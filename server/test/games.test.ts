import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAction, createGame, type GameState } from '../../shared/engine'
import type {
  ApiError,
  CreateGameResponse,
  JoinGameResponse,
  LookupGameResponse,
} from '../../shared/protocol'
import { appendEvent, getGame, listEventsSince, listPlayers, setStatus } from '../db'
import { ACTIVE_TTL_MS, WAITING_TTL_MS } from '../games'
import { hashToken } from '../auth/tokens'
import { gameRng } from '../rng'
import { api } from './api'

const create = (body: unknown = { name: 'Ada', chatOn: true, videoOn: false }) =>
  api<CreateGameResponse>('POST', '/api/games', { body })

const join = (code: string, body: unknown = { name: 'Bo' }) =>
  api<JoinGameResponse>('POST', `/api/games/${code}/join`, { body })

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/games', () => {
  it('creates a waiting game and returns a code, a token and a starting cursor', async () => {
    const res = await create()
    expect(res.status).toBe(201)
    expect(res.body.code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{5}$/)
    expect(res.body.seat).toBe(0)
    expect(res.body.playerToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(res.body.cursor).toBe(0)

    const game = await getGame(env.DB, res.body.code)
    expect(game?.status).toBe('waiting')
    expect(game?.state).toEqual(createGame())
    const [host] = await listPlayers(env.DB, res.body.code)
    expect(host).toMatchObject({ seat: 0, name: 'Ada', chatOn: true, videoOn: false })
    // Only the hash of the token is stored.
    expect(host?.tokenHash).toBe(await hashToken(res.body.playerToken))
    expect(JSON.stringify(host)).not.toContain(res.body.playerToken)
  })

  it('expires a waiting game after an hour', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000, toFake: ['Date'] })
    const res = await create()
    expect((await getGame(env.DB, res.body.code))?.expiresAt).toBe(
      1_800_000_000_000 + WAITING_TTL_MS,
    )
  })

  it('picks another code when the random one is taken', async () => {
    const taken = (await create()).body.code
    // Make the next five letter draws spell the taken code; later draws are real randomness.
    const letters = 'BCDFGHJKLMNPQRSTVWXZ'
    const queue = [...taken].map((c) => letters.indexOf(c))
    const original = crypto.getRandomValues.bind(crypto)
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
      if (array instanceof Uint32Array && array.length === 1 && queue.length) {
        array[0] = queue.shift()!
        return array
      }
      return original(array)
    }) as typeof crypto.getRandomValues)
    try {
      const res = await create()
      expect(queue).toEqual([]) // the taken code was really drawn
      expect(res.status).toBe(201)
      expect(res.body.code).not.toBe(taken)
    } finally {
      spy.mockRestore()
    }
  })

  it('trims the name', async () => {
    const res = await create({ name: '  Ada  Lovelace ', chatOn: false, videoOn: true })
    const [host] = await listPlayers(env.DB, res.body.code)
    expect(host).toMatchObject({ name: 'Ada Lovelace', chatOn: false, videoOn: true })
  })

  it.each([
    ['a missing name', { chatOn: true, videoOn: false }],
    ['an empty name', { name: '   ', chatOn: true, videoOn: false }],
    ['a name over 20 characters', { name: 'x'.repeat(21), chatOn: true, videoOn: false }],
    ['a non-boolean switch', { name: 'Ada', chatOn: 'yes', videoOn: false }],
    ['an extra field', { name: 'Ada', chatOn: true, videoOn: false, seat: 1 }],
  ])('rejects %s with 400 bad_request', async (_, body) => {
    const res = await create(body)
    expect(res.status).toBe(400)
    expect((res.body as unknown as ApiError).error).toMatchObject({ code: 'bad_request' })
    expect((res.body as unknown as ApiError).error.message).not.toBe('')
  })

  it('rejects a body that is not JSON', async () => {
    const res = await api<ApiError>('POST', '/api/games', { rawBody: '{nope' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('bad_request')
  })
})

describe('GET /api/games/:code', () => {
  it('returns the host’s name and settings, and nothing secret', async () => {
    const created = await create({ name: 'Ada', chatOn: true, videoOn: true })
    const res = await api<LookupGameResponse>('GET', `/api/games/${created.body.code}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      code: created.body.code,
      status: 'waiting',
      hostName: 'Ada',
      hostChatOn: true,
      hostVideoOn: true,
      joinable: true,
    })
    expect(res.text).not.toContain(created.body.playerToken)
    expect(res.text).not.toContain('token')
    expect(res.text).not.toContain('state')
  })

  it('accepts the code in any case', async () => {
    const created = await create()
    const res = await api('GET', `/api/games/${created.body.code.toLowerCase()}`)
    expect(res.status).toBe(200)
  })

  it('is no longer joinable once the second player is in', async () => {
    const created = await create()
    await join(created.body.code)
    const res = await api<LookupGameResponse>('GET', `/api/games/${created.body.code}`)
    expect(res.body).toMatchObject({ status: 'active', joinable: false })
  })

  it.each(['QQQQQ', 'AEIOU', 'toolong'])('answers 404 game_not_found for %s', async (code) => {
    const res = await api<ApiError>('GET', `/api/games/${code}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('game_not_found')
  })

  it('treats a game as expired from the exact moment it expires', async () => {
    const created = await create()
    const { expiresAt } = (await getGame(env.DB, created.body.code))!
    vi.useFakeTimers({ now: expiresAt - 1, toFake: ['Date'] })
    expect((await api('GET', `/api/games/${created.body.code}`)).status).toBe(200)
    vi.setSystemTime(expiresAt)
    expect((await api('GET', `/api/games/${created.body.code}`)).status).toBe(404)
  })

  it('answers 404 for an expired game', async () => {
    const created = await create()
    vi.useFakeTimers({ now: Date.now() + WAITING_TTL_MS + 1, toFake: ['Date'] })
    const res = await api<ApiError>('GET', `/api/games/${created.body.code}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('game_not_found')
  })
})

describe('POST /api/games/:code/join', () => {
  it('takes seat 1, starts the game and deals the first hand', async () => {
    const created = await create()
    const res = await join(created.body.code, { name: 'Bo', chatOn: false, videoOn: true })
    expect(res.status).toBe(200)
    expect(res.body.seat).toBe(1)
    expect(res.body.playerToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(res.body.playerToken).not.toBe(created.body.playerToken)

    const game = await getGame(env.DB, created.body.code)
    expect(game?.status).toBe('active')
    expect(game?.state.phase).toBe('discard')
    expect(game?.state.hand).toBe(1)
    expect(game?.state.hands.map((h) => h.length)).toEqual([6, 6])
    expect(game?.version).toBe(1)
    const players = await listPlayers(env.DB, created.body.code)
    expect(players[1]).toMatchObject({ seat: 1, name: 'Bo', chatOn: false, videoOn: true })
  })

  it('gives the guest a cursor just before the opening events', async () => {
    const created = await create()
    // An earlier event (e.g. a system notice) must not be replayed, nor the opening skipped.
    const earlier = (await appendEvent(
      env.DB,
      created.body.code,
      { kind: 'system', payload: { note: 'before the join' } },
      Date.now(),
    )) as number
    const res = await join(created.body.code)
    expect(res.body.cursor).toBe(earlier)
    const events = await listEventsSince(env.DB, created.body.code, res.body.cursor, 1, 100)
    expect(events).toHaveLength(1)
    const [opening] = events
    expect(opening?.kind).toBe('game')
    expect(opening?.kind === 'game' ? opening.payload.events.map((e) => e.type) : []).toEqual([
      'cut_for_deal',
      'hand_dealt',
    ])
  })

  it('turns chat on and video off for a guest who doesn’t choose', async () => {
    const created = await create()
    await join(created.body.code, { name: 'Bo' })
    const guest = (await listPlayers(env.DB, created.body.code))[1]
    expect(guest).toMatchObject({ chatOn: true, videoOn: false })
  })

  it('makes the game last 24 hours after the join', async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000, toFake: ['Date'] })
    const created = await create()
    await join(created.body.code)
    expect((await getGame(env.DB, created.body.code))?.expiresAt).toBe(
      1_800_000_000_000 + ACTIVE_TTL_MS,
    )
  })

  it('lets exactly one of two simultaneous joins in; the other gets 409 game_full', async () => {
    const created = await create()
    const results = await Promise.all([
      join(created.body.code, { name: 'One' }),
      join(created.body.code, { name: 'Two' }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const loser = results.find((r) => r.status === 409)!
    expect((loser.body as unknown as ApiError).error.code).toBe('game_full')
    expect(await listPlayers(env.DB, created.body.code)).toHaveLength(2)
  })

  it('answers 409 game_full when the game already has two players', async () => {
    const created = await create()
    await join(created.body.code)
    const res = await join(created.body.code)
    expect(res.status).toBe(409)
    expect((res.body as unknown as ApiError).error.code).toBe('game_full')
  })

  it.each(['finished', 'abandoned'] as const)(
    'answers 410 game_ended for a %s game',
    async (status) => {
      const created = await create()
      await setStatus(env.DB, created.body.code, 0, { status, now: Date.now() })
      const res = await join(created.body.code)
      expect(res.status).toBe(410)
      expect((res.body as unknown as ApiError).error.code).toBe('game_ended')
    },
  )

  it('answers 404 for an unknown or expired game', async () => {
    expect((await join('QQQQQ')).status).toBe(404)
    const created = await create()
    vi.useFakeTimers({ now: Date.now() + WAITING_TTL_MS + 1, toFake: ['Date'] })
    const res = await join(created.body.code)
    expect(res.status).toBe(404)
    expect((res.body as unknown as ApiError).error.code).toBe('game_not_found')
  })

  it('rejects an invalid body with 400 and writes nothing', async () => {
    const created = await create()
    const res = await join(created.body.code, { name: '' })
    expect(res.status).toBe(400)
    expect((res.body as unknown as ApiError).error.code).toBe('bad_request')
    expect(await listPlayers(env.DB, created.body.code)).toHaveLength(1)
  })
})

describe('reproducible deals', () => {
  it('deals the first hand from TEST_SEED + code + version when ENVIRONMENT is test', async () => {
    const created = await create()
    await join(created.body.code)
    const game = await getGame(env.DB, created.body.code)
    const expected = applyAction(
      createGame(),
      0,
      { type: 'start' },
      gameRng({ ENVIRONMENT: 'test', TEST_SEED: 'server-tests' }, created.body.code, 0),
    ) as { state: GameState }
    expect(game?.state).toEqual(expected.state)
  })

  it('uses the seed only in test and development', () => {
    const draw = (e: { ENVIRONMENT?: string; TEST_SEED?: string }) =>
      Array.from({ length: 8 }, () => gameRng(e, 'BCDFG', 3).nextInt(1_000_000)).join()
    for (const environment of ['test', 'development']) {
      const e = { ENVIRONMENT: environment, TEST_SEED: 'x' }
      expect(draw(e)).toBe(draw(e))
    }
    // Real randomness: two draws of eight numbers from a million agree only by chance.
    for (const environment of ['production', 'preview', 'Test', 'dev', '', undefined]) {
      const e = { ENVIRONMENT: environment, TEST_SEED: 'x' }
      expect(draw(e)).not.toBe(draw(e))
    }
    expect(draw({ ENVIRONMENT: 'test' })).not.toBe(draw({ ENVIRONMENT: 'test' }))
  })

  it('derives the seed from the game code and the state version', () => {
    const e = { ENVIRONMENT: 'test', TEST_SEED: 'x' }
    const draw = (code: string, version: number) =>
      Array.from({ length: 8 }, () => gameRng(e, code, version).nextInt(1_000_000)).join()
    expect(draw('BCDFG', 3)).not.toBe(draw('BCDFG', 4))
    expect(draw('BCDFG', 3)).not.toBe(draw('BCDFH', 3))
  })
})

describe('API plumbing', () => {
  it('marks API responses, errors included, as not cacheable', async () => {
    const created = await create()
    expect(created.headers.get('cache-control')).toBe('no-store')
    const missing = await api('GET', '/api/games/QQQQQ')
    expect(missing.headers.get('cache-control')).toBe('no-store')
    const noRoute = await api('GET', '/api/nothing/here')
    expect(noRoute.status).toBe(404)
    expect(noRoute.headers.get('cache-control')).toBe('no-store')
  })

  it('answers unknown methods on real routes with the JSON 404', async () => {
    const res = await api<ApiError>('DELETE', '/api/games')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('not_found')
  })
})

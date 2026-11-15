import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAction, type CardId } from '../../shared/engine'
import type {
  ApiError,
  CreateGameResponse,
  JoinGameResponse,
  ServerEvent,
  SyncResponse,
} from '../../shared/protocol'
import { appendEvent, getGame, listPlayers, saveState, setStatus } from '../db'
import { ACTIVE_TTL_MS } from '../games'
import { gameRng } from '../rng'
import { CONNECTED_WINDOW_MS, PRESENCE_WRITE_INTERVAL_MS, SYNC_EVENT_LIMIT } from '../sync'
import { api } from './api'

afterEach(() => {
  vi.useRealTimers()
})

interface Seats {
  code: string
  host: { token: string; cursor: number }
  guest: { token: string; cursor: number }
}

async function createAndJoin(): Promise<Seats> {
  const created = await api<CreateGameResponse>('POST', '/api/games', {
    body: { name: 'Ada', chatOn: true, videoOn: false },
  })
  const joined = await api<JoinGameResponse>('POST', `/api/games/${created.body.code}/join`, {
    body: { name: 'Bo' },
  })
  return {
    code: created.body.code,
    host: { token: created.body.playerToken, cursor: created.body.cursor },
    guest: { token: joined.body.playerToken, cursor: joined.body.cursor },
  }
}

function sync(code: string, token: string | undefined, query: Record<string, number> = {}) {
  const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))
  const qs = params.size ? `?${params}` : ''
  return api<SyncResponse>('GET', `/api/games/${code}/sync${qs}`, { token })
}

const gameEventTypes = (events: ServerEvent[]) =>
  events.flatMap((e) => (e.kind === 'game' ? e.payload.events.map((g) => g.type) : []))

/** Applies an engine action directly to the stored game, as another request would. */
async function writeAction(code: string, seat: 0 | 1, action: Parameters<typeof applyAction>[2]) {
  const game = (await getGame(env.DB, code))!
  const result = applyAction(game.state, seat, action, gameRng(env, code, game.version))
  if ('error' in result) throw new Error(result.error)
  const now = Date.now()
  const saved = await saveState(env.DB, code, game.version, {
    state: result.state,
    status: 'active',
    gameEvents: { fromSeat: seat, events: result.events },
    now,
    expiresAt: now + ACTIVE_TTL_MS,
  })
  if (!saved.ok) throw new Error('conflict')
}

describe('GET /api/games/:code/sync', () => {
  it('gives the guest the opening deal from the cursor returned by join', async () => {
    const g = await createAndJoin()
    const res = await sync(g.code, g.guest.token, { cursor: g.guest.cursor })
    expect(res.status).toBe(200)
    expect(gameEventTypes(res.body.events)).toEqual(['cut_for_deal', 'hand_dealt'])
    expect(res.body.status).toBe('active')
    expect(res.body.view?.seat).toBe(1)
    expect(res.body.view?.phase).toBe('discard')
    expect(res.body.view?.myHand).toHaveLength(6)
    expect(res.body.cursor).toBe(res.body.events.at(-1)?.id)
    expect(res.body.more).toBe(false)
    expect(res.body.players.map((p) => [p.seat, p.name])).toEqual([
      [0, 'Ada'],
      [1, 'Bo'],
    ])
  })

  it('never sends a seat the other player’s hand or the deck', async () => {
    const g = await createAndJoin()
    const { state } = (await getGame(env.DB, g.code))!
    for (const [seat, token] of [
      [0, g.host.token],
      [1, g.guest.token],
    ] as const) {
      const res = await sync(g.code, token, { cursor: 0 })
      const hidden = [...state.hands[seat === 0 ? 1 : 0], ...state.deck]
      // The cut for first deal shows two cards that are shuffled back before the deal, so they
      // say nothing about anyone's hand; leave that one event out of the check.
      const checked = JSON.stringify({
        ...res.body,
        events: res.body.events.map((e) =>
          e.kind === 'game'
            ? {
                ...e,
                payload: { events: e.payload.events.filter((x) => x.type !== 'cut_for_deal') },
              }
            : e,
        ),
      })
      const leaked = hidden.filter((card) => checked.includes(`"${card}"`))
      expect(leaked).toEqual([])
      expect(gameEventTypes(res.body.events)).toContain('cut_for_deal')
      // ...but it does contain their own hand.
      for (const card of state.hands[seat]) expect(res.text).toContain(`"${card}"`)
      // No token or token hash of either player, under any name.
      for (const p of await listPlayers(env.DB, g.code)) expect(res.text).not.toContain(p.tokenHash)
      expect(res.text).not.toContain(g.host.token)
      expect(res.text).not.toContain(g.guest.token)
    }
  })

  it('snaps a client without a cursor to the present: no history, newest cursor, a view', async () => {
    const g = await createAndJoin()
    const res = await sync(g.code, g.host.token)
    expect(res.body.events).toEqual([])
    const latest = await sync(g.code, g.host.token, { cursor: 0 })
    expect(res.body.cursor).toBe(latest.body.cursor)
    expect(res.body.view?.myHand).toHaveLength(6)
  })

  it('leaves out the view and events when nothing changed', async () => {
    const g = await createAndJoin()
    const first = await sync(g.code, g.host.token, { cursor: 0 })
    const again = await sync(g.code, g.host.token, {
      cursor: first.body.cursor,
      v: first.body.version!,
    })
    expect(again.body.view).toBeUndefined()
    expect(again.body.events).toEqual([])
    expect(again.body.cursor).toBe(first.body.cursor)
    expect(again.body.version).toBe(first.body.version)
  })

  it('returns a view at least as new as the newest event, after a write between two syncs', async () => {
    const g = await createAndJoin()
    const first = await sync(g.code, g.host.token, { cursor: g.host.cursor })
    const { state } = (await getGame(env.DB, g.code))!
    await writeAction(g.code, 1, {
      type: 'discard',
      cards: state.hands[1].slice(0, 2) as [CardId, CardId],
    })

    const second = await sync(g.code, g.host.token, {
      cursor: first.body.cursor,
      v: first.body.version!,
    })
    expect(gameEventTypes(second.body.events)).toEqual(['discarded'])
    expect(second.body.version).toBe(first.body.version! + 1)
    expect(second.body.view?.hasDiscarded).toEqual([false, true])
    expect(second.body.view?.cribCount).toBe(2)
  })

  it('delivers every event exactly once across truncated pages, with the view on the last', async () => {
    const g = await createAndJoin()
    const total = SYNC_EVENT_LIMIT * 2 + 37
    for (let i = 0; i < total; i++) {
      await appendEvent(env.DB, g.code, { kind: 'chat', fromSeat: 0, payload: { i } }, Date.now())
    }
    const seen: number[] = []
    const pages: { events: number; more: boolean; view: boolean; cursorIsLastEvent: boolean }[] = []
    let cursor = g.guest.cursor
    for (let more = true; more;) {
      const res = await sync(g.code, g.guest.token, { cursor })
      seen.push(...res.body.events.map((e) => e.id))
      pages.push({
        events: res.body.events.length,
        more: res.body.more,
        view: res.body.view !== undefined,
        cursorIsLastEvent: res.body.cursor === (res.body.events.at(-1)?.id ?? cursor),
      })
      cursor = res.body.cursor
      more = res.body.more && pages.length < 10
    }
    // Full pages without a view, then the last page with the rest and the view.
    expect(pages).toEqual([
      { events: SYNC_EVENT_LIMIT, more: true, view: false, cursorIsLastEvent: true },
      { events: SYNC_EVENT_LIMIT, more: true, view: false, cursorIsLastEvent: true },
      {
        events: total + 1 - 2 * SYNC_EVENT_LIMIT,
        more: false,
        view: true,
        cursorIsLastEvent: true,
      },
    ])
    expect(seen).toHaveLength(total + 1) // the opening deal plus every chat message
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('still delivers the final view to a client that copies version from every page', async () => {
    const g = await createAndJoin()
    for (let i = 0; i < SYNC_EVENT_LIMIT + 5; i++) {
      await appendEvent(env.DB, g.code, { kind: 'chat', fromSeat: 0, payload: { i } }, Date.now())
    }
    let cursor = g.guest.cursor
    let v: number | undefined
    let view = false
    for (let more = true, pages = 0; more && pages < 5; pages++) {
      const res = await sync(g.code, g.guest.token, { cursor, ...(v === undefined ? {} : { v }) })
      cursor = res.body.cursor
      v = res.body.version // naive client code: copy it whatever the page
      view = res.body.view !== undefined
      more = res.body.more
    }
    expect(view).toBe(true)
  })

  it('sends exactly a full page of new events as one page', async () => {
    const g = await createAndJoin()
    const start = (await sync(g.code, g.host.token)).body.cursor
    for (let i = 0; i < SYNC_EVENT_LIMIT; i++) {
      await appendEvent(env.DB, g.code, { kind: 'chat', fromSeat: 1, payload: { i } }, Date.now())
    }
    const res = await sync(g.code, g.host.token, { cursor: start })
    expect(res.body.events).toHaveLength(SYNC_EVENT_LIMIT)
    expect(res.body.more).toBe(false)
    expect(res.body.view).toBeDefined()
  })

  it('moves the cursor past events addressed only to the other seat', async () => {
    const g = await createAndJoin()
    const start = (await sync(g.code, g.host.token)).body.cursor
    let last = 0
    for (let i = 0; i < 3; i++) {
      last = (await appendEvent(
        env.DB,
        g.code,
        { kind: 'signal', fromSeat: 0, toSeat: 1, payload: { i } },
        Date.now(),
      )) as number
    }
    const res = await sync(g.code, g.host.token, { cursor: start })
    expect(res.body.events).toEqual([])
    expect(res.body.cursor).toBe(last)
    // ...while the guest still receives them.
    expect((await sync(g.code, g.guest.token, { cursor: start })).body.events).toHaveLength(3)
  })

  it('snaps a cursor from beyond the end of the log back to the present', async () => {
    const g = await createAndJoin()
    const latest = (await sync(g.code, g.host.token)).body.cursor
    const lost = await sync(g.code, g.host.token, { cursor: latest + 1_000_000 })
    expect(lost.body.cursor).toBe(latest)
    expect(lost.body.view).toBeDefined()
    const id = await appendEvent(env.DB, g.code, { kind: 'chat', payload: {} }, Date.now())
    const next = await sync(g.code, g.host.token, { cursor: lost.body.cursor })
    expect(next.body.events.map((e) => e.id)).toEqual([id])
  })

  it('never delivers an event addressed to one seat to the other', async () => {
    const g = await createAndJoin()
    const start = (await sync(g.code, g.host.token)).body.cursor
    await appendEvent(
      env.DB,
      g.code,
      { kind: 'signal', fromSeat: 0, toSeat: 1, payload: { offer: 'x' } },
      1,
    )
    await appendEvent(
      env.DB,
      g.code,
      { kind: 'signal', fromSeat: 1, toSeat: 0, payload: { answer: 'y' } },
      1,
    )
    const host = await sync(g.code, g.host.token, { cursor: start })
    const guest = await sync(g.code, g.guest.token, { cursor: start })
    expect(host.body.events.map((e) => e.payload)).toEqual([{ answer: 'y' }])
    expect(guest.body.events.map((e) => e.payload)).toEqual([{ offer: 'x' }])
    expect(host.text).not.toContain('offer')
    expect(guest.text).not.toContain('answer')
  })

  it('works while the game is waiting for its second player', async () => {
    const created = await api<CreateGameResponse>('POST', '/api/games', {
      body: { name: 'Ada', chatOn: true, videoOn: false },
    })
    const res = await sync(created.body.code, created.body.playerToken, { cursor: 0 })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('waiting')
    expect(res.body.view?.phase).toBe('lobby')
    expect(res.body.events).toEqual([])
    expect(res.body.players).toHaveLength(1)
  })

  it('offers no moves once the game is no longer active', async () => {
    const g = await createAndJoin()
    const game = (await getGame(env.DB, g.code))!
    await setStatus(env.DB, g.code, game.version, { status: 'abandoned', now: Date.now() })
    const res = await sync(g.code, g.host.token)
    expect(res.body.status).toBe('abandoned')
    expect(res.body.view?.legal).toEqual({
      discard: false,
      cut: false,
      playable: [],
      go: false,
      ready: false,
    })
  })
})

describe('presence', () => {
  it('shows a player as gone after the timeout, and back on their next poll, with few writes', async () => {
    const t0 = Date.now()
    vi.useFakeTimers({ now: t0, toFake: ['Date'] })
    const g = await createAndJoin()
    const lastSeen = async (seat: 0 | 1) =>
      (await listPlayers(env.DB, g.code)).find((p) => p.seat === seat)!.lastSeenAt
    const guestAsSeenByHost = async () =>
      (await sync(g.code, g.host.token)).body.players.find((p) => p.seat === 1)!.connected

    expect(await guestAsSeenByHost()).toBe(true)

    // Polls within the write interval don't touch the database.
    await sync(g.code, g.guest.token)
    expect(await lastSeen(1)).toBe(t0)
    vi.setSystemTime(t0 + PRESENCE_WRITE_INTERVAL_MS - 1)
    await sync(g.code, g.guest.token)
    expect(await lastSeen(1)).toBe(t0)

    // The guest stops polling: after the window they show as disconnected.
    vi.setSystemTime(t0 + CONNECTED_WINDOW_MS + 1)
    expect(await guestAsSeenByHost()).toBe(false)

    // One poll later they are back, and that poll wrote last_seen_at.
    await sync(g.code, g.guest.token)
    expect(await lastSeen(1)).toBe(t0 + CONNECTED_WINDOW_MS + 1)
    expect(await guestAsSeenByHost()).toBe(true)
  })

  it('always shows the caller as connected', async () => {
    const t0 = Date.now()
    vi.useFakeTimers({ now: t0, toFake: ['Date'] })
    const g = await createAndJoin()
    vi.setSystemTime(t0 + 10 * CONNECTED_WINDOW_MS)
    const res = await sync(g.code, g.host.token)
    expect(res.body.players.find((p) => p.seat === 0)?.connected).toBe(true)
  })
})

describe('errors', () => {
  it.each([
    ['no token', undefined],
    ['an unknown token', 'not-a-real-token'],
  ])('answers 401 for %s', async (_, token) => {
    const g = await createAndJoin()
    const res = await sync(g.code, token)
    expect(res.status).toBe(401)
    expect((res.body as unknown as ApiError).error.code).toBe('unauthorized')
  })

  it('answers 401 for a token from another game', async () => {
    const a = await createAndJoin()
    const b = await createAndJoin()
    const res = await sync(b.code, a.host.token)
    expect(res.status).toBe(401)
  })

  it.each(['Basic abc', 'Bearer', 'Bearer a b', 'token-without-scheme'])(
    'answers 401 for the Authorization header %j',
    async (header) => {
      const g = await createAndJoin()
      const res = await exports.default.fetch(`http://localhost/api/games/${g.code}/sync`, {
        headers: { Authorization: header },
      })
      expect(res.status).toBe(401)
    },
  )

  it('answers 404 for an unknown or expired game', async () => {
    const g = await createAndJoin()
    expect((await sync('QQQQQ', g.host.token)).status).toBe(404)
    vi.useFakeTimers({ now: Date.now() + ACTIVE_TTL_MS + 1, toFake: ['Date'] })
    const res = await sync(g.code, g.host.token)
    expect(res.status).toBe(404)
    expect((res.body as unknown as ApiError).error.code).toBe('game_not_found')
  })

  it('answers 400 for a malformed cursor', async () => {
    const g = await createAndJoin()
    const res = await api<ApiError>('GET', `/api/games/${g.code}/sync?cursor=abc`, {
      token: g.host.token,
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('bad_request')
  })
})

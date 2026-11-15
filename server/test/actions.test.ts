import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { leakedCards, otherSeat, type CardId, type GameEvent } from '../../shared/engine'
import type {
  ApiError,
  CreateGameResponse,
  JoinGameResponse,
  SyncResponse,
} from '../../shared/protocol'
import { playBotGame } from '../../shared/testing/http-bot'
import { getGame, setStatus } from '../db'
import { api } from './api'

interface Game {
  code: string
  tokens: [string, string]
  cursors: [number, number]
}

async function newGame(): Promise<Game> {
  const created = await api<CreateGameResponse>('POST', '/api/games', {
    body: { name: 'Ada', chatOn: true, videoOn: false },
  })
  const joined = await api<JoinGameResponse>('POST', `/api/games/${created.body.code}/join`, {
    body: { name: 'Bo' },
  })
  return {
    code: created.body.code,
    tokens: [created.body.playerToken, joined.body.playerToken],
    cursors: [created.body.cursor, joined.body.cursor],
  }
}

async function eventRows(code: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE game_code = ?')
    .bind(code)
    .first<{ n: number }>()
  return row?.n ?? 0
}

function act(g: Game, seat: 0 | 1, body: Record<string, unknown>) {
  return api<SyncResponse>('POST', `/api/games/${g.code}/actions`, {
    token: g.tokens[seat],
    body: { hand: 1, cursor: g.cursors[seat], v: 0, ...body },
  })
}

/** Each engine event in the response, with the seat whose request caused it. */
const gameEvents = (res: SyncResponse): { type: GameEvent['type']; by?: number }[] =>
  res.events.flatMap((e) =>
    e.kind === 'game' ? e.payload.events.map((g) => ({ type: g.type, by: e.from })) : [],
  )

/** The first two cards of a seat's hand, from the stored state. */
async function twoCards(code: string, seat: 0 | 1): Promise<[CardId, CardId]> {
  const { state } = (await getGame(env.DB, code))!
  return state.hands[seat].slice(0, 2) as [CardId, CardId]
}

describe('POST /api/games/:code/actions', () => {
  it('applies a legal move: new state, version + 1 and one event row, all together', async () => {
    const g = await newGame()
    const before = (await getGame(env.DB, g.code))!
    const rows = await eventRows(g.code)
    const cards = await twoCards(g.code, 0)

    const res = await act(g, 0, { action: { type: 'discard', cards } })
    expect(res.status).toBe(200)
    expect(res.body.version).toBe(before.version + 1)
    expect(res.body.view?.myDiscards.slice().sort()).toEqual([...cards].sort())
    const after = (await getGame(env.DB, g.code))!
    expect(after.version).toBe(before.version + 1)
    expect(after.state.discards[0].slice().sort()).toEqual([...cards].sort())
    expect(await eventRows(g.code)).toBe(rows + 1)
  })

  it('answers with every event after the client’s cursor: the opponent’s first, then its own', async () => {
    const g = await newGame()
    // The guest has synced the opening deal; then the host discards before the guest moves.
    const opening = await api<SyncResponse>(
      'GET',
      `/api/games/${g.code}/sync?cursor=${g.cursors[1]}`,
      { token: g.tokens[1] },
    )
    await act(g, 0, { action: { type: 'discard', cards: await twoCards(g.code, 0) } })

    const res = await act(g, 1, {
      action: { type: 'discard', cards: await twoCards(g.code, 1) },
      cursor: opening.body.cursor,
      v: opening.body.version,
    })
    expect(res.status).toBe(200)
    expect(gameEvents(res.body).map((e) => [e.type, e.by])).toEqual([
      ['discarded', 0],
      ['discarded', 1],
    ])
    expect(res.body.view?.phase).toBe('cut')
    expect(res.body.cursor).toBe(res.body.events.at(-1)?.id)
  })

  it('rejects an illegal move with 422, the engine’s code and a message, and writes nothing', async () => {
    const g = await newGame()
    const before = (await getGame(env.DB, g.code))!
    const rows = await eventRows(g.code)
    const theirs = await twoCards(g.code, 1)

    for (const [action, code] of [
      [{ type: 'discard', cards: theirs }, 'card_not_in_hand'],
      [{ type: 'cut' }, 'wrong_phase'],
      [{ type: 'play', card: theirs[0] }, 'wrong_phase'],
    ] as const) {
      const res = await act(g, 0, { action })
      expect(res.status).toBe(422)
      const error = (res.body as unknown as ApiError).error
      expect(error.code).toBe(code)
      expect(error.message.length).toBeGreaterThan(5)
    }
    expect((await getGame(env.DB, g.code))!).toEqual(before)
    expect(await eventRows(g.code)).toBe(rows)
  })

  it('lets both players discard at the same moment', async () => {
    for (let round = 0; round < 5; round++) {
      const g = await newGame()
      // Read both hands first, so the two requests really overlap.
      const [mine, theirs] = [await twoCards(g.code, 0), await twoCards(g.code, 1)]
      const [a, b] = await Promise.all([
        act(g, 0, { action: { type: 'discard', cards: mine } }),
        act(g, 1, { action: { type: 'discard', cards: theirs } }),
      ])
      expect([a.status, b.status]).toEqual([200, 200])
      const after = (await getGame(env.DB, g.code))!
      expect(after.state.phase).toBe('cut')
      expect(after.version).toBe(3)
    }
  })

  it('never applies the same request twice', async () => {
    const g = await newGame()
    const discard = { action: { type: 'discard', cards: await twoCards(g.code, 0) } }
    expect((await act(g, 0, discard)).status).toBe(200)
    const again = await act(g, 0, discard)
    expect(again.status).toBe(422)
    expect((again.body as unknown as ApiError).error.code).toBe('already_discarded')
    expect((await getGame(env.DB, g.code))!.version).toBe(2)
  })

  it('treats a repeated ready as a no-op that writes nothing', async () => {
    const g = await newGame()
    // Put the stored game in the show phase, where ready is the move.
    const game = (await getGame(env.DB, g.code))!
    const show = { ...game.state, phase: 'show' as const }
    await env.DB.prepare('UPDATE games SET state = ? WHERE code = ?')
      .bind(JSON.stringify(show), g.code)
      .run()
    expect((await act(g, 0, { action: { type: 'ready' } })).status).toBe(200)
    const version = (await getGame(env.DB, g.code))!.version
    const rows = await eventRows(g.code)
    const again = await act(g, 0, { action: { type: 'ready' } })
    expect(again.status).toBe(200)
    expect((await getGame(env.DB, g.code))!.version).toBe(version)
    expect(await eventRows(g.code)).toBe(rows)
  })

  it('refuses an action for another hand with 409 stale_action, writing nothing', async () => {
    const g = await newGame()
    const before = (await getGame(env.DB, g.code))!
    const res = await act(g, 0, {
      action: { type: 'discard', cards: await twoCards(g.code, 0) },
      hand: 2,
    })
    expect(res.status).toBe(409)
    expect((res.body as unknown as ApiError).error.code).toBe('stale_action')
    expect((await getGame(env.DB, g.code))!).toEqual(before)
  })

  it('refuses a late ready from an earlier hand, so it can’t land in this one', async () => {
    const g = await newGame()
    const game = (await getGame(env.DB, g.code))!
    // The game is now in hand 2's show, where a ready would be legal.
    await env.DB.prepare('UPDATE games SET state = ? WHERE code = ?')
      .bind(JSON.stringify({ ...game.state, hand: 2, phase: 'show' }), g.code)
      .run()
    const before = (await getGame(env.DB, g.code))!
    const rows = await eventRows(g.code)
    const res = await act(g, 0, { action: { type: 'ready' }, hand: 1 })
    expect(res.status).toBe(409)
    expect((res.body as unknown as ApiError).error.code).toBe('stale_action')
    expect((await getGame(env.DB, g.code))!).toEqual(before)
    expect(await eventRows(g.code)).toBe(rows)
  })

  it.each(['finished', 'abandoned'] as const)(
    'answers 410 game_ended for a %s game and writes nothing',
    async (status) => {
      const g = await newGame()
      const game = (await getGame(env.DB, g.code))!
      await setStatus(env.DB, g.code, game.version, { status, now: Date.now() })
      const before = (await getGame(env.DB, g.code))!
      const res = await act(g, 0, { action: { type: 'discard', cards: await twoCards(g.code, 0) } })
      expect(res.status).toBe(410)
      expect((res.body as unknown as ApiError).error.code).toBe('game_ended')
      expect((await getGame(env.DB, g.code))!).toEqual(before)
    },
  )

  it('answers 404 for an expired game', async () => {
    const g = await newGame()
    await env.DB.prepare('UPDATE games SET expires_at = ? WHERE code = ?')
      .bind(Date.now() - 1, g.code)
      .run()
    const res = await act(g, 0, { action: { type: 'discard', cards: await twoCards(g.code, 0) } })
    expect(res.status).toBe(404)
  })

  it('checks the token, the game and the body', async () => {
    const g = await newGame()
    const body = { action: { type: 'cut' }, hand: 1, cursor: 0, v: 0 }
    const noToken = await api('POST', `/api/games/${g.code}/actions`, { body })
    expect(noToken.status).toBe(401)
    const unknown = await api('POST', '/api/games/QQQQQ/actions', { body, token: g.tokens[0] })
    expect(unknown.status).toBe(404)
    const start = await api<ApiError>('POST', `/api/games/${g.code}/actions`, {
      body: { ...body, action: { type: 'start' } },
      token: g.tokens[0],
    })
    expect(start.status).toBe(400)
    expect(start.body.error.code).toBe('bad_request')
  })
})

describe('a whole game over HTTP', () => {
  it.each(['first', 'second'])(
    'two bots play to the end (%s seed), and no response ever shows a hidden card',
    async (seed) => {
      const leaks: string[] = []
      let responses = 0
      const result = await playBotGame(
        { request: (method, path, init) => api(method, path, init ?? {}) },
        {
          seed,
          onResponse: async ({ code, seat, path, text }) => {
            responses++
            const { state } = (await getGame(env.DB, code))!
            // The cut for first deal shows two cards that are shuffled back before the deal;
            // check they are exactly the cut cards, then leave them out of the scan.
            const body = JSON.parse(text) as SyncResponse
            const events = (body.events ?? []).map((e) =>
              e.kind !== 'game'
                ? e
                : {
                    ...e,
                    payload: {
                      events: e.payload.events.filter((x) => {
                        if (x.type !== 'cut_for_deal') return true
                        // Exactly the cut cards and the dealer, nothing more.
                        const expected = {
                          type: 'cut_for_deal',
                          cards: state.firstCut,
                          dealer: x.dealer,
                        }
                        if (JSON.stringify(x) !== JSON.stringify(expected)) {
                          leaks.push(`${path}: cut_for_deal is ${JSON.stringify(x)}`)
                        }
                        return false
                      }),
                    },
                  },
            )
            const leaked = leakedCards(JSON.stringify({ ...body, events }), state, seat)
            if (leaked.length) leaks.push(`seat ${seat} ${path}: ${leaked.join(' ')}`)
          },
        },
      )
      expect(leaks).toEqual([])
      expect(result.scores[result.winner]).toBe(121)
      expect(result.scores[otherSeat(result.winner)]).toBeLessThan(121)
      expect(result.actions).toBeGreaterThan(50)
      expect(responses).toBeGreaterThan(result.actions)
      const game = (await getGame(env.DB, result.code))!
      expect(game.status).toBe('finished')
      expect(game.state.phase).toBe('game_over')
    },
    120_000,
  )
})

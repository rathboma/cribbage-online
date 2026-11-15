/**
 * Two random bots playing a whole game through the HTTP API, each seeing only what its own sync
 * responses tell it. Used by the server's full-game test (against local D1) and by
 * `yarn bot:play` (against a running dev server). The transport is injected, so this file has no
 * platform dependencies.
 */
import { chooseMove, seededRng, type PlayerView, type Seat } from '../engine'
import type { CreateGameResponse, JoinGameResponse, SyncResponse } from '../protocol'

export interface BotTransport {
  request(
    method: 'GET' | 'POST',
    path: string,
    options?: { body?: unknown; token?: string },
  ): Promise<{ status: number; body: unknown; text: string }>
}

export interface BotGameOptions {
  /** Seeds the bots' choices (the server deals with its own randomness). */
  seed: string
  /** Called with every response body a seat receives, e.g. to check for leaks. */
  onResponse?: (info: {
    code: string
    seat: Seat
    path: string
    text: string
  }) => void | Promise<void>
  /** Gives up after this many requests (a real game takes a few hundred). */
  maxRequests?: number
}

export interface BotGameResult {
  code: string
  winner: Seat
  scores: [number, number]
  actions: number
  requests: number
}

interface SeatState {
  token: string
  cursor: number
  v?: number
  view?: PlayerView
  status?: SyncResponse['status']
}

export async function playBotGame(
  transport: BotTransport,
  options: BotGameOptions,
): Promise<BotGameResult> {
  const rng = seededRng(options.seed)
  const maxRequests = options.maxRequests ?? 3000
  let requests = 0
  let actions = 0

  const call = async (
    seat: Seat | null,
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; token?: string } = {},
  ) => {
    if (++requests > maxRequests) throw new Error(`No result after ${maxRequests} requests`)
    const res = await transport.request(method, path, init)
    if (seat !== null && code) await options.onResponse?.({ code, seat, path, text: res.text })
    return res
  }

  let code = ''
  const created = await call(null, 'POST', '/api/games', {
    body: { name: 'Bot A', chatOn: false, videoOn: false },
  })
  expectStatus(created, 201, 'create')
  const host = created.body as CreateGameResponse
  code = host.code
  const joined = await call(null, 'POST', `/api/games/${code}/join`, { body: { name: 'Bot B' } })
  expectStatus(joined, 200, 'join')
  const guest = joined.body as JoinGameResponse

  const seats: [SeatState, SeatState] = [
    { token: host.playerToken, cursor: host.cursor },
    { token: guest.playerToken, cursor: guest.cursor },
  ]

  const absorb = (seat: Seat, res: SyncResponse) => {
    const s = seats[seat]
    s.cursor = res.cursor
    s.status = res.status
    if (res.view) {
      s.view = res.view
      s.v = res.version
    }
  }

  /** Polls until this seat has seen every event (following `more`). */
  const sync = async (seat: Seat) => {
    for (let more = true; more;) {
      const s = seats[seat]
      const query = `cursor=${s.cursor}${s.v === undefined ? '' : `&v=${s.v}`}`
      const res = await call(seat, 'GET', `/api/games/${code}/sync?${query}`, { token: s.token })
      expectStatus(res, 200, 'sync')
      absorb(seat, res.body as SyncResponse)
      more = (res.body as SyncResponse).more
    }
  }

  for (;;) {
    await sync(0)
    await sync(1)
    const [a, b] = [seats[0].view, seats[1].view]
    if (!a || !b) throw new Error('A seat has no view after syncing')
    if (seats[0].status === 'finished') break

    const move = chooseMove([a, b], rng)
    if (!move) throw new Error(`Neither bot can act in phase ${a.phase}`)
    const s = seats[move.seat]
    const res = await call(move.seat, 'POST', `/api/games/${code}/actions`, {
      token: s.token,
      body: { action: move.action, hand: a.hand, cursor: s.cursor, v: s.v ?? 0 },
    })
    expectStatus(res, 200, `action ${JSON.stringify(move.action)}`)
    absorb(move.seat, res.body as SyncResponse)
    actions++
  }

  const final = seats[0].view as PlayerView
  if (final.winner === null) throw new Error('The game finished without a winner')
  return { code, winner: final.winner, scores: [...final.scores], actions, requests }
}

function expectStatus(res: { status: number; text: string }, status: number, what: string) {
  if (res.status !== status) {
    throw new Error(`${what}: expected ${status}, got ${res.status}: ${res.text.slice(0, 300)}`)
  }
}

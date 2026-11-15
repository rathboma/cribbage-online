import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayerView, ServerEvent, SyncResponse } from '@shared/protocol'
import { ApiError, type ApiClient } from './client'
import { PollingTransport, POLL, type Step, type TransportEnv } from './transport'

const MIN = 60_000

function view(overrides: Partial<PlayerView> = {}, myMove = false): PlayerView {
  return {
    seat: 0,
    phase: 'play',
    hand: 1,
    dealer: 1,
    scores: [0, 0],
    previousScores: [0, 0],
    myHand: [],
    myDiscards: [],
    opponentHandCount: 4,
    cribCount: 4,
    crib: null,
    starter: null,
    count: 0,
    turn: 0,
    sequence: [],
    played: [[], []],
    hasDiscarded: [true, true],
    saidGo: [false, false],
    ready: [false, false],
    show: [],
    winner: null,
    skunk: null,
    legal: { discard: false, cut: false, playable: myMove ? ['5H'] : [], go: false, ready: false },
    ...overrides,
  }
}

const chat = (id: number): ServerEvent => ({ id, kind: 'chat', at: 0, payload: { id } })

function response(overrides: Partial<SyncResponse> = {}): SyncResponse {
  return {
    status: 'active',
    version: 1,
    events: [],
    cursor: 0,
    more: false,
    players: [],
    serverTime: 0,
    ...overrides,
  }
}

/** When each sync call happened, in fake milliseconds. */
let syncTimes: number[] = []

/** An API whose sync answers come from a queue (repeating the last one when it runs dry). */
function fakeApi() {
  const answers: (SyncResponse | Error)[] = []
  let last: SyncResponse = response()
  const sync = vi.fn(async () => {
    syncTimes.push(Date.now())
    const next = answers.shift()
    if (next instanceof Error) throw next
    if (next) last = next
    return last
  })
  const act = vi.fn(async () => response())
  const api = { sync, act } as unknown as ApiClient
  return { api, sync, act, answers }
}

let hidden = false
let visibilityListener: (() => void) | null = null
const env: Partial<TransportEnv> = {
  random: () => 1,
  isHidden: () => hidden,
  onVisibilityChange: (fn) => {
    visibilityListener = fn
    return () => (visibilityListener = null)
  },
}

function setup() {
  const fake = fakeApi()
  const transport = new PollingTransport(fake.api, 'BCDFG', 'token', env)
  const steps: Step[] = []
  const connection: string[] = []
  const fatal: ApiError[] = []
  transport.onStep((s) => steps.push(s))
  transport.onConnection((c) => connection.push(c))
  transport.onFatal((e) => fatal.push(e))
  return { ...fake, transport, steps, connection, fatal }
}

/** Runs fake time until the next sync call and returns the gap since the previous call. */
async function gapBeforeNextSync(_sync?: unknown, maxMs = 40 * MIN) {
  const before = syncTimes.length
  for (let t = 0; t < maxMs && syncTimes.length === before; t += 50) {
    await vi.advanceTimersByTimeAsync(50)
  }
  return (syncTimes.at(-1) as number) - (syncTimes.at(-2) as number)
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_700_000_000_000 })
  syncTimes = []
  hidden = false
  visibilityListener = null
})
afterEach(() => {
  vi.useRealTimers()
})

describe('PollingTransport', () => {
  it('starts from the given cursor, then follows the server’s cursor and version', async () => {
    const t = setup()
    t.answers.push(response({ cursor: 12, version: 4, view: view(), events: [chat(12)] }))
    t.transport.start(10)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sync).toHaveBeenLastCalledWith('BCDFG', 'token', { cursor: 10, v: undefined })
    await vi.advanceTimersByTimeAsync(POLL.waiting)
    expect(t.sync).toHaveBeenLastCalledWith('BCDFG', 'token', { cursor: 12, v: 4 })
    expect(t.steps[0]?.events.map((e) => e.id)).toEqual([12])
    expect(t.connection).toContain('online')
  })

  it('snaps to the present after a reload: no cursor on the first sync', async () => {
    const t = setup()
    t.transport.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sync).toHaveBeenCalledWith('BCDFG', 'token', { cursor: undefined, v: undefined })
  })

  it('syncs again at once while the server says there is more', async () => {
    const t = setup()
    t.answers.push(response({ cursor: 100, more: true, events: [chat(100)] }))
    t.answers.push(response({ cursor: 150, more: false, view: view(), events: [chat(150)] }))
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    // At once: a zero-delay timer (which, like Node's, fires after 1ms).
    expect(await gapBeforeNextSync(t.sync)).toBeLessThanOrEqual(1)
    expect(t.sync).toHaveBeenCalledTimes(2)
    expect(t.sync).toHaveBeenLastCalledWith('BCDFG', 'token', { cursor: 100, v: undefined })
  })

  it('never delivers the same event twice', async () => {
    const t = setup()
    t.answers.push(response({ cursor: 2, events: [chat(1), chat(2)] }))
    t.answers.push(response({ cursor: 3, events: [chat(2), chat(3)] }))
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(POLL.waiting)
    expect(t.steps.flatMap((s) => s.events.map((e) => e.id))).toEqual([1, 2, 3])
  })

  it('ignores a view older than the one it already has', async () => {
    const t = setup()
    t.answers.push(response({ version: 5, view: view({ hand: 5 }) }))
    t.answers.push(response({ version: 4, view: view({ hand: 4 }) }))
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(POLL.waiting)
    expect(t.steps.map((s) => s.view?.hand)).toEqual([5, undefined])
  })

  it('polls every second while waiting on the opponent, every 2.5s on my move', async () => {
    const t = setup()
    t.answers.push(response({ view: view({}, false) }))
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.waiting)

    t.answers.push(response({ version: 2, view: view({}, true) }))
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.myMove)
  })

  it('backs off when nothing changes, and comes back on activity', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    // Each interval is chosen when the previous poll finishes, so skip one poll after each jump.
    await vi.advanceTimersByTimeAsync(2 * MIN)
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(5_000)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(15_000)
    await vi.advanceTimersByTimeAsync(5 * MIN)
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(30_000)

    // The user does something: an immediate poll, then the active interval again.
    t.transport.nudge()
    expect(await gapBeforeNextSync(t.sync)).toBeLessThan(30_000)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.waiting)
  })

  it('sends nothing extra for activity while already polling at an active rate', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    const calls = t.sync.mock.calls.length
    // A burst of taps and key presses in the middle of a turn.
    for (let i = 0; i < 5; i++) t.transport.nudge()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sync.mock.calls.length).toBe(calls)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.waiting)
  })

  it('counts activity during a request, so the backoff still resets', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(5_000)
    // The tap lands while a poll is in flight (no timer is waiting).
    let finish: (r: SyncResponse) => void = () => {}
    t.sync.mockImplementationOnce(() => {
      syncTimes.push(Date.now())
      return new Promise<SyncResponse>((resolve) => (finish = resolve))
    })
    await vi.advanceTimersByTimeAsync(5_000)
    t.transport.nudge()
    finish(response())
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.waiting)
  })

  it('resets the backoff when something changes', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(5_000)
    t.answers.push(response({ cursor: 9, events: [chat(9)] }))
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.waiting)
  })

  it('keeps polling slowly in a hidden tab, and at once when it becomes visible', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    hidden = true
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.hidden)

    await vi.advanceTimersByTimeAsync(5_000)
    hidden = false
    const before = t.sync.mock.calls.length
    visibilityListener?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sync.mock.calls.length).toBe(before + 1)
  })

  it('polls a finished game slowly for 10 minutes, then pauses until resumed', async () => {
    const t = setup()
    t.answers.push(response({ status: 'finished', view: view({ phase: 'game_over' }) }))
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.ended)
    await vi.advanceTimersByTimeAsync(POLL.endedFor)
    expect(t.connection.at(-1)).toBe('paused')
    const calls = t.sync.mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(t.sync.mock.calls.length).toBe(calls)

    t.transport.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sync.mock.calls.length).toBe(calls + 1)
  })

  it('polls every 300ms in boost mode', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    t.transport.setBoost(true)
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.boost)
    t.transport.setBoost(false)
    await gapBeforeNextSync(t.sync)
    expect(await gapBeforeNextSync(t.sync)).toBe(POLL.waiting)
  })

  it('backs off exponentially on network errors and recovers', async () => {
    const t = setup()
    const offline = () => new ApiError(0, 'network', 'offline')
    t.answers.push(offline(), offline(), offline(), offline())
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    const gaps = [
      await gapBeforeNextSync(t.sync),
      await gapBeforeNextSync(t.sync),
      await gapBeforeNextSync(t.sync),
      await gapBeforeNextSync(t.sync),
    ]
    expect(gaps).toEqual([1000, 2000, 4000, 8000])
    expect(t.connection).toContain('reconnecting')
    expect(t.connection).toContain('offline')
    expect(t.connection.at(-1)).toBe('online')
  })

  it('adds jitter to the error backoff', async () => {
    const fake = fakeApi()
    const transport = new PollingTransport(fake.api, 'BCDFG', 'token', { ...env, random: () => 0 })
    fake.answers.push(new ApiError(0, 'network', 'x'))
    transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(await gapBeforeNextSync(fake.sync)).toBe(500)
  })

  it.each([401, 404, 410])('stops for good on %i and reports it', async (status) => {
    const t = setup()
    t.answers.push(new ApiError(status, 'game_not_found', 'gone'))
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.fatal.map((e) => e.status)).toEqual([status])
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(t.sync).toHaveBeenCalledTimes(1)
  })

  it('sends moves with the hand, cursor and version, and delivers the response', async () => {
    const t = setup()
    t.answers.push(response({ cursor: 30, version: 6, view: view() }))
    t.act.mockResolvedValueOnce(response({ cursor: 32, version: 7, events: [chat(31), chat(32)] }))
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    await t.transport.send({ type: 'go' }, 3)
    expect(t.act).toHaveBeenCalledWith('BCDFG', 'token', {
      action: { type: 'go' },
      hand: 3,
      cursor: 30,
      v: 6,
    })
    expect(t.steps.at(-1)?.events.map((e) => e.id)).toEqual([31, 32])
  })

  it('never runs a move while a poll is in flight', async () => {
    const t = setup()
    let release: (r: SyncResponse) => void = () => {}
    t.sync.mockImplementationOnce(() => new Promise<SyncResponse>((r) => (release = r)))
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    const sent = t.transport.send({ type: 'cut' }, 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(t.act).not.toHaveBeenCalled()
    release(response({ cursor: 5, version: 2, view: view() }))
    await sent
    expect(t.act).toHaveBeenCalledWith(
      'BCDFG',
      'token',
      expect.objectContaining({ cursor: 5, v: 2 }),
    )
  })

  it('rejects a refused move and resyncs straight away', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    t.act.mockRejectedValueOnce(new ApiError(422, 'not_your_turn', 'no'))
    await expect(t.transport.send({ type: 'go' }, 1)).rejects.toMatchObject({
      code: 'not_your_turn',
    })
    const calls = t.sync.mock.calls.length
    await vi.advanceTimersByTimeAsync(0)
    expect(t.sync.mock.calls.length).toBe(calls + 1)
    expect(t.fatal).toEqual([])
  })

  it('stops when a move gets a terminal answer', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    t.act.mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'no'))
    await expect(t.transport.send({ type: 'go' }, 1)).rejects.toBeInstanceOf(ApiError)
    expect(t.fatal).toHaveLength(1)
  })

  it('stops polling when stopped', async () => {
    const t = setup()
    t.transport.start(0)
    await vi.advanceTimersByTimeAsync(0)
    t.transport.stop()
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(t.sync).toHaveBeenCalledTimes(1)
    expect(visibilityListener).toBeNull()
  })
})

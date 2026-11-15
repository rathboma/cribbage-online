/**
 * How the client stays in sync with the server. The store talks to a GameTransport, so the
 * polling implementation here can later be swapped for long-polling (P6.4) without touching it.
 */
import type {
  ClientAction,
  GameStatus,
  PlayerInfo,
  PlayerView,
  ServerEvent,
  SyncResponse,
} from '@shared/protocol'
import { ApiError, type ApiClient } from './client'

/** One server response, reduced to what is new: the store hands these to the presenter. */
export interface Step {
  /** Events not delivered before, oldest first. */
  events: ServerEvent[]
  /** The state after these events; absent when it hasn't changed. */
  view?: PlayerView
  version?: number
  status: GameStatus
  players: PlayerInfo[]
  serverTime: number
}

export type ConnectionState = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'paused'

export interface GameTransport {
  /** Starts syncing. With a cursor (just created or joined) events after it are replayed; without
   * one (a reload) the client snaps to the current state. */
  start(cursor?: number): void
  stop(): void
  /** Sends a move for hand `hand`. Resolves once its response has been delivered as a step. */
  send(action: ClientAction, hand: number): Promise<void>
  onStep(listener: (step: Step) => void): () => void
  onConnection(listener: (state: ConnectionState) => void): () => void
  /** The server says the game or this seat is gone (401/404/410): syncing has stopped. */
  onFatal(listener: (error: ApiError) => void): () => void
  /** Polls very often while on (WebRTC signalling, P5.4). */
  setBoost(on: boolean): void
  /** The user did something: go back to the active polling intervals now. */
  nudge(): void
  /** Starts polling again after a pause. */
  resume(): void
}

/** Polling intervals in milliseconds. */
export const POLL = {
  waiting: 1000,
  myMove: 2500,
  boost: 300,
  hidden: 15_000,
  ended: 15_000,
  /** Idle backoff: after this long without any change, poll at that interval. */
  idle: [
    { after: 10 * 60_000, every: 30_000 },
    { after: 5 * 60_000, every: 15_000 },
    { after: 2 * 60_000, every: 5_000 },
  ],
  /** Keep polling a finished game this long (so the last moves and chat arrive), then pause. */
  endedFor: 10 * 60_000,
  errorBase: 1000,
  errorMax: 30_000,
  /** Consecutive failures before the connection counts as offline rather than reconnecting. */
  offlineAfter: 3,
} as const

/** What the transport needs from the environment, injectable for tests. */
export interface TransportEnv {
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(id: unknown): void
  random(): number
  isHidden(): boolean
  onVisibilityChange(fn: () => void): () => void
}

export function browserEnv(): TransportEnv {
  return {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    random: () => Math.random(),
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisibilityChange(fn) {
      if (typeof document === 'undefined') return () => {}
      document.addEventListener('visibilitychange', fn)
      return () => document.removeEventListener('visibilitychange', fn)
    },
  }
}

const ENDED: GameStatus[] = ['finished', 'abandoned']

/** True when this view has something for its player to do. */
export function isMyMove(view: PlayerView | undefined): boolean {
  const legal = view?.legal
  return (
    !!legal && (legal.discard || legal.cut || legal.go || legal.ready || legal.playable.length > 0)
  )
}

export class PollingTransport implements GameTransport {
  private readonly env: TransportEnv
  private cursor: number | undefined
  /** Highest event id handed out, so no event is ever delivered twice. */
  private delivered = 0
  private version: number | undefined
  private view: PlayerView | undefined
  private status: GameStatus = 'waiting'
  private stopped = true
  private paused = false
  private boost = false
  private failures = 0
  private timer: unknown = null
  private lastChange = 0
  private lastActivity = 0
  private endedAt: number | null = null
  /** Requests run one at a time, in order: polls and moves never overlap. */
  private queue: Promise<unknown> = Promise.resolve()
  private unwatchVisibility: () => void = () => {}
  private readonly stepListeners = new Set<(step: Step) => void>()
  private readonly connectionListeners = new Set<(state: ConnectionState) => void>()
  private readonly fatalListeners = new Set<(error: ApiError) => void>()

  constructor(
    private readonly api: ApiClient,
    private readonly code: string,
    private readonly token: string,
    env: Partial<TransportEnv> = {},
  ) {
    this.env = { ...browserEnv(), ...env }
  }

  start(cursor?: number): void {
    this.stopped = false
    this.paused = false
    this.cursor = cursor
    this.delivered = cursor ?? 0
    this.lastChange = this.lastActivity = this.env.now()
    this.unwatchVisibility = this.env.onVisibilityChange(() => {
      if (!this.env.isHidden()) this.nudge()
    })
    this.setConnection('connecting')
    this.schedule(0)
  }

  stop(): void {
    this.stopped = true
    this.clearTimer()
    this.unwatchVisibility()
  }

  send(action: ClientAction, hand: number): Promise<void> {
    if (this.paused) this.resume()
    else this.nudge()
    return this.exclusive(async () => {
      const res = await this.api.act(this.code, this.token, {
        action,
        hand,
        cursor: this.cursor ?? 0,
        v: this.version ?? 0,
      })
      this.absorb(res)
      this.schedule(0) // confirm straight away
    }).catch((err: unknown) => {
      if (err instanceof ApiError && err.isTerminal) this.fail(err)
      else this.schedule(0) // resync whatever happened
      throw err
    })
  }

  onStep(listener: (step: Step) => void) {
    this.stepListeners.add(listener)
    return () => this.stepListeners.delete(listener)
  }

  onConnection(listener: (state: ConnectionState) => void) {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  onFatal(listener: (error: ApiError) => void) {
    this.fatalListeners.add(listener)
    return () => this.fatalListeners.delete(listener)
  }

  setBoost(on: boolean): void {
    this.boost = on
    if (on) this.schedule(0)
  }

  nudge(): void {
    this.lastActivity = this.env.now()
    if (!this.stopped && !this.paused) this.schedule(0)
  }

  resume(): void {
    if (this.stopped) return
    this.paused = false
    if (this.endedAt !== null) this.endedAt = this.env.now()
    this.setConnection('connecting')
    this.nudge()
  }

  /** How long to wait before the next poll, or null to pause. */
  nextDelay(): number | null {
    const now = this.env.now()
    if (this.boost) return POLL.boost
    if (this.endedAt !== null) return now - this.endedAt >= POLL.endedFor ? null : POLL.ended
    if (this.env.isHidden()) return POLL.hidden
    const idle = now - Math.max(this.lastChange, this.lastActivity)
    const step = POLL.idle.find((s) => idle >= s.after)
    if (step) return step.every
    return isMyMove(this.view) ? POLL.myMove : POLL.waiting
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.paused) return
    await this.exclusive(async () => {
      const res = await this.api.sync(this.code, this.token, {
        cursor: this.cursor,
        v: this.version,
      })
      this.absorb(res)
      this.failures = 0
      this.setConnection('online')
      this.schedule(res.more ? 0 : this.nextDelay())
    }).catch((err: unknown) => {
      const error = err instanceof ApiError ? err : new ApiError(0, 'network', String(err))
      if (error.isTerminal) return this.fail(error)
      this.failures++
      this.setConnection(this.failures >= POLL.offlineAfter ? 'offline' : 'reconnecting')
      const backoff = Math.min(POLL.errorMax, POLL.errorBase * 2 ** (this.failures - 1))
      this.schedule(backoff * (0.5 + this.env.random() * 0.5))
    })
  }

  /** Folds a response into the transport's state and hands what is new to the listeners. */
  private absorb(res: SyncResponse): void {
    const events = res.events.filter((e) => e.id > this.delivered)
    if (events.length) this.delivered = (events.at(-1) as ServerEvent).id
    this.cursor = Math.max(this.cursor ?? 0, res.cursor)
    // A view older than the one already held (stale or out-of-order) is ignored.
    const fresh =
      res.view !== undefined && (this.version === undefined || (res.version ?? 0) >= this.version)
    const view = fresh ? res.view : undefined
    if (view) {
      if (res.version !== this.version) this.lastChange = this.env.now()
      this.view = view
      this.version = res.version
    }
    if (events.length) this.lastChange = this.env.now()
    this.status = res.status
    if (ENDED.includes(res.status) && this.endedAt === null) this.endedAt = this.env.now()
    const step: Step = {
      events,
      ...(view ? { view, version: res.version } : {}),
      status: res.status,
      players: res.players,
      serverTime: res.serverTime,
    }
    for (const listener of this.stepListeners) listener(step)
  }

  private schedule(delay: number | null): void {
    this.clearTimer()
    if (this.stopped) return
    if (delay === null) {
      this.paused = true
      this.setConnection('paused')
      return
    }
    this.timer = this.env.setTimer(() => {
      this.timer = null
      void this.poll()
    }, delay)
  }

  private clearTimer(): void {
    if (this.timer !== null) this.env.clearTimer(this.timer)
    this.timer = null
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private fail(error: ApiError): void {
    this.stop()
    for (const listener of this.fatalListeners) listener(error)
  }

  private setConnection(state: ConnectionState): void {
    for (const listener of this.connectionListeners) listener(state)
  }
}

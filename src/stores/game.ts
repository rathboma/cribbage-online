/**
 * The game as the UI sees it. `view` is the latest authoritative PlayerView from the server;
 * `presentedView` is what the screen should show right now, and is what all UI reads. Every
 * server response is a step handed to the presenter in order: the default presenter shows each
 * view at once (the DOM table); the 3D table's animation director (Phase 4) plays a step's
 * events first and then lets the view through.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type {
  CardId,
  ClientAction,
  GameEvent,
  GameStatus,
  PlayerInfo,
  PlayerView,
  Seat,
  ServerEvent,
  ServerEventKind,
} from '@shared/protocol'
import { ApiError, type ApiClient } from '@/api/client'
import { getApi } from '@/api'
import { loadSession, removeSession } from '@/api/session'
import {
  isMyMove,
  PollingTransport,
  type ConnectionState,
  type GameTransport,
  type Step,
} from '@/api/transport'

/** Shows a step. May return a promise (e.g. while animating); the view is committed after it. */
export type Presenter = (step: Step) => void | PromiseLike<void>

const showAtOnce: Presenter = () => {}

function isThenable(value: unknown): value is PromiseLike<void> {
  return typeof (value as PromiseLike<void> | undefined)?.then === 'function'
}

/**
 * Keeps only the events of the latest hand: from its `hand_dealt` on (and the cut for first
 * deal just before it), so the list never grows past one hand's worth.
 */
export function eventsOfCurrentHand(events: GameEvent[]): GameEvent[] {
  const dealt = events.map((e) => e.type).lastIndexOf('hand_dealt')
  if (dealt <= 0) return events
  return events.slice(events[dealt - 1]?.type === 'cut_for_deal' ? dealt - 1 : dealt)
}

type OtherKind = Exclude<ServerEventKind, 'game'>
type EventListener = (event: ServerEvent) => void

export interface ConnectOptions {
  /** The cursor from create/join, when the session was just made; omitted after a reload. */
  cursor?: number
  api?: ApiClient
  transport?: (api: ApiClient, code: string, token: string) => GameTransport
}

export const useGameStore = defineStore('game', () => {
  const code = ref<string | null>(null)
  const mySeat = ref<Seat | null>(null)
  const status = ref<GameStatus | null>(null)
  const players = shallowRef<PlayerInfo[]>([])
  const view = shallowRef<PlayerView | null>(null)
  const presentedView = shallowRef<PlayerView | null>(null)
  /**
   * The game events of the hand on screen, oldest first, committed together with
   * `presentedView`. The HUD words them ("Sam played 8♣ - fifteen for 2"). Starts again at each
   * deal, and is empty after a reload (a reload snaps to the present without replaying events).
   */
  const handEvents = shallowRef<GameEvent[]>([])
  /**
   * The game's status as of the step on screen. `status` is the server's latest word and can
   * run ahead of the screen while a step is still being shown; the game screen reads this one.
   */
  const presentedStatus = ref<GameStatus | null>(null)
  const connection = ref<ConnectionState>('connecting')
  /** Set when the server says this game or seat is gone; syncing has stopped. */
  const fatalError = shallowRef<ApiError | null>(null)
  /** True while a move is on its way to the server. */
  const sending = ref(false)
  /** True while steps have arrived that the presenter has not finished showing. */
  const presenting = ref(false)
  /**
   * No new move may start: one is on its way, or the screen has not caught up with the
   * server yet (so what the player would be acting on is already out of date).
   */
  const busy = computed(() => sending.value || presenting.value)

  let transport: GameTransport | null = null
  let unsubscribe: (() => void)[] = []
  let presenter: Presenter = showAtOnce
  const pending: Step[] = []
  /** Goes up at every (re)connect, so a step still being shown for an old game is dropped. */
  let generation = 0
  const listeners = new Map<OtherKind, Set<EventListener>>()

  const isMyTurn = computed(() => isMyMove(presentedView.value ?? undefined))

  // When it becomes this player's move while the tab is in the background, say so in the tab's
  // title; put the title back when they look at the tab again.
  const TURN_PREFIX = '● Your move · '
  watch(isMyTurn, (mine) => {
    if (typeof document === 'undefined') return
    if (mine && document.visibilityState === 'hidden' && !document.title.startsWith(TURN_PREFIX)) {
      document.title = TURN_PREFIX + document.title
    } else if (!mine) {
      clearTurnTitle()
    }
  })
  function clearTurnTitle() {
    if (typeof document !== 'undefined' && document.title.startsWith(TURN_PREFIX)) {
      document.title = document.title.slice(TURN_PREFIX.length)
    }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') clearTurnTitle()
    })
  }

  /**
   * Starts syncing game `code` with the session stored for it. Returns false (and sets
   * `fatalError`) if this browser has no session for that game.
   */
  function connect(gameCode: string, options: ConnectOptions = {}): boolean {
    disconnect()
    reset()
    code.value = gameCode
    const session = loadSession(gameCode)
    if (!session) {
      fatalError.value = new ApiError(401, 'unauthorized', 'This browser is not in that game.')
      return false
    }
    mySeat.value = session.seat
    const api = options.api ?? getApi()
    const make =
      options.transport ?? ((a: ApiClient, c: string, t: string) => new PollingTransport(a, c, t))
    transport = make(api, gameCode, session.playerToken)
    unsubscribe = [
      transport.onStep(receive),
      transport.onConnection((state) => (connection.value = state)),
      transport.onFatal((error) => {
        fatalError.value = error
        // The token can't be used again: forget it so the home screen doesn't offer it.
        removeSession(gameCode)
      }),
    ]
    transport.start(options.cursor)
    return true
  }

  function disconnect() {
    transport?.stop()
    for (const off of unsubscribe) off()
    unsubscribe = []
    transport = null
  }

  function reset() {
    code.value = null
    mySeat.value = null
    status.value = null
    players.value = []
    view.value = null
    presentedView.value = null
    presentedStatus.value = null
    handEvents.value = []
    connection.value = 'connecting'
    fatalError.value = null
    sending.value = false
    pending.length = 0
    presenting.value = false
    generation++
  }

  function receive(step: Step) {
    status.value = step.status
    players.value = step.players
    if (step.view) view.value = step.view
    // Chat, signals and notices don't wait for animations. A listener that fails must not
    // take the step (or the other listeners) down with it.
    for (const event of step.events) {
      if (event.kind === 'game') continue
      for (const fn of listeners.get(event.kind) ?? []) {
        try {
          fn(event)
        } catch (err) {
          console.error(`A ${event.kind} listener failed`, err)
        }
      }
    }
    pending.push(step)
    if (!presenting.value) present()
  }

  /** Hands queued steps to the presenter strictly in order, committing each view after it. */
  function present() {
    const mine = generation
    presenting.value = true
    while (pending.length) {
      const step = pending.shift() as Step
      let result: void | PromiseLike<void>
      try {
        result = presenter(step)
      } catch (err) {
        console.error('Presenter failed', err)
        result = undefined
      }
      if (isThenable(result)) {
        Promise.resolve(result)
          .catch((err: unknown) => console.error('Presenter failed', err))
          .then(() => {
            // Reconnected (or left) while this step was being shown: it belongs to the past.
            if (mine !== generation) return
            commit(step)
            present()
          })
        return
      }
      commit(step)
    }
    presenting.value = false
  }

  function commit(step: Step) {
    presentedStatus.value = step.status
    const fresh = step.events.flatMap((e) => (e.kind === 'game' ? e.payload.events : []))
    if (fresh.length) handEvents.value = eventsOfCurrentHand([...handEvents.value, ...fresh])
    if (step.view) presentedView.value = step.view
  }

  /** Replaces the presenter (the 3D table's animation director); returns a function to undo it. */
  function setPresenter(next: Presenter): () => void {
    presenter = next
    return () => {
      if (presenter === next) presenter = showAtOnce
    }
  }

  /** Listens for chat, signal or system events (Phase 5). Returns an unsubscribe function. */
  function onServerEvent(kind: OtherKind, fn: EventListener): () => void {
    const set = listeners.get(kind) ?? new Set<EventListener>()
    set.add(fn)
    listeners.set(kind, set)
    return () => set.delete(fn)
  }

  /** Sends a move for the hand on screen. Throws ApiError if the server refuses it. */
  async function send(action: ClientAction): Promise<void> {
    if (!transport || !presentedView.value) throw new ApiError(0, 'network', 'Not connected.')
    sending.value = true
    try {
      await transport.send(action, presentedView.value.hand)
    } finally {
      sending.value = false
    }
  }

  return {
    code,
    mySeat,
    status,
    players,
    view,
    presentedView,
    presentedStatus,
    handEvents,
    connection,
    fatalError,
    sending,
    busy,
    isMyTurn,
    connect,
    disconnect,
    setPresenter,
    onServerEvent,
    discard: (cards: [CardId, CardId]) => send({ type: 'discard', cards }),
    cut: () => send({ type: 'cut' }),
    play: (card: CardId) => send({ type: 'play', card }),
    go: () => send({ type: 'go' }),
    ready: () => send({ type: 'ready' }),
    /** The user did something: poll at the active rate again. */
    nudge: () => transport?.nudge(),
    /** Resumes polling after "Paused - tap to resume". */
    resume: () => transport?.resume(),
    setBoost: (on: boolean) => transport?.setBoost(on),
  }
})

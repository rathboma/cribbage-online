import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { GameEvent, PlayerView, ServerEvent } from '@shared/protocol'
import { ApiError, type ApiClient } from '@/api/client'
import { loadSession, saveSession } from '@/api/session'
import type { ConnectionState, GameTransport, Step } from '@/api/transport'
import { eventsOfCurrentHand, useGameStore } from './game'

function view(hand: number, myMove = false): PlayerView {
  return {
    seat: 1,
    phase: 'play',
    hand,
    dealer: 0,
    scores: [0, 0],
    previousScores: [0, 0],
    myHand: ['5H'],
    myDiscards: [],
    opponentHandCount: 4,
    cribCount: 4,
    crib: null,
    starter: null,
    count: 0,
    turn: 1,
    sequence: [],
    played: [[], []],
    hasDiscarded: [true, true],
    saidGo: [false, false],
    ready: [false, false],
    show: [],
    winner: null,
    skunk: null,
    legal: { discard: false, cut: false, playable: myMove ? ['5H'] : [], go: false, ready: false },
  }
}

function step(hand: number | null, events: ServerEvent[] = [], myMove = false): Step {
  return {
    events,
    ...(hand === null ? {} : { view: view(hand, myMove), version: hand }),
    status: 'active',
    players: [],
    serverTime: 0,
  }
}

class FakeTransport implements GameTransport {
  started: (number | undefined)[] = []
  stopped = false
  sent: unknown[] = []
  private steps = new Set<(s: Step) => void>()
  private fatals = new Set<(e: ApiError) => void>()
  private connections = new Set<(c: ConnectionState) => void>()
  start(cursor?: number) {
    this.started.push(cursor)
  }
  stop() {
    this.stopped = true
  }
  async send(action: unknown, hand: number) {
    this.sent.push({ action, hand })
  }
  onStep(fn: (s: Step) => void) {
    this.steps.add(fn)
    return () => this.steps.delete(fn)
  }
  onConnection(fn: (c: ConnectionState) => void) {
    this.connections.add(fn)
    return () => this.connections.delete(fn)
  }
  onFatal(fn: (e: ApiError) => void) {
    this.fatals.add(fn)
    return () => this.fatals.delete(fn)
  }
  setBoost = vi.fn()
  nudge = vi.fn()
  resume = vi.fn()
  emit(s: Step) {
    for (const fn of this.steps) fn(s)
  }
  fail(e: ApiError) {
    for (const fn of this.fatals) fn(e)
  }
  connect(c: ConnectionState) {
    for (const fn of this.connections) fn(c)
  }
}

let transport: FakeTransport
const api = {} as ApiClient

function connect(cursor?: number) {
  const store = useGameStore()
  const ok = store.connect('BCDFG', { cursor, api, transport: () => transport })
  return { store, ok }
}

beforeEach(() => {
  setActivePinia(createPinia())
  transport = new FakeTransport()
  saveSession('BCDFG', { playerToken: 'tok', seat: 1, name: 'Bo' })
})
afterEach(() => {
  localStorage.clear()
  document.title = ''
})

describe('useGameStore', () => {
  it('connects with the stored session and the cursor from create/join', () => {
    const { store, ok } = connect(42)
    expect(ok).toBe(true)
    expect(store.mySeat).toBe(1)
    expect(transport.started).toEqual([42])
  })

  it('reconnects after a reload without a cursor, so it snaps to the present', () => {
    connect()
    expect(transport.started).toEqual([undefined])
  })

  it('reports a game this browser has no session for', () => {
    localStorage.clear()
    const { store, ok } = connect()
    expect(ok).toBe(false)
    expect(store.fatalError?.code).toBe('unauthorized')
    expect(transport.started).toEqual([])
  })

  it('shows each view at once with the default presenter', () => {
    const { store } = connect()
    transport.emit(step(1))
    expect(store.view?.hand).toBe(1)
    expect(store.presentedView).toBe(store.view)
    transport.emit(step(null)) // nothing new
    expect(store.presentedView?.hand).toBe(1)
    transport.emit(step(2))
    expect(store.presentedView).toBe(store.view)
  })

  it('hands steps to a custom presenter strictly in order, committing each view after it', async () => {
    const { store } = connect()
    const seen: number[] = []
    const finish: (() => void)[] = []
    store.setPresenter(
      (s) =>
        new Promise<void>((resolve) => {
          seen.push(s.view?.hand ?? -1)
          finish.push(resolve)
        }),
    )
    transport.emit(step(1))
    transport.emit(step(2))
    transport.emit(step(3))
    // The latest view is known at once; the screen waits for the presenter.
    expect(store.view?.hand).toBe(3)
    expect(store.presentedView).toBeNull()
    expect(seen).toEqual([1])

    finish[0]!()
    await vi.waitFor(() => expect(seen).toEqual([1, 2]))
    expect(store.presentedView?.hand).toBe(1)
    finish[1]!()
    await vi.waitFor(() => expect(seen).toEqual([1, 2, 3]))
    expect(store.presentedView?.hand).toBe(2)
    finish[2]!()
    await vi.waitFor(() => expect(store.presentedView?.hand).toBe(3))
  })

  it('keeps going if a presenter fails', async () => {
    const { store } = connect()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store.setPresenter(() => Promise.reject(new Error('animation broke')))
    transport.emit(step(4))
    await vi.waitFor(() => expect(store.presentedView?.hand).toBe(4))
  })

  it('updates status, players and connection from every step', () => {
    const { store } = connect()
    transport.connect('online')
    transport.emit({
      ...step(1),
      status: 'finished',
      players: [{ seat: 0, name: 'Ada', connected: true, chatOn: true, videoOn: false }],
    })
    expect(store.connection).toBe('online')
    expect(store.status).toBe('finished')
    expect(store.players.map((p) => p.name)).toEqual(['Ada'])
  })

  it('passes chat, signal and system events to listeners at once, but not game events', () => {
    const { store } = connect()
    const chats: number[] = []
    const off = store.onServerEvent('chat', (e) => chats.push(e.id))
    store.setPresenter(() => new Promise(() => {})) // never finishes
    transport.emit(
      step(1, [
        { id: 1, kind: 'game', at: 0, payload: { events: [] } },
        { id: 2, kind: 'chat', at: 0, payload: { text: 'hi' } },
      ]),
    )
    expect(chats).toEqual([2])
    off()
    transport.emit(step(null, [{ id: 3, kind: 'chat', at: 0, payload: {} }]))
    expect(chats).toEqual([2])
  })

  it('goes into a terminal state and forgets the session on 401/404', () => {
    const { store } = connect()
    transport.fail(new ApiError(404, 'game_not_found', 'gone'))
    expect(store.fatalError?.status).toBe(404)
    expect(loadSession('BCDFG')).toBeNull()
  })

  it('sends moves for the hand on screen', async () => {
    const { store } = connect()
    transport.emit(step(3))
    await store.play('5H')
    await store.discard(['5H', 'KD'])
    await store.go()
    await store.cut()
    await store.ready()
    expect(transport.sent).toEqual([
      { action: { type: 'play', card: '5H' }, hand: 3 },
      { action: { type: 'discard', cards: ['5H', 'KD'] }, hand: 3 },
      { action: { type: 'go' }, hand: 3 },
      { action: { type: 'cut' }, hand: 3 },
      { action: { type: 'ready' }, hand: 3 },
    ])
  })

  it('stops syncing when disconnected', () => {
    const { store } = connect()
    store.disconnect()
    expect(transport.stopped).toBe(true)
  })

  it('flags the tab title when it becomes my move in a hidden tab', async () => {
    const { store } = connect()
    document.title = 'Cribbage'
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    transport.emit(step(1, [], true))
    await nextTick()
    expect(store.isMyTurn).toBe(true)
    expect(document.title).toMatch(/Your move.*Cribbage/)
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.title).toBe('Cribbage')
  })
})

describe('the events of the hand on screen', () => {
  let nextId = 1
  /** One server event carrying the engine events of one move. */
  const move = (...events: GameEvent[]): ServerEvent => ({
    id: nextId++,
    at: 0,
    kind: 'game',
    payload: { events },
  })
  const played = (card: '5H' | '6H' | '7H'): GameEvent => ({
    type: 'card_played',
    seat: 0,
    card,
    count: 5,
  })
  const types = (events: GameEvent[]) => events.map((e) => e.type)

  it('collects game events in order as their steps are shown', () => {
    const { store } = connect(0)
    expect(store.handEvents).toEqual([])
    transport.emit(
      step(1, [
        move(
          { type: 'cut_for_deal', cards: ['4C', 'KD'], dealer: 0 },
          { type: 'hand_dealt', hand: 1, dealer: 0 },
        ),
      ]),
    )
    transport.emit(step(1, [move({ type: 'discarded', seat: 0 }), move(played('5H'))]))
    expect(types(store.handEvents)).toEqual([
      'cut_for_deal',
      'hand_dealt',
      'discarded',
      'card_played',
    ])
  })

  it('ignores chat, signal and system events', () => {
    const { store } = connect(0)
    transport.emit(
      step(1, [{ id: 1, at: 0, kind: 'chat', payload: { text: 'hi' } }, move(played('5H'))]),
    )
    expect(types(store.handEvents)).toEqual(['card_played'])
  })

  it('starts again at each deal, so the list never outgrows one hand', () => {
    const { store } = connect(0)
    transport.emit(step(1, [move(played('5H')), move(played('6H'))]))
    transport.emit(step(2, [move({ type: 'hand_dealt', hand: 2, dealer: 1 }), move(played('7H'))]))
    expect(store.handEvents).toEqual([{ type: 'hand_dealt', hand: 2, dealer: 1 }, played('7H')])
  })

  it('appears together with the view, after the presenter has shown the step', async () => {
    const { store } = connect(0)
    let finish = () => {}
    store.setPresenter(() => new Promise<void>((resolve) => (finish = resolve)))
    transport.emit(step(1, [move(played('5H'))]))
    expect(store.handEvents).toEqual([])
    expect(store.presentedView).toBeNull()
    finish()
    await vi.waitFor(() => expect(store.presentedView?.hand).toBe(1))
    expect(types(store.handEvents)).toEqual(['card_played'])
  })

  it('is empty again after reconnecting (a reload replays nothing)', () => {
    const { store } = connect(0)
    transport.emit(step(1, [move(played('5H'))]))
    store.connect('BCDFG', { api, transport: () => transport })
    expect(store.handEvents).toEqual([])
  })

  it('keeps the cut for first deal with the first hand', () => {
    const cut: GameEvent = { type: 'cut_for_deal', cards: ['4C', 'KD'], dealer: 0 }
    const dealt = (hand: number): GameEvent => ({ type: 'hand_dealt', hand, dealer: 0 })
    expect(eventsOfCurrentHand([cut, dealt(1), played('5H')])).toEqual([
      cut,
      dealt(1),
      played('5H'),
    ])
    expect(eventsOfCurrentHand([played('5H'), dealt(2), played('6H')])).toEqual([
      dealt(2),
      played('6H'),
    ])
    expect(eventsOfCurrentHand([played('5H')])).toEqual([played('5H')])
    expect(eventsOfCurrentHand([])).toEqual([])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { GameState } from '@shared/engine'
import type { CardId, GameStatus, Seat, SyncResponse } from '@shared/protocol'
import { useApiClient } from '@/api'
import { ApiError, type ApiClient } from '@/api/client'
import { loadSession, saveSession } from '@/api/session'
import App from '@/App.vue'
import { routes } from '@/router/routes'
import { useGameStore } from '@/stores/game'
import { useToasts } from '@/stores/toasts'
import {
  playerView,
  playMoves,
  PLAYERS,
  stateWhen,
  WORKED_EXAMPLE_MOVES,
  workedExample,
} from '@/test/game'

let restore: () => void
let sync: ReturnType<typeof vi.fn>
let act: ReturnType<typeof vi.fn>
let version = 1

/** What the server answers for `state` as seen from `seat`. */
function response(state: GameState, seat: Seat, status: GameStatus = 'active'): SyncResponse {
  version += 1
  return {
    status,
    version,
    view: playerView(state, seat, { canAct: status === 'active' }),
    events: [],
    cursor: version,
    more: false,
    players: PLAYERS,
    serverTime: 0,
  }
}

/** Opens the game screen for `seat` with the server at `state`. */
async function open(state: GameState, seat: Seat = 0, status: GameStatus = 'active') {
  saveSession('BCDFG', { playerToken: 'tok', seat, name: seat === 0 ? 'Ada' : 'Sam' })
  sync.mockResolvedValue(response(state, seat, status))
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/g/BCDFG')
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(App, { global: { plugins: [router, pinia] }, attachTo: document.body })
  await flushPromises()
  await vi.advanceTimersByTimeAsync(0)
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof open>>
const testId = (id: string) => `[data-testid="${id}"]`
const handCard = (w: Wrapper, card: CardId) => w.get(`${testId('hand-card')}[data-card="${card}"]`)
const phase = (w: Wrapper) => w.get(testId('game')).attributes('data-phase')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  version = 1
  sync = vi.fn()
  act = vi.fn()
  restore = useApiClient({ sync, act } as unknown as ApiClient)
})
afterEach(() => {
  restore()
  vi.useRealTimers()
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('game screen', () => {
  it('shows the scores, the prompt and the table for a game in progress', async () => {
    const wrapper = await open(workedExample())
    expect(phase(wrapper)).toBe('play')
    expect(wrapper.get('h1').text()).toBe('Game BCDFG')
    expect(wrapper.get(testId('prompt')).text()).toBe('Your turn — count is 0')
    expect(wrapper.get(testId('player-0')).text()).toContain('Ada')
    expect(wrapper.get(testId('player-1')).text()).toContain('Sam')
    expect(wrapper.findAll(testId('hand-card'))).toHaveLength(4)
    expect(wrapper.get(testId('starter')).attributes('data-card')).toBe('5H')
  })

  it('sends the two picked cards to the crib and shows what the server answers', async () => {
    const before = stateWhen((s) => s.phase === 'discard')
    const wrapper = await open(before)
    const [a, , c] = before.hands[0] as [CardId, CardId, CardId]
    expect(wrapper.get(testId('action-discard')).attributes('disabled')).toBeDefined()

    await handCard(wrapper, a).trigger('click')
    await handCard(wrapper, c).trigger('click')
    expect(handCard(wrapper, a).attributes('aria-pressed')).toBe('true')
    expect(wrapper.get(testId('action-discard')).attributes('disabled')).toBeUndefined()

    const after = playMoves(before, [{ seat: 0, action: { type: 'discard', cards: [a, c] } }]).state
    act.mockResolvedValue(response(after, 0))
    await wrapper.get(testId('action-discard')).trigger('click')
    await flushPromises()

    expect(act).toHaveBeenCalledTimes(1)
    expect(act.mock.calls[0]?.slice(0, 2)).toEqual(['BCDFG', 'tok'])
    expect(act.mock.calls[0]?.[2]).toMatchObject({
      action: { type: 'discard', cards: [a, c] },
      hand: before.hand,
    })
    expect(wrapper.findAll(testId('hand-card'))).toHaveLength(4)
    expect(wrapper.find(testId('action-discard')).exists()).toBe(false)
    expect(wrapper.get(testId('prompt')).text()).toBe('Waiting for Sam to discard')
  })

  it('plays a card with one click', async () => {
    const before = workedExample()
    const wrapper = await open(before)
    const after = playMoves(before, WORKED_EXAMPLE_MOVES.slice(0, 1)).state
    act.mockResolvedValue(response(after, 0))
    await handCard(wrapper, '7S').trigger('click')
    await flushPromises()

    expect(act.mock.calls[0]?.[2]).toMatchObject({ action: { type: 'play', card: '7S' }, hand: 1 })
    expect(wrapper.findAll(testId('hand-card'))).toHaveLength(3)
    expect(wrapper.get(testId('count')).text()).toBe('7')
    expect(wrapper.get(testId('prompt')).text()).toBe('Sam is thinking…')
  })

  it('sends Cut, Go and Next hand from their buttons', async () => {
    const cutting = stateWhen((s) => s.phase === 'cut')
    const pone: Seat = cutting.dealer === 0 ? 1 : 0
    let wrapper = await open(cutting, pone)
    act.mockResolvedValue(response(cutting, pone))
    await wrapper.get(testId('action-cut')).trigger('click')
    await flushPromises()
    expect(act.mock.calls.at(-1)?.[2]).toMatchObject({ action: { type: 'cut' } })
    wrapper.unmount()

    const stuck = playMoves(workedExample(), WORKED_EXAMPLE_MOVES.slice(0, 5)).state
    wrapper = await open(stuck, 1)
    act.mockResolvedValue(response(stuck, 1))
    await wrapper.get(testId('action-go')).trigger('click')
    await flushPromises()
    expect(act.mock.calls.at(-1)?.[2]).toMatchObject({ action: { type: 'go' } })
    wrapper.unmount()

    const shown = playMoves(workedExample(), WORKED_EXAMPLE_MOVES).state
    wrapper = await open(shown, 0)
    act.mockResolvedValue(response(shown, 0))
    await wrapper.get(testId('action-ready')).trigger('click')
    await flushPromises()
    expect(act.mock.calls.at(-1)?.[2]).toMatchObject({ action: { type: 'ready' } })
  })

  it('shows a move the server refuses as a toast and carries on', async () => {
    const wrapper = await open(workedExample())
    act.mockRejectedValue(new ApiError(422, 'not_your_turn', "It's not your turn."))
    await handCard(wrapper, '7S').trigger('click')
    await flushPromises()

    expect(useToasts().toasts).toMatchObject([{ kind: 'error', message: "It's not your turn." }])
    expect(phase(wrapper)).toBe('play')
    expect(wrapper.findAll(testId('hand-card'))).toHaveLength(4)
    // The card can be tried again.
    expect(handCard(wrapper, '7S').attributes('aria-disabled')).toBeUndefined()
  })

  it('never sends a second move while the first is on its way', async () => {
    const wrapper = await open(workedExample())
    act.mockReturnValue(new Promise(() => {}))
    await handCard(wrapper, '7S').trigger('click')
    await handCard(wrapper, '8D').trigger('click')
    await handCard(wrapper, '7S').trigger('click')
    expect(act).toHaveBeenCalledTimes(1)
    expect(handCard(wrapper, '8D').attributes('aria-disabled')).toBe('true')
  })

  it('gives the screen to the show panel while the hand is counted', async () => {
    const shown = playMoves(workedExample(), WORKED_EXAMPLE_MOVES).state
    const wrapper = await open(shown)
    expect(phase(wrapper)).toBe('show')
    expect(wrapper.find(testId('dom-table')).exists()).toBe(false)
    expect(wrapper.findAll(testId('show-hand'))).toHaveLength(3)
    expect(wrapper.get(testId('action-ready')).text()).toBe('Next hand')
  })

  it('shows the result of a finished game, with nothing left to press but home', async () => {
    const over = stateWhen((s) => s.phase === 'game_over', { scores: [112, 112] })
    const wrapper = await open(over, 0, 'finished')
    expect(phase(wrapper)).toBe('game_over')
    expect(wrapper.get(testId('winner')).text()).toMatch(/won/)
    expect(wrapper.find(testId('dom-table')).exists()).toBe(false)
    expect(wrapper.find('.action-bar').exists()).toBe(false)
    expect(wrapper.get(testId('back-home')).attributes('href')).toBe('/')
  })

  it('forgets the picked cards when a new hand is dealt, even if the same cards come back', async () => {
    const first = stateWhen((s) => s.phase === 'discard')
    const wrapper = await open(first)
    const cards = wrapper.findAll(testId('hand-card'))
    await cards[0]?.trigger('click')
    await cards[1]?.trigger('click')
    expect(wrapper.findAll(`${testId('hand-card')}[aria-pressed="true"]`)).toHaveLength(2)

    // The next hand happens to deal the very same cards.
    sync.mockResolvedValue(response({ ...first, hand: first.hand + 1 }, 0))
    await vi.advanceTimersByTimeAsync(3000)
    expect(wrapper.get(testId('game')).attributes('data-hand')).toBe(String(first.hand + 1))
    expect(wrapper.findAll(`${testId('hand-card')}[aria-pressed="true"]`)).toHaveLength(0)
    expect(wrapper.get(testId('action-discard')).text()).toContain('0 of 2')
    // Every card can be picked: none is blocked by a selection left over from the last hand.
    expect(
      wrapper.findAll(testId('hand-card')).filter((c) => c.attributes('aria-disabled') === 'true'),
    ).toHaveLength(0)
  })

  it('takes no tap for a moment after a card is played, and shows it on the cards', async () => {
    // The opponent is out of cards, so this player keeps the turn after each card.
    const before = workedExample()
    before.play.played[1] = [...before.hands[1]]
    before.hands[1] = []
    const wrapper = await open(before)
    const after = playMoves(before, [{ seat: 0, action: { type: 'play', card: '3C' } }]).state
    act.mockResolvedValue(response(after, 0))

    await handCard(wrapper, '3C').trigger('click')
    await flushPromises()
    expect(wrapper.findAll(testId('hand-card'))).toHaveLength(3)

    // The hand has closed up: the same spot (and keyboard focus) is now on the 7. A second
    // tap there is a double tap, not a decision. The cards say so: flat, not to be pressed.
    expect(handCard(wrapper, '7S').attributes('aria-disabled')).toBe('true')
    expect(handCard(wrapper, '7S').classes()).toContain('hand-card--idle')
    await handCard(wrapper, '7S').trigger('click')
    await flushPromises()
    expect(act).toHaveBeenCalledTimes(1)

    // A moment later the cards are up again and a tap is a play.
    await vi.advanceTimersByTimeAsync(400)
    expect(handCard(wrapper, '7S').attributes('aria-disabled')).toBeUndefined()
    expect(handCard(wrapper, '7S').classes()).toContain('hand-card--usable')
    await handCard(wrapper, '7S').trigger('click')
    await flushPromises()
    expect(act).toHaveBeenCalledTimes(2)
    expect(act.mock.calls[1]?.[2]).toMatchObject({ action: { type: 'play', card: '7S' } })
  })

  it('shows that a tap was taken while the move is on its way', async () => {
    const wrapper = await open(workedExample())
    act.mockReturnValue(new Promise(() => {})) // a slow connection
    expect(handCard(wrapper, '7S').classes()).toContain('hand-card--usable')
    await handCard(wrapper, '7S').trigger('click')
    // Every card drops flat at once: the tap registered, and no other can be made.
    for (const card of wrapper.findAll(testId('hand-card'))) {
      expect(card.classes()).toContain('hand-card--idle')
      expect(card.attributes('aria-disabled')).toBe('true')
    }
  })

  it('takes no move while the screen is still catching up with the server', async () => {
    const before = workedExample()
    const wrapper = await open(before)
    // An animating presenter (the 3D table) has not finished showing the latest step.
    useGameStore().setPresenter(() => new Promise(() => {}))
    const after = playMoves(before, WORKED_EXAMPLE_MOVES.slice(0, 2)).state
    sync.mockResolvedValue(response(after, 0))
    await vi.advanceTimersByTimeAsync(3000)

    // The screen still offers the 7 (already played, as far as the server knows).
    expect(wrapper.findAll(testId('hand-card'))).toHaveLength(4)
    await handCard(wrapper, '7S').trigger('click')
    await flushPromises()
    expect(act).not.toHaveBeenCalled()
    expect(handCard(wrapper, '7S').attributes('aria-disabled')).toBe('true')
  })

  it('treats a move refused because the game is over as a refused move, not a lost seat', async () => {
    const shown = playMoves(workedExample(), WORKED_EXAMPLE_MOVES).state
    const wrapper = await open(shown)
    act.mockRejectedValue(new ApiError(410, 'game_ended', 'The game is over.'))
    await wrapper.get(testId('action-ready')).trigger('click')
    await flushPromises()

    expect(useToasts().toasts).toMatchObject([
      { kind: 'error', message: 'That game has already finished.' },
    ])
    // Still at the table, still seated.
    expect(wrapper.find(testId('game')).exists()).toBe(true)
    expect(loadSession('BCDFG')).not.toBeNull()
  })

  it('shows what the presenter has shown, not what the server last said', async () => {
    const before = workedExample()
    const wrapper = await open(before)
    // An animating presenter (the 3D table) holds the next step back.
    useGameStore().setPresenter(() => new Promise(() => {}))
    const after = playMoves(before, WORKED_EXAMPLE_MOVES.slice(0, 2)).state
    sync.mockResolvedValue(response(after, 0))
    await vi.advanceTimersByTimeAsync(3000)

    expect(useGameStore().view?.count).toBe(15)
    expect(wrapper.get(testId('prompt')).text()).toBe('Your turn — count is 0')
    expect(wrapper.findAll(testId('hand-card'))).toHaveLength(4)
  })

  it('polls at once when the player comes back after a quiet spell, and not for every tap', async () => {
    await open(workedExample())
    // In the middle of a turn, taps and key presses send nothing extra.
    let calls = sync.mock.calls.length
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sync.mock.calls.length).toBe(calls)

    // Nothing happens for ten minutes: polling has slowed right down.
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 30_000)
    calls = sync.mock.calls.length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(sync.mock.calls.length).toBe(calls)
    // The player touches the screen: one poll straight away.
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sync.mock.calls.length).toBe(calls + 1)
  })
})

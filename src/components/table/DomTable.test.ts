import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { CardId, PlayerView, Seat } from '@shared/protocol'
import {
  playerView,
  playMoves,
  stateWhen,
  seats,
  viewWhen,
  WORKED_EXAMPLE_MOVES,
  workedExample,
} from '@/test/game'
import DomTable from './DomTable.vue'

function mountTable(
  view: PlayerView,
  options: { selected?: CardId[]; busy?: boolean; attach?: boolean } = {},
) {
  return mount(DomTable, {
    props: {
      view,
      seats: seats(view.seat),
      selected: options.selected ?? [],
      busy: options.busy ?? false,
    },
    attachTo: options.attach ? document.body : undefined,
  })
}

type Wrapper = ReturnType<typeof mountTable>
const testId = (id: string) => `[data-testid="${id}"]`
const handCards = (w: Wrapper) => w.findAll(testId('hand-card'))
const card = (w: Wrapper, id: CardId) => w.get(`${testId('hand-card')}[data-card="${id}"]`)
const usable = (w: Wrapper) =>
  handCards(w)
    .filter((c) => c.attributes('aria-disabled') !== 'true')
    .map((c) => c.attributes('data-card'))
const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0)

afterEach(() => {
  document.body.innerHTML = ''
})

describe('your hand', () => {
  it('shows each card as a real button named for screen readers', () => {
    const view = viewWhen(0, (s) => s.phase === 'discard')
    const wrapper = mountTable(view)
    const buttons = handCards(wrapper)
    expect(buttons.map((b) => b.attributes('data-card'))).toEqual(view.myHand)
    expect(buttons.every((b) => b.element.tagName === 'BUTTON')).toBe(true)
    const first = buttons[0]!
    expect(first.text()).toMatch(/ of (clubs|diamonds|hearts|spades)$/)
  })

  it('picks and unpicks cards for the crib, two at most', async () => {
    const view = viewWhen(0, (s) => s.phase === 'discard')
    const [a, b, c] = view.myHand as [CardId, CardId, CardId]
    const wrapper = mountTable(view)
    expect(usable(wrapper)).toEqual(view.myHand)
    expect(card(wrapper, a).attributes('aria-pressed')).toBe('false')

    await card(wrapper, a).trigger('click')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([[a]])
    await wrapper.setProps({ selected: [a] })
    expect(card(wrapper, a).attributes('aria-pressed')).toBe('true')

    await card(wrapper, b).trigger('click')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([[a, b]])
    await wrapper.setProps({ selected: [a, b] })

    // With two picked, the rest are visibly blocked and a click on them does nothing.
    expect(usable(wrapper)).toEqual([a, b])
    expect(card(wrapper, c).classes()).toContain('hand-card--blocked')
    const before = wrapper.emitted('update:selected')?.length
    await card(wrapper, c).trigger('click')
    expect(wrapper.emitted('update:selected')).toHaveLength(before as number)

    // Clicking a picked card puts it back.
    await card(wrapper, a).trigger('click')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([[b]])
    expect(wrapper.emitted('play')).toBeUndefined()
  })

  it('is inert once this player has discarded', async () => {
    const view = viewWhen(0, (s) => s.phase === 'discard' && s.discards[0].length === 2)
    const wrapper = mountTable(view)
    expect(handCards(wrapper)).toHaveLength(4)
    expect(usable(wrapper)).toEqual([])
    expect(handCards(wrapper).every((c) => c.classes().includes('hand-card--idle'))).toBe(true)
    expect(handCards(wrapper)[0]?.attributes('aria-pressed')).toBeUndefined()
    await handCards(wrapper)[0]?.trigger('click')
    expect(wrapper.emitted('update:selected')).toBeUndefined()
    expect(wrapper.emitted('play')).toBeUndefined()
  })

  it('plays a card with one click, but only a card the server allows', async () => {
    // Count 25 with K♥ and 3♣ in hand: only the 3 fits.
    const state = playMoves(workedExample(), WORKED_EXAMPLE_MOVES.slice(0, 4)).state
    const wrapper = mountTable(playerView(state, 0))
    expect(usable(wrapper)).toEqual(['3C'])
    expect(card(wrapper, 'KH').classes()).toContain('hand-card--blocked')
    expect(card(wrapper, 'KH').attributes('aria-disabled')).toBe('true')

    await card(wrapper, 'KH').trigger('click')
    expect(wrapper.emitted('play')).toBeUndefined()
    await card(wrapper, '3C').trigger('click')
    expect(wrapper.emitted('play')).toEqual([['3C']])
  })

  it("can't be played out of turn", async () => {
    const wrapper = mountTable(playerView(workedExample(), 1))
    expect(usable(wrapper)).toEqual([])
    expect(handCards(wrapper).every((c) => c.classes().includes('hand-card--idle'))).toBe(true)
    await handCards(wrapper)[0]?.trigger('click')
    expect(wrapper.emitted('play')).toBeUndefined()
  })

  it('blocks every card for a player who must say go', () => {
    const stuck = playMoves(workedExample(), WORKED_EXAMPLE_MOVES.slice(0, 5)).state
    const wrapper = mountTable(playerView(stuck, 1))
    expect(usable(wrapper)).toEqual([])
    expect(handCards(wrapper).every((c) => c.classes().includes('hand-card--blocked'))).toBe(true)
  })

  it('takes no clicks while a move is on its way', async () => {
    const wrapper = mountTable(playerView(workedExample(), 0), { busy: true })
    expect(usable(wrapper)).toEqual([])
    await handCards(wrapper)[0]?.trigger('click')
    expect(wrapper.emitted('play')).toBeUndefined()
  })

  it('keeps keyboard focus in the hand when the focused card is played', async () => {
    const state = workedExample()
    const wrapper = mountTable(playerView(state, 0), { attach: true })
    const second = handCards(wrapper)[1]!
    ;(second.element as HTMLElement).focus()
    expect(document.activeElement).toBe(second.element)

    const played = second.attributes('data-card') as CardId
    const next = playMoves(state, [{ seat: 0, action: { type: 'play', card: played } }]).state
    await wrapper.setProps({ view: playerView(next, 0) })
    await nextTick()
    // The card that took its place has the focus now.
    expect(document.activeElement).toBe(handCards(wrapper)[1]?.element)
    expect(handCards(wrapper)).toHaveLength(3)
  })

  it('leaves focus alone when it is somewhere else', async () => {
    const state = workedExample()
    const wrapper = mountTable(playerView(state, 0), { attach: true })
    const next = playMoves(state, [{ seat: 0, action: { type: 'play', card: '7S' } }]).state
    await wrapper.setProps({ view: playerView(next, 0) })
    await nextTick()
    expect(document.activeElement).toBe(document.body)
  })
})

describe('the rest of the table', () => {
  it("shows the opponent's hand as backs: how many, never which", () => {
    const state = stateWhen((s) => s.phase === 'discard')
    const view = playerView(state, 0)
    const wrapper = mountTable(view)
    expect(wrapper.get(testId('opponent-count')).attributes('data-count')).toBe('6')
    expect(wrapper.get(testId('opponent-count')).text()).toBe('6 cards')
    expect(wrapper.findAll('.dom-table__fan .card-back')).toHaveLength(6)
    const html = wrapper.html()
    for (const hidden of state.hands[1]) expect(html).not.toContain(`data-card="${hidden}"`)
  })

  it('shows the deck until the cut, then the starter', () => {
    const before = mountTable(viewWhen(0, (s) => s.phase === 'cut'))
    expect(before.find(testId('starter')).exists()).toBe(false)
    expect(before.text()).toContain('Deck')
    const after = mountTable(playerView(workedExample(), 0))
    expect(after.get(testId('starter')).attributes('data-card')).toBe('5H')
    expect(after.text()).toContain('Starter')
  })

  it("names the crib's owner and shows only this player's own discards", () => {
    const state = stateWhen((s) => s.phase === 'cut')
    for (const seat of [0, 1] as Seat[]) {
      const wrapper = mountTable(playerView(state, seat))
      const crib = wrapper.get(testId('crib'))
      expect(crib.attributes('data-count')).toBe('4')
      const owner = state.dealer === seat ? 'Your' : `${state.dealer === 0 ? 'Ada' : 'Sam'}'s`
      expect(crib.text()).toContain(`${owner} crib`)
      expect(crib.findAll('[data-card]').map((c) => c.attributes('data-card'))).toEqual(
        state.discards[seat],
      )
      expect(crib.findAll('.card-back')).toHaveLength(2)
      for (const hidden of state.discards[other(seat)]) {
        expect(wrapper.html()).not.toContain(`data-card="${hidden}"`)
      }
    }
  })

  it('shows the cards each player has laid, marking those from an earlier count', () => {
    // After the go: 7♠ 8♦ 3♣ and 8♣ 2♠ are turned; then the dealer leads 9♥.
    const state = playMoves(workedExample(), WORKED_EXAMPLE_MOVES.slice(0, 7)).state
    const wrapper = mountTable(playerView(state, 0))
    const laid = (seat: Seat) =>
      wrapper
        .get(testId(`played-${seat}`))
        .findAll('li')
        .map((li) => [
          li.get('[data-card]').attributes('data-card'),
          li.classes().includes('dom-table__turned'),
        ])
    expect(laid(0)).toEqual([
      ['7S', true],
      ['8D', true],
      ['3C', true],
    ])
    expect(laid(1)).toEqual([
      ['8C', true],
      ['2S', true],
      ['9H', false],
    ])
    expect(wrapper.get(testId('opponent-count')).text()).toBe('1 card')
  })
})

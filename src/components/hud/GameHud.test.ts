import { describe, expect, it, vi } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import { h } from 'vue'
import type { GameState } from '@shared/engine'
import type { CardId, GameEvent, GameStatus, PlayerView, Seat } from '@shared/protocol'
import { cardText } from '@/game/cards'
import {
  playerView,
  playMoves,
  seats,
  stateWhen,
  viewWhen,
  WORKED_EXAMPLE_MOVES,
  workedExample,
} from '@/test/game'
import GameHud from './GameHud.vue'

function mountHud(
  view: PlayerView,
  options: {
    status?: GameStatus
    events?: GameEvent[]
    selected?: CardId[]
    sending?: boolean
  } = {},
) {
  return mount(GameHud, {
    props: {
      view,
      status: options.status ?? 'active',
      seats: seats(view.seat),
      events: options.events ?? [],
      selected: options.selected ?? [],
      sending: options.sending ?? false,
    },
    slots: { default: () => h('div', { 'data-testid': 'the-table' }) },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
}

const testId = (id: string) => `[data-testid="${id}"]`
const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0)

describe('scoreboard', () => {
  it('shows both names, the scores out of 121 and who deals', () => {
    const view = viewWhen(1, (s) => s.phase === 'play' && s.scores[0] > 0 && s.scores[1] > 0)
    const wrapper = mountHud(view)
    const rows = wrapper.findAll('.score-board__player')
    // This player's row comes first.
    expect(rows[0]?.text()).toContain('Sam')
    expect(rows[0]?.text()).toContain('(you)')
    expect(rows[1]?.text()).toContain('Ada')
    expect(rows[1]?.text()).not.toContain('(you)')
    expect(wrapper.get(testId('score-0')).text()).toBe(String(view.scores[0]))
    expect(wrapper.get(testId('score-1')).text()).toBe(String(view.scores[1]))
    expect(wrapper.get(testId('player-0')).text()).toContain('/ 121')
    expect(wrapper.find(testId(`dealer-${view.dealer}`)).exists()).toBe(true)
    expect(wrapper.find(testId(`dealer-${other(view.dealer)}`)).exists()).toBe(false)
  })

  it('marks whose move it is in words, not only colour', () => {
    const view = viewWhen(0, (s) => s.phase === 'play')
    const wrapper = mountHud(view)
    const turn = wrapper.get(testId(`turn-${view.turn}`))
    expect(turn.text()).toBe(view.turn === 0 ? 'Your move' : 'Their move')
    expect(wrapper.find(testId(`turn-${other(view.turn)}`)).exists()).toBe(false)
  })

  it('marks both players while both are still choosing their discards', () => {
    const wrapper = mountHud(viewWhen(0, (s) => s.phase === 'discard'))
    expect(wrapper.get(testId('turn-0')).text()).toBe('Your move')
    expect(wrapper.get(testId('turn-1')).text()).toBe('Their move')
  })
})

describe('prompt and count', () => {
  it('shows the prompt for the phase and exposes phase and hand to tests', () => {
    const view = viewWhen(0, (s) => s.phase === 'cut')
    const wrapper = mountHud(view)
    const prompt = wrapper.get(testId('prompt'))
    expect(prompt.attributes('role')).toBe('status')
    expect(prompt.text()).toMatch(/cut the deck/i)
    expect(wrapper.get(testId('game')).attributes()).toMatchObject({
      'data-phase': 'cut',
      'data-hand': '1',
    })
  })

  it('shows the running count during the play only', () => {
    const inPlay = viewWhen(0, (s) => s.phase === 'play' && s.play.count > 0)
    expect(mountHud(inPlay).get(testId('count')).text()).toBe(String(inPlay.count))
    const discarding = viewWhen(0, (s) => s.phase === 'discard')
    expect(mountHud(discarding).find(testId('count')).exists()).toBe(false)
  })
})

describe('what just happened', () => {
  it('shows the latest moves, newest last', () => {
    const { state, events } = playMoves(workedExample(), WORKED_EXAMPLE_MOVES.slice(0, 3))
    const wrapper = mountHud(playerView(state, 0), { events })
    const feed = wrapper.get(testId('feed'))
    expect(feed.attributes('role')).toBe('log')
    expect(feed.findAll('li').map((li) => li.text())).toEqual([
      `Sam played ${cardText('8C')} — count 15. Fifteen for 2.`,
      `You played ${cardText('8D')} — count 23. A pair for 2.`,
    ])
  })

  it('keeps the move that ended the play in view while the hands are counted', () => {
    // Otherwise the last card, and the point it scored, would never be seen: the screen goes
    // straight from the play to the show.
    const { state, events } = playMoves(workedExample(), WORKED_EXAMPLE_MOVES)
    expect(state.phase).toBe('show')
    const feed = mountHud(playerView(state, 0), { events }).get(testId('feed'))
    expect(feed.findAll('li').map((li) => li.text())).toEqual([
      `Sam played ${cardText('QD')} — count 29. Last card for 1.`,
    ])
  })

  it('keeps the move that won the game in view beside the result', () => {
    const before = workedExample()
    before.scores = [100, 119]
    before.previousScores = [100, 119]
    // The dealer needs two: the fifteen made by the second card is enough.
    const { state, events } = playMoves(before, WORKED_EXAMPLE_MOVES.slice(0, 2))
    expect(state.phase).toBe('game_over')
    const wrapper = mountHud(playerView(state, 0, { canAct: false }), {
      events,
      status: 'finished',
    })
    expect(wrapper.get(testId('winner')).text()).toBe('Sam won')
    expect(
      wrapper
        .get(testId('feed'))
        .findAll('li')
        .map((li) => li.text()),
    ).toEqual([`Sam played ${cardText('8C')} — count 15. Fifteen for 2.`])
  })

  it('is on the page before anything has happened, so a screen reader hears the first line', async () => {
    const wrapper = mountHud(playerView(workedExample(), 0))
    const feed = wrapper.get(testId('feed'))
    expect(feed.attributes('role')).toBe('log')
    expect(feed.findAll('li')).toHaveLength(0)
    const { events } = playMoves(workedExample(), WORKED_EXAMPLE_MOVES.slice(0, 1))
    await wrapper.setProps({ events })
    expect(wrapper.get(testId('feed')).element).toBe(feed.element)
    expect(feed.findAll('li')).toHaveLength(1)
  })
})

describe('action buttons', () => {
  it('offers Send to crib only with exactly two cards picked', async () => {
    const view = viewWhen(0, (s) => s.phase === 'discard')
    const [a, b] = view.myHand as [CardId, CardId]
    const wrapper = mountHud(view)
    const button = () => wrapper.get(testId('action-discard'))
    expect(button().attributes('disabled')).toBeDefined()
    expect(button().text()).toContain('0 of 2')

    await wrapper.setProps({ selected: [a] })
    expect(button().attributes('disabled')).toBeDefined()
    expect(button().text()).toContain('1 of 2')

    await wrapper.setProps({ selected: [a, b] })
    expect(button().attributes('disabled')).toBeUndefined()
    await button().trigger('click')
    expect(wrapper.emitted('discard')).toHaveLength(1)
  })

  it('offers nothing to a player who has already discarded', () => {
    const view = viewWhen(0, (s) => s.phase === 'discard' && s.discards[0].length === 2)
    const wrapper = mountHud(view)
    expect(wrapper.find('.action-bar').exists()).toBe(false)
  })

  it('offers Cut to the pone only', async () => {
    const state = stateWhen((s) => s.phase === 'cut')
    const pone = other(state.dealer)
    const wrapper = mountHud(playerView(state, pone))
    await wrapper.get(testId('action-cut')).trigger('click')
    expect(wrapper.emitted('cut')).toHaveLength(1)
    expect(mountHud(playerView(state, state.dealer)).find(testId('action-cut')).exists()).toBe(
      false,
    )
  })

  it('offers Go only to the player who is stuck', async () => {
    const stuck = playMoves(workedExample(), WORKED_EXAMPLE_MOVES.slice(0, 5)).state
    const wrapper = mountHud(playerView(stuck, 1))
    await wrapper.get(testId('action-go')).trigger('click')
    expect(wrapper.emitted('go')).toHaveLength(1)
    expect(mountHud(playerView(stuck, 0)).find(testId('action-go')).exists()).toBe(false)
    // During ordinary play there is no button at all: cards are played on the table.
    expect(mountHud(playerView(workedExample(), 0)).find('.action-bar').exists()).toBe(false)
  })

  it('offers Next hand until this player is ready', async () => {
    const shown = stateWhen((s) => s.phase === 'show')
    const wrapper = mountHud(playerView(shown, 0))
    await wrapper.get(testId('action-ready')).trigger('click')
    expect(wrapper.emitted('ready')).toHaveLength(1)

    const waiting = stateWhen((s) => s.phase === 'show' && s.ready[0] && !s.ready[1])
    expect(mountHud(playerView(waiting, 0)).find(testId('action-ready')).exists()).toBe(false)
    expect(mountHud(playerView(waiting, 1)).find(testId('action-ready')).exists()).toBe(true)
  })

  it('moves keyboard focus to the prompt when the button that was pressed goes away', async () => {
    const shown = stateWhen((s) => s.phase === 'show')
    const wrapper = mount(GameHud, {
      props: {
        view: playerView(shown, 0),
        status: 'active',
        seats: seats(0),
        events: [],
        selected: [],
        sending: false,
      },
      attachTo: document.body,
      global: { stubs: { RouterLink: RouterLinkStub } },
    })
    const button = wrapper.get(testId('action-ready'))
    ;(button.element as HTMLElement).focus()
    expect(document.activeElement).toBe(button.element)

    // Next hand was pressed: this player is ready, the button is gone.
    const ready = playMoves(shown, [{ seat: 0, action: { type: 'ready' } }]).state
    await wrapper.setProps({ view: playerView(ready, 0) })
    expect(wrapper.find(testId('action-ready')).exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get(testId('prompt')).element)
    wrapper.unmount()
  })

  it('leaves focus where it is when it was not on a button of the tray', async () => {
    const shown = stateWhen((s) => s.phase === 'show')
    const wrapper = mountHud(playerView(shown, 0))
    const ready = playMoves(shown, [{ seat: 0, action: { type: 'ready' } }]).state
    await wrapper.setProps({ view: playerView(ready, 0) })
    expect(document.activeElement).toBe(document.body)
  })

  it('ignores clicks while a move is on its way', async () => {
    const wrapper = mountHud(
      viewWhen(0, (s) => s.phase === 'show'),
      { sending: true },
    )
    const button = wrapper.get(testId('action-ready'))
    expect(button.attributes('aria-disabled')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('ready')).toBeUndefined()
  })
})

describe('the show', () => {
  function shownState(): GameState {
    return playMoves(workedExample(), WORKED_EXAMPLE_MOVES).state
  }

  it("lists each hand's cards, items and total exactly as the engine counted them", () => {
    const state = shownState()
    const wrapper = mountHud(playerView(state, 0))
    const hands = wrapper.findAll(testId('show-hand'))
    // Counting order: pone's hand, dealer's hand, crib.
    expect(hands.map((hand) => hand.get('h3 span').text())).toEqual([
      'Your hand',
      "Sam's hand",
      "Sam's crib",
    ])
    hands.forEach((hand, i) => {
      const result = state.show[i]!
      expect(hand.findAll(testId('show-card')).map((c) => c.attributes('data-card'))).toEqual(
        result.cards,
      )
      expect(hand.get(`${testId('show-starter')} [data-card]`).attributes('data-card')).toBe('5H')
      expect(
        hand.findAll(testId('show-item')).map((li) => Number(li.attributes('data-points'))),
      ).toEqual(result.items.map((item) => item.points))
      expect(hand.get(testId('show-total')).attributes('data-total')).toBe(String(result.total))
    })
    expect(hands.map((hand) => hand.get(testId('show-total')).text())).toEqual([
      '6 points',
      '4 points',
      '10 points',
    ])
    // The crib, read the traditional way, with the cards of each item.
    expect(hands[2]?.findAll(testId('show-item')).map((li) => li.text())).toEqual([
      `Fifteen two${cardText('5H')} ${cardText('JH')}`,
      `Fifteen four${cardText('AC')} ${cardText('4D')} ${cardText('JH')}`,
      `Fifteen six${cardText('4D')} ${cardText('5H')} ${cardText('6S')}`,
      `Run of three is nine${cardText('4D')} ${cardText('5H')} ${cardText('6S')}`,
      `His nobs is ten${cardText('JH')} ${cardText('5H')}`,
    ])
  })

  it('shows a hand worth nothing as such', () => {
    const zero = stateWhen((s) => s.phase === 'show' && s.show.some((r) => r.total === 0), {
      seed: 'zero-hand',
    })
    const wrapper = mountHud(playerView(zero, 0))
    const index = zero.show.findIndex((r) => r.total === 0)
    const hand = wrapper.findAll(testId('show-hand'))[index]!
    expect(hand.get(testId('show-total')).text()).toBe('No points')
    expect(hand.find(testId('show-nothing')).exists()).toBe(true)
    expect(hand.findAll(testId('show-item'))).toHaveLength(0)
    expect(hand.findAll(testId('show-card'))).toHaveLength(4)
  })

  it('is not there before the hand is counted', () => {
    const wrapper = mountHud(playerView(workedExample(), 0))
    expect(wrapper.find(testId('show-panel')).exists()).toBe(false)
    expect(wrapper.find(testId('the-table')).exists()).toBe(true)
  })
})

describe('a show too long for the screen', () => {
  it('says there is more below and scrolls on when asked, until the end is in view', async () => {
    const state = playMoves(workedExample(), WORKED_EXAMPLE_MOVES).state
    const wrapper = mountHud(playerView(state, 0))
    expect(wrapper.find(testId('more-below')).exists()).toBe(false)

    // jsdom lays nothing out: give the panel a size that needs scrolling.
    const panels = wrapper.get('.game-hud__panels').element as HTMLElement
    const size = { scrollHeight: 900, clientHeight: 300 }
    Object.defineProperties(panels, {
      scrollHeight: { get: () => size.scrollHeight },
      clientHeight: { get: () => size.clientHeight },
    })
    const scrollBy = vi.fn()
    panels.scrollBy = scrollBy as unknown as typeof panels.scrollBy
    await wrapper.get('.game-hud__panels').trigger('scroll')

    const more = wrapper.get(testId('more-below'))
    expect(more.element.tagName).toBe('BUTTON')
    await more.trigger('click')
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 240 }))

    // Scrolled to the end: nothing more to announce.
    panels.scrollTop = 600
    await wrapper.get('.game-hud__panels').trigger('scroll')
    expect(wrapper.find(testId('more-below')).exists()).toBe(false)
  })
})

describe('game over', () => {
  const over = (skunk: 'none' | 'skunk' | 'double') => (s: GameState) =>
    s.phase === 'game_over' && s.skunk === skunk

  it('names the winner on both screens with the final scores', () => {
    const state = stateWhen(over('none'), { scores: [112, 112] })
    const winner = state.winner as Seat
    const won = mountHud(playerView(state, winner, { canAct: false }), { status: 'finished' })
    expect(won.get(testId('winner')).text()).toBe('You won!')
    expect(won.get(testId(`final-score-${winner}`)).text()).toBe('121')
    expect(won.find(testId('skunk')).exists()).toBe(false)
    expect(won.getComponent(RouterLinkStub).props('to')).toBe('/')
    expect(won.get(testId('back-home')).text()).toBe('Back to home')

    const lost = mountHud(playerView(state, other(winner), { canAct: false }), {
      status: 'finished',
    })
    expect(lost.get(testId('winner')).text()).toBe(`${winner === 0 ? 'Ada' : 'Sam'} won`)
    expect(lost.get(testId(`final-score-${other(winner)}`)).text()).toBe(
      String(state.scores[other(winner)]),
    )
    expect(lost.get(testId('prompt')).text()).toMatch(/won the game/)
    expect(lost.find('.action-bar').exists()).toBe(false)
  })

  it('reports a skunk and a double skunk', () => {
    const skunk = stateWhen(over('skunk'), { scores: [70, 110], seed: 'skunk' })
    const loser = other(skunk.winner as Seat)
    expect(mountHud(playerView(skunk, loser)).get(testId('skunk')).text()).toBe(
      "Skunk! You didn't reach 91.",
    )
    expect(
      mountHud(playerView(skunk, other(loser)))
        .get(testId('skunk'))
        .text(),
    ).toBe(`Skunk! ${loser === 0 ? 'Ada' : 'Sam'} didn't reach 91.`)
    const double = stateWhen(over('double'), { scores: [110, 20], seed: 'double' })
    expect(
      mountHud(playerView(double, double.winner as Seat))
        .get(testId('skunk'))
        .text(),
    ).toMatch(/^Double skunk! .* didn't reach 61\.$/)
  })

  it('lists only the hands that were counted when the game ends during the show', () => {
    const state = stateWhen(
      (s) => s.phase === 'game_over' && s.show.length > 0 && s.show.length < 3,
      { scores: [115, 115], seed: 'pone-counts-out' },
    )
    const wrapper = mountHud(playerView(state, 0), { status: 'finished' })
    expect(wrapper.findAll(testId('show-hand'))).toHaveLength(state.show.length)
    expect(wrapper.find(testId('game-over')).exists()).toBe(true)
  })
})

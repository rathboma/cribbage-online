import {
  applyAction,
  cardId,
  createGame,
  fullDeck,
  playerView,
  seededRng,
  type Action,
  type CardId,
  type GameState,
  type PlayerView,
  type Seat,
} from '@shared/engine'
import type { LayoutOptions } from './layout'

/**
 * One hand of a game at every point the table has to draw, for /dev/table and the layout
 * tests. The states come from the real rules engine, so each view is exactly what the server
 * would send either seat.
 *
 * The hands are those of the worked example in cribbage_rules.md (the play goes differently,
 * to include a go): seat 0 is the pone and keeps 3♣ 7♠ 8♦ K♥, seat 1 deals and keeps
 * 2♠ 8♣ 9♥ Q♦, the crib is 4♦ 6♠ A♣ J♥ and the starter is 5♥.
 */

export interface LayoutFixture {
  id: string
  label: string
  state: GameState
  /** Cards each seat has picked for the crib, shown raised. */
  selected?: Partial<Record<Seat, CardId[]>>
  /** How many of the show's counts are on screen (LayoutOptions.showStep). */
  showStep?: number
}

const KEPT: [CardId[], CardId[]] = [
  ['3C', '7S', '8D', 'KH'],
  ['2S', '8C', '9H', 'QD'],
]
const DISCARDS: [[CardId, CardId], [CardId, CardId]] = [
  ['4D', '6S'],
  ['AC', 'JH'],
]
const STARTER: CardId = '5H'

/** Pone leads K♥, dealer Q♦ (20), pone 8♦ (28), dealer 2♠ (30), pone says go. */
const FIRST_COUNT: [Seat, Action][] = [
  [0, { type: 'play', card: 'KH' }],
  [1, { type: 'play', card: 'QD' }],
  [0, { type: 'play', card: '8D' }],
  [1, { type: 'play', card: '2S' }],
  [0, { type: 'go' }],
]
/** The dealer can't play either and pegs one for the go; the pone leads 7♠, dealer 8♣ for fifteen. */
const SECOND_COUNT_START: [Seat, Action][] = [
  [0, { type: 'play', card: '7S' }],
  [1, { type: 'play', card: '8C' }],
]
const SECOND_COUNT_END: [Seat, Action][] = [
  [0, { type: 'play', card: '3C' }],
  [1, { type: 'play', card: '9H' }],
]

function apply(state: GameState, moves: [Seat, Action][]): GameState {
  const rng = seededRng('layout-fixtures')
  return moves.reduce((s, [seat, action]) => {
    const result = applyAction(s, seat, action, rng)
    if ('error' in result) throw new Error(`Fixture move refused: ${result.error}`)
    return result.state
  }, state)
}

function dealt(): GameState {
  const hands: [CardId[], CardId[]] = [
    [...KEPT[0], ...DISCARDS[0]],
    [...KEPT[1], ...DISCARDS[1]],
  ]
  const used = new Set<CardId>([...hands[0], ...hands[1]])
  const deck = fullDeck()
    .map(cardId)
    .filter((c) => !used.has(c))
  return {
    ...createGame(),
    phase: 'discard',
    hand: 1,
    dealer: 1,
    hands,
    deck,
  }
}

function build(): LayoutFixture[] {
  const deal = dealt()
  const oneDiscarded = apply(deal, [[1, { type: 'discard', cards: DISCARDS[1] }]])
  const cut = apply(oneDiscarded, [[0, { type: 'discard', cards: DISCARDS[0] }]])
  // The starter is cut at random; the fixtures want 5♥, so the play starts from a set state.
  const playing: GameState = {
    ...cut,
    phase: 'play',
    starter: STARTER,
    deck: cut.deck.filter((c) => c !== STARTER),
    play: { ...cut.play, count: 0, turn: 0, sequence: [], played: [[], []], goSaid: null },
  }
  const midPlay = apply(playing, FIRST_COUNT.slice(0, 3))
  const afterGo = apply(playing, [...FIRST_COUNT, ...SECOND_COUNT_START])
  const show = apply(afterGo, SECOND_COUNT_END)
  if (show.phase !== 'show' || show.show.length !== 3) throw new Error('Fixture: expected the show')
  // The server counts the whole show at once; the screen shows one count at a time. A win
  // stops the show, though, so a game won on the dealer's hand never counts the crib.
  const won: GameState = {
    ...show,
    show: show.show.slice(0, 2),
    phase: 'game_over',
    scores: [104, 121],
    previousScores: [96, 112],
    winner: 1,
    skunk: 'none',
  }
  return [
    { id: 'lobby', label: 'Before the deal', state: createGame() },
    { id: 'deal', label: 'Deal', state: deal },
    {
      id: 'discard',
      label: 'Discard (two picked)',
      state: oneDiscarded,
      selected: { 0: [...DISCARDS[0]], 1: [...DISCARDS[1]] },
    },
    { id: 'cut', label: 'Cut', state: cut },
    { id: 'play', label: 'Mid-play', state: midPlay },
    { id: 'go', label: 'After a go', state: afterGo },
    { id: 'show-1', label: 'Show: pone', state: show, showStep: 1 },
    { id: 'show-2', label: 'Show: dealer', state: show, showStep: 2 },
    { id: 'show-3', label: 'Show: crib', state: show, showStep: 3 },
    { id: 'game-over', label: 'Game over', state: won },
  ]
}

export const LAYOUT_FIXTURES: readonly LayoutFixture[] = build()

/** The fixture as `seat` sees it, and the layout options for it (picked cards, show step). */
export function fixtureView(
  fixture: LayoutFixture,
  seat: Seat,
): { view: PlayerView; options: LayoutOptions & { selected: CardId[] } } {
  const view = playerView(fixture.state, seat)
  const selected = (fixture.selected?.[seat] ?? []).filter((c) => view.myHand.includes(c))
  const options = { selected, ...(fixture.showStep ? { showStep: fixture.showStep } : {}) }
  return { view, options }
}

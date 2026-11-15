/**
 * What each player is allowed to see and do. `playerView` is the only game data ever sent to a
 * client: it must never contain a card hidden from that seat.
 */
import { parseCard, type CardId } from './cards'
import { legalPlays } from './pegging'
import type { ScoreBreakdown } from './show'
import type { GameState, Pair, Phase, PlayedCard, ShowSource, Skunk } from './state'
import { otherSeat, type Seat } from './types'

/** What a seat may do right now. The UI enables and disables its controls from this alone. */
export interface LegalActions {
  /** May discard two cards to the crib. */
  discard: boolean
  /** May cut for the starter. */
  cut: boolean
  /** Cards that may be played now. Empty when it isn't this seat's turn to play. */
  playable: CardId[]
  /** Must say go: on turn, holding cards, none of them playable (and the opponent holds cards
   * and hasn't said go, which the engine guarantees whenever this seat is on turn). */
  go: boolean
  /** May acknowledge the show to start the next hand. */
  ready: boolean
}

/** A hand or the crib as counted in the show. */
export interface ShowView {
  seat: Seat
  source: ShowSource
  /** Listed explicitly: a zero-point hand has no items to derive them from. */
  cards: CardId[]
  breakdown: ScoreBreakdown
}

export interface PlayerView {
  /** The seat this view is for. */
  seat: Seat
  phase: Phase
  /** Hand number: 0 before the first deal. */
  hand: number
  dealer: Seat
  /** Front pegs (current scores) by seat. */
  scores: Pair<number>
  /** Rear pegs (score before each seat's last award) by seat. */
  previousScores: Pair<number>
  /** This seat's cards still in hand. */
  myHand: CardId[]
  /** The two cards this seat put in the crib (empty until discarded). */
  myDiscards: CardId[]
  /** How many cards the opponent holds. Never which. */
  opponentHandCount: number
  /** How many cards are in the crib (0, 2 or 4). */
  cribCount: number
  /** The crib's cards, once the show has counted it; null until then. */
  crib: CardId[] | null
  starter: CardId | null
  /** Running total of the current count. */
  count: number
  /** Whose turn it is to play or say go (meaningful in the play). */
  turn: Seat
  /** Cards laid in the current count, oldest first. */
  sequence: PlayedCard[]
  /** Every card each seat has laid this hand, by seat, in order. */
  played: Pair<CardId[]>
  hasDiscarded: Pair<boolean>
  /** Who has said go in the current count. */
  saidGo: Pair<boolean>
  ready: Pair<boolean>
  /** Hands counted so far in the show, in counting order. */
  show: ShowView[]
  winner: Seat | null
  skunk: Skunk | null
  legal: LegalActions
}

/**
 * The view of the game for `seat`. Pass `canAct: false` when the game is no longer being
 * played (finished, abandoned or expired on the server), so `legal` offers nothing.
 */
export function playerView(
  state: GameState,
  seat: Seat,
  options: { canAct?: boolean } = {},
): PlayerView {
  const opponent = otherSeat(seat)
  const cribShown = state.show.some((r) => r.source === 'crib')
  const cribCount = state.discards[0].length + state.discards[1].length
  return {
    seat,
    phase: state.phase,
    hand: state.hand,
    dealer: state.dealer,
    scores: [...state.scores],
    previousScores: [...state.previousScores],
    myHand: [...state.hands[seat]],
    myDiscards: [...state.discards[seat]],
    opponentHandCount: state.hands[opponent].length,
    cribCount,
    crib: cribShown ? [...(state.show.find((r) => r.source === 'crib')?.cards ?? [])] : null,
    starter: state.starter,
    count: state.play.count,
    turn: state.play.turn,
    sequence: state.play.sequence.map((p) => ({ ...p })),
    played: [[...state.play.played[0]], [...state.play.played[1]]],
    hasDiscarded: [state.discards[0].length > 0, state.discards[1].length > 0],
    saidGo: [state.play.goSaid === 0, state.play.goSaid === 1],
    ready: [...state.ready],
    show: state.show.map((r) => ({
      seat: r.seat,
      source: r.source,
      cards: [...r.cards],
      breakdown: { total: r.total, items: r.items.map((i) => ({ ...i, cards: [...i.cards] })) },
    })),
    winner: state.winner,
    skunk: state.skunk,
    legal: options.canAct === false ? noActions() : legalActions(state, seat),
  }
}

function noActions(): LegalActions {
  return { discard: false, cut: false, playable: [], go: false, ready: false }
}

/**
 * What `seat` may do right now. Mirrors the checks in `applyAction`: everything allowed here is
 * accepted there. (A repeated `ready` is also accepted there, as a no-op, but isn't offered.)
 */
export function legalActions(state: GameState, seat: Seat): LegalActions {
  const none = noActions()
  switch (state.phase) {
    case 'discard':
      return { ...none, discard: state.discards[seat].length === 0 }
    case 'cut':
      return { ...none, cut: seat === otherSeat(state.dealer) }
    case 'play': {
      if (state.play.turn !== seat) return none
      const hand = state.hands[seat]
      const playable = hand.filter((id) => legalPlays([parseCard(id)], state.play.count).length)
      const opponent = otherSeat(seat)
      const goOwed =
        hand.length > 0 && state.hands[opponent].length > 0 && state.play.goSaid !== opponent
      return { ...none, playable, go: playable.length === 0 && goOwed }
    }
    case 'show':
      return { ...none, ready: !state.ready[seat] }
    default:
      return none
  }
}

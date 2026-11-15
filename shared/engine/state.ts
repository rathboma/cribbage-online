/**
 * Game state, actions, events and errors of the state machine in game.ts.
 * Everything here is plain JSON: cards are CardIds, never Card objects.
 */
import type { CardId } from './cards'
import type { PegItem } from './pegging'
import type { ScoreItem } from './show'
import type { Seat } from './types'

export const WINNING_SCORE = 121

export type Phase = 'lobby' | 'discard' | 'cut' | 'play' | 'show' | 'game_over'
export type Skunk = 'none' | 'skunk' | 'double'
export type ShowSource = 'hand' | 'crib'
export type Pair<T> = [T, T]

/** A card laid in the play, and who laid it. */
export interface PlayedCard {
  seat: Seat
  card: CardId
}

export interface PlayState {
  /** Running total of the current count, 0 to 31. */
  count: number
  /** Whose turn it is to play or say go. */
  turn: Seat
  /** Cards laid since the count was last reset, oldest first. */
  sequence: PlayedCard[]
  /** Every card each seat has laid this hand, in order (across all counts). */
  played: Pair<CardId[]>
  /** The seat that said go in the current count, if any. */
  goSaid: Seat | null
}

/** One hand or crib counted in the show. */
export interface ShowResult {
  seat: Seat
  source: ShowSource
  cards: CardId[]
  starter: CardId
  items: ScoreItem[]
  total: number
}

/**
 * The complete state of a game, including hidden information (the deck, both hands and the
 * crib). It never leaves the server; clients get a redacted view (see view.ts, P1.5).
 */
export interface GameState {
  phase: Phase
  /** Hand number: 0 before the first deal, then 1, 2, ... */
  hand: number
  dealer: Seat
  /** Front pegs: the current scores, capped at 121. */
  scores: Pair<number>
  /** Rear pegs: each seat's score before its last award. */
  previousScores: Pair<number>
  /** The cut for first deal, by seat. Set by `start`. */
  firstCut: Pair<CardId> | null
  /** Undealt cards (40 after the deal, 39 once the starter is cut). Hidden from both seats. */
  deck: CardId[]
  /** Cards each seat holds right now: 6 after the deal, 4 after discarding, fewer in the play. */
  hands: Pair<CardId[]>
  /** The four cards each seat kept after discarding, counted in the show. */
  kept: Pair<CardId[]>
  /** The two cards each seat put in the crib. Together they are the crib. */
  discards: Pair<CardId[]>
  starter: CardId | null
  play: PlayState
  /** Hands counted so far in the show, in counting order. */
  show: ShowResult[]
  /** Who has acknowledged the show and is ready for the next deal. */
  ready: Pair<boolean>
  winner: Seat | null
  skunk: Skunk | null
}

export type Action =
  | { type: 'start' }
  | { type: 'discard'; cards: [CardId, CardId] }
  | { type: 'cut' }
  | { type: 'play'; card: CardId }
  | { type: 'go' }
  | { type: 'ready' }

export type ActionType = Action['type']

/**
 * What just happened, in order. Events are shown to both players, so they never contain a
 * card that is still hidden from either of them.
 */
export type GameEvent =
  /** The decisive cut for first deal; `cards` is indexed by seat. */
  | { type: 'cut_for_deal'; cards: Pair<CardId>; dealer: Seat }
  /** No cards: each player reads their own hand from their view. */
  | { type: 'hand_dealt'; hand: number; dealer: Seat }
  | { type: 'discarded'; seat: Seat }
  | { type: 'starter_cut'; card: CardId }
  | { type: 'card_played'; seat: Seat; card: CardId; count: number }
  /** Only for an explicit go. */
  | { type: 'go'; seat: Seat }
  /** Every score outside the show. Follows the event that caused it. */
  | { type: 'points'; seat: Seat; items: PegItem[]; from: number; to: number }
  | { type: 'count_reset'; leader: Seat }
  /** One per hand counted; reveals its cards. */
  | {
      type: 'show_scored'
      seat: Seat
      source: ShowSource
      cards: CardId[]
      starter: CardId
      items: ScoreItem[]
      total: number
      from: number
      to: number
    }
  /** The show is finished; waiting for both players to be ready. */
  | { type: 'hand_complete'; hand: number }
  | { type: 'game_over'; winner: Seat; scores: Pair<number>; skunk: Skunk }

export type GameEventType = GameEvent['type']

export type EngineErrorCode =
  | 'wrong_phase'
  | 'not_your_turn'
  | 'card_not_in_hand'
  | 'illegal_play'
  | 'must_play'
  | 'go_not_needed'
  | 'already_discarded'
  | 'game_over'
  /** The action itself is malformed (unknown type, wrong number of cards, repeated card). */
  | 'invalid_action'

export type ApplyResult = { state: GameState; events: GameEvent[] } | { error: EngineErrorCode }

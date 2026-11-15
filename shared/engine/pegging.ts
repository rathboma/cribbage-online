/**
 * The play (pegging): which cards may be played, and what a played card scores.
 * Rules: cribbage_rules.md section 5. When go, last card and his heels are awarded is decided
 * by the game state machine; this module only scores the card itself.
 */
import { cardId, cardValue, type Card, type CardId } from './cards'

export type PegKind = 'fifteen' | 'thirtyone' | 'pair' | 'run' | 'go' | 'last_card' | 'heels'

/** Any points scored outside the show. `scorePlay` makes the first four kinds. */
export interface PegItem {
  kind: PegKind
  points: number
  cards: CardId[]
}

export const MAX_COUNT = 31

/**
 * Fixed point values outside the show, keyed by item kind. Every count ends with exactly one
 * award to the player of its last card: the `thirtyone` item that `scorePlay` returns when the
 * card makes 31, or otherwise a `go` (or `last_card`) item added by the state machine. Never both.
 */
export const PEG_POINTS = {
  fifteen: 2,
  /** Also the end-of-count award for that count: no go or last-card point on top. */
  thirtyone: 2,
  /** For the player of the last card of a count that ended below 31. */
  go: 1,
  /** For the player of the final card of the hand, when it doesn't make 31. */
  last_card: 1,
  /** For the dealer when the starter is a jack. */
  heels: 2,
} as const satisfies Partial<Record<PegKind, number>>

/** Pair (2), pair royal (6), double pair royal (12): alternatives, not cumulative. */
export const PAIR_POINTS: Readonly<Record<2 | 3 | 4, number>> = { 2: 2, 3: 6, 4: 12 }

/** The running total of a sequence (the cards played since the count was last reset). */
export function countOf(sequence: readonly Card[]): number {
  return sequence.reduce((sum, card) => sum + cardValue(card), 0)
}

/** The cards in `hand` that can be played without taking the count above 31. */
export function legalPlays<T extends Card>(hand: readonly T[], count: number): T[] {
  return hand.filter((card) => count + cardValue(card) <= MAX_COUNT)
}

/**
 * Scores `card` played on top of `sequence` (the cards played since the last reset, oldest
 * first). Returns the new count and the items in the order they are announced: fifteen or
 * thirty-one, then pair, then run. A `thirtyone` item is that count's end-of-count award, so the
 * caller must not add a go or last-card point for it.
 *
 * Throws on input the state machine never produces: a repeated card, or a count above 31.
 * Validate client input before calling it.
 */
export function scorePlay(
  sequence: readonly Card[],
  card: Card,
): { count: number; items: PegItem[] } {
  const played = [...sequence, card]
  if (new Set(played.map(cardId)).size !== played.length) {
    throw new Error(`A card appears twice in the count: ${played.map(cardId).join(' ')}`)
  }
  const count = countOf(played)
  if (count > MAX_COUNT) throw new Error(`${cardId(card)} would take the count to ${count}`)

  const items: PegItem[] = []
  if (count === 15) items.push(pegItem('fifteen', PEG_POINTS.fifteen, played))
  if (count === MAX_COUNT) items.push(pegItem('thirtyone', PEG_POINTS.thirtyone, played))

  const pair = trailingSameRank(played)
  if (pair.length >= 2) {
    items.push(pegItem('pair', PAIR_POINTS[pair.length as 2 | 3 | 4], pair))
  }

  const run = longestTrailingRun(played)
  if (run.length >= 3) items.push(pegItem('run', run.length, run))

  return { count, items }
}

export function pegItem(kind: PegKind, points: number, cards: readonly Card[]): PegItem {
  return { kind, points, cards: cards.map(cardId) }
}

/** The last card plus the cards immediately before it of the same rank (2 to 4 cards). */
function trailingSameRank(played: readonly Card[]): Card[] {
  const last = played.at(-1) as Card
  let start = played.length - 1
  while (start > 0 && (played[start - 1] as Card).rank === last.rank) start--
  return played.slice(start)
}

/**
 * The longest tail of the sequence (3 cards or more) whose ranks are all different and
 * consecutive, in any order. Every length is tested, longest first, because a longer tail can
 * be a run when a shorter one is not (4, 2, 6, 5, 3: only all five cards are a run).
 */
function longestTrailingRun(played: readonly Card[]): Card[] {
  for (let length = played.length; length >= 3; length--) {
    const tail = played.slice(-length)
    const ranks = new Set(tail.map((c) => c.rank))
    if (ranks.size !== length) continue
    if (Math.max(...ranks) - Math.min(...ranks) === length - 1) return tail
  }
  return []
}

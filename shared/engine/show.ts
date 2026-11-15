/**
 * The show: scoring a four-card hand or crib together with the starter.
 * Rules: cribbage_rules.md section 6.
 */
import {
  cardId,
  cardValue,
  isCardId,
  JACK,
  parseCard,
  sameCard,
  sortCards,
  type Card,
  type CardId,
} from './cards'

export type ScoreKind = 'fifteen' | 'pair' | 'run' | 'flush' | 'nobs'

/** One scoring combination, listing exactly the cards it uses. */
export interface ScoreItem {
  kind: ScoreKind
  points: number
  /**
   * Fifteens, pairs and runs list their cards by rank then suit, starter included. A flush lists
   * the four hand cards in that order, then the starter if it matches; nobs lists the jack, then
   * the starter.
   */
  cards: CardId[]
}

export interface ScoreBreakdown {
  total: number
  /** In the traditional counting order: fifteens, pairs, runs, flush, nobs. */
  items: ScoreItem[]
}

export const SHOW_POINTS = {
  fifteen: 2,
  pair: 2,
  nobs: 1,
  handFlush: 4,
  fiveCardFlush: 5,
} as const

/**
 * Scores a hand (or the crib) of four cards with the starter as a fifth card.
 * Throws if the cards are not four distinct cards plus a different starter.
 */
export function scoreHand(hand: readonly Card[], starter: Card, isCrib: boolean): ScoreBreakdown {
  assertValidShow(hand, starter)
  // Sorting first makes the items, and the cards inside each item, come out in a stable order.
  const cards = sortCards([...hand, starter])
  const items = [
    ...fifteens(cards),
    ...pairs(cards),
    ...runs(cards),
    ...flush(hand, starter, isCrib),
    ...nobs(hand, starter),
  ]
  return { total: items.reduce((sum, item) => sum + item.points, 0), items }
}

function item(kind: ScoreKind, points: number, cards: readonly Card[]): ScoreItem {
  return { kind, points, cards: cards.map(cardId) }
}

/** Every different set of two or more cards adding up to 15. Smaller sets first. */
function fifteens(cards: readonly Card[]): ScoreItem[] {
  const found: Card[][] = []
  for (let mask = 1; mask < 1 << cards.length; mask++) {
    const subset = cards.filter((_, i) => mask & (1 << i))
    if (subset.length >= 2 && subset.reduce((sum, c) => sum + cardValue(c), 0) === 15) {
      found.push(subset)
    }
  }
  found.sort((a, b) => a.length - b.length || compareIndexLists(cards, a, b))
  return found.map((subset) => item('fifteen', SHOW_POINTS.fifteen, subset))
}

/** Orders two subsets of `cards` by the positions of their cards (lexicographically). */
function compareIndexLists(cards: readonly Card[], a: readonly Card[], b: readonly Card[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = cards.indexOf(a[i] as Card) - cards.indexOf(b[i] as Card)
    if (diff !== 0) return diff
  }
  return 0
}

/** Every different pair of cards of the same rank: three of a kind is three items. */
function pairs(cards: readonly Card[]): ScoreItem[] {
  const out: ScoreItem[] = []
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i] as Card
      const b = cards[j] as Card
      if (a.rank === b.rank) out.push(item('pair', SHOW_POINTS.pair, [a, b]))
    }
  }
  return out
}

/**
 * Runs of three or more consecutive ranks. Only the longest runs count, but each different
 * choice of cards is its own run, so 3-4-4-5 is two runs of three.
 */
function runs(cards: readonly Card[]): ScoreItem[] {
  // Group the (sorted) cards by rank, then look for the longest stretch of consecutive ranks.
  const byRank = new Map<number, Card[]>()
  for (const card of cards) byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card])
  const ranks = [...byRank.keys()]

  let best: number[] = []
  let current: number[] = []
  for (const rank of ranks) {
    current =
      current.length > 0 && rank === (current.at(-1) as number) + 1 ? [...current, rank] : [rank]
    if (current.length > best.length) best = current
  }
  if (best.length < 3) return []

  // One run per way of choosing a card of each rank in the stretch.
  let combos: Card[][] = [[]]
  for (const rank of best) {
    combos = combos.flatMap((combo) => (byRank.get(rank) as Card[]).map((c) => [...combo, c]))
  }
  return combos.map((combo) => item('run', combo.length, combo))
}

/** Hand: four hand cards of one suit score 4, or 5 with the starter. Crib: only all five. */
function flush(hand: readonly Card[], starter: Card, isCrib: boolean): ScoreItem[] {
  const suit = hand[0]?.suit
  if (!hand.every((c) => c.suit === suit)) return []
  const sorted = sortCards(hand)
  if (starter.suit === suit) return [item('flush', SHOW_POINTS.fiveCardFlush, [...sorted, starter])]
  return isCrib ? [] : [item('flush', SHOW_POINTS.handFlush, sorted)]
}

/** His nobs: a jack held in the hand or crib, of the starter's suit. Never the starter itself. */
function nobs(hand: readonly Card[], starter: Card): ScoreItem[] {
  const jack = hand.find((c) => c.rank === JACK && c.suit === starter.suit)
  return jack ? [item('nobs', SHOW_POINTS.nobs, [jack, starter])] : []
}

function assertValidShow(hand: readonly Card[], starter: Card): void {
  if (hand.length !== 4) throw new Error(`A hand has 4 cards, got ${hand.length}`)
  for (const card of [...hand, starter]) {
    // Rejects malformed cards such as { rank: '5', suit: 'H' } or { rank: 14, suit: 'X' }.
    if (!isCardId(cardId(card)) || !sameCard(parseCard(cardId(card)), card)) {
      throw new Error(`Not a card: ${JSON.stringify(card)}`)
    }
  }
  const ids = new Set([...hand, starter].map(cardId))
  if (ids.size !== 5) throw new Error('Hand and starter must be five different cards')
}

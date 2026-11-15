/**
 * Cards and the deck. A card's compact string form (`CardId`) is used everywhere in JSON,
 * game state, events and the protocol: rank character then suit character, e.g. "5H", "TD",
 * "KS". `Card` objects are for computation inside functions only; never store or send them,
 * because the leak tests look for hidden cards by their `CardId`.
 */

export type Suit = 'C' | 'D' | 'H' | 'S'
/** 1 = ace (always low), 11 = jack, 12 = queen, 13 = king. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13
export type RankChar = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K'
export type CardId = `${RankChar}${Suit}`

export interface Card {
  readonly rank: Rank
  readonly suit: Suit
}

/** Suits in sorting order: clubs, diamonds, hearts, spades. */
export const SUITS: readonly Suit[] = ['C', 'D', 'H', 'S']
/** Ranks in order, ace low. */
export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
export const JACK: Rank = 11

const RANK_CHARS = 'A23456789TJQK'

export function cardId(card: Card): CardId {
  return `${RANK_CHARS[card.rank - 1] as RankChar}${card.suit}`
}

export function isCardId(value: unknown): value is CardId {
  return (
    typeof value === 'string' &&
    value.length === 2 &&
    RANK_CHARS.includes(value.charAt(0)) &&
    (SUITS as readonly string[]).includes(value.charAt(1))
  )
}

/** Parses a `CardId` such as "TD". Throws on anything else; validate untrusted input with `isCardId`. */
export function parseCard(id: string): Card {
  if (!isCardId(id)) throw new Error(`Not a card id: ${JSON.stringify(id)}`)
  return { rank: (RANK_CHARS.indexOf(id.charAt(0)) + 1) as Rank, suit: id.charAt(1) as Suit }
}

/** Value for the count and for fifteens: ace 1, 2-10 face value, jack/queen/king 10. */
export function cardValue(card: Card): number {
  return Math.min(card.rank, 10)
}

/** The 52 cards in a fixed order (clubs A-K, then diamonds, hearts, spades). */
export function fullDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })))
}

/**
 * Orders by rank (ace low). Suits never decide anything in the rules except flushes and nobs,
 * so use this wherever only rank matters, e.g. the cut for first deal.
 */
export function compareRanks(a: Card, b: Card): number {
  return a.rank - b.rank
}

/** Orders by rank (ace low), then by suit. The suit order is for stable display only. */
export function compareCards(a: Card, b: Card): number {
  return a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)
}

/** Returns a new array sorted by rank, then suit. */
export function sortCards<T extends Card>(cards: readonly T[]): T[] {
  return [...cards].sort(compareCards)
}

export function cardIds(cards: readonly Card[]): CardId[] {
  return cards.map(cardId)
}

export function parseCards(ids: readonly string[]): Card[] {
  return ids.map(parseCard)
}

export function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit
}

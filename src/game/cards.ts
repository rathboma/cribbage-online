/** How a card is written and read aloud. Used by the card component, the HUD and the table. */
import type { CardId } from '@shared/protocol'

export interface CardFace {
  /** "A", "2" ... "10", "J", "Q", "K". */
  rank: string
  /** The suit symbol, forced to its text (not emoji) form. */
  suit: string
  red: boolean
  /** How a screen reader says it: "10 of hearts". */
  name: string
}

// U+FE0E asks for the text glyph; without it some phones draw the suits as colour emoji.
const TEXT_STYLE = '︎'

const SUITS: Record<string, { symbol: string; name: string; red: boolean }> = {
  C: { symbol: '♣', name: 'clubs', red: false },
  D: { symbol: '♦', name: 'diamonds', red: true },
  H: { symbol: '♥', name: 'hearts', red: true },
  S: { symbol: '♠', name: 'spades', red: false },
}

const RANKS: Record<string, { label: string; name: string }> = {
  A: { label: 'A', name: 'ace' },
  T: { label: '10', name: '10' },
  J: { label: 'J', name: 'jack' },
  Q: { label: 'Q', name: 'queen' },
  K: { label: 'K', name: 'king' },
}

export function cardFace(id: CardId): CardFace {
  const rankChar = id.charAt(0)
  const rank = RANKS[rankChar] ?? { label: rankChar, name: rankChar }
  const suit = SUITS[id.charAt(1)] as (typeof SUITS)[string]
  return {
    rank: rank.label,
    suit: suit.symbol + TEXT_STYLE,
    red: suit.red,
    name: `${rank.name} of ${suit.name}`,
  }
}

/** Short written form: "10♥". */
export function cardText(id: CardId): string {
  const face = cardFace(id)
  return face.rank + face.suit
}

/** Spoken form: "10 of hearts". */
export function cardName(id: CardId): string {
  return cardFace(id).name
}

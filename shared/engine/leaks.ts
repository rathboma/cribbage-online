/**
 * Helpers for proving that nothing a player receives reveals a hidden card. Used by the engine's
 * property tests and the API tests; cheap enough to run on every step of thousands of games.
 */
import type { CardId } from './cards'
import type { GameState } from './state'
import { otherSeat, type Seat } from './types'

/**
 * Cards `seat` must not see right now: the opponent's hand, the undealt deck, and the
 * opponent's crib cards until the show has counted the crib.
 */
export function hiddenCardsFor(state: GameState, seat: Seat): Set<CardId> {
  const opponent = otherSeat(seat)
  const cribShown = state.show.some((r) => r.source === 'crib')
  return new Set([
    ...state.hands[opponent],
    ...state.deck,
    ...(cribShown ? [] : state.discards[opponent]),
  ])
}

const CARD_ID_TOKEN = /(?<![A-Za-z0-9])[A2-9TJQK][CDHS](?![A-Za-z0-9])/g

/**
 * Every card id in a piece of text (typically JSON), wherever it appears: as a JSON string, or
 * inside a longer string such as "5H,TD". Text that spells out a card as an object (with "rank"
 * and "suit" keys) is reported too, as "rank/suit", since ids can't be found in it.
 */
export function cardIdsInText(text: string): string[] {
  const ids = text.match(CARD_ID_TOKEN) ?? []
  return /"(rank|suit)"\s*:/.test(text) ? [...ids, 'rank/suit'] : ids
}

/** The hidden cards (or card objects) that `text` would show to `seat`. */
export function leakedCards(text: string, state: GameState, seat: Seat): string[] {
  const hidden: Set<string> = hiddenCardsFor(state, seat)
  return cardIdsInText(text).filter((c) => c === 'rank/suit' || hidden.has(c))
}

import { describe, expect, it } from 'vitest'
import {
  cardId,
  cardIds,
  cardValue,
  compareCards,
  compareRanks,
  fullDeck,
  isCard,
  isCardId,
  parseCard,
  parseCards,
  sortCards,
  type Card,
} from './cards'

describe('fullDeck', () => {
  it('has 52 unique cards: 13 ranks in each of 4 suits', () => {
    const deck = fullDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck.map(cardId)).size).toBe(52)
    for (const suit of ['C', 'D', 'H', 'S']) {
      expect(deck.filter((c) => c.suit === suit).map((c) => c.rank)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
      ])
    }
  })

  it('returns a fresh array each time', () => {
    const a = fullDeck()
    a.pop()
    expect(fullDeck()).toHaveLength(52)
  })
})

describe('card ids', () => {
  it('round-trip for every card', () => {
    for (const card of fullDeck()) {
      expect(parseCard(cardId(card))).toEqual(card)
    }
  })

  it.each([
    [{ rank: 1, suit: 'S' }, 'AS'],
    [{ rank: 5, suit: 'H' }, '5H'],
    [{ rank: 10, suit: 'D' }, 'TD'],
    [{ rank: 11, suit: 'C' }, 'JC'],
    [{ rank: 13, suit: 'S' }, 'KS'],
  ] as [Card, string][])('%o is %s', (card, id) => {
    expect(cardId(card)).toBe(id)
    expect(parseCard(id)).toEqual(card)
  })

  it.each(['', 'A', '10H', 'th', '5X', '1H', 'ZS', 'AS '])('rejects the string %j', (value) => {
    expect(isCardId(value)).toBe(false)
    expect(() => parseCard(value)).toThrow()
  })

  it.each([5, null, undefined, {}, ['A', 'S']])('rejects the non-string %j', (value) => {
    expect(isCardId(value)).toBe(false)
  })
})

describe('isCard', () => {
  it('accepts every card of the deck', () => {
    expect(fullDeck().every(isCard)).toBe(true)
  })

  it.each([
    { rank: 0, suit: 'H' },
    { rank: 14, suit: 'H' },
    { rank: 1.5, suit: 'H' },
    { rank: '5', suit: 'H' },
    { rank: 5, suit: 'X' },
    { rank: 5 },
    null,
    '5H',
  ])('rejects %j', (value) => {
    expect(isCard(value)).toBe(false)
  })
})

describe('cardValue', () => {
  it('counts ace as 1, pips at face value and court cards as 10', () => {
    const values = ['AH', '2H', '9H', 'TH', 'JH', 'QH', 'KH'].map((id) => cardValue(parseCard(id)))
    expect(values).toEqual([1, 2, 9, 10, 10, 10, 10])
  })
})

describe('sorting', () => {
  it('orders by rank with ace low, then by suit', () => {
    const ids = ['KS', 'AH', 'TD', 'AC', '5S', '5D']
    expect(sortCards(ids.map(parseCard)).map(cardId)).toEqual(['AC', 'AH', '5D', '5S', 'TD', 'KS'])
  })

  it('does not mutate its input', () => {
    const cards = ['KS', 'AH'].map(parseCard)
    sortCards(cards)
    expect(cards.map(cardId)).toEqual(['KS', 'AH'])
  })

  it('compareCards breaks rank ties by suit; compareRanks does not', () => {
    expect(compareCards(parseCard('5H'), parseCard('5H'))).toBe(0)
    expect(compareCards(parseCard('5H'), parseCard('5S'))).toBeLessThan(0)
    expect(compareRanks(parseCard('5H'), parseCard('5S'))).toBe(0)
    expect(compareRanks(parseCard('AS'), parseCard('2C'))).toBeLessThan(0)
  })

  it('converts lists of cards to ids and back', () => {
    expect(cardIds(parseCards(['AS', 'TD']))).toEqual(['AS', 'TD'])
  })
})

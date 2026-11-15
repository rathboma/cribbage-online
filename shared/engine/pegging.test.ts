import { describe, expect, it } from 'vitest'
import { cardId, cardValue, fullDeck, parseCard, SUITS, type Card, type Suit } from './cards'
import { seededRng, shuffle } from './rng'
import { countOf, legalPlays, scorePlay, type PegItem } from './pegging'

/**
 * Builds distinct cards from ranks written as in the rules ("A", "2" ... "T", "J", "Q", "K"),
 * giving repeated ranks different suits: "5 5 5" becomes 5C 5D 5H.
 */
function play(ranks: string): Card[] {
  const used = new Map<string, number>()
  return ranks
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((r) => {
      const n = used.get(r) ?? 0
      used.set(r, n + 1)
      return parseCard(`${r}${SUITS[n] as Suit}`)
    })
}

/** Splits "a b c | d" into the sequence so far and the card played. */
function scoreOf(sequence: string, card: string) {
  const cards = play(`${sequence} ${card}`)
  return scorePlay(cards.slice(0, -1), cards.at(-1) as Card)
}

const total = (items: PegItem[]) => items.reduce((sum, i) => sum + i.points, 0)
const kinds = (items: PegItem[]) => items.map((i) => `${i.kind}:${i.points}`)

describe('scorePlay test vectors (issue #10)', () => {
  it.each([
    // sequence so far, card played, count, points, items
    ['7', '8', 15, 2, ['fifteen:2']],
    ['4 6', '5', 15, 5, ['fifteen:2', 'run:3']],
    ['3 5', '4', 12, 3, ['run:3']],
    ['5', '5', 10, 2, ['pair:2']],
    ['5 5', '5', 15, 8, ['fifteen:2', 'pair:6']],
    ['7 7 7', '7', 28, 12, ['pair:12']],
    ['A 7', '7', 15, 4, ['fifteen:2', 'pair:2']],
    ['2 3 5', '4', 14, 4, ['run:4']],
    ['5 3 6', '4', 18, 4, ['run:4']],
    ['4 2 6', '5', 17, 0, []],
    ['4 2 6 5', '3', 20, 5, ['run:5']],
    ['2 3 A 4 5', '6', 21, 6, ['run:6']],
    ['3 4 4', '5', 16, 0, []],
    ['9 9', '3', 21, 0, []],
    ['K Q 5', '6', 31, 2, ['thirtyone:2']],
    ['7 8 9', '7', 31, 5, ['thirtyone:2', 'run:3']],
    ['K 6 7', '8', 31, 5, ['thirtyone:2', 'run:3']],
    ['9 8 7', '7', 31, 4, ['thirtyone:2', 'pair:2']],
    ['K', 'Q', 20, 0, []],
    ['6 7 8', '9', 30, 4, ['run:4']],
  ] as const)('%s then %s: count %i, %i points', (sequence, card, count, points, items) => {
    const result = scoreOf(sequence, card)
    expect(result.count).toBe(count)
    expect(total(result.items)).toBe(points)
    expect(kinds(result.items)).toEqual(items)
  })
})

describe('scorePlay examples from cribbage_rules.md section 5', () => {
  it.each([
    ['5 6 8', '7', ['run:4']], // run of 4 out of order
    ['4 2 6 5', '3', ['run:5']],
    ['2 3 A 4 5', '6', ['run:6']],
    ['4 5 9', '6', []], // the 9 is in the way
    ['6 7 7', '8', []], // the repeated 7 breaks the run
    ['7 8', '7', []], // pairs must be consecutive
    ['4 5', '6', ['fifteen:2', 'run:3']],
    ['4 5 6', '6', ['pair:2']],
    ['4 5 6 6', 'J', ['thirtyone:2']],
  ] as const)('%s then %s scores %j', (sequence, card, items) => {
    expect(kinds(scoreOf(sequence, card).items)).toEqual(items)
  })

  it('scores the worked example of the play step by step', () => {
    // Pone 7S 8D KH 3C, dealer 8C 9H QD 2S. First count: 7S 8C 8D 2S 3C, then a reset.
    const first = ['7S', '8C', '8D', '2S', '3C'].map(parseCard)
    const points = first.map((card, i) => total(scorePlay(first.slice(0, i), card).items))
    expect(points).toEqual([0, 2, 2, 0, 0])
    expect(countOf(first)).toBe(28)
    // Second count after the reset: 9H, KH, QD (K then Q is not a pair).
    const second = ['9H', 'KH', 'QD'].map(parseCard)
    expect(second.map((card, i) => total(scorePlay(second.slice(0, i), card).items))).toEqual([
      0, 0, 0,
    ])
  })
})

describe('scorePlay items', () => {
  it('lists every card of the count for fifteen and thirty-one', () => {
    expect(scoreOf('7 8 9', '7').items).toEqual([
      { kind: 'thirtyone', points: 2, cards: ['7C', '8C', '9C', '7D'] },
      { kind: 'run', points: 3, cards: ['8C', '9C', '7D'] },
    ])
  })

  it('lists all the cards of a pair royal in one item worth 6', () => {
    expect(scoreOf('5 5', '5').items).toEqual([
      { kind: 'fifteen', points: 2, cards: ['5C', '5D', '5H'] },
      { kind: 'pair', points: 6, cards: ['5C', '5D', '5H'] },
    ])
  })

  it('lists the run cards in the order they were played', () => {
    expect(scoreOf('4 2 6 5', '3').items).toEqual([
      { kind: 'run', points: 5, cards: ['4C', '2C', '6C', '5C', '3C'] },
    ])
  })
})

describe('scorePlay rules', () => {
  it('pairs by rank, not value', () => {
    expect(scoreOf('T J', 'Q').items).toEqual([
      { kind: 'run', points: 3, cards: ['TC', 'JC', 'QC'] },
    ])
    expect(scoreOf('K', 'Q').items).toEqual([])
  })

  it('treats the ace as low only', () => {
    expect(scoreOf('Q K', 'A').items).toEqual([])
    expect(scoreOf('K A', '2').items).toEqual([])
    expect(kinds(scoreOf('3 2', 'A').items)).toEqual(['run:3'])
  })

  it('does not mutate its inputs', () => {
    const sequence = Object.freeze(play('4 6').map((c) => Object.freeze(c)))
    const card = Object.freeze(parseCard('5S'))
    scorePlay(sequence, card)
    expect(sequence.map(cardId)).toEqual(['4C', '6C'])
  })

  it('refuses a card that would pass 31 or was already played', () => {
    expect(() => scoreOf('K Q 5', '7')).toThrow()
    expect(() => scorePlay([parseCard('5H')], parseCard('5H'))).toThrow()
  })
})

describe('legalPlays', () => {
  it('returns exactly the cards that keep the count at 31 or below', () => {
    const rng = seededRng('legal-plays')
    for (let n = 0; n < 2000; n++) {
      const hand = shuffle(fullDeck(), rng).slice(0, 1 + rng.nextInt(4))
      const count = rng.nextInt(32)
      const legal = legalPlays(hand, count)
      expect(legal).toEqual(hand.filter((c) => count + cardValue(c) <= 31))
    }
  })

  it('handles the edges: 31 allows nothing, 21 allows tens, an empty hand allows nothing', () => {
    const hand = ['AH', '5S', 'TD', 'KC'].map(parseCard)
    expect(legalPlays(hand, 31)).toEqual([])
    expect(legalPlays(hand, 30).map(cardId)).toEqual(['AH'])
    expect(legalPlays(hand, 21).map(cardId)).toEqual(['AH', '5S', 'TD', 'KC'])
    expect(legalPlays([], 0)).toEqual([])
  })

  it('does not mutate the hand', () => {
    const hand = Object.freeze(['AH', 'KC'].map(parseCard))
    legalPlays(hand, 25)
    expect(hand.map(cardId)).toEqual(['AH', 'KC'])
  })
})

describe('scorePlay over random legal counts', () => {
  /** Independent check of one played card, straight from the rules text. */
  function expected(sequence: Card[], card: Card) {
    const played = [...sequence, card]
    const count = countOf(played)
    let same = 1
    while (same < played.length && played[played.length - 1 - same]!.rank === card.rank) same++
    let run = 0
    for (let n = 3; n <= played.length; n++) {
      const ranks = played.slice(-n).map((c) => c.rank)
      const sorted = [...ranks].sort((a, b) => a - b)
      if (sorted.every((r, i) => i === 0 || r === sorted[i - 1]! + 1)) run = n
    }
    return {
      count,
      fifteen: count === 15 ? 2 : 0,
      thirtyone: count === 31 ? 2 : 0,
      pair: [0, 0, 2, 6, 12][same]!,
      run,
    }
  }

  it('agrees with an independent check for 20,000 counts', () => {
    const rng = seededRng('peg-sample')
    const mismatches: unknown[] = []
    for (let game = 0; game < 2000; game++) {
      // Play random legal cards from a shuffled deck until nothing fits, a few times over.
      let deck = shuffle(fullDeck(), rng)
      let sequence: Card[] = []
      for (let step = 0; step < 10; step++) {
        const options = legalPlays(deck.slice(0, 8), countOf(sequence))
        if (options.length === 0) {
          sequence = []
          continue
        }
        const card = options[rng.nextInt(options.length)]!
        deck = deck.filter((c) => c !== card)
        const result = scorePlay(sequence, card)
        const got = { count: result.count, fifteen: 0, thirtyone: 0, pair: 0, run: 0 }
        for (const item of result.items) got[item.kind as 'fifteen'] += item.points
        const want = expected(sequence, card)
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          mismatches.push({ sequence: sequence.map(cardId), card: cardId(card), got, want })
        }
        sequence = [...sequence, card]
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([])
  })
})

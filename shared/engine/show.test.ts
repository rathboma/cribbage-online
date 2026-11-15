import { describe, expect, it } from 'vitest'
import { cardId, cardValue, fullDeck, parseCard, type Card } from './cards'
import { seededRng } from './rng'
import { scoreHand, type ScoreBreakdown, type ScoreItem, type ScoreKind } from './show'

const cards = (ids: string) => ids.split(' ').map(parseCard)

function score(hand: string, starter: string, isCrib = false): ScoreBreakdown {
  return scoreHand(cards(hand), parseCard(starter), isCrib)
}

/** Number of items of each kind, e.g. { fifteen: 4, pair: 2 }. */
function kindCounts(breakdown: ScoreBreakdown): Partial<Record<ScoreKind, number>> {
  const counts: Partial<Record<ScoreKind, number>> = {}
  for (const item of breakdown.items) counts[item.kind] = (counts[item.kind] ?? 0) + 1
  return counts
}

describe('scoreHand test vectors (issue #9 and cribbage_rules.md)', () => {
  it.each([
    // hand, starter, crib?, total, items by kind
    ['5H 5D 5S JC', '5C', false, 29, { fifteen: 8, pair: 6, nobs: 1 }],
    ['5C 5D 5H 5S', 'KD', false, 28, { fifteen: 8, pair: 6 }],
    ['7H 7D 8S 8C', '9D', false, 24, { fifteen: 4, pair: 2, run: 4 }],
    ['4H 5D 5S 6C', '6D', false, 24, { fifteen: 4, pair: 2, run: 4 }],
    ['3H 3D 4S 4C', '5D', false, 20, { fifteen: 2, pair: 2, run: 4 }],
    ['3H 3D 3S 4C', '5D', false, 21, { fifteen: 3, pair: 3, run: 3 }],
    ['AH 2D 3S 4C', '5H', false, 7, { fifteen: 1, run: 1 }],
    ['6H 7D 8S 9C', '9D', false, 16, { fifteen: 3, pair: 1, run: 2 }],
    ['TH JD QS KC', '5H', false, 12, { fifteen: 4, run: 1 }],
    ['2H 6H 9H KH', '3S', false, 8, { fifteen: 2, flush: 1 }],
    ['2H 6H 9H KH', '3S', true, 4, { fifteen: 2 }],
    ['2H 6H 9H KH', '3H', true, 9, { fifteen: 2, flush: 1 }],
    ['JH 2D 7S KC', '9H', true, 1, { nobs: 1 }],
    ['2C 4D 6H 8S', 'KC', false, 0, {}],
    // The worked example of the show in cribbage_rules.md (starter 5H).
    ['7S 8D KH 3C', '5H', false, 6, { fifteen: 3 }],
    ['8C 9H QD 2S', '5H', false, 4, { fifteen: 2 }],
    ['4D 6S JH AC', '5H', true, 10, { fifteen: 3, run: 1, nobs: 1 }],
  ] as const)('%s + %s (crib: %s) scores %i', (hand, starter, isCrib, total, kinds) => {
    const result = score(hand, starter, isCrib)
    expect(result.total).toBe(total)
    expect(kindCounts(result)).toEqual(kinds)
  })
})

describe('scoreHand items', () => {
  it('itemises the 29 hand exactly', () => {
    expect(score('5H 5D 5S JC', '5C').items).toEqual([
      { kind: 'fifteen', points: 2, cards: ['5C', 'JC'] },
      { kind: 'fifteen', points: 2, cards: ['5D', 'JC'] },
      { kind: 'fifteen', points: 2, cards: ['5H', 'JC'] },
      { kind: 'fifteen', points: 2, cards: ['5S', 'JC'] },
      { kind: 'fifteen', points: 2, cards: ['5C', '5D', '5H'] },
      { kind: 'fifteen', points: 2, cards: ['5C', '5D', '5S'] },
      { kind: 'fifteen', points: 2, cards: ['5C', '5H', '5S'] },
      { kind: 'fifteen', points: 2, cards: ['5D', '5H', '5S'] },
      { kind: 'pair', points: 2, cards: ['5C', '5D'] },
      { kind: 'pair', points: 2, cards: ['5C', '5H'] },
      { kind: 'pair', points: 2, cards: ['5C', '5S'] },
      { kind: 'pair', points: 2, cards: ['5D', '5H'] },
      { kind: 'pair', points: 2, cards: ['5D', '5S'] },
      { kind: 'pair', points: 2, cards: ['5H', '5S'] },
      { kind: 'nobs', points: 1, cards: ['JC', '5C'] },
    ])
  })

  it('itemises a double run as two runs of three plus a pair', () => {
    expect(score('3C 4D 4H 5S', 'KC').items).toEqual([
      { kind: 'fifteen', points: 2, cards: ['5S', 'KC'] },
      { kind: 'pair', points: 2, cards: ['4D', '4H'] },
      { kind: 'run', points: 3, cards: ['3C', '4D', '5S'] },
      { kind: 'run', points: 3, cards: ['3C', '4H', '5S'] },
    ])
  })

  it('itemises a double double run as four runs of three', () => {
    const runs = score('3H 3D 4S 4C', '5D').items.filter((i) => i.kind === 'run')
    expect(runs).toEqual([
      { kind: 'run', points: 3, cards: ['3D', '4C', '5D'] },
      { kind: 'run', points: 3, cards: ['3D', '4S', '5D'] },
      { kind: 'run', points: 3, cards: ['3H', '4C', '5D'] },
      { kind: 'run', points: 3, cards: ['3H', '4S', '5D'] },
    ])
  })

  it('scores a run of five once, not as shorter runs', () => {
    expect(score('AH 2D 3S 4C', '5H').items).toEqual([
      { kind: 'fifteen', points: 2, cards: ['AH', '2D', '3S', '4C', '5H'] },
      { kind: 'run', points: 5, cards: ['AH', '2D', '3S', '4C', '5H'] },
    ])
  })

  it('scores a run of four once', () => {
    expect(score('TH JD QS KC', '5H').items).toEqual([
      { kind: 'fifteen', points: 2, cards: ['5H', 'TH'] },
      { kind: 'fifteen', points: 2, cards: ['5H', 'JD'] },
      { kind: 'fifteen', points: 2, cards: ['5H', 'QS'] },
      { kind: 'fifteen', points: 2, cards: ['5H', 'KC'] },
      { kind: 'run', points: 4, cards: ['TH', 'JD', 'QS', 'KC'] },
    ])
  })

  it('lists the flush cards: four for a hand flush, five with the starter', () => {
    expect(score('2H 6H 9H KH', '3S').items.at(-1)).toEqual({
      kind: 'flush',
      points: 4,
      cards: ['2H', '6H', '9H', 'KH'],
    })
    expect(score('2H 6H 9H KH', '3H').items.at(-1)).toEqual({
      kind: 'flush',
      points: 5,
      cards: ['2H', '6H', '9H', 'KH', '3H'],
    })
  })

  it('returns items in counting order: fifteens, pairs, runs, flush, nobs', () => {
    const order: ScoreKind[] = ['fifteen', 'pair', 'run', 'flush', 'nobs']
    const inOrder = (hand: string, starter: string) => {
      const kinds = score(hand, starter).items.map((i) => i.kind)
      expect(kinds).toEqual([...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
      return new Set(kinds)
    }
    // A pair, a flush and nobs can't all happen in one hand, so check two hands.
    expect(inOrder('4H 5H 6H JH', '6D')).toEqual(new Set(['fifteen', 'pair', 'run', 'flush']))
    expect(inOrder('4H 5H 6H JH', '3H')).toEqual(new Set(['fifteen', 'run', 'flush', 'nobs']))
  })
})

describe('scoreHand rules', () => {
  it('awards nobs only for a jack held in hand, never a jack starter', () => {
    expect(kindCounts(score('2C 3D 4H 9S', 'JC')).nobs).toBeUndefined()
    expect(kindCounts(score('2C 3D 4H JS', 'JC')).nobs).toBeUndefined() // jack of another suit
    expect(kindCounts(score('2C 3D 4H JC', '9C')).nobs).toBe(1)
  })

  it('needs all four hand cards for a flush', () => {
    expect(kindCounts(score('2H 6H 9H KS', '3H')).flush).toBeUndefined()
  })

  it('treats the ace as low only: Q-K-A and K-A-2 are not runs', () => {
    expect(kindCounts(score('QH KD AS 7C', '2S')).run).toBeUndefined()
  })

  it('pairs by rank, not value', () => {
    expect(kindCounts(score('KH QD 2S 7C', '8S')).pair).toBeUndefined()
  })

  it.each([
    ['8S 5C JH 7D', 'AS'],
    ['KH 9H 2H 6H', '3H'], // five-card flush
    ['KH 9H 2H 6H', '3S'], // four-card flush
    ['JD 4C 5S 6H', '9D'], // nobs and a run
  ])('does not depend on the order of the hand: %s + %s', (hand, starter) => {
    const reversed = hand.split(' ').reverse().join(' ')
    expect(score(reversed, starter)).toEqual(score(hand, starter))
  })

  it('does not mutate its inputs', () => {
    const hand = Object.freeze(cards('5H 5D 5S JC').map((c) => Object.freeze(c)))
    const starter = Object.freeze(parseCard('5C'))
    expect(scoreHand(hand, starter, false).total).toBe(29)
    expect(hand.map(cardId)).toEqual(['5H', '5D', '5S', 'JC'])
  })

  it('rejects malformed card objects', () => {
    const good = cards('5H 5D 5S')
    const bad = [
      { rank: '5', suit: 'C' },
      { rank: 14, suit: 'C' },
      { rank: 2, suit: 'X' },
    ]
    for (const card of bad) {
      expect(() => scoreHand([...good, card as unknown as Card], parseCard('KC'), false)).toThrow()
    }
  })

  it('rejects anything but four distinct cards and a different starter', () => {
    expect(() => score('5H 5D 5S', '5C')).toThrow()
    expect(() => score('5H 5D 5S 5C JD', '2C')).toThrow()
    expect(() => score('5H 5D 5S 5H', '2C')).toThrow()
    expect(() => score('5H 5D 5S JC', 'JC')).toThrow()
  })
})

/**
 * A deliberately naive, independent scorer: counts every subset directly from the rules text.
 * Used to cross-check scoreHand on random hands.
 */
function bruteForce(hand: Card[], starter: Card, isCrib: boolean) {
  const all = [...hand, starter]
  const subsets: Card[][] = []
  for (let mask = 1; mask < 32; mask++) subsets.push(all.filter((_, i) => mask & (1 << i)))
  const isRun = (s: Card[]) => {
    const ranks = s.map((c) => c.rank).sort((a, b) => a - b)
    return s.length >= 3 && ranks.every((r, i) => i === 0 || r === (ranks[i - 1] as number) + 1)
  }
  const fifteen =
    2 *
    subsets.filter((s) => s.length >= 2 && s.reduce((t, c) => t + cardValue(c), 0) === 15).length
  const pair = 2 * subsets.filter((s) => s.length === 2 && s[0]!.rank === s[1]!.rank).length
  const runSets = subsets.filter(isRun)
  const longest = Math.max(0, ...runSets.map((s) => s.length))
  const run = longest * runSets.filter((s) => s.length === longest).length
  const handFlush = hand.every((c) => c.suit === hand[0]!.suit)
  const flush = !handFlush ? 0 : starter.suit === hand[0]!.suit ? 5 : isCrib ? 0 : 4
  const nobs = hand.some((c) => c.rank === 11 && c.suit === starter.suit) ? 1 : 0
  return { fifteen, pair, run, flush, nobs }
}

/** Checks an item lists distinct cards from the show that really make what it claims. */
function itemIsWellFormed(item: ScoreItem, five: Card[]): boolean {
  const ids = five.map(cardId)
  if (new Set(item.cards).size !== item.cards.length) return false
  if (!item.cards.every((id) => ids.includes(id))) return false
  const used = item.cards.map(parseCard)
  const ranks = used.map((c) => c.rank).sort((a, b) => a - b)
  switch (item.kind) {
    case 'fifteen':
      return item.points === 2 && used.reduce((t, c) => t + cardValue(c), 0) === 15
    case 'pair':
      return item.points === 2 && used.length === 2 && ranks[0] === ranks[1]
    case 'run':
      return (
        item.points === used.length &&
        used.length >= 3 &&
        ranks.every((r, i) => i === 0 || r === (ranks[i - 1] as number) + 1)
      )
    case 'flush':
      return item.points === used.length && used.every((c) => c.suit === used[0]!.suit)
    case 'nobs':
      return item.points === 1 && used[0]!.rank === 11 && used[0]!.suit === used[1]!.suit
  }
}

describe('scoreHand over a seeded random sample of 200,000 hands', () => {
  it('matches the brute-force scorer, never scores 19, 25, 26 or 27, and never exceeds 29', () => {
    const rng = seededRng('show-sample')
    const deck = fullDeck()
    const seen = new Set<number>()
    const failures: unknown[] = []
    for (let n = 0; n < 200_000 && failures.length < 5; n++) {
      // Draw five distinct cards: a partial Fisher-Yates shuffle.
      const pool = [...deck]
      for (let i = 0; i < 5; i++) {
        const j = i + rng.nextInt(52 - i)
        ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
      }
      const hand = pool.slice(0, 4)
      const starter = pool[4]!
      const isCrib = n % 2 === 1
      const result = scoreHand(hand, starter, isCrib)
      if (n % 10 === 0) {
        const again = scoreHand([...hand].reverse(), starter, isCrib)
        if (JSON.stringify(again) !== JSON.stringify(result)) {
          failures.push({ orderDependent: `${hand.map(cardId).join(' ')} + ${cardId(starter)}` })
        }
      }

      const byKind = { fifteen: 0, pair: 0, run: 0, flush: 0, nobs: 0 }
      for (const item of result.items) byKind[item.kind] += item.points
      const expected = bruteForce(hand, starter, isCrib)
      const sum = result.items.reduce((t, i) => t + i.points, 0)
      const malformed = result.items.filter((item) => !itemIsWellFormed(item, [...hand, starter]))
      if (
        JSON.stringify(byKind) !== JSON.stringify(expected) ||
        sum !== result.total ||
        malformed.length
      ) {
        const show = `${hand.map(cardId).join(' ')} + ${cardId(starter)}${isCrib ? ' (crib)' : ''}`
        failures.push({ show, byKind, expected, total: result.total, sum, malformed })
      }
      seen.add(result.total)
    }
    expect(failures).toEqual([])
    expect([...seen].filter((t) => [19, 25, 26, 27].includes(t) || t > 29)).toEqual([])
    // The sample is large enough to reach every other score from 0 to 24.
    expect([...seen].filter((t) => t <= 24).sort((a, b) => a - b)).toEqual(
      [...Array(25).keys()].filter((t) => t !== 19),
    )
  })
})

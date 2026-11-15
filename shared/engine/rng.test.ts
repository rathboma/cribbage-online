import { describe, expect, it, vi } from 'vitest'
import { cardId, fullDeck } from './cards'
import { cryptoRng, seededRng, shuffle, uniformInt, type RandomValuesSource } from './rng'

const ids = (seed: number | string) => shuffle(fullDeck(), seededRng(seed)).map(cardId).join(' ')

describe('shuffle', () => {
  it('returns a permutation of its input', () => {
    const deck = fullDeck()
    const shuffled = shuffle(deck, seededRng(1))
    expect(shuffled).toHaveLength(52)
    expect(new Set(shuffled.map(cardId))).toEqual(new Set(deck.map(cardId)))
    expect(shuffled.map(cardId)).not.toEqual(deck.map(cardId))
  })

  it('does not mutate its input', () => {
    const deck = Object.freeze(fullDeck())
    const before = deck.map(cardId)
    shuffle(deck, seededRng(1))
    expect(deck.map(cardId)).toEqual(before)
  })

  it('handles empty and single-item arrays', () => {
    expect(shuffle([], seededRng(1))).toEqual([])
    expect(shuffle(['x'], seededRng(1))).toEqual(['x'])
  })

  it('gives the same order for the same seed', () => {
    expect(ids(42)).toBe(ids(42))
    expect(ids('game-ABCDE')).toBe(ids('game-ABCDE'))
  })

  it('gives different orders for different seeds', () => {
    const orders = new Set(Array.from({ length: 200 }, (_, seed) => ids(seed)))
    expect(orders.size).toBe(200)
  })

  it('puts each item in each position about equally often', () => {
    const rng = seededRng('uniformity')
    const runs = 40_000
    const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0])
    for (let i = 0; i < runs; i++) {
      shuffle([0, 1, 2, 3], rng).forEach((item, pos) => counts[item]![pos]!++)
    }
    for (const row of counts) {
      for (const n of row) expect(Math.abs(n - runs / 4)).toBeLessThan(runs * 0.02)
    }
  })
})

describe('seededRng', () => {
  it('stays in range', () => {
    const rng = seededRng(7)
    for (const n of [1, 2, 3, 40, 52, 1000, 2 ** 32]) {
      for (let i = 0; i < 200; i++) {
        const x = rng.nextInt(n)
        expect(Number.isInteger(x) && x >= 0 && x < n).toBe(true)
      }
    }
  })

  it('rejects invalid bounds', () => {
    const rng = seededRng(7)
    for (const n of [0, -1, 1.5, NaN, 2 ** 32 + 1]) expect(() => rng.nextInt(n)).toThrow(RangeError)
  })
})

/** A fake getRandomValues that hands out the given 32-bit values in order. */
function scriptedSource(values: number[]): RandomValuesSource & { calls: number } {
  const source = {
    calls: 0,
    getRandomValues(array: Uint32Array<ArrayBuffer>) {
      array[0] = values[source.calls++]!
      return array
    },
  }
  return source
}

describe('uniformInt', () => {
  it('rejects draws in the incomplete last block instead of using modulo', () => {
    // For n = 3, 2^32 mod 3 = 1, so only the single value 2^32 - 1 is out of range.
    const top = 2 ** 32 - 1
    const values = [top, top, 5]
    let i = 0
    expect(uniformInt(() => values[i++]!, 3)).toBe(5 % 3)
    expect(i).toBe(3)
  })

  it('accepts the largest value below the limit', () => {
    const n = 52
    const limit = 2 ** 32 - (2 ** 32 % n)
    expect(uniformInt(() => limit - 1, n)).toBe((limit - 1) % n)
  })
})

describe('cryptoRng', () => {
  it('uses the global crypto.getRandomValues by default and covers the whole range', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    try {
      const rng = cryptoRng()
      const seen = new Set<number>()
      for (let i = 0; i < 2000; i++) seen.add(rng.nextInt(52))
      expect(spy).toHaveBeenCalled()
      expect([...seen].sort((a, b) => a - b)).toEqual([...Array(52).keys()])
    } finally {
      spy.mockRestore()
    }
  })

  it('accepts the platform crypto object as a source', () => {
    expect(cryptoRng(globalThis.crypto).nextInt(10)).toBeLessThan(10)
  })

  it('redraws values that would bias the result', () => {
    // 2^32 mod 52 = 48, so the top 48 values must be rejected.
    const limit = 2 ** 32 - (2 ** 32 % 52)
    const source = scriptedSource([limit, limit + 1, 2 ** 32 - 1, 103])
    expect(cryptoRng(source).nextInt(52)).toBe(103 % 52)
    expect(source.calls).toBe(4)
  })

  it('takes the first draw when it is in range', () => {
    const source = scriptedSource([7])
    expect(cryptoRng(source).nextInt(52)).toBe(7)
    expect(source.calls).toBe(1)
  })
})

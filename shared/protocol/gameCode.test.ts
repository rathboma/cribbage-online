import { describe, expect, it } from 'vitest'
import {
  GAME_CODE_ALPHABET,
  GAME_CODE_LENGTH,
  isValidGameCode,
  normalizeGameCode,
  parseGameCode,
} from './gameCode'

describe('game codes', () => {
  it('uses 20 distinct consonants and no vowels, Y or digits', () => {
    expect(GAME_CODE_ALPHABET).toHaveLength(20)
    expect(new Set(GAME_CODE_ALPHABET).size).toBe(20)
    expect(GAME_CODE_ALPHABET).toMatch(/^[A-Z]+$/)
    expect(GAME_CODE_ALPHABET).not.toMatch(/[AEIOUY]/)
    expect(GAME_CODE_LENGTH).toBe(5)
  })

  it('normalizes case, spaces and dashes', () => {
    expect(normalizeGameCode(' bcd-fg ')).toBe('BCDFG')
    expect(normalizeGameCode('Bc Df G')).toBe('BCDFG')
  })

  it('accepts only canonical codes as valid', () => {
    expect(isValidGameCode('BCDFG')).toBe(true)
    expect(isValidGameCode('ZXWVT')).toBe(true)
    expect(isValidGameCode('bcdfg')).toBe(false)
    expect(isValidGameCode(' BCDFG')).toBe(false)
  })

  it('parses user input into the canonical code', () => {
    expect(parseGameCode(' bcd-fg ')).toBe('BCDFG')
    expect(parseGameCode('zxwvt')).toBe('ZXWVT')
  })

  it.each(['BCDF', 'BCDFGH', 'ABCDF', 'BCDFY', 'BCDF1', '', 'BC FG!', 'HELLO', 'bcdß', 'bcdﬀ'])(
    'rejects %j',
    (input) => {
      expect(parseGameCode(input)).toBeNull()
    },
  )
})

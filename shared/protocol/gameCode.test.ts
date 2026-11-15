import { describe, expect, it } from 'vitest'
import {
  GAME_CODE_ALPHABET,
  GAME_CODE_LENGTH,
  isValidGameCode,
  normalizeGameCode,
} from './gameCode'

describe('game codes', () => {
  it('uses 20 distinct consonants and no vowels, Y or digits', () => {
    expect(new Set(GAME_CODE_ALPHABET).size).toBe(20)
    expect(GAME_CODE_ALPHABET).not.toMatch(/[AEIOUY0-9]/)
    expect(GAME_CODE_LENGTH).toBe(5)
  })

  it('normalizes case, spaces and dashes', () => {
    expect(normalizeGameCode(' bcd-fg ')).toBe('BCDFG')
    expect(normalizeGameCode('Bc Df G')).toBe('BCDFG')
  })

  it('accepts valid codes case-insensitively', () => {
    expect(isValidGameCode('BCDFG')).toBe(true)
    expect(isValidGameCode('zxwvt')).toBe(true)
  })

  it.each(['BCDF', 'BCDFGH', 'ABCDF', 'BCDFY', 'BCDF1', '', 'BC FG!'])('rejects %j', (code) => {
    expect(isValidGameCode(code)).toBe(false)
  })
})

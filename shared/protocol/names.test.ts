import { describe, expect, it } from 'vitest'
import { normalizePlayerName, parsePlayerName, PLAYER_NAME_MAX_LENGTH } from './names'

describe('player names', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizePlayerName('  Ada   Lovelace \n')).toBe('Ada Lovelace')
  })

  it.each([
    ['Ada', 'Ada'],
    ['  Ada  ', 'Ada'],
    ['x'.repeat(20), 'x'.repeat(20)],
    ['😀'.repeat(20), '😀'.repeat(20)], // an emoji counts as one character
    ['Zoë', 'Zoë'],
  ])('accepts %j as %j', (input, name) => {
    expect(parsePlayerName(input)).toBe(name)
  })

  it.each(['', '   ', 'x'.repeat(21), '\u0000\u0007', '\u007f'])('rejects %j', (input) => {
    expect(parsePlayerName(input)).toBeNull()
  })

  it('strips control characters', () => {
    expect(parsePlayerName('Ada\u0000Lovelace')).toBe('Ada Lovelace')
    expect(parsePlayerName('\u0007Bo\u007f')).toBe('Bo')
    expect(parsePlayerName('line\nbreak')).toBe('line break')
  })

  it('allows 20 characters', () => {
    expect(PLAYER_NAME_MAX_LENGTH).toBe(20)
  })
})

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

  it.each(['', '   ', 'x'.repeat(21), 'tab\u0000name', 'bell\u0007', 'del\u007f'])(
    'rejects %j',
    (input) => {
      expect(parsePlayerName(input)).toBeNull()
    },
  )

  it('allows 20 characters', () => {
    expect(PLAYER_NAME_MAX_LENGTH).toBe(20)
  })
})

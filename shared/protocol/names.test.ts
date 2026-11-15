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
    ['👨‍👩‍👧‍👦'.repeat(20), '👨‍👩‍👧‍👦'.repeat(20)], // so does a family emoji
    ['🇨🇦'.repeat(20), '🇨🇦'.repeat(20)], // and a flag
    ['Zoë', 'Zoë'],
  ])('accepts %j as %j', (input, name) => {
    expect(parsePlayerName(input)).toBe(name)
  })

  it.each([
    '',
    '   ',
    'x'.repeat(21),
    '\u0000\u0007',
    '\u007f',
    '\u200b', // zero-width space
    '\u3164', // Hangul filler, looks blank
    '\u202e', // right-to-left override, stripped
  ])('rejects %j', (input) => {
    expect(parsePlayerName(input)).toBeNull()
  })

  it('strips text-direction overrides and lone surrogates', () => {
    expect(parsePlayerName('Ada\u202e wins')).toBe('Ada wins')
    expect(parsePlayerName('Bo\ud800')).toBe('Bo')
  })

  it('strips control characters', () => {
    expect(parsePlayerName('Ada\u0000Lovelace')).toBe('Ada Lovelace')
    expect(parsePlayerName('\u0007Bo\u007f')).toBe('Bo')
    expect(parsePlayerName('line\nbreak')).toBe('line break')
  })

  it('allows 20 characters and no more', () => {
    expect(PLAYER_NAME_MAX_LENGTH).toBe(20)
    expect(parsePlayerName('é'.repeat(20))).toBe('é'.repeat(20))
    expect(parsePlayerName('é'.repeat(21))).toBeNull()
  })
})

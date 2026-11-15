/**
 * Game codes are exactly five letters drawn from 20 consonants (no vowels, no Y,
 * no digits), so a code never spells a word and never mixes up 0/O or 1/I.
 * See the "Game codes" decision in the roadmap (issue #1).
 */
export const GAME_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
export const GAME_CODE_LENGTH = 5

const GAME_CODE_PATTERN = new RegExp(`^[${GAME_CODE_ALPHABET}]{${GAME_CODE_LENGTH}}$`)

/** Upper-cases and strips whitespace and dashes, so "bcd fg" and "BCD-FG" both become "BCDFG". */
export function normalizeGameCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase()
}

/** True when `input` is a valid game code once normalized (input is case-insensitive). */
export function isValidGameCode(input: string): boolean {
  return GAME_CODE_PATTERN.test(normalizeGameCode(input))
}

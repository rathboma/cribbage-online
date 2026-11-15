/** Input rules for player names, shared by the client forms and the server. */
export const PLAYER_NAME_MAX_LENGTH = 20

/**
 * Removes control and text-direction characters, trims, and turns any run of whitespace inside
 * the name into a single space.
 */
export function normalizePlayerName(input: string): string {
  return input.replace(LONE_SURROGATES, '').replace(STRIPPED, ' ').trim().replace(/\s+/g, ' ')
}

/**
 * The name to store, or null if it can't be one: 1 to 20 characters once normalized, counted
 * as a reader would (an emoji or a flag is one), with at least one visible character.
 */
export function parsePlayerName(input: string): string | null {
  const name = normalizePlayerName(input)
  const length = graphemeCount(name)
  if (length < 1 || length > PLAYER_NAME_MAX_LENGTH) return null
  if (name.length > PLAYER_NAME_MAX_LENGTH * 16) return null // absurdly long emoji sequences
  return VISIBLE.test(name) ? name : null
}

function graphemeCount(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length
}

/** Control characters, and the characters that override or isolate text direction. */
// eslint-disable-next-line no-control-regex
const STRIPPED = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g
const LONE_SURROGATES = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
/** A letter, digit, punctuation mark or symbol that actually shows (not a blank filler). */
const VISIBLE = /(?!\p{Default_Ignorable_Code_Point})[\p{L}\p{N}\p{P}\p{S}]/u

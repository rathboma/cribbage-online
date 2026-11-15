/** Input rules for player names, shared by the client forms and the server. */
export const PLAYER_NAME_MAX_LENGTH = 20

/** Trims, and turns any run of whitespace inside the name into a single space. */
export function normalizePlayerName(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

/**
 * The name to store, or null if it can't be one: 1 to 20 characters once normalized (an emoji
 * counts as one), with no control characters.
 */
export function parsePlayerName(input: string): string | null {
  const name = normalizePlayerName(input)
  const length = [...name].length
  if (length < 1 || length > PLAYER_NAME_MAX_LENGTH) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return null
  return name
}

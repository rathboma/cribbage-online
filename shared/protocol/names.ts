/** Input rules for player names, shared by the client forms and the server. */
export const PLAYER_NAME_MAX_LENGTH = 20

/**
 * Removes control characters, trims, and turns any run of whitespace inside the name into a
 * single space.
 */
export function normalizePlayerName(input: string): string {
  return input.replace(CONTROL_CHARACTERS, ' ').trim().replace(/\s+/g, ' ')
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

/**
 * The name to store, or null if it can't be one: 1 to 20 characters once normalized (an emoji
 * counts as one).
 */
export function parsePlayerName(input: string): string | null {
  const name = normalizePlayerName(input)
  const length = [...name].length
  return length >= 1 && length <= PLAYER_NAME_MAX_LENGTH ? name : null
}

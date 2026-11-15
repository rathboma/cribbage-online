/** Turns failures into short, friendly sentences for the screen. */
import { ApiError } from './client'

const MESSAGES: Partial<Record<ApiError['code'], string>> = {
  network: "Couldn't reach the server. Check your connection and try again.",
  game_not_found:
    "There's no game with that code. It may have expired - check the code and try again.",
  game_full: 'That game already has two players.',
  game_ended: 'That game has already finished.',
  unauthorized: 'This browser is not a player in that game.',
  rate_limited: 'Too many tries. Wait a moment and try again.',
  conflict: 'The game changed at the same moment. Please try again.',
  stale_action: 'The game had already moved on.',
}

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    const message = MESSAGES[err.code]
    if (message) return message
    if (err.code === 'internal' || err.status === 0 || err.status >= 500) {
      return 'Something went wrong on our side. Please try again in a moment.'
    }
    return err.message
  }
  return 'Something went wrong. Please try again.'
}

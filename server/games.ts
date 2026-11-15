/** Game lifecycle rules shared by the API routes: codes, expiry and loading a live game. */
import { cryptoRng } from '../shared/engine'
import { GAME_CODE_ALPHABET, GAME_CODE_LENGTH, parseGameCode } from '../shared/protocol'
import { getGame, type GameRow } from './db'
import { HttpError } from './http'

/** A game waiting for its second player lasts an hour. */
export const WAITING_TTL_MS = 60 * 60 * 1000
/** An active game lasts 24 hours after its last change. */
export const ACTIVE_TTL_MS = 24 * 60 * 60 * 1000

/** A fresh random game code (crypto randomness; collisions are retried by the caller). */
export function randomGameCode(): string {
  const rng = cryptoRng()
  let code = ''
  for (let i = 0; i < GAME_CODE_LENGTH; i++) {
    code += GAME_CODE_ALPHABET[rng.nextInt(GAME_CODE_ALPHABET.length)]
  }
  return code
}

/** The canonical code from a URL parameter. A malformed code can't exist, so it's a 404. */
export function codeFromParam(param: string | string[] | undefined): string {
  const code = typeof param === 'string' ? parseGameCode(param) : null
  if (code === null) throw gameNotFound()
  return code
}

/** Loads a game that exists and hasn't expired, or throws 404 `game_not_found`. */
export async function loadLiveGame(db: D1Database, code: string, now: number): Promise<GameRow> {
  const game = await getGame(db, code)
  if (!game || isExpired(game, now)) throw gameNotFound()
  return game
}

export function isExpired(game: Pick<GameRow, 'expiresAt'>, now: number): boolean {
  return game.expiresAt <= now
}

export function gameNotFound(): HttpError {
  return new HttpError(
    404,
    'game_not_found',
    'There is no game with that code. It may have expired.',
  )
}

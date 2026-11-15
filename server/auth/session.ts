/** Bearer-token authentication shared by every endpoint that acts for a player. */
import type { PlayerRow, SyncSnapshot } from '../db'
import { readLiveGame } from '../games'
import { HttpError } from '../http'
import { hashToken } from './tokens'

/**
 * Authenticates the request's bearer token against game `code` and reads the game in the same
 * D1 batch: the snapshot (with the events after `cursor` visible to the caller) and the caller.
 * 401 for a missing, unknown or other game's token; 404 for a missing or expired game.
 */
export async function authenticate(
  db: D1Database,
  request: Request,
  code: string,
  now: number,
  events: { cursor: number; limit: number } = { cursor: 0, limit: 0 },
): Promise<{ snapshot: SyncSnapshot; player: PlayerRow }> {
  const tokenHash = await requireTokenHash(request)
  const snapshot = await readLiveGame(db, code, now, { tokenHash }, events.cursor, events.limit)
  const player = snapshot.players.find((p) => p.tokenHash === tokenHash)
  if (!player) throw unauthorized()
  return { snapshot, player }
}

/** The SHA-256 of the request's bearer token, or a 401 if there isn't one. */
async function requireTokenHash(request: Request): Promise<string> {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!match?.[1]) throw unauthorized()
  return hashToken(match[1])
}

function unauthorized(): HttpError {
  return new HttpError(401, 'unauthorized', 'This browser is not a player in that game.')
}

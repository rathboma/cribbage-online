/** Bearer-token authentication shared by every endpoint that acts for a player. */
import type { Seat } from '../../shared/protocol'
import type { PlayerRow } from '../db'
import { HttpError } from '../http'
import { hashToken } from './tokens'

/** The SHA-256 of the request's bearer token, or a 401 if there isn't one. */
export async function requireTokenHash(request: Request): Promise<string> {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!match?.[1]) throw unauthorized()
  return hashToken(match[1])
}

/** The player of this game holding the token, or a 401 (unknown token, or another game's). */
export function requirePlayer(players: PlayerRow[], tokenHash: string): PlayerRow & { seat: Seat } {
  const player = players.find((p) => p.tokenHash === tokenHash)
  if (!player) throw unauthorized()
  return player
}

function unauthorized(): HttpError {
  return new HttpError(401, 'unauthorized', 'This browser is not a player in that game.')
}

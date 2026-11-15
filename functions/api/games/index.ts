/** POST /api/games: start a game. The creator takes seat 0 and gets a code to share. */
import { createGame } from '../../../shared/engine'
import type { CreateGameResponse } from '../../../shared/protocol'
import { createGameRequestSchema } from '../../../shared/protocol/schemas'
import { generateToken, hashToken } from '../../../server/auth/tokens'
import { insertGame } from '../../../server/db'
import type { Env } from '../../../server/env'
import { randomGameCode, WAITING_TTL_MS } from '../../../server/games'
import { HttpError, json, readBody } from '../../../server/http'

const CODE_ATTEMPTS = 5

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readBody(request, createGameRequestSchema)
  const now = Date.now()
  const playerToken = generateToken()
  const host = {
    seat: 0 as const,
    name: body.name,
    tokenHash: await hashToken(playerToken),
    chatOn: body.chatOn,
    videoOn: body.videoOn,
  }
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = randomGameCode()
    const game = { code, status: 'waiting' as const, state: createGame(), now }
    const result = await insertGame(env.DB, { ...game, expiresAt: now + WAITING_TTL_MS }, host)
    if (result.ok) {
      // A brand-new game has no events yet, so the client syncs from the very start.
      const response: CreateGameResponse = { code, seat: 0, playerToken, cursor: 0 }
      return json(response, 201)
    }
  }
  throw new HttpError(503, 'unavailable', 'Could not find a free game code. Please try again.')
}

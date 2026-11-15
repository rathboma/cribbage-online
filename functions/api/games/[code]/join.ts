/**
 * POST /api/games/:code/join: take seat 1. In one atomic write the player is added, the engine's
 * `start` action cuts for deal and deals the first hand, and the game becomes active.
 */
import { applyAction } from '../../../../shared/engine'
import type { JoinGameResponse } from '../../../../shared/protocol'
import { joinGameRequestSchema } from '../../../../shared/protocol/schemas'
import { generateToken, hashToken } from '../../../../server/auth/tokens'
import { joinGame, readSync } from '../../../../server/db'
import type { Env } from '../../../../server/env'
import { ACTIVE_TTL_MS, codeFromParam, gameNotFound, isExpired } from '../../../../server/games'
import { HttpError, json, readBody } from '../../../../server/http'
import { gameRng } from '../../../../server/rng'

const ATTEMPTS = 3

export const onRequestPost: PagesFunction<Env> = async ({ request, params, env }) => {
  const code = codeFromParam(params.code)
  const body = await readBody(request, joinGameRequestSchema)
  const playerToken = generateToken()
  const player = {
    seat: 1 as const,
    name: body.name,
    tokenHash: await hashToken(playerToken),
    chatOn: body.chatOn ?? true,
    videoOn: body.videoOn ?? false,
  }

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const now = Date.now()
    const snapshot = await readSync(env.DB, code, { seat: 1 }, 0, 0)
    if (!snapshot || isExpired(snapshot.game, now)) throw gameNotFound()
    const { game } = snapshot
    if (game.status === 'finished' || game.status === 'abandoned') {
      throw new HttpError(410, 'game_ended', 'That game has already ended.')
    }
    if (game.status !== 'waiting' || snapshot.players.length >= 2) {
      throw new HttpError(409, 'game_full', 'That game already has two players.')
    }

    const started = applyAction(game.state, 0, { type: 'start' }, gameRng(env, code, game.version))
    if ('error' in started) throw new Error(`Could not start game ${code}: ${started.error}`)

    const result = await joinGame(env.DB, code, player, game.version, {
      state: started.state,
      status: 'active',
      gameEvents: { fromSeat: 1, events: started.events },
      now,
      expiresAt: now + ACTIVE_TTL_MS,
    })
    if (result.ok) {
      // The newest event before the join: the guest's first sync replays the cut and the deal.
      const response: JoinGameResponse = { seat: 1, playerToken, cursor: result.cursor }
      return json(response)
    }
    // Someone else changed the game first (most likely another join): look again.
  }
  throw new HttpError(409, 'conflict', 'The game changed while joining. Please try again.')
}

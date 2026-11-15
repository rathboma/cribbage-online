/**
 * POST /api/games/:code/actions — a player's move. The server validates it with the engine,
 * saves the result with a version check, and answers with a sync response built from the
 * client's own cursor, so it includes anything the opponent did first, then this move.
 */
import { applyAction } from '../../../../shared/engine'
import { actionRequestSchema } from '../../../../shared/protocol/schemas'
import { requirePlayer, requireTokenHash } from '../../../../server/auth/session'
import { saveState } from '../../../../server/db'
import type { Env } from '../../../../server/env'
import { ENGINE_ERROR_MESSAGES } from '../../../../server/errors'
import { ACTIVE_TTL_MS, codeFromParam, readLiveGame } from '../../../../server/games'
import { HttpError, json, readBody } from '../../../../server/http'
import { gameRng } from '../../../../server/rng'
import { buildSyncResponse, notePresence, SYNC_EVENT_LIMIT } from '../../../../server/sync'

/** Attempts when both players act at once (e.g. simultaneous discards). */
const ATTEMPTS = 3

export const onRequestPost: PagesFunction<Env> = async ({ request, params, env }) => {
  const code = codeFromParam(params.code)
  const body = await readBody(request, actionRequestSchema)
  const tokenHash = await requireTokenHash(request)

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const now = Date.now()
    const snapshot = await readLiveGame(env.DB, code, now, { tokenHash })
    const player = requirePlayer(snapshot.players, tokenHash)
    const { game } = snapshot

    if (game.status === 'abandoned') {
      throw new HttpError(410, 'game_ended', 'That game has ended.')
    }
    // A late or repeated request from an earlier hand must never land in this one.
    if (body.hand !== game.state.hand) {
      throw new HttpError(409, 'stale_action', 'That move was for a hand that is already over.')
    }

    const result = applyAction(
      game.state,
      player.seat,
      body.action,
      gameRng(env, code, game.version),
    )
    if ('error' in result) {
      throw new HttpError(422, result.error, ENGINE_ERROR_MESSAGES[result.error])
    }

    // A repeated `ready` changes nothing: answer without writing.
    const changed =
      result.events.length > 0 || JSON.stringify(result.state) !== JSON.stringify(game.state)
    if (changed) {
      const saved = await saveState(env.DB, code, game.version, {
        state: result.state,
        status: result.state.phase === 'game_over' ? 'finished' : 'active',
        gameEvents: { fromSeat: player.seat, events: result.events },
        now,
        expiresAt: now + ACTIVE_TTL_MS,
      })
      // The other player changed the game first: reload and try again on the new state.
      if (!saved.ok) continue
    }

    await notePresence(env.DB, player, now)
    const after = await readLiveGame(
      env.DB,
      code,
      now,
      { tokenHash },
      body.cursor,
      SYNC_EVENT_LIMIT,
    )
    return json(buildSyncResponse(after, player.seat, { cursor: body.cursor, v: body.v }, now))
  }
  throw new HttpError(409, 'conflict', 'The game kept changing. Please try again.')
}

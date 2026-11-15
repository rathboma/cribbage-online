/**
 * GET /api/games/:code/sync?cursor=&v= — the endpoint clients poll. One D1 batch reads the game,
 * the players and the new events together (and identifies the caller); presence is written at
 * most every 20 seconds.
 */
import { syncQuerySchema } from '../../../../shared/protocol/schemas'
import { requirePlayer, requireTokenHash } from '../../../../server/auth/session'
import { readSync } from '../../../../server/db'
import type { Env } from '../../../../server/env'
import { codeFromParam, gameNotFound, isExpired } from '../../../../server/games'
import { json, parse } from '../../../../server/http'
import { buildSyncResponse, eventLimit, notePresence } from '../../../../server/sync'

export const onRequestGet: PagesFunction<Env> = async ({ request, params, env }) => {
  const code = codeFromParam(params.code)
  const query = parse(syncQuerySchema, Object.fromEntries(new URL(request.url).searchParams))
  const tokenHash = await requireTokenHash(request)
  const now = Date.now()

  const snapshot = await readSync(env.DB, code, { tokenHash }, query.cursor ?? 0, eventLimit(query))
  if (!snapshot || isExpired(snapshot.game, now)) throw gameNotFound()
  const player = requirePlayer(snapshot.players, tokenHash)

  await notePresence(env.DB, player, now)
  return json(buildSyncResponse(snapshot, player.seat, query, now))
}

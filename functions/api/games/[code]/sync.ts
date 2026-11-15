/**
 * GET /api/games/:code/sync?cursor=&v= — the endpoint clients poll. One D1 batch reads the game,
 * the players and the new events together (and identifies the caller); presence is written at
 * most every 20 seconds.
 */
import { syncQuerySchema } from '../../../../shared/protocol/schemas'
import { requirePlayer, requireTokenHash } from '../../../../server/auth/session'
import type { Env } from '../../../../server/env'
import { codeFromParam, readLiveGame } from '../../../../server/games'
import { json, parse } from '../../../../server/http'
import { buildSyncResponse, eventLimit, notePresence } from '../../../../server/sync'

export const onRequestGet: PagesFunction<Env> = async ({ request, params, env }) => {
  const code = codeFromParam(params.code)
  const query = parse(syncQuerySchema, Object.fromEntries(new URL(request.url).searchParams))
  const tokenHash = await requireTokenHash(request)
  const now = Date.now()

  const snapshot = await readLiveGame(
    env.DB,
    code,
    now,
    { tokenHash },
    query.cursor ?? 0,
    eventLimit(query),
  )
  const player = requirePlayer(snapshot.players, tokenHash)

  await notePresence(env.DB, player, now)
  return json(buildSyncResponse(snapshot, player.seat, query, now))
}

/**
 * GET /api/games/:code/sync?cursor=&v= — the endpoint clients poll. One D1 batch authenticates
 * the caller and reads the game, the players and the new events together; presence is written
 * at most every 20 seconds.
 */
import { syncQuerySchema } from '../../../../shared/protocol/schemas'
import { authenticate } from '../../../../server/auth/session'
import type { Env } from '../../../../server/env'
import { codeFromParam } from '../../../../server/games'
import { json, parse } from '../../../../server/http'
import { buildSyncResponse, eventLimit, notePresence } from '../../../../server/sync'

export const onRequestGet: PagesFunction<Env> = async ({ request, params, env }) => {
  const code = codeFromParam(params.code)
  const query = parse(syncQuerySchema, Object.fromEntries(new URL(request.url).searchParams))
  const now = Date.now()
  const { snapshot, player } = await authenticate(env.DB, request, code, now, {
    cursor: query.cursor ?? 0,
    limit: eventLimit(query),
  })
  await notePresence(env.DB, player, snapshot.game.status, now)
  return json(buildSyncResponse(snapshot, player.seat, query, now))
}

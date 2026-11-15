/** GET /api/games/:code: public details for the join screen. No secrets, no game state. */
import type { LookupGameResponse } from '../../../../shared/protocol'
import { listPlayers } from '../../../../server/db'
import type { Env } from '../../../../server/env'
import { codeFromParam, loadLiveGame } from '../../../../server/games'
import { json } from '../../../../server/http'

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const code = codeFromParam(params.code)
  const game = await loadLiveGame(env.DB, code, Date.now())
  const players = await listPlayers(env.DB, code)
  const host = players.find((p) => p.seat === 0)
  const response: LookupGameResponse = {
    code,
    status: game.status,
    hostName: host?.name ?? '',
    hostChatOn: host?.chatOn ?? false,
    hostVideoOn: host?.videoOn ?? false,
    joinable: game.status === 'waiting' && players.length < 2,
  }
  return json(response)
}

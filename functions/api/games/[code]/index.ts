/** GET /api/games/:code: public details for the join screen. No secrets, no game state. */
import type { LookupGameResponse } from '../../../../shared/protocol'
import type { Env } from '../../../../server/env'
import { codeFromParam, readLiveGame } from '../../../../server/games'
import { json } from '../../../../server/http'

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const code = codeFromParam(params.code)
  // Game and players from one snapshot, so a join can't land between the two reads.
  const { game, players } = await readLiveGame(env.DB, code, Date.now())
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

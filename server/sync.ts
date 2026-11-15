/**
 * Building sync responses: what a player learns on every poll (and after every action).
 * See SyncResponse in shared/protocol for the contract.
 */
import { playerView } from '../shared/engine'
import type { PlayerInfo, Seat, SyncQuery, SyncResponse } from '../shared/protocol'
import { touchPlayer, type PlayerRow, type SyncSnapshot } from './db'

/** The most events one response carries; the client syncs again at once when `more` is set. */
export const SYNC_EVENT_LIMIT = 100
/** `last_seen_at` is written at most this often per player, not on every poll. */
export const PRESENCE_WRITE_INTERVAL_MS = 20_000
/** A player seen within this window counts as connected. */
export const CONNECTED_WINDOW_MS = 45_000

/** How many events to read: none for a client without a cursor (it snaps to the present). */
export function eventLimit(query: SyncQuery): number {
  return query.cursor === undefined ? 0 : SYNC_EVENT_LIMIT
}

export function buildSyncResponse(
  snapshot: SyncSnapshot,
  seat: Seat,
  query: SyncQuery,
  now: number,
): SyncResponse {
  const { game, events } = snapshot
  const snapToNow = query.cursor === undefined
  const more = !snapToNow && snapshot.more
  // The cursor is the last event actually delivered, so a truncated page never skips events.
  const cursor = snapToNow ? snapshot.latestEventId : (events.at(-1)?.id ?? query.cursor ?? 0)
  // A truncated page's events are older than the current state: the view waits for the last page.
  const sendView = !more && query.v !== game.version
  return {
    status: game.status,
    version: game.version,
    ...(sendView
      ? { view: playerView(game.state, seat, { canAct: game.status === 'active' }) }
      : {}),
    events,
    cursor,
    more,
    players: snapshot.players.map((p) => playerInfo(p, seat, now)),
    serverTime: now,
  }
}

function playerInfo(p: PlayerRow, viewer: Seat, now: number): PlayerInfo {
  return {
    seat: p.seat,
    name: p.name,
    connected: p.seat === viewer || now - p.lastSeenAt < CONNECTED_WINDOW_MS,
    chatOn: p.chatOn,
    videoOn: p.videoOn,
  }
}

/**
 * Records the player as seen, writing to D1 at most once per PRESENCE_WRITE_INTERVAL_MS. The
 * check is done here first (no query at all on most polls) and again atomically in SQL.
 */
export async function notePresence(db: D1Database, player: PlayerRow, now: number): Promise<void> {
  if (now - player.lastSeenAt >= PRESENCE_WRITE_INTERVAL_MS) {
    await touchPlayer(db, player.gameCode, player.seat, now, PRESENCE_WRITE_INTERVAL_MS)
  }
}

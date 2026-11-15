/**
 * Building sync responses: what a player learns on every poll (and after every action).
 * See SyncResponse in shared/protocol for the contract.
 */
import { playerView } from '../shared/engine'
import type { GameStatus, PlayerInfo, Seat, SyncQuery, SyncResponse } from '../shared/protocol'
import { touchPlayer, type PlayerRow, type SyncSnapshot } from './db'

/** The most events one response carries; the client syncs again at once when `more` is set. */
export const SYNC_EVENT_LIMIT = 100
/** `last_seen_at` is written at most this often per player, not on every poll. */
export const PRESENCE_WRITE_INTERVAL_MS = 20_000
/**
 * A player seen within this window counts as connected. Generous, because browsers throttle
 * timers in background tabs (to about once a minute) and clients back off when idle.
 */
export const CONNECTED_WINDOW_MS = 90_000

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
  const { game, events, latestEventId } = snapshot
  // No cursor (a reload), or a cursor ahead of the log (from another game, or a reset
  // database): snap to the present instead of waiting forever for ids that never come.
  const snapToNow = query.cursor === undefined || query.cursor > latestEventId
  const more = !snapToNow && snapshot.more
  const delivered = snapToNow ? [] : events
  // The cursor is the last event delivered, so a truncated page never skips events. On the last
  // page it moves on to the newest event: anything in between is private to the other seat, and
  // re-reading it on every poll would be wasted work.
  const cursor = snapToNow
    ? latestEventId
    : more
      ? (delivered.at(-1)?.id as number)
      : Math.max(delivered.at(-1)?.id ?? query.cursor ?? 0, latestEventId)
  // A truncated page's events are older than the current state: the view (and the version that
  // goes with it) wait for the last page.
  const sendView = !more && query.v !== game.version
  return {
    status: game.status,
    ...(more ? {} : { version: game.version }),
    ...(sendView
      ? { view: playerView(game.state, seat, { canAct: game.status === 'active' }) }
      : {}),
    events: delivered,
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
 * Records the player as seen, writing to D1 at most once per PRESENCE_WRITE_INTERVAL_MS (checked
 * here first, so most polls make no query at all, and again atomically in SQL). Nothing is
 * written for a game that is over. A failed write is logged, never turned into a failed poll.
 */
export async function notePresence(
  db: D1Database,
  player: PlayerRow,
  status: GameStatus,
  now: number,
): Promise<void> {
  if (status === 'finished' || status === 'abandoned') return
  if (now - player.lastSeenAt < PRESENCE_WRITE_INTERVAL_MS) return
  try {
    await touchPlayer(db, player.gameCode, player.seat, now, PRESENCE_WRITE_INTERVAL_MS)
  } catch (err) {
    console.error('Could not record presence', err)
  }
}

/**
 * The HTTP contract between the client (src/) and the Pages Functions (functions/). Types only:
 * the runtime validation for request bodies is in schemas.ts, which the client never imports.
 */
import type { Action, EngineErrorCode, GameEvent, Seat } from '../engine'
import type { PlayerView } from '../engine/view'

export type GameStatus = 'waiting' | 'active' | 'finished' | 'abandoned'

/** Actions a client may send. `start` is issued by the server when the second player joins. */
export type ClientAction = Exclude<Action, { type: 'start' }>

// --- Create, look up, join ------------------------------------------------------------------

/** POST /api/games */
export interface CreateGameRequest {
  name: string
  chatOn: boolean
  videoOn: boolean
}
export interface CreateGameResponse {
  code: string
  seat: Seat
  /** Secret for this seat; send it as a bearer token. Kept in localStorage. */
  playerToken: string
  /** Event cursor to start syncing from, so the client sees everything after creating. */
  cursor: number
}

/** GET /api/games/:code */
export interface LookupGameResponse {
  code: string
  status: GameStatus
  hostName: string
  hostChatOn: boolean
  hostVideoOn: boolean
  /** True while the game is waiting for its second player. */
  joinable: boolean
}

/** POST /api/games/:code/join */
export interface JoinGameRequest {
  name: string
  chatOn?: boolean
  videoOn?: boolean
}
export interface JoinGameResponse {
  seat: Seat
  playerToken: string
  cursor: number
}

// --- Sync and actions -----------------------------------------------------------------------

/** GET /api/games/:code/sync?cursor=&v= */
export interface SyncQuery {
  /** Id of the last event the client has. Omitted after a reload: the client snaps to now. */
  cursor?: number
  /** Game version the client already has a view for. */
  v?: number
}

/**
 * One *step*: new events plus the view that results from them, read as one consistent snapshot.
 */
export interface SyncResponse {
  status: GameStatus
  /**
   * The game's current state version. Once a response includes `view`, send this back as `v`
   * so the next sync can leave the view out if nothing changed.
   */
  version: number
  /**
   * The state after every event in the game so far. Omitted when the caller's `v` is already
   * current, and while `more` is true: a truncated page's events are older than the current
   * state, so the view only comes with the final page.
   */
  view?: PlayerView
  /** In id order. */
  events: ServerEvent[]
  /** Id of the last event included in this response (the client sends it back next time). */
  cursor: number
  /** True when the event list was truncated: sync again straight away. */
  more: boolean
  players: PlayerInfo[]
  /** Server clock, epoch milliseconds. */
  serverTime: number
}

/** POST /api/games/:code/actions. Answers with a SyncResponse. */
export interface ActionRequest {
  action: ClientAction
  /**
   * The hand number the client believes it is acting in. This is the staleness guard: an
   * action for another hand is refused (409 stale_action) and nothing is written.
   */
  hand: number
  /** As in sync: only used to build the response, never to refuse the action. */
  cursor: number
  /** As in sync: only used to build the response, never to refuse the action. */
  v: number
}

export interface PlayerInfo {
  seat: Seat
  name: string
  connected: boolean
  chatOn: boolean
  videoOn: boolean
}

// --- The event log --------------------------------------------------------------------------

export type ServerEventKind = 'game' | 'chat' | 'signal' | 'system'

interface ServerEventBase {
  /** Position in the game's event log; the sync cursor. */
  id: number
  /** The seat whose request caused it, if any. */
  from?: Seat
  /** Epoch milliseconds. */
  at: number
}

/** All engine events produced by one action, in order (one row per action). */
export interface GameServerEvent extends ServerEventBase {
  kind: 'game'
  payload: { events: GameEvent[] }
}

/** Chat, WebRTC signalling and system notices. Their payloads are defined in Phase 5 and P6. */
export interface OtherServerEvent extends ServerEventBase {
  kind: Exclude<ServerEventKind, 'game'>
  payload: Record<string, unknown>
}

export type ServerEvent = GameServerEvent | OtherServerEvent

// --- Errors ---------------------------------------------------------------------------------

export type ApiErrorCode =
  | EngineErrorCode
  /** The body, query or path didn't pass validation. */
  | 'bad_request'
  /** No such API route. */
  | 'not_found'
  /** No such game, or it has expired. */
  | 'game_not_found'
  /** Missing or wrong player token. */
  | 'unauthorized'
  /** The game already has two players. */
  | 'game_full'
  /** The game is finished or abandoned. */
  | 'game_ended'
  /** The action was for a hand that is already over; nothing was written. */
  | 'stale_action'
  /** Someone else changed the game at the same moment; retry. */
  | 'conflict'
  | 'rate_limited'
  | 'unavailable'
  | 'internal'

/** Every API error has this shape, always with both fields. */
export interface ApiError {
  error: { code: ApiErrorCode; message: string }
}

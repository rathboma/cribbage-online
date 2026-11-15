/**
 * The data-access layer: every read and write of the games, players and events tables.
 * Endpoints never write SQL themselves.
 *
 * Concurrency: each game row carries a `version`. Every write that depends on the game's state
 * is guarded on the version the caller read, inside one `db.batch()` (a transaction). A guarded
 * UPDATE that matches no rows does not roll a batch back, so the event INSERTs are guarded on
 * the same version and placed before the UPDATE: a lost race writes nothing at all.
 */
import type { GameEvent, GameState } from '../../shared/engine'
import type { GameStatus, Seat, ServerEvent, ServerEventKind } from '../../shared/protocol'

export interface GameRow {
  code: string
  status: GameStatus
  state: GameState
  version: number
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export interface PlayerRow {
  gameCode: string
  seat: Seat
  name: string
  tokenHash: string
  chatOn: boolean
  videoOn: boolean
  lastSeenAt: number
}

/** A player to insert. */
export interface NewPlayer {
  seat: Seat
  name: string
  tokenHash: string
  chatOn: boolean
  videoOn: boolean
}

/** An event to append that isn't a game action: chat, signal or system notice. */
export interface NewEvent {
  kind: Exclude<ServerEventKind, 'game'>
  fromSeat?: Seat | null
  /** Only this seat sees it; null or omitted means both players. */
  toSeat?: Seat | null
  payload: Record<string, unknown>
}

/** The engine events of one action, stored together as one `game` event row. */
export interface GameEventsWrite {
  fromSeat: Seat | null
  events: GameEvent[]
}

export type WriteResult = { ok: true; version: number } | { ok: false; reason: 'conflict' }

// --- Rows -----------------------------------------------------------------------------------

interface GameRecord {
  code: string
  status: GameStatus
  state: string
  version: number
  created_at: number
  updated_at: number
  expires_at: number
}

interface PlayerRecord {
  game_code: string
  seat: number
  name: string
  token_hash: string
  chat_on: number
  video_on: number
  last_seen_at: number
}

interface EventRecord {
  id: number
  kind: ServerEventKind
  from_seat: number | null
  payload: string
  created_at: number
}

function toGame(r: GameRecord): GameRow {
  return {
    code: r.code,
    status: r.status,
    state: JSON.parse(r.state) as GameState,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    expiresAt: r.expires_at,
  }
}

function toPlayer(r: PlayerRecord): PlayerRow {
  return {
    gameCode: r.game_code,
    seat: r.seat as Seat,
    name: r.name,
    tokenHash: r.token_hash,
    chatOn: r.chat_on === 1,
    videoOn: r.video_on === 1,
    lastSeenAt: r.last_seen_at,
  }
}

function toServerEvent(r: EventRecord): ServerEvent {
  const base = {
    id: r.id,
    at: r.created_at,
    ...(r.from_seat === null ? {} : { from: r.from_seat as Seat }),
  }
  const payload = JSON.parse(r.payload) as Record<string, unknown>
  return r.kind === 'game'
    ? { ...base, kind: 'game', payload: payload as { events: GameEvent[] } }
    : { ...base, kind: r.kind, payload }
}

// --- Statements -----------------------------------------------------------------------------

const GAME_COLUMNS = 'code, status, state, version, created_at, updated_at, expires_at'
const PLAYER_COLUMNS = 'game_code, seat, name, token_hash, chat_on, video_on, last_seen_at'
const EVENT_COLUMNS = 'id, kind, from_seat, payload, created_at'

const selectGame = (db: D1Database, code: string) =>
  db.prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE code = ?`).bind(code)

const selectPlayers = (db: D1Database, code: string) =>
  db.prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE game_code = ? ORDER BY seat`).bind(code)

/** Events after `cursor` that `seat` may see (to both players, or to that seat), oldest first. */
const selectEventsSince = (
  db: D1Database,
  code: string,
  cursor: number,
  seat: Seat,
  limit: number,
) =>
  db
    .prepare(
      `SELECT ${EVENT_COLUMNS} FROM events
       WHERE game_code = ? AND id > ? AND (to_seat IS NULL OR to_seat = ?)
       ORDER BY id LIMIT ?`,
    )
    .bind(code, cursor, seat, limit)

const selectLatestEventId = (db: D1Database, code: string) =>
  db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE game_code = ?').bind(code)

/** An event INSERT that only happens if the game is still at `expectedVersion`. */
function guardedEventInsert(
  db: D1Database,
  code: string,
  expectedVersion: number,
  kind: ServerEventKind,
  fromSeat: Seat | null,
  toSeat: Seat | null,
  payload: unknown,
  now: number,
) {
  return db
    .prepare(
      `INSERT INTO events (game_code, kind, from_seat, to_seat, payload, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (SELECT version FROM games WHERE code = ?1) = ?7`,
    )
    .bind(code, kind, fromSeat, toSeat, JSON.stringify(payload), now, expectedVersion)
}

// --- Reads ----------------------------------------------------------------------------------

export async function getGame(db: D1Database, code: string): Promise<GameRow | null> {
  const row = await selectGame(db, code).first<GameRecord>()
  return row ? toGame(row) : null
}

export async function listPlayers(db: D1Database, code: string): Promise<PlayerRow[]> {
  const { results } = await selectPlayers(db, code).all<PlayerRecord>()
  return results.map(toPlayer)
}

/** The player of game `code` holding this token, or null. A token never works for another game. */
export async function getPlayerByTokenHash(
  db: D1Database,
  code: string,
  tokenHash: string,
): Promise<PlayerRow | null> {
  const row = await db
    .prepare(`SELECT ${PLAYER_COLUMNS} FROM players WHERE game_code = ? AND token_hash = ?`)
    .bind(code, tokenHash)
    .first<PlayerRecord>()
  return row ? toPlayer(row) : null
}

/** Events after `cursor` visible to `seat`, in id order, at most `limit`. */
export async function listEventsSince(
  db: D1Database,
  code: string,
  cursor: number,
  seat: Seat,
  limit: number,
): Promise<ServerEvent[]> {
  const { results } = await selectEventsSince(db, code, cursor, seat, limit).all<EventRecord>()
  return results.map(toServerEvent)
}

/** Id of the game's newest event (any recipient), or 0 if it has none. */
export async function latestEventId(db: D1Database, code: string): Promise<number> {
  const row = await selectLatestEventId(db, code).first<{ id: number }>()
  return row?.id ?? 0
}

export interface SyncSnapshot {
  game: GameRow
  players: PlayerRow[]
  /** Events after the cursor visible to the seat, oldest first, at most `limit`. */
  events: ServerEvent[]
  /** True when more events were waiting than `limit`. */
  more: boolean
  /** Id of the game's newest event, for clients that sync without a cursor. */
  latestEventId: number
}

/**
 * The game, its players and the new events, read in one batch (one transaction), so the view
 * built from the game row and the events always describe the same moment.
 */
export async function readSync(
  db: D1Database,
  code: string,
  seat: Seat,
  cursor: number,
  limit: number,
): Promise<SyncSnapshot | null> {
  const [game, players, events, latest] = await db.batch([
    selectGame(db, code),
    selectPlayers(db, code),
    selectEventsSince(db, code, cursor, seat, limit + 1),
    selectLatestEventId(db, code),
  ])
  const gameRecord = (game?.results as GameRecord[] | undefined)?.[0]
  if (!gameRecord) return null
  const eventRecords = (events?.results ?? []) as EventRecord[]
  return {
    game: toGame(gameRecord),
    players: ((players?.results ?? []) as PlayerRecord[]).map(toPlayer),
    events: eventRecords.slice(0, limit).map(toServerEvent),
    more: eventRecords.length > limit,
    latestEventId: ((latest?.results as { id: number }[] | undefined)?.[0]?.id ?? 0) as number,
  }
}

// --- Writes ---------------------------------------------------------------------------------

/**
 * Creates a game (version 0) with its host. Fails with `code_taken` if the code is in use, so
 * the caller can retry with another code.
 */
export async function insertGame(
  db: D1Database,
  game: { code: string; status: GameStatus; state: GameState; now: number; expiresAt: number },
  host: NewPlayer,
): Promise<{ ok: true } | { ok: false; reason: 'code_taken' }> {
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO games (${GAME_COLUMNS}) VALUES (?, ?, ?, 0, ?, ?, ?)`)
        .bind(
          game.code,
          game.status,
          JSON.stringify(game.state),
          game.now,
          game.now,
          game.expiresAt,
        ),
      insertPlayer(db, game.code, host, game.now),
    ])
    return { ok: true }
  } catch (err) {
    if (isConstraintError(err, 'games.code')) return { ok: false, reason: 'code_taken' }
    throw err
  }
}

function insertPlayer(db: D1Database, code: string, player: NewPlayer, now: number) {
  return db
    .prepare(`INSERT INTO players (${PLAYER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      code,
      player.seat,
      player.name,
      player.tokenHash,
      player.chatOn ? 1 : 0,
      player.videoOn ? 1 : 0,
      now,
    )
}

/**
 * Saves a new state if nobody else changed the game since `expectedVersion` was read: bumps the
 * version, sets status and expiry, and appends the action's engine events as one `game` row.
 * On a conflict nothing is written.
 */
export async function saveState(
  db: D1Database,
  code: string,
  expectedVersion: number,
  write: {
    state: GameState
    status: GameStatus
    gameEvents?: GameEventsWrite
    now: number
    expiresAt: number
  },
): Promise<WriteResult> {
  const statements = []
  if (write.gameEvents && write.gameEvents.events.length > 0) {
    statements.push(
      guardedEventInsert(
        db,
        code,
        expectedVersion,
        'game',
        write.gameEvents.fromSeat,
        null,
        { events: write.gameEvents.events },
        write.now,
      ),
    )
  }
  statements.push(updateGame(db, code, expectedVersion, write))
  const results = await db.batch(statements)
  return results.at(-1)?.meta.changes === 1
    ? { ok: true, version: expectedVersion + 1 }
    : { ok: false, reason: 'conflict' }
}

/**
 * Adds the second player and saves the started game in one atomic batch, if the game is still at
 * `expectedVersion`. Of two simultaneous joins exactly one succeeds.
 */
export async function joinGame(
  db: D1Database,
  code: string,
  player: NewPlayer,
  expectedVersion: number,
  write: {
    state: GameState
    status: GameStatus
    gameEvents?: GameEventsWrite
    now: number
    expiresAt: number
  },
): Promise<WriteResult> {
  const statements = [
    db
      .prepare(
        `INSERT INTO players (${PLAYER_COLUMNS})
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
         WHERE (SELECT version FROM games WHERE code = ?1) = ?8`,
      )
      .bind(
        code,
        player.seat,
        player.name,
        player.tokenHash,
        player.chatOn ? 1 : 0,
        player.videoOn ? 1 : 0,
        write.now,
        expectedVersion,
      ),
  ]
  if (write.gameEvents && write.gameEvents.events.length > 0) {
    statements.push(
      guardedEventInsert(
        db,
        code,
        expectedVersion,
        'game',
        write.gameEvents.fromSeat,
        null,
        { events: write.gameEvents.events },
        write.now,
      ),
    )
  }
  statements.push(updateGame(db, code, expectedVersion, write))
  try {
    const results = await db.batch(statements)
    return results.at(-1)?.meta.changes === 1
      ? { ok: true, version: expectedVersion + 1 }
      : { ok: false, reason: 'conflict' }
  } catch (err) {
    // The seat is already taken (primary key): another join won the race.
    if (isConstraintError(err, 'players')) return { ok: false, reason: 'conflict' }
    throw err
  }
}

/**
 * Changes only the status (e.g. a player leaves), through the same version check so a
 * concurrent move can't overwrite it. Optionally appends a system event for both players.
 */
export async function setStatus(
  db: D1Database,
  code: string,
  expectedVersion: number,
  write: { status: GameStatus; systemEvent?: NewEvent; now: number; expiresAt?: number },
): Promise<WriteResult> {
  const statements = []
  if (write.systemEvent) {
    const e = write.systemEvent
    statements.push(
      guardedEventInsert(
        db,
        code,
        expectedVersion,
        e.kind,
        e.fromSeat ?? null,
        e.toSeat ?? null,
        e.payload,
        write.now,
      ),
    )
  }
  statements.push(
    db
      .prepare(
        `UPDATE games SET status = ?, version = version + 1, updated_at = ?,
           expires_at = COALESCE(?, expires_at)
         WHERE code = ? AND version = ?`,
      )
      .bind(write.status, write.now, write.expiresAt ?? null, code, expectedVersion),
  )
  const results = await db.batch(statements)
  return results.at(-1)?.meta.changes === 1
    ? { ok: true, version: expectedVersion + 1 }
    : { ok: false, reason: 'conflict' }
}

/**
 * Appends an event that doesn't change the game state (chat, signal), without a version check.
 * Returns its id.
 */
export async function appendEvent(
  db: D1Database,
  code: string,
  event: NewEvent,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO events (game_code, kind, from_seat, to_seat, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      code,
      event.kind,
      event.fromSeat ?? null,
      event.toSeat ?? null,
      JSON.stringify(event.payload),
      now,
    )
    .first<{ id: number }>()
  if (!row) throw new Error('INSERT ... RETURNING returned no row')
  return row.id
}

/** Records that a player was just seen (presence). */
export async function touchPlayer(
  db: D1Database,
  code: string,
  seat: Seat,
  now: number,
): Promise<void> {
  await db
    .prepare('UPDATE players SET last_seen_at = ? WHERE game_code = ? AND seat = ?')
    .bind(now, code, seat)
    .run()
}

function updateGame(
  db: D1Database,
  code: string,
  expectedVersion: number,
  write: { state: GameState; status: GameStatus; now: number; expiresAt: number },
) {
  return db
    .prepare(
      `UPDATE games SET state = ?, status = ?, version = version + 1, updated_at = ?, expires_at = ?
       WHERE code = ? AND version = ?`,
    )
    .bind(
      JSON.stringify(write.state),
      write.status,
      write.now,
      write.expiresAt,
      code,
      expectedVersion,
    )
}

function isConstraintError(err: unknown, mention: string): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /constraint/i.test(message) && message.includes(mention)
}

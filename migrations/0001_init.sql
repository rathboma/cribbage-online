-- Games, their players, and the append-only event log.
-- See server/db/ for the code that reads and writes these tables.

-- One row per game. `state` is the engine's full GameState as JSON, hidden cards included; it
-- never leaves the server. `version` increases on every write (optimistic concurrency).
CREATE TABLE games (
  code        TEXT PRIMARY KEY,          -- 5-letter game code
  status      TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'finished', 'abandoned')),
  state       TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,          -- ms since epoch
  updated_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- The (at most two) players of a game. Tokens are stored only as a SHA-256 hash.
CREATE TABLE players (
  game_code    TEXT NOT NULL REFERENCES games(code) ON DELETE CASCADE,
  seat         INTEGER NOT NULL CHECK (seat IN (0, 1)),
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  chat_on      INTEGER NOT NULL DEFAULT 1,
  video_on     INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (game_code, seat)
);

-- One row per write: all engine events of one action share a `game` row; each chat message,
-- signal or system notice is its own row. The id is the sync cursor.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_code  TEXT NOT NULL REFERENCES games(code) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('game', 'chat', 'signal', 'system')),
  from_seat  INTEGER CHECK (from_seat IN (0, 1)),
  to_seat    INTEGER CHECK (to_seat IN (0, 1)),  -- NULL = both players, else only that seat
  payload    TEXT NOT NULL,                      -- JSON
  created_at INTEGER NOT NULL
);
CREATE INDEX events_by_game ON events (game_code, id);

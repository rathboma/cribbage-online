import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createGame, type GameEvent } from '../../shared/engine'
import type { Seat } from '../../shared/protocol'
import { generateToken, hashToken } from '../auth/tokens'
import {
  appendEvent,
  getGame,
  getPlayerByTokenHash,
  insertGame,
  joinGame,
  latestEventId,
  listEventsSince,
  listPlayers,
  readSync,
  saveState,
  setStatus,
  touchPlayer,
  type NewPlayer,
} from './index'

const db = env.DB
const NOW = 1_700_000_000_000

// The database is shared by every test in this file, so each test uses its own game code.
let codeCounter = 0
function newCode(): string {
  const letters = 'BCDFGHJKLMNPQRSTVWXZ'
  let n = codeCounter++
  let code = ''
  for (let i = 0; i < 5; i++) {
    code = letters[n % 20] + code
    n = Math.floor(n / 20)
  }
  return code
}

function player(seat: Seat, overrides: Partial<NewPlayer> = {}): NewPlayer {
  return {
    seat,
    name: seat === 0 ? 'Ada' : 'Bo',
    tokenHash: `hash-${seat}-${Math.random()}`,
    chatOn: true,
    videoOn: false,
    ...overrides,
  }
}

async function newGame(): Promise<string> {
  const code = newCode()
  const result = await insertGame(
    db,
    { code, status: 'waiting', state: createGame(), now: NOW, expiresAt: NOW + 3_600_000 },
    player(0),
  )
  expect(result).toEqual({ ok: true })
  return code
}

const someEvents: GameEvent[] = [
  { type: 'discarded', seat: 0 },
  { type: 'discarded', seat: 1 },
]

async function countRows(table: 'events' | 'players', code: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE game_code = ?`)
    .bind(code)
    .first<{ n: number }>()
  return row?.n ?? 0
}

describe('schema', () => {
  it('has the three tables after migrations', async () => {
    const { results } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all<{ name: string }>()
    expect(results.map((r) => r.name)).toEqual(
      expect.arrayContaining(['events', 'games', 'players']),
    )
  })

  it('deletes a game’s players and events with it', async () => {
    const code = await newGame()
    await appendEvent(db, code, { kind: 'system', payload: { note: 'x' } }, NOW)
    expect(await countRows('players', code)).toBe(1)
    expect(await countRows('events', code)).toBe(1)
    await db.prepare('DELETE FROM games WHERE code = ?').bind(code).run()
    expect(await countRows('players', code)).toBe(0)
    expect(await countRows('events', code)).toBe(0)
  })

  it('does not append events to a game that does not exist', async () => {
    expect(await appendEvent(db, 'ZZZZZ', { kind: 'system', payload: {} }, NOW)).toBeNull()
    await expect(
      db
        .prepare(
          "INSERT INTO events (game_code, kind, payload, created_at) VALUES ('ZZZZZ', 'chat', '{}', 1)",
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })
})

describe('insertGame and reads', () => {
  it('stores the game at version 0 with its host', async () => {
    const code = await newGame()
    const game = await getGame(db, code)
    expect(game).toEqual({
      code,
      status: 'waiting',
      state: createGame(),
      version: 0,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW + 3_600_000,
    })
    const players = await listPlayers(db, code)
    expect(players).toHaveLength(1)
    expect(players[0]).toMatchObject({ gameCode: code, seat: 0, name: 'Ada', chatOn: true })
  })

  it('reports a taken code instead of overwriting the game', async () => {
    const code = await newGame()
    const again = await insertGame(
      db,
      { code, status: 'waiting', state: createGame(), now: NOW, expiresAt: NOW },
      player(0, { name: 'Mallory' }),
    )
    expect(again).toEqual({ ok: false, reason: 'code_taken' })
    expect((await listPlayers(db, code))[0]?.name).toBe('Ada')
  })

  it('returns null for an unknown game', async () => {
    expect(await getGame(db, 'QQQQQ')).toBeNull()
    expect(await listPlayers(db, 'QQQQQ')).toEqual([])
  })

  it('finds a player by token hash only within their own game', async () => {
    const a = await newGame()
    const b = await newGame()
    const host = (await listPlayers(db, a))[0]!
    expect(await getPlayerByTokenHash(db, a, host.tokenHash)).toEqual(host)
    expect(await getPlayerByTokenHash(db, b, host.tokenHash)).toBeNull()
    expect(await getPlayerByTokenHash(db, a, 'wrong')).toBeNull()
  })
})

describe('saveState', () => {
  it('saves the state, bumps the version and stores the action’s events as one row', async () => {
    const code = await newGame()
    const state = { ...createGame(), hand: 1 }
    const result = await saveState(db, code, 0, {
      state,
      status: 'active',
      gameEvents: { fromSeat: 1, events: someEvents },
      now: NOW + 5,
      expiresAt: NOW + 86_400_000,
    })
    expect(result).toEqual({ ok: true, version: 1 })
    const game = await getGame(db, code)
    expect(game).toMatchObject({
      status: 'active',
      version: 1,
      updatedAt: NOW + 5,
      expiresAt: NOW + 86_400_000,
      state,
    })
    const events = await listEventsSince(db, code, 0, 0, 10)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'game',
      from: 1,
      at: NOW + 5,
      payload: { events: someEvents },
    })
  })

  it('lets exactly one of two writes from the same version win, and the loser writes nothing', async () => {
    const code = await newGame()
    const write = (hand: number) =>
      saveState(db, code, 0, {
        state: { ...createGame(), hand },
        status: 'active',
        gameEvents: { fromSeat: 0, events: [{ type: 'hand_dealt', hand, dealer: 0 }] },
        now: NOW,
        expiresAt: NOW,
      })
    const results = await Promise.all([write(1), write(2)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'conflict' }])
    expect(await countRows('events', code)).toBe(1)
    const game = await getGame(db, code)
    expect(game?.version).toBe(1)
    // The stored state and event come from the same (winning) write.
    const [event] = await listEventsSince(db, code, 0, 0, 10)
    expect((event?.payload as { events: { hand: number }[] }).events[0]?.hand).toBe(
      game?.state.hand,
    )
  })

  it('refuses a stale version without writing', async () => {
    const code = await newGame()
    const stale = await saveState(db, code, 3, {
      state: createGame(),
      status: 'active',
      gameEvents: { fromSeat: 0, events: someEvents },
      now: NOW,
      expiresAt: NOW,
    })
    expect(stale).toEqual({ ok: false, reason: 'conflict' })
    expect(await countRows('events', code)).toBe(0)
    expect((await getGame(db, code))?.version).toBe(0)
  })

  it('writes no event row when the action produced no events', async () => {
    const code = await newGame()
    const result = await saveState(db, code, 0, {
      state: createGame(),
      status: 'active',
      gameEvents: { fromSeat: 0, events: [] },
      now: NOW,
      expiresAt: NOW,
    })
    expect(result.ok).toBe(true)
    expect(await countRows('events', code)).toBe(0)
  })
})

describe('joinGame', () => {
  const start = (now = NOW) => ({
    state: { ...createGame(), phase: 'discard' as const, hand: 1 },
    status: 'active' as const,
    gameEvents: { fromSeat: 1 as Seat, events: someEvents },
    now,
    expiresAt: now + 86_400_000,
  })

  it('adds the second player and saves the started game together', async () => {
    const code = await newGame()
    const before = (await appendEvent(db, code, { kind: 'system', payload: {} }, NOW)) as number
    expect(await joinGame(db, code, player(1), 0, start(NOW + 7))).toEqual({
      ok: true,
      version: 1,
      cursor: before,
    })
    expect((await listPlayers(db, code)).map((p) => p.seat)).toEqual([0, 1])
    expect(await getGame(db, code)).toMatchObject({
      status: 'active',
      version: 1,
      updatedAt: NOW + 7,
      expiresAt: NOW + 7 + 86_400_000,
    })
    expect(await countRows('events', code)).toBe(2)
    // The returned cursor is just before the join's own events.
    const after = await listEventsSince(db, code, before, 1, 10)
    expect(after.map((e) => e.kind)).toEqual(['game'])
  })

  it('reports a cursor of 0 for a game with no events yet', async () => {
    const code = await newGame()
    expect(await joinGame(db, code, player(1), 0, start())).toMatchObject({ ok: true, cursor: 0 })
  })

  it('lets real database errors through instead of calling them conflicts', async () => {
    const code = await newGame()
    const host = (await listPlayers(db, code))[0]!
    // Reusing the host's token hash breaks the UNIQUE constraint: an error, not a lost race.
    await expect(
      joinGame(db, code, player(1, { tokenHash: host.tokenHash }), 0, start()),
    ).rejects.toThrow(/UNIQUE/)
    expect(await countRows('players', code)).toBe(1)
    expect((await getGame(db, code))?.version).toBe(0)
  })

  it('lets exactly one of two simultaneous joins succeed', async () => {
    const code = await newGame()
    const results = await Promise.all([
      joinGame(db, code, player(1, { name: 'First' }), 0, start()),
      joinGame(db, code, player(1, { name: 'Second' }), 0, start()),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'conflict' }])
    expect(await countRows('players', code)).toBe(2)
    expect(await countRows('events', code)).toBe(1)
  })

  it('refuses a join on a stale version, even if the seat is free', async () => {
    const code = await newGame()
    await setStatus(db, code, 0, { status: 'waiting', now: NOW })
    expect(await joinGame(db, code, player(1), 0, start())).toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(await countRows('players', code)).toBe(1)
    expect(await countRows('events', code)).toBe(0)
  })

  it('refuses a seat that is already taken', async () => {
    const code = await newGame()
    expect(await joinGame(db, code, player(0), 0, start())).toEqual({
      ok: false,
      reason: 'conflict',
    })
    expect(await countRows('players', code)).toBe(1)
  })
})

describe('setStatus', () => {
  it('can move the expiry with the status', async () => {
    const code = await newGame()
    await setStatus(db, code, 0, { status: 'finished', now: NOW, expiresAt: NOW + 42 })
    expect((await getGame(db, code))?.expiresAt).toBe(NOW + 42)
  })

  it('changes the status through the version check, with an optional system event', async () => {
    const code = await newGame()
    const result = await setStatus(db, code, 0, {
      status: 'abandoned',
      systemEvent: { kind: 'system', fromSeat: 0, payload: { type: 'left', seat: 0 } },
      now: NOW + 9,
    })
    expect(result).toEqual({ ok: true, version: 1 })
    expect(await getGame(db, code)).toMatchObject({
      status: 'abandoned',
      version: 1,
      updatedAt: NOW + 9,
      expiresAt: NOW + 3_600_000,
    })
    const events = await listEventsSince(db, code, 0, 1, 10)
    expect(events).toEqual([
      expect.objectContaining({ kind: 'system', from: 0, payload: { type: 'left', seat: 0 } }),
    ])
  })

  it('loses to a concurrent move and writes nothing', async () => {
    const code = await newGame()
    await saveState(db, code, 0, {
      state: createGame(),
      status: 'active',
      now: NOW,
      expiresAt: NOW,
    })
    const result = await setStatus(db, code, 0, {
      status: 'abandoned',
      systemEvent: { kind: 'system', payload: { type: 'left' } },
      now: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'conflict' })
    expect((await getGame(db, code))?.status).toBe('active')
    expect(await countRows('events', code)).toBe(0)
  })
})

describe('events', () => {
  it('lists events after a cursor in id order, only those the seat may see', async () => {
    const code = await newGame()
    const append = async (event: Parameters<typeof appendEvent>[2]) =>
      (await appendEvent(db, code, event, NOW)) as number
    const ids = [
      await append({ kind: 'chat', fromSeat: 0, payload: { text: 'hi' } }),
      await append({ kind: 'signal', fromSeat: 0, toSeat: 1, payload: { s: 1 } }),
      await append({ kind: 'signal', fromSeat: 1, toSeat: 0, payload: { s: 2 } }),
      await append({ kind: 'system', payload: { note: 'both' } }),
    ]
    expect(ids).toEqual([...ids].sort((a, b) => a - b))

    const forSeat0 = await listEventsSince(db, code, 0, 0, 10)
    expect(forSeat0.map((e) => e.id)).toEqual([ids[0], ids[2], ids[3]])
    const forSeat1 = await listEventsSince(db, code, 0, 1, 10)
    expect(forSeat1.map((e) => e.id)).toEqual([ids[0], ids[1], ids[3]])

    expect((await listEventsSince(db, code, ids[0]!, 1, 10)).map((e) => e.id)).toEqual([
      ids[1],
      ids[3],
    ])
    expect((await listEventsSince(db, code, 0, 1, 2)).map((e) => e.id)).toEqual([ids[0], ids[1]])
    expect(forSeat0[0]).toEqual({
      id: ids[0],
      kind: 'chat',
      from: 0,
      at: NOW,
      payload: { text: 'hi' },
    })
  })

  it('never lists another game’s events', async () => {
    const a = await newGame()
    const b = await newGame()
    await appendEvent(db, a, { kind: 'chat', payload: { text: 'a' } }, NOW)
    expect(await listEventsSince(db, b, 0, 0, 10)).toEqual([])
  })

  it('reports the newest event id, or 0 for none', async () => {
    const code = await newGame()
    expect(await latestEventId(db, code)).toBe(0)
    const id = await appendEvent(db, code, { kind: 'signal', toSeat: 1, payload: {} }, NOW)
    expect(await latestEventId(db, code)).toBe(id)
  })
})

describe('readSync', () => {
  it('reads the game, players and new events together, flagging when more are waiting', async () => {
    const code = await newGame()
    const ids: number[] = []
    for (let i = 0; i < 5; i++) {
      ids.push((await appendEvent(db, code, { kind: 'chat', payload: { i } }, NOW)) as number)
    }
    const snapshot = await readSync(db, code, { seat: 0 }, ids[0]!, 3)
    expect(snapshot?.game.code).toBe(code)
    expect(snapshot?.players.map((p) => p.seat)).toEqual([0])
    expect(snapshot?.events.map((e) => e.id)).toEqual(ids.slice(1, 4))
    expect(snapshot?.more).toBe(true)
    expect(snapshot?.latestEventId).toBe(ids[4])

    const rest = await readSync(db, code, { seat: 0 }, ids[3]!, 3)
    expect(rest?.events.map((e) => e.id)).toEqual([ids[4]])
    expect(rest?.more).toBe(false)
  })

  it('returns null for an unknown game', async () => {
    expect(await readSync(db, 'QQQQQ', { seat: 0 }, 0, 10)).toBeNull()
  })
})

describe('touchPlayer', () => {
  it('records when a player was last seen, in their own game only', async () => {
    const code = await newGame()
    const other = await newGame()
    expect(await touchPlayer(db, code, 0, NOW + 1234)).toBe(true)
    expect((await listPlayers(db, code))[0]?.lastSeenAt).toBe(NOW + 1234)
    expect((await listPlayers(db, other))[0]?.lastSeenAt).toBe(NOW)
  })

  it('skips the write when the player was seen within the interval', async () => {
    const code = await newGame()
    expect(await touchPlayer(db, code, 0, NOW + 19_999, 20_000)).toBe(false)
    expect((await listPlayers(db, code))[0]?.lastSeenAt).toBe(NOW)
    expect(await touchPlayer(db, code, 0, NOW + 20_000, 20_000)).toBe(true)
    expect((await listPlayers(db, code))[0]?.lastSeenAt).toBe(NOW + 20_000)
  })
})

describe('tokens', () => {
  it('generates 32 random bytes as base64url', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken))
    expect(tokens.size).toBe(100)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('hashes with SHA-256 as lower-case hex', async () => {
    expect(await hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { PlayerRow } from './db'
import { notePresence, PRESENCE_WRITE_INTERVAL_MS } from './sync'

const NOW = 1_700_000_000_000
const player: PlayerRow = {
  gameCode: 'BCDFG',
  seat: 0,
  name: 'Ada',
  tokenHash: 'h',
  chatOn: true,
  videoOn: false,
  lastSeenAt: NOW - PRESENCE_WRITE_INTERVAL_MS,
}

/** A D1Database whose every query fails, counting the attempts. */
function failingDb() {
  const prepare = vi.fn(() => {
    throw new Error('D1 is out of writes for today')
  })
  return { db: { prepare } as unknown as D1Database, prepare }
}

describe('notePresence', () => {
  it('makes no query at all within the write interval', async () => {
    const { db, prepare } = failingDb()
    await notePresence(db, { ...player, lastSeenAt: NOW - 1 }, 'active', NOW)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('writes nothing for a game that is over', async () => {
    const { db, prepare } = failingDb()
    await notePresence(db, player, 'finished', NOW)
    await notePresence(db, player, 'abandoned', NOW)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('never turns a failed write into a failed poll', async () => {
    const { db, prepare } = failingDb()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notePresence(db, player, 'active', NOW)).resolves.toBeUndefined()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

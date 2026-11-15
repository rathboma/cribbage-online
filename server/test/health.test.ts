import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '../../shared/protocol'

describe('GET /api/health', () => {
  it('answers ok from D1, with the protocol version from shared/', async () => {
    const res = await exports.default.fetch('http://localhost/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, protocol: PROTOCOL_VERSION })
  })

  it('runs against a migrated D1 database', async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'",
    ).all()
    expect(tables.results).toHaveLength(1)
  })
})

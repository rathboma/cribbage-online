import type { Env } from '../../server/env'
import { PROTOCOL_VERSION } from '../../shared/version'

/** GET /api/health: checks that the Function runs and can query D1. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const row = await env.DB.prepare('SELECT 1 AS one').first<{ one: number }>()
    if (row?.one !== 1) throw new Error('unexpected result from SELECT 1')
    return Response.json({ ok: true, protocol: PROTOCOL_VERSION })
  } catch (err) {
    console.error('health check failed', err)
    return Response.json(
      { ok: false, error: { code: 'unavailable', message: 'The database is not reachable.' } },
      { status: 503 },
    )
  }
}

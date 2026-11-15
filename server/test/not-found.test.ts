import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('unknown /api routes', () => {
  it.each([
    ['GET', '/api/nope'],
    ['GET', '/api/games/BCDFG/nothing'],
    ['POST', '/api/health'],
  ])('%s %s answers 404 JSON, not the app shell', async (method, path) => {
    const res = await exports.default.fetch(`http://localhost${path}`, { method })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})

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

describe('paths that match no file', () => {
  it.each(['/j/BCDFG', '/g/BCDFG', '/new', '/no/such/page'])(
    '%s is a page of the app: it gets index.html',
    async (path) => {
      const res = await exports.default.fetch(`http://localhost${path}`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      expect(await res.text()).toContain('app shell')
    },
  )

  it.each(['/assets/index-0ldHash.js', '/assets/KC-0ldHash.png', '/favicon.ico', '/robots.txt'])(
    '%s looks like a file: a 404 that is never cached, not the app shell',
    async (path) => {
      const res = await exports.default.fetch(`http://localhost${path}`)
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await res.text()).not.toContain('app shell')
    },
  )

  it('answers a browser that already has the page with a 304', async () => {
    const first = await exports.default.fetch('http://localhost/j/BCDFG')
    const etag = first.headers.get('etag')!
    await first.text()
    const again = await exports.default.fetch('http://localhost/j/BCDFG', {
      headers: { 'If-None-Match': etag },
    })
    expect(again.status).toBe(304)
  })

  it('only serves pages to GET and HEAD', async () => {
    const res = await exports.default.fetch('http://localhost/g/BCDFG', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

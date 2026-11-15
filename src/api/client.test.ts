import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'

function fakeFetch(status: number, body: unknown, raw?: string) {
  return vi.fn(
    async () =>
      new Response(raw ?? JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

describe('createApiClient', () => {
  it('creates a game with a JSON body', async () => {
    const fetch = fakeFetch(201, { code: 'BCDFG', seat: 0, playerToken: 't', cursor: 0 })
    const api = createApiClient({ fetch })
    const res = await api.createGame({ name: 'Ada', chatOn: true, videoOn: false })
    expect(res.code).toBe('BCDFG')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/games')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Ada', chatOn: true, videoOn: false })
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('looks up and joins by code', async () => {
    const fetch = fakeFetch(200, {})
    const api = createApiClient({ fetch, baseUrl: 'https://example.test/' })
    await api.lookupGame('BCDFG')
    await api.joinGame('BCDFG', { name: 'Bo' })
    expect(fetch.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      'https://example.test/api/games/BCDFG',
      'https://example.test/api/games/BCDFG/join',
    ])
  })

  it('syncs with the bearer token, cursor and version', async () => {
    const fetch = fakeFetch(200, { events: [] })
    const api = createApiClient({ fetch })
    await api.sync('BCDFG', 'secret', { cursor: 0, v: 3 })
    await api.sync('BCDFG', 'secret', {})
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(calls.map((c) => c[0])).toEqual([
      '/api/games/BCDFG/sync?cursor=0&v=3',
      '/api/games/BCDFG/sync',
    ])
    expect((calls[0]![1].headers as Record<string, string>).Authorization).toBe('Bearer secret')
  })

  it('posts actions with the token', async () => {
    const fetch = fakeFetch(200, { events: [] })
    await createApiClient({ fetch }).act('BCDFG', 'secret', {
      action: { type: 'go' },
      hand: 2,
      cursor: 7,
      v: 9,
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/games/BCDFG/actions')
    expect(JSON.parse(init.body as string)).toEqual({
      action: { type: 'go' },
      hand: 2,
      cursor: 7,
      v: 9,
    })
  })

  it('turns an API error into an ApiError with the server’s code', async () => {
    const fetch = fakeFetch(422, {
      error: { code: 'not_your_turn', message: "It's not your turn." },
    })
    const err = await createApiClient({ fetch })
      .act('BCDFG', 't', { action: { type: 'go' }, hand: 1, cursor: 0, v: 0 })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 422,
      code: 'not_your_turn',
      message: "It's not your turn.",
    })
    expect((err as ApiError).isTerminal).toBe(false)
  })

  it.each([401, 404, 410])('marks %i as terminal', async (status) => {
    const fetch = fakeFetch(status, { error: { code: 'unauthorized', message: 'x' } })
    const err = (await createApiClient({ fetch })
      .sync('B', 't', {})
      .catch((e) => e)) as ApiError
    expect(err.isTerminal).toBe(true)
  })

  it('copes with a non-JSON error page', async () => {
    const fetch = fakeFetch(502, null, '<html>Bad gateway</html>')
    const err = (await createApiClient({ fetch })
      .lookupGame('B')
      .catch((e) => e)) as ApiError
    expect(err).toMatchObject({ status: 502, code: 'internal' })
  })

  it('reports a network failure as code network, status 0', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = (await createApiClient({ fetch })
      .lookupGame('B')
      .catch((e) => e)) as ApiError
    expect(err).toMatchObject({ status: 0, code: 'network' })
    expect(err.isTerminal).toBe(false)
  })
})

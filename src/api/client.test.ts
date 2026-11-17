import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient, REQUEST_TIMEOUT_MS } from './client'
import { friendlyError } from './messages'

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

  it.each([
    [401, 'unauthorized'],
    [404, 'game_not_found'],
  ] as const)('marks %i %s as terminal', async (status, code) => {
    const fetch = fakeFetch(status, { error: { code, message: 'x' } })
    const err = (await createApiClient({ fetch })
      .sync('B', 't', {})
      .catch((e) => e)) as ApiError
    expect(err.isTerminal).toBe(true)
  })

  it.each([
    // A move refused because the game is over is a refused move, not a lost seat.
    [410, { error: { code: 'game_ended', message: 'x' } }],
    // No such API route (a deploy gone wrong), or a proxy's own 404 page.
    [404, { error: { code: 'not_found', message: 'x' } }],
    [404, null],
    [401, null],
  ] as const)('does not mark %i %j as terminal', async (status, body) => {
    const fetch = fakeFetch(status, body, body === null ? '<html>nope</html>' : undefined)
    const err = (await createApiClient({ fetch })
      .sync('B', 't', {})
      .catch((e) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err.isTerminal).toBe(false)
  })

  it('copes with a non-JSON error page', async () => {
    const fetch = fakeFetch(502, null, '<html>Bad gateway</html>')
    const err = (await createApiClient({ fetch })
      .lookupGame('B')
      .catch((e) => e)) as ApiError
    expect(err).toMatchObject({ status: 502, code: 'internal' })
  })

  it('reports an answer it cannot read as the server going wrong', async () => {
    const fetch = fakeFetch(200, null, '<html>Welcome to nginx</html>')
    const err = (await createApiClient({ fetch })
      .lookupGame('B')
      .catch((e) => e)) as ApiError
    expect(err).toMatchObject({ status: 200, code: 'internal' })
    expect(friendlyError(err)).toMatch(/went wrong on our side/)
  })

  it('gives up on a request that never answers', async () => {
    vi.useFakeTimers()
    try {
      // Like the real fetch: pending until the signal aborts it.
      const fetch = vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('', 'AbortError')),
            )
          }),
      )
      const pending = createApiClient({ fetch: fetch as unknown as typeof globalThis.fetch })
        .sync('B', 't', {})
        .catch((e) => e)
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const err = (await pending) as ApiError
      expect(err).toMatchObject({ status: 0, code: 'network' })
      expect(err.isTerminal).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not time out an answer that arrived', async () => {
    vi.useFakeTimers()
    try {
      const fetch = fakeFetch(200, { ok: true })
      await createApiClient({ fetch }).lookupGame('B')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
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

/**
 * Typed calls to the game API (see shared/protocol for the contract). Every failure becomes an
 * ApiError with the server's error code, or `network` when no response arrived.
 */
import type {
  ActionRequest,
  ApiError as ApiErrorBody,
  ApiErrorCode,
  CreateGameRequest,
  CreateGameResponse,
  JoinGameRequest,
  JoinGameResponse,
  LookupGameResponse,
  SyncQuery,
  SyncResponse,
} from '@shared/protocol'

export type ClientErrorCode = ApiErrorCode | 'network'

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the request never got a response. */
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** The server says this game or this seat is gone for good: stop and forget the session. */
  get isTerminal(): boolean {
    return this.status === 401 || this.status === 404 || this.status === 410
  }
}

export interface ApiClient {
  createGame(body: CreateGameRequest): Promise<CreateGameResponse>
  lookupGame(code: string): Promise<LookupGameResponse>
  joinGame(code: string, body: JoinGameRequest): Promise<JoinGameResponse>
  sync(code: string, token: string, query: SyncQuery): Promise<SyncResponse>
  act(code: string, token: string, body: ActionRequest): Promise<SyncResponse>
}

export function createApiClient(
  options: { baseUrl?: string; fetch?: typeof fetch } = {},
): ApiClient {
  const base = (options.baseUrl ?? '').replace(/\/$/, '')
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; token?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    if (init.token) headers.Authorization = `Bearer ${init.token}`
    let res: Response
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
    } catch (err) {
      throw new ApiError(0, 'network', err instanceof Error ? err.message : 'Network error')
    }
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // Not JSON (e.g. a proxy error page); handled below.
    }
    if (res.ok && body !== null) return body as T
    const error = (body as Partial<ApiErrorBody> | null)?.error
    throw new ApiError(
      res.status,
      error?.code ?? (res.status >= 500 ? 'internal' : 'bad_request'),
      error?.message ?? `The server answered ${res.status}.`,
    )
  }

  const game = (code: string) => `/api/games/${encodeURIComponent(code)}`

  return {
    createGame: (body) => request('POST', '/api/games', { body }),
    lookupGame: (code) => request('GET', game(code)),
    joinGame: (code, body) => request('POST', `${game(code)}/join`, { body }),
    sync(code, token, query) {
      const params = [
        query.cursor === undefined ? null : `cursor=${query.cursor}`,
        query.v === undefined ? null : `v=${query.v}`,
      ].filter(Boolean)
      return request('GET', `${game(code)}/sync${params.length ? `?${params.join('&')}` : ''}`, {
        token,
      })
    },
    act: (code, token, body) => request('POST', `${game(code)}/actions`, { body, token }),
  }
}

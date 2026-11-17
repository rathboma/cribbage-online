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

  /**
   * The server itself says this game is gone or this seat's token is no good: stop syncing and
   * forget the session. Judged by the server's error code, never by the HTTP status alone: a
   * proxy's 404 page or an unknown route must not cost a player their seat, and a move refused
   * because the game has finished (410) is just a refused move.
   */
  get isTerminal(): boolean {
    return this.code === 'game_not_found' || this.code === 'unauthorized'
  }
}

/** How long a request may take before it counts as a network failure. */
export const REQUEST_TIMEOUT_MS = 10_000

export interface ApiClient {
  createGame(body: CreateGameRequest): Promise<CreateGameResponse>
  lookupGame(code: string): Promise<LookupGameResponse>
  joinGame(code: string, body: JoinGameRequest): Promise<JoinGameResponse>
  sync(code: string, token: string, query: SyncQuery): Promise<SyncResponse>
  act(code: string, token: string, body: ActionRequest): Promise<SyncResponse>
}

export function createApiClient(
  options: { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): ApiClient {
  const base = (options.baseUrl ?? '').replace(/\/$/, '')
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS

  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    init: { body?: unknown; token?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    if (init.token) headers.Authorization = `Bearer ${init.token}`
    // A request that never answers would hold up everything queued behind it (polls and
    // moves run one at a time), so it is given up on after a while.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    let body: unknown = null
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      })
      try {
        body = await res.json()
      } catch (err) {
        if (controller.signal.aborted) throw err
        // Not JSON (e.g. a proxy error page); handled below.
      }
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ApiError(0, 'network', 'The server took too long to answer.')
      }
      throw new ApiError(0, 'network', err instanceof Error ? err.message : 'Network error')
    } finally {
      clearTimeout(timer)
    }
    if (res.ok && body !== null) return body as T
    const error = (body as Partial<ApiErrorBody> | null)?.error
    throw new ApiError(
      res.status,
      // An answer that can't be read (even a 200) is the server's side going wrong.
      error?.code ?? (res.status >= 500 || res.ok ? 'internal' : 'bad_request'),
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

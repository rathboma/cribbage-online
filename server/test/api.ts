/** Helpers for route tests: call the API through the compiled Functions, like a browser would. */
import { exports } from 'cloudflare:workers'

export interface ApiResult<T = unknown> {
  status: number
  body: T
  headers: Headers
  /** The raw response text, for leak checks. */
  text: string
}

export async function api<T = unknown>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string; rawBody?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined || options.rawBody !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  const res = await exports.default.fetch(`http://localhost${path}`, {
    method,
    headers,
    body:
      options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  })
  const text = await res.text()
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as T,
    headers: res.headers,
    text,
  }
}

/**
 * Runs for every /api/* request (never for static assets): API responses are never cached, and
 * anything a route throws becomes the uniform `{ error: { code, message } }` JSON shape.
 */
import type { Env } from '../../server/env'
import { toErrorResponse } from '../../server/http'

export const onRequest: PagesFunction<Env> = async ({ next }) => {
  let response: Response
  try {
    response = await next()
  } catch (err) {
    response = toErrorResponse(err)
  }
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, { status: response.status, headers })
}

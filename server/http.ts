/** Request and response helpers shared by every API route. */
import type { z } from 'zod'
import type { ApiError, ApiErrorCode } from '../shared/protocol'

/** Throw this from a route: the API middleware turns it into `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    /** Extra response headers, e.g. Retry-After on a 429. */
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  headers: Record<string, string> = {},
): Response {
  const body: ApiError = { error: { code, message } }
  return Response.json(body, { status, headers })
}

/** Turns anything thrown by a route into the uniform JSON error shape. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message, err.headers)
  console.error('Unhandled error in API route', err)
  return errorResponse(500, 'internal', 'Something went wrong on the server.')
}

/** Parses and validates a JSON body, or throws a 400 `bad_request` that says what is wrong. */
export async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, 'bad_request', 'The request body must be JSON.')
  }
  return parse(schema, body)
}

/** Validates a value (e.g. query parameters), or throws a 400 `bad_request`. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
  throw new HttpError(400, 'bad_request', `${where}${issue?.message ?? 'Invalid request.'}`)
}

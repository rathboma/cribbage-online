/**
 * Any /api/* request that no other Function handles. Without this, Pages would fall back
 * to the app's index.html with a 200, and clients would try to parse HTML as JSON.
 */
import { errorResponse } from '../../server/http'

export const onRequest: PagesFunction = ({ request }) => {
  const { pathname } = new URL(request.url)
  return errorResponse(404, 'not_found', `No API route for ${request.method} ${pathname}`)
}

/**
 * Any /api/* request that no other Function handles. Without this, Pages would fall back
 * to the app's index.html with a 200, and clients would try to parse HTML as JSON.
 */
export const onRequest: PagesFunction = ({ request }) => {
  const { pathname } = new URL(request.url)
  return Response.json(
    { error: { code: 'not_found', message: `No API route for ${request.method} ${pathname}` } },
    { status: 404 },
  )
}

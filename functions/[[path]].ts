/**
 * Every request that matches no file in dist/ and is not for /api/* (files are served before
 * the Worker runs; see `assets` in wrangler.jsonc).
 *
 * A page of the app - a deep link such as /j/BCDFG or /g/BCDFG, or a mistyped address, which
 * the app's router reports as not found - gets index.html.
 *
 * Anything that looks like a file gets a real 404 that is never cached. Answering a missing
 * /assets/ file with index.html, as Cloudflare's built-in single-page fallback does, would let
 * a browser keep that HTML under the file's URL for a year (the /assets/* rule in
 * public/_headers): an old tab asking for a script or card image from a previous deploy would
 * poison the URL, and the page would break if that exact file came back (a revert, a rollback).
 */
const FILE = /^\/assets\/|\.[a-z0-9]+$/i

export const onRequest: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url)
  const isPage = (request.method === 'GET' || request.method === 'HEAD') && !FILE.test(url.pathname)
  if (!isPage) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  return env.ASSETS.fetch(new Request(new URL('/', url), { method: request.method }))
}

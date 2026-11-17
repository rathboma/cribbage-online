/**
 * How the Worker serves the built files: everything under /assets/ has a content hash in its
 * name and may be cached for good; the page itself must not be, or a browser could keep
 * pointing at files from an old deploy. (Rules in public/_headers.)
 */
import { expect, test } from '@playwright/test'

test('built files are cached for good, and the page that lists them is not', async ({
  request,
}) => {
  const page = await request.get('/')
  expect(page.ok()).toBe(true)
  expect(page.headers()['cache-control'] ?? '').not.toContain('immutable')

  const script = (await page.text()).match(/\/assets\/[^"]+\.js/)?.[0]
  expect(script, 'index.html loads a script from /assets/').toBeTruthy()
  const asset = await request.get(script!)
  expect(asset.ok()).toBe(true)
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
})

test('a missing file is a 404 that is never cached, while a deep link loads the app', async ({
  request,
}) => {
  // An old tab asking for a script from a previous deploy must not get index.html: browsers
  // would keep it under that URL for a year.
  const missing = await request.get('/assets/index-0ldHash.js')
  expect(missing.status()).toBe(404)
  expect(missing.headers()['cache-control']).toBe('no-store')

  const deepLink = await request.get('/g/BCDFG')
  expect(deepLink.status()).toBe(200)
  expect(await deepLink.text()).toContain('<div id="app">')
})

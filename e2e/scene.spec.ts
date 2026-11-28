/**
 * The 3D table on its own, at the dev-only page /dev/table (served by a Vite dev server; see
 * the `scene` project in playwright.config.ts). Real WebGL in a real browser: what unit tests
 * with a stand-in renderer can't show.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const frames = async (page: Page) => Number(await page.getByTestId('frame-count').innerText())

/** Every console error and warning, and anything thrown: a clean run leaves it empty. */
function watchConsole(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    // The software renderer CI uses reports its own slowness; that is not the app's doing.
    if (/GL Driver Message|GPU stall/.test(text)) return
    if (message.type() === 'error' || message.type() === 'warning') problems.push(text)
  })
  page.on('pageerror', (error) => problems.push(String(error)))
  return problems
}

/** Opens /dev/table and waits for the table and, unless told not to, the card art. */
async function openTable(page: Page, { art = true, query = '' } = {}) {
  await page.goto(`/dev/table${query}`)
  await expect(page.getByTestId('webgl')).toHaveText('yes')
  await expect(page.getByTestId('table-ready')).toBeAttached()
  // The art arriving redraws the table, so tests that count frames wait for it.
  if (art)
    await expect(page.getByTestId('atlas-state')).toContainText('loaded', { timeout: 20_000 })
}

/**
 * Intercepts the card images (not the modules the dev server serves for them): `handle` decides
 * what happens to each.
 */
async function routeCardImages(page: Page, handle: (route: Route, url: string) => unknown) {
  await page.route(/\/assets\/cards\/[^/?]+\.(svg|png)/, (route) => {
    if (route.request().resourceType() !== 'image') return route.continue()
    return handle(route, route.request().url())
  })
}

/** The canvas fills its box, and its drawing buffer has the same shape (nothing stretched). */
async function expectUndistorted(page: Page) {
  const canvas = page.getByTestId('table-canvas')
  await expect(async () => {
    const shape = await canvas.evaluate((el: HTMLCanvasElement) => {
      const box = el.parentElement!.getBoundingClientRect()
      return {
        box: [box.width, box.height],
        css: [el.clientWidth, el.clientHeight],
        buffer: [el.width, el.height],
      }
    })
    const [boxW, boxH] = shape.box as [number, number]
    const [cssW, cssH] = shape.css as [number, number]
    const [bufW, bufH] = shape.buffer as [number, number]
    expect(Math.abs(cssW - boxW)).toBeLessThanOrEqual(1)
    expect(Math.abs(cssH - boxH)).toBeLessThanOrEqual(1)
    expect(bufW / bufH).toBeCloseTo(cssW / cssH, 1)
    const aspect = Number(await page.getByTestId('camera-aspect').innerText())
    expect(aspect).toBeCloseTo(cssW / cssH, 2)
  }).toPass({ timeout: 5_000 })
}

test.describe('3D table scene', () => {
  test('draws a table that fills its box, and nothing while idle', async ({ page }) => {
    const problems = watchConsole(page)
    await page.setViewportSize({ width: 390, height: 760 })
    await openTable(page)
    await expectUndistorted(page)

    // Give the first frames time to land, then watch: an idle table draws nothing.
    await page.waitForTimeout(300)
    const idle = await frames(page)
    expect(idle).toBeGreaterThan(0)
    await page.waitForTimeout(1_000)
    expect(await frames(page)).toBe(idle)
    expect(problems).toEqual([])
  })

  test('stays undistorted through resizes and a change of orientation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 })
    await openTable(page)
    for (const size of [
      { width: 760, height: 390 },
      { width: 1280, height: 720 },
      { width: 320, height: 568 },
    ]) {
      const before = await frames(page)
      await page.setViewportSize(size)
      await expect.poll(() => frames(page)).toBeGreaterThan(before)
      await expectUndistorted(page)
    }
  })

  test('draws frame after frame while something moves, then stops', async ({ page }) => {
    await openTable(page)
    const before = await frames(page)
    await page.getByTestId('animate').click()
    // Frames keep coming while the 750 ms move plays (how many depends on the machine)...
    await expect.poll(() => frames(page)).toBeGreaterThan(before + 2)
    await expect(page.getByTestId('animate')).toBeEnabled()
    // ...and stop once it has finished.
    const after = await frames(page)
    await page.waitForTimeout(500)
    expect(await frames(page)).toBe(after)
  })

  test('mounting and unmounting 20 times leaves nothing behind', async ({ page }) => {
    const problems = watchConsole(page)
    await openTable(page)
    // Keep hold of every WebGL context the page creates from here on. (Chrome reclaims the
    // contexts of canvases it has garbage-collected, so its own warning alone proves little.)
    await page.evaluate(() => {
      const contexts: WebGL2RenderingContext[] = []
      Object.assign(window, { __contexts: contexts })
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args) {
        const context = (original as (...a: unknown[]) => unknown).apply(this, args)
        if (context instanceof WebGL2RenderingContext && !contexts.includes(context)) {
          contexts.push(context)
        }
        return context
      } as typeof original
    })
    await page.getByTestId('remount-20').click()
    // Twenty WebGL contexts made and released: slow with software rendering on a busy machine.
    await expect(page.getByTestId('dispose-summary')).toContainText('20 clean of 20', {
      timeout: 30_000,
    })
    await expect(page.getByTestId('dispose-summary')).toContainText(
      '0 geometries, 0 textures, context released',
    )
    await expect(page.getByTestId('table-ready')).toBeAttached()
    await expect(page.locator('canvas')).toHaveCount(1)
    // 20 tables made a context each, and every one but the last has been handed back.
    const contexts = await page.evaluate(() => {
      const all = (window as unknown as { __contexts: WebGL2RenderingContext[] }).__contexts
      return { made: all.length, live: all.filter((gl) => !gl.isContextLost()).length }
    })
    expect(contexts).toEqual({ made: 20, live: 1 })

    // The table that is left still has its context and still draws.
    const canvas = page.getByTestId('table-canvas')
    expect(
      await canvas.evaluate((el: HTMLCanvasElement) => el.getContext('webgl2')?.isContextLost()),
    ).toBe(false)
    const before = await frames(page)
    await page.getByTestId('animate').click()
    await expect.poll(() => frames(page)).toBeGreaterThan(before)

    // Chrome warns "Too many active WebGL contexts" when contexts are not released.
    expect(problems).toEqual([])
  })

  test('unmounting releases the WebGL context', async ({ page }) => {
    await openTable(page)
    const context = await page
      .getByTestId('table-canvas')
      .evaluateHandle((el: HTMLCanvasElement) => el.getContext('webgl2')!)
    await page.getByTestId('toggle').click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(page.getByTestId('dispose-summary')).toContainText('1 clean of 1')
    expect(await context.evaluate((gl) => gl.isContextLost())).toBe(true)
  })

  test('stops while the WebGL context is lost and draws again once it is back', async ({
    page,
  }) => {
    await openTable(page)
    await page.getByTestId('lose-context').click()
    await expect(page.getByTestId('context-state')).toHaveText('lost')
    const lost = await frames(page)
    await page.getByTestId('animate').click()
    await page.waitForTimeout(300)
    expect(await frames(page)).toBe(lost)

    await page.getByTestId('restore-context').click()
    await expect(page.getByTestId('context-state')).toHaveText('ok')
    await expect.poll(() => frames(page)).toBeGreaterThan(lost)
  })

  test('unmounting while the context is lost is clean and quiet', async ({ page }) => {
    await openTable(page)
    await page.getByTestId('lose-context').click()
    await expect(page.getByTestId('context-state')).toHaveText('lost')
    const problems = watchConsole(page)
    await page.getByTestId('toggle').click()
    await expect(page.getByTestId('dispose-summary')).toContainText('1 clean of 1')
    expect(problems).toEqual([])
  })

  test('unmounting after the context came back is clean', async ({ page }) => {
    await openTable(page)
    await page.getByTestId('lose-context').click()
    await expect(page.getByTestId('context-state')).toHaveText('lost')
    await page.getByTestId('restore-context').click()
    await expect(page.getByTestId('context-state')).toHaveText('ok')
    const problems = watchConsole(page)
    await page.getByTestId('toggle').click()
    await expect(page.getByTestId('dispose-summary')).toContainText('1 clean of 1')
    // three.js still holds handles from before the loss and deletes them too, which WebGL
    // reports as harmless warnings: one per buffer, so with a table of cards Chrome stops
    // after a few dozen and says so. Anything else is a problem.
    const harmless = /object does not belong to this context|too many errors, no more errors/
    expect(problems.filter((p) => !harmless.test(p))).toEqual([])
  })

  test('a card face that fails to load keeps its stand-in, and nothing breaks', async ({
    page,
  }) => {
    const problems = watchConsole(page)
    await routeCardImages(page, (route, url) =>
      /\/KC\.png/.test(url) ? route.abort() : route.continue(),
    )
    await openTable(page)
    await expect(page.getByTestId('atlas-missing')).toHaveText('KC')
    await expect(page.getByTestId('card-stats')).toContainText('53 cards')
    const before = await frames(page)
    await page.getByTestId('animate').click()
    await expect.poll(() => frames(page)).toBeGreaterThan(before)
    await expect(page.getByTestId('animate')).toBeEnabled()
    // The browser reports the failed request; the app itself stays quiet.
    expect(problems.filter((p) => !/Failed to load resource/.test(p))).toEqual([])
  })

  test('the table can be used while the card art is still loading', async ({ page }) => {
    const held: Route[] = []
    await routeCardImages(page, (route) => void held.push(route))
    await openTable(page, { art: false })
    await expect(page.getByTestId('atlas-state')).toHaveText('loading')
    await expect(page.getByTestId('card-stats')).toContainText('53 cards')
    const before = await frames(page)
    await page.getByTestId('animate').click()
    await expect.poll(() => frames(page)).toBeGreaterThan(before + 2)
    await expect(page.getByTestId('animate')).toBeEnabled()

    // Once the art arrives the atlas is uploaded again and the table redrawn.
    await expect.poll(() => held.length).toBe(53)
    const loading = await frames(page)
    for (const route of held) await route.continue()
    await expect(page.getByTestId('atlas-state')).toHaveText('loaded', { timeout: 20_000 })
    await expect.poll(() => frames(page)).toBeGreaterThan(loading)
  })
})

test.describe('3D cards on a phone', () => {
  test.use({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })

  test('shows all 52 faces and the back from one texture and one material', async ({
    page,
  }, testInfo) => {
    const problems = watchConsole(page)
    await openTable(page)
    await expect(page.getByTestId('atlas-state')).toHaveText('loaded')
    await expect(page.getByTestId('card-stats')).toHaveText('53 cards, 1 material(s), 1 texture(s)')
    // On the GPU: the lamp's shadow map (a colour and a depth texture), the lookup table three.js
    // gives lit materials, and the card atlas. 53 cards add one texture between them.
    await expect(page.getByTestId('gpu-textures')).toHaveText('4')
    await page.waitForTimeout(300)
    await testInfo.attach('cards at 390 px', {
      body: await page.getByTestId('table-canvas').screenshot(),
      contentType: 'image/png',
    })
    expect(problems).toEqual([])
  })

  test('unmounting releases the atlas texture with everything else', async ({ page }) => {
    await openTable(page)
    await page.getByTestId('toggle').click()
    await expect(page.getByTestId('dispose-summary')).toContainText(
      '1 clean of 1 (last: 0 geometries, 0 textures, context released)',
    )
  })
})

/** The fixture hands on /dev/table, and how many cards (deck included) each puts on the table. */
const FIXTURES = [
  ['lobby', 1],
  ['deal', 13],
  ['discard', 13],
  ['cut', 13],
  ['play', 14],
  ['go', 14],
  ['show-1', 14],
  ['show-2', 14],
  ['show-3', 14],
  ['game-over', 14],
] as const

for (const { name, viewport, mode } of [
  { name: 'portrait', viewport: { width: 360, height: 640 }, mode: 'portrait' },
  { name: 'landscape', viewport: { width: 1440, height: 900 }, mode: 'landscape' },
]) {
  test.describe(`3D layouts, ${name}`, () => {
    test.use({ viewport, deviceScaleFactor: 1 })

    test('lays out every point of a hand, for both seats', async ({ page }, testInfo) => {
      const problems = watchConsole(page)
      // The controls hidden, so the table has the whole window, as it will in a game.
      await openTable(page, { query: '?fixture=deal&seat=0&controls=0' })
      for (const seat of ['0', '1']) {
        await page.getByTestId('seat').selectOption(seat, { force: true })
        for (const [fixture, cards] of FIXTURES) {
          await page.getByTestId('fixture').selectOption(fixture, { force: true })
          await expect(page.getByTestId('layout-mode')).toHaveText(mode)
          await expect(page.getByTestId('card-stats')).toHaveText(
            `${cards} cards, 1 material(s), 1 texture(s)`,
          )
          await expect(page).toHaveURL(new RegExp(`fixture=${fixture}&seat=${seat}`))
          await page.waitForTimeout(150)
          await testInfo.attach(`${fixture}, seat ${seat}`, {
            body: await page.getByTestId('table-canvas').screenshot(),
            contentType: 'image/png',
          })
        }
      }
      expect(problems).toEqual([])
    })
  })
}

test('switches arrangement when the window turns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openTable(page, { query: '?fixture=play&seat=0&controls=0' })
  await expect(page.getByTestId('layout-mode')).toHaveText('portrait')
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.getByTestId('layout-mode')).toHaveText('landscape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('layout-mode')).toHaveText('portrait')
})

test('goes back to the card gallery from a fixture', async ({ page }) => {
  await openTable(page, { query: '?fixture=show-3&seat=1' })
  await expect(page.getByTestId('card-stats')).toHaveText('14 cards, 1 material(s), 1 texture(s)')
  await page.getByTestId('fixture').selectOption('gallery')
  await expect(page.getByTestId('card-stats')).toHaveText('53 cards, 1 material(s), 1 texture(s)')
  await expect(page.getByTestId('layout-mode')).toHaveText('–')
  await expect(page).toHaveURL(/\/dev\/table$/)
})

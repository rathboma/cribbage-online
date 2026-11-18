/**
 * The 3D table on its own, at the dev-only page /dev/table (served by a Vite dev server; see
 * the `scene` project in playwright.config.ts). Real WebGL in a real browser: what unit tests
 * with a stand-in renderer can't show.
 */
import { expect, test, type Page } from '@playwright/test'

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

async function openTable(page: Page) {
  await page.goto('/dev/table')
  await expect(page.getByTestId('webgl')).toHaveText('yes')
  await expect(page.getByTestId('table-ready')).toBeAttached()
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
    // reports as harmless warnings. Anything else is a problem.
    expect(problems.filter((p) => !/object does not belong to this context/.test(p))).toEqual([])
  })
})

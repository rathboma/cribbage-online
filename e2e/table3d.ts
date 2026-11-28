/**
 * Playing on the 3D table in the end-to-end tests. The cards are drawn on a canvas, so there is
 * nothing to click by test id; instead the 3D table keeps a hidden list of the cards that take
 * input (`table-target`: which card, how it responds, and where its middle is drawn), and these
 * helpers tap the canvas there, with the mouse or a finger, as a player would. The HUD's
 * buttons are pressed by test id, as on the simple table.
 */
import { devices, expect, type Locator, type Page } from '@playwright/test'
import type { Player, Policy } from './table'

/** How a player presses things: a mouse on a desktop, or a finger on a phone. */
export type Input = 'mouse' | 'touch'

/** A phone held upright, for touch: Chromium's own emulation of a Pixel 7. */
export const PHONE = devices['Pixel 7']

/** A card on the 3D table that takes input, with where to tap it on the page. */
export interface TableTarget {
  key: string
  /** The card, or 'deck'. */
  card: string
  state: 'usable' | 'selected' | 'blocked' | 'idle'
  /** The middle of the card, in CSS pixels from the top left of the window. */
  x: number
  y: number
}

/**
 * The 3D table is on screen and laid out for the canvas as it is now (not as it was before a
 * resize: the hidden list says which size it was laid out for).
 */
export async function expectTable(page: Page): Promise<void> {
  await expect(page.getByTestId('table-canvas')).toBeVisible()
  await expect(async () => {
    const { size, laidOutFor } = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="table-canvas"]')
      const list = document.querySelector<HTMLElement>('[data-testid="table-targets"]')
      return {
        size: canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : null,
        laidOutFor: list?.dataset.size ?? null,
      }
    })
    expect(laidOutFor).toBe(size)
  }).toPass({ timeout: 10_000 })
}

/**
 * The cards laid in the play as this player's 3D table shows them: their own and their
 * opponent's, in the order laid; `*` marks one turned face down (from an earlier count).
 */
export function laidCards(page: Page): Promise<{ mine: string[]; theirs: string[] }> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="table-card"]'))
    const laid = (zone: string) =>
      cards
        .filter((el) => el.dataset.zone === zone)
        .map((el) => `${el.dataset.card ?? '?'}${el.dataset.faceUp === 'true' ? '' : '*'}`)
    return { mine: laid('my-played'), theirs: laid('opponent-played') }
  })
}

/** Every card that takes input, read in one look at the page. */
export function tableTargets(page: Page): Promise<TableTarget[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="table-canvas"]')
    const box = canvas?.getBoundingClientRect()
    if (!box) return []
    return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="table-target"]')).map(
      (el) => ({
        key: el.dataset.key!,
        card: el.dataset.card!,
        state: el.dataset.state as TableTarget['state'],
        x: box.left + Number(el.dataset.x),
        y: box.top + Number(el.dataset.y),
      }),
    )
  })
}

export function target(page: Page, card: string): Locator {
  return page.locator(`[data-testid="table-target"][data-card="${card}"]`)
}

/**
 * Where to tap `card` now, scrolled into the window first if need be (on a short screen the
 * page scrolls and the hand can be below the fold).
 */
export async function pointOf(page: Page, card: string): Promise<{ x: number; y: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const found = (await tableTargets(page)).find((t) => t.card === card)
    if (!found) throw new Error(`${card} is not on the table`)
    const height = await page.evaluate(() => window.innerHeight)
    if (found.y > 8 && found.y < height - 8) return found
    await page.evaluate((dy) => window.scrollBy(0, dy), found.y - height / 2)
  }
  throw new Error(`${card} could not be scrolled into view`)
}

/** Taps the canvas where `card` is drawn. */
export async function tapCard(page: Page, card: string, input: Input): Promise<void> {
  const { x, y } = await pointOf(page, card)
  if (input === 'touch') await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

export type Choice3d =
  { kind: 'press'; testId: string } | { kind: 'pick' | 'play' | 'cut'; card: string }

/**
 * What this player would do next on the 3D table, or null if there is nothing to do right now.
 * The deck is tapped to cut (not the HUD's Cut button), so that is tested too.
 */
export function nextChoice3d(page: Page, policy: Policy = 'lowest'): Promise<Choice3d | null> {
  return page.evaluate((policy): Choice3d | null => {
    const one = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    const enabled = (el: HTMLElement | null): el is HTMLElement =>
      !!el && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true'
    const game = one('game')
    if (!game) return null
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="table-target"]'),
    ).map((el) => ({ card: el.dataset.card!, state: el.dataset.state! }))
    if (targets.some((t) => t.card === 'deck' && t.state === 'usable')) {
      return { kind: 'cut', card: 'deck' }
    }
    for (const testId of ['action-ready', 'action-go']) {
      if (enabled(one(testId))) return { kind: 'press', testId }
    }
    const send = one('action-discard')
    if (send) {
      if (send.getAttribute('aria-disabled') === 'true') return null // on its way
      if (enabled(send)) return { kind: 'press', testId: 'action-discard' }
      const pick = targets.find((t) => t.state === 'usable')
      return pick ? { kind: 'pick', card: pick.card } : null
    }
    if (game.dataset.phase !== 'play') return null
    // In the order of the hand, which is sorted by rank: the last playable card is the highest.
    const playable = targets.filter((t) => t.state === 'usable' && t.card !== 'deck')
    const card = policy === 'highest' ? playable.at(-1) : playable[0]
    return card ? { kind: 'play', card: card.card } : null
  }, policy)
}

/** Makes this player's next move on the 3D table and waits for it to take effect. */
export async function move3d(
  player: Player,
  input: Input,
  policy: Policy = 'lowest',
): Promise<Choice3d | null> {
  const { page } = player
  const choice = await nextChoice3d(page, policy)
  if (!choice) return null
  if (choice.kind === 'press') {
    const button = page.getByTestId(choice.testId)
    if (input === 'touch') await button.tap()
    else await button.click()
    await expect(button).toHaveCount(0)
    return choice
  }
  await tapCard(page, choice.card, input)
  if (choice.kind === 'pick')
    await expect(target(page, choice.card)).toHaveAttribute('data-state', 'selected')
  else await expect(target(page, choice.card)).toHaveCount(0)
  return choice
}

/**
 * Both players keep making whatever move the 3D table and the HUD offer until `until` says
 * so, each with their own way of pressing. Fails if the game stops moving.
 */
export async function play3d(
  players: readonly { player: Player; input: Input }[],
  options: {
    until: () => Promise<boolean>
    policy?: Policy
    afterMove?: (by: Player, choice: Choice3d) => Promise<void>
    stuckAfterMs?: number
  },
): Promise<void> {
  const stuckAfterMs = options.stuckAfterMs ?? 30_000
  let lastMove = Date.now()
  for (;;) {
    if (await options.until()) return
    let moved = false
    for (const { player, input } of players) {
      const choice = await move3d(player, input, options.policy)
      if (!choice) continue
      moved = true
      await options.afterMove?.(player, choice)
    }
    if (moved) lastMove = Date.now()
    else {
      expect(Date.now() - lastMove, 'nobody could move: the game is stuck').toBeLessThan(
        stuckAfterMs,
      )
      await players[0]?.player.page.waitForTimeout(100)
    }
  }
}

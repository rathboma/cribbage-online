import { expect, test, type Page } from '@playwright/test'
import { expectSameTable, handNumber, nextChoice, seatTwoPlayers } from './table'

/** What has keyboard focus: its data-testid, its card, and whether pressing it would do anything. */
function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    return {
      testId: el.dataset.testid ?? null,
      card: el.dataset.card ?? null,
      enabled: !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true',
    }
  })
}

/**
 * Makes the player's next move with Tab and Enter/Space only. Returns false when there was
 * nothing to do.
 */
async function keyboardMove(page: Page, key: 'Enter' | 'Space'): Promise<boolean> {
  const choice = await nextChoice(page)
  if (!choice) return false
  // Tab through the page until the wanted control has focus (the page wraps around).
  for (let presses = 0; presses < 60; presses++) {
    const at = await focused(page)
    const onIt =
      at?.enabled && at.testId === choice.testId && (!choice.card || at.card === choice.card)
    if (onIt) {
      await page.keyboard.press(key)
      return true
    }
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${choice.testId} ${choice.card ?? ''}`)
}

test('a whole hand can be played with the keyboard alone', async ({ browser }) => {
  const { host, guest } = await seatTwoPlayers(browser)
  let moves = 0
  let lastMove = Date.now()
  let playedByKeyboard = 0

  while ((await handNumber(host.page)) < 2 || (await handNumber(guest.page)) < 2) {
    let moved = false
    for (const player of [host, guest]) {
      const choice = await nextChoice(player.page)
      if (!choice) continue
      const discarding = (await player.page.getByTestId('action-discard').count()) > 0
      // Alternate the two keys a button answers to.
      if (!(await keyboardMove(player.page, moves % 2 ? 'Enter' : 'Space'))) continue
      moved = true
      moves++
      if (choice.card && !discarding) {
        // The card leaves the hand. (A key press that comes straight after the last card left
        // is taken for a double press and ignored, so the card may still be there: the loop
        // comes round again.)
        const played = player.page.locator(`[data-testid="hand-card"][data-card="${choice.card}"]`)
        const gone = await played
          .waitFor({ state: 'detached', timeout: 2_000 })
          .then(() => true)
          .catch(() => false)
        if (!gone) continue
        playedByKeyboard++
        // Focus is on one of the cards that remain, so the next one is a key press away (not
        // back at the top of the page).
        if ((await player.page.getByTestId('hand-card').count()) > 0) {
          expect((await focused(player.page))?.testId).toBe('hand-card')
        }
      }
    }
    if (moved) lastMove = Date.now()
    else {
      expect(Date.now() - lastMove, 'nobody could move: the game is stuck').toBeLessThan(30_000)
      await host.page.waitForTimeout(100)
    }
  }

  expect(playedByKeyboard).toBe(8)
  const table = await expectSameTable(host, guest)
  expect(table.phase).toBe('discard')
  expect(table.hand).toBe('2')
})

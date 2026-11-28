/**
 * The 3D table in a real game: two browsers against the built Worker, as in game.spec.ts, but
 * playing on the canvas. Cards are tapped where they are drawn (see table3d.ts), with a mouse
 * on a desktop or a finger on an emulated phone.
 */
import { expect, test, type Page, type Route } from '@playwright/test'
import {
  expectNoErrors,
  expectSameTable,
  handNumber,
  joinByLink,
  move,
  newPlayer,
  phase,
  seatTwoPlayers,
  startGame,
  type Player,
} from './table'
import {
  PHONE,
  expectTable,
  laidCards,
  move3d,
  nextChoice3d,
  play3d,
  tableTargets,
  tapCard,
  target,
  type Input,
} from './table3d'

const DESKTOP_3D = { view: '3d' } as const
const PHONE_3D = { view: '3d', context: PHONE } as const

/** The cards in this player's hand on the 3D table. */
async function handOnTable(page: Page): Promise<string[]> {
  return (await tableTargets(page)).filter((t) => t.card !== 'deck').map((t) => t.card)
}

/**
 * Plays on until `player` (on the 3D table) has a card to lay, making their other moves
 * (discards, the cut, a go) on the way, while the other player moves on the simple table.
 */
async function untilCardToPlay(player: Player, input: Input, other: Player) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const choice = await nextChoice3d(player.page)
    if (choice?.kind === 'play') return
    const moved = choice ? await move3d(player, input) : null
    if (!moved && !(await move(other.page))) await player.page.waitForTimeout(100)
  }
  throw new Error(`${player.name} never had a card to lay`)
}

test('the 3D table loads, and a card is played by tapping it', async ({ browser }) => {
  const { host, guest } = await seatTwoPlayers(browser, { host: DESKTOP_3D })
  await expectTable(host.page)
  await expect(host.page.getByTestId('dom-table')).toHaveCount(0)
  await expect(guest.page.getByTestId('dom-table')).toBeVisible()
  // Under a finger on the table, the page neither scrolls nor zooms.
  for (const testId of ['table-canvas', 'table-hole']) {
    const touchAction = await host.page
      .getByTestId(testId)
      .evaluate((el) => getComputedStyle(el).touchAction)
    expect(touchAction, testId).toBe('none')
  }

  await untilCardToPlay(host, 'mouse', guest)
  const [card] = (await tableTargets(host.page)).filter((t) => t.state === 'usable')
  await tapCard(host.page, card!.card, 'mouse')
  await expect(target(host.page, card!.card)).toHaveCount(0)
  // It is on the table for the other player too.
  await expect(
    guest.page.locator(
      `[data-testid="played-0"] [data-testid="laid-card"][data-card="${card!.card}"]`,
    ),
  ).toHaveCount(1)
  await expectNoErrors(host, guest)
})

test('a double tap on a card lays it once', async ({ browser }) => {
  const { host, guest } = await seatTwoPlayers(browser, { guest: PHONE_3D })
  await expectTable(guest.page)
  await untilCardToPlay(guest, 'touch', host)
  const actions: string[] = []
  guest.page.on('request', (request) => {
    if (request.method() === 'POST' && /\/actions$/.test(request.url())) actions.push(request.url())
  })
  const before = await handOnTable(guest.page)
  const [card] = (await tableTargets(guest.page)).filter((t) => t.state === 'usable')
  // Two taps in quick succession on the same spot: once the first card has gone, the second
  // would land on the one that took its place.
  await guest.page.touchscreen.tap(card!.x, card!.y)
  await guest.page.touchscreen.tap(card!.x, card!.y)
  await expect(target(guest.page, card!.card)).toHaveCount(0)
  await guest.page.waitForTimeout(1_000)
  expect(actions).toHaveLength(1)
  expect(await handOnTable(guest.page)).toEqual(before.filter((c) => c !== card!.card))
  await expectNoErrors(host, guest)
})

test('tapping the middle of each card picks that card, at phone, tablet and desktop sizes', async ({
  browser,
}) => {
  const { host, guest } = await seatTwoPlayers(browser, {
    host: PHONE_3D,
    guest: DESKTOP_3D,
  })
  const sizes: [Player, Input, { width: number; height: number }[]][] = [
    [
      host,
      'touch',
      [
        { width: 412, height: 839 },
        { width: 320, height: 568 },
        { width: 360, height: 740 },
        { width: 844, height: 390 },
      ],
    ],
    [
      guest,
      'mouse',
      [
        { width: 768, height: 1024 },
        { width: 1024, height: 768 },
        { width: 1280, height: 720 },
        { width: 1920, height: 1080 },
      ],
    ],
  ]
  for (const [player, input, viewports] of sizes) {
    const { page } = player
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.evaluate(() => window.scrollTo(0, 0))
      await expectTable(page)
      // A screen too short for the game scrolls, and a drag on the table may scroll it then.
      const touchAction = viewport.height <= 480 ? 'pan-y' : 'none'
      for (const testId of ['table-canvas', 'table-hole']) {
        const actual = await page
          .getByTestId(testId)
          .evaluate((el) => getComputedStyle(el).touchAction)
        expect(actual, `${testId} at ${viewport.width}×${viewport.height}`).toBe(touchAction)
      }
      const hand = await handOnTable(page)
      expect(hand).toHaveLength(6)
      for (const card of hand) {
        const where = `${card} at ${viewport.width}×${viewport.height} (${input})`
        await tapCard(page, card, input)
        await expect(target(page, card), where).toHaveAttribute('data-state', 'selected')
        // That card and no other.
        const picked = (await tableTargets(page)).filter((t) => t.state === 'selected')
        expect(
          picked.map((t) => t.card),
          where,
        ).toEqual([card])
        await tapCard(page, card, input)
        await expect(target(page, card), where).toHaveAttribute('data-state', 'usable')
      }
    }
  }
  await expectNoErrors(host, guest)
})

test('the simple table: the menu switch, ?view=2d, kept through reloads and navigation', async ({
  browser,
}) => {
  const { host, code } = await seatTwoPlayers(browser, { host: DESKTOP_3D })
  const page = host.page
  await expectTable(page)

  const toggle = page.getByTestId('view-switch').getByRole('switch')
  await page.getByTestId('game-menu').click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(page.getByTestId('dom-table')).toBeVisible()
  await expect(page.getByTestId('table-canvas')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('dom-table')).toBeVisible()
  await page.goto('/')
  await page.goto(`/g/${code}`)
  await expect(page.getByTestId('dom-table')).toBeVisible()
  await expect(page.getByTestId('table-canvas')).toHaveCount(0)

  // Back to 3D, and that is kept too.
  await page.getByTestId('game-menu').click()
  await toggle.click()
  await expectTable(page)
  await page.reload()
  await expectTable(page)

  // ?view=2d chooses the simple table, and leaves the URL.
  await page.goto(`/g/${code}?view=2d`)
  await expect(page.getByTestId('dom-table')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/g/${code}$`))
  await page.reload()
  await expect(page.getByTestId('dom-table')).toBeVisible()
  await page.getByTestId('game-menu').click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expectNoErrors(host)
})

test('while the 3D table downloads it says so, and if it never comes the simple table does', async ({
  browser,
}) => {
  const host = await newPlayer(browser, 'Ada', DESKTOP_3D)
  const guest = await newPlayer(browser, 'Sam')
  // The 3D table's code (three.js and all) is held back, then fails.
  const held: Route[] = []
  let fail = false
  await host.context.route(/\/assets\/ThreeTable-[^/]+\.js$/, (route) =>
    fail ? route.abort() : void held.push(route),
  )
  const code = await startGame(host)
  await joinByLink(guest, code)
  await expect(host.page.getByTestId('game')).toHaveAttribute('data-phase', 'discard')
  await expect(host.page.getByTestId('table-loading')).toBeVisible()
  // The HUD works meanwhile.
  await expect(host.page.getByTestId('action-discard')).toBeVisible()

  fail = true
  for (const route of held) await route.abort()
  await expect(host.page.getByTestId('dom-table')).toBeVisible()
  await expect(host.page.getByTestId('table-loading')).toHaveCount(0)
  await expect(host.page.locator('[data-testid="toast"][data-kind="info"]')).toHaveCount(1)
  // Nothing to choose for the rest of this visit; the game goes on, on the simple table.
  await expect(host.page.getByTestId('game-menu')).toHaveCount(0)
  expect(await move(host.page)).not.toBeNull()
  // The failed download is all that went wrong.
  expect(
    host.errors.filter((e) => !/Failed to load|ThreeTable|dynamically imported/i.test(e)),
  ).toEqual([])
})

test('without WebGL the simple table is shown, with no switch', async ({ browser }) => {
  const { host, guest } = await seatTwoPlayers(browser, {
    host: { view: '3d', webgl: false },
    guest: { view: '3d', context: PHONE, webgl: false },
  })
  for (const player of [host, guest]) {
    await expect(player.page.getByTestId('dom-table')).toBeVisible()
    await expect(player.page.getByTestId('table-canvas')).toHaveCount(0)
    await expect(player.page.getByTestId('game-menu')).toHaveCount(0)
  }
  await expectNoErrors(host, guest)
})

/**
 * Presses Tab until the element with this test id has focus (40 presses at most), checking at
 * every step that the canvas never takes it. Returns the test ids focused on the way.
 */
async function tabUntil(page: Page, testId: string): Promise<(string | null)[]> {
  const seen: (string | null)[] = []
  for (let presses = 0; presses < 40; presses++) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return { tag: el?.tagName ?? null, testId: el?.dataset.testid ?? null }
    })
    expect(focused.tag, 'the canvas took focus').not.toBe('CANVAS')
    seen.push(focused.testId)
    if (focused.testId === testId) break
  }
  return seen
}

test('the canvas never takes keyboard focus, and the HUD buttons can be reached', async ({
  browser,
}) => {
  const { host } = await seatTwoPlayers(browser, { host: DESKTOP_3D })
  const page = host.page
  await expectTable(page)
  // Two cards picked on the table, then Send to crib from the keyboard.
  const [a, b] = await handOnTable(page)
  for (const card of [a!, b!]) {
    await tapCard(page, card, 'mouse')
    await expect(target(page, card)).toHaveAttribute('data-state', 'selected')
  }
  // Tab from where the click left off to Send to crib, and press it.
  const toSend = await tabUntil(page, 'action-discard')
  expect(toSend.at(-1)).toBe('action-discard')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('action-discard')).toHaveCount(0)
  expect(await handOnTable(page)).toHaveLength(4)
  // Tabbing on goes round the whole page and back to the top: nothing holds on to focus. On the
  // way, the way to the simple table for keyboard players.
  const round = await tabUntil(page, 'game-menu')
  expect(round.at(-1)).toBe('game-menu')
  const again = await tabUntil(page, 'use-simple-table')
  expect(again.at(-1)).toBe('use-simple-table')

  // The way to the simple table shows itself when it has focus, and works.
  const simple = page.getByTestId('use-simple-table')
  await simple.focus()
  await expect(simple).toBeVisible()
  expect((await simple.boundingBox())!.width).toBeGreaterThan(100)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('dom-table')).toBeVisible()
  await expectNoErrors(host)
})

test(
  'a whole game in 3D: one player with a mouse, the other by touch on a phone',
  { tag: '@slow' },
  async ({ browser }) => {
    test.slow()
    const { host, guest } = await seatTwoPlayers(browser, {
      host: DESKTOP_3D,
      guest: PHONE_3D,
    })
    await expectTable(host.page)
    await expectTable(guest.page)
    const kinds = new Set<string>()
    let hands = 0
    await play3d(
      [
        { player: host, input: 'mouse' },
        { player: guest, input: 'touch' },
      ],
      {
        until: async () =>
          (await phase(host.page)) === 'game_over' && (await phase(guest.page)) === 'game_over',
        afterMove: async (_by, choice) => {
          kinds.add(choice.kind === 'press' ? choice.testId : choice.kind)
          if (choice.kind === 'play') {
            // Every card laid is on both tables, in the same place, face up. (The HUD can't
            // show this, and the simple table, which expectSameTable reads, isn't there.)
            await expect(async () => {
              const [a, b] = [await laidCards(host.page), await laidCards(guest.page)]
              expect(a.mine).toEqual(b.theirs)
              expect(a.theirs).toEqual(b.mine)
            }).toPass({ timeout: 20_000 })
          }
          if (choice.kind !== 'press' || choice.testId !== 'action-ready') return
          const [a, b] = [await handNumber(host.page), await handNumber(guest.page)]
          if (a === b && a > hands) {
            hands = a
            await expectSameTable(host, guest)
          }
        },
      },
    )
    for (const kind of ['pick', 'action-discard', 'cut', 'play', 'action-ready']) {
      expect(kinds, `${kind} never happened`).toContain(kind)
    }
    const final = await expectSameTable(host, guest)
    expect(final.winner).toMatch(/^[01]$/)
    expect(final.scores[Number(final.winner)]).toBe('121')
    for (const player of [host, guest]) {
      await expect(player.page.getByTestId('game-over')).toBeVisible()
      expect(await handOnTable(player.page)).toEqual([])
    }
    await expectNoErrors(host, guest)
  },
)

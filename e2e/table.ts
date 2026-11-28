/**
 * What the end-to-end tests do at the table: start and join a game the way two people would,
 * read what both screens show, and make moves through the controls the UI offers.
 * Everything is found by data-testid, never by wording or layout.
 */
import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test'
import { GAME_CODE_ALPHABET, GAME_CODE_LENGTH } from '../shared/protocol/gameCode'

export const CODE_PATTERN = new RegExp(`^[${GAME_CODE_ALPHABET}]{${GAME_CODE_LENGTH}}$`)

export interface Player {
  name: string
  context: BrowserContext
  page: Page
  /**
   * Everything that went wrong in this player's browser: console errors (a request the server
   * refused is one) and uncaught exceptions. A clean game leaves it empty.
   */
  errors: string[]
}

/** Where the game keeps the choice of table (src/composables/useTableView.ts). */
const VIEW_STORAGE_KEY = 'cribbage:view'

export interface PlayerOptions {
  /**
   * The table this player starts with. The simple one by default: the tests drive it through
   * its buttons. The choice is only made when the browser has none, so a test can change it
   * (the game menu) and see it kept after a reload.
   */
  view?: '2d' | '3d'
  /** For the browser profile: a phone to emulate, say. */
  context?: BrowserContextOptions
  /** false: a browser without WebGL 2, as some old or locked-down ones are. */
  webgl?: boolean
}

/** A person with their own browser profile (their own localStorage, so their own seat). */
export async function newPlayer(
  browser: Browser,
  name: string,
  options: PlayerOptions = {},
): Promise<Player> {
  const context = await browser.newContext(options.context)
  await context.addInitScript(
    ([key, view]) => {
      try {
        if (!localStorage.getItem(key)) localStorage.setItem(key, view)
      } catch {
        // A page with no storage (about:blank): nothing to choose.
      }
    },
    [VIEW_STORAGE_KEY, options.view ?? '2d'] as const,
  )
  if (options.webgl === false) {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'WebGL2RenderingContext', { value: undefined })
    })
  }
  const page = await context.newPage()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return { name, context, page, errors }
}

/** Nothing was refused, nothing threw, and no error message is on either screen. */
export async function expectNoErrors(...players: Player[]): Promise<void> {
  for (const player of players) {
    expect(player.errors, `${player.name}'s browser reported errors`).toEqual([])
    await expect(player.page.locator('[data-testid="toast"][data-kind="error"]')).toHaveCount(0)
  }
}

/**
 * Host: landing page, Start game, the chat and video choices, a name, Start. Returns the code
 * to share. Chat is on and video off unless asked otherwise (the form's defaults).
 */
export async function startGame(
  host: Player,
  options: { chat?: boolean; video?: boolean } = {},
): Promise<string> {
  await host.page.goto('/')
  await host.page.getByTestId('start-game').click()
  const wanted = { 'chat-toggle': options.chat ?? true, 'video-toggle': options.video ?? false }
  for (const [testId, on] of Object.entries(wanted)) {
    const toggle = host.page.getByTestId(testId).getByRole('switch')
    if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', String(on))
  }
  await host.page.getByTestId('name-input').fill(host.name)
  await host.page.getByTestId('start-submit').click()
  const code = (await host.page.getByTestId('game-code').innerText()).trim()
  expect(code).toMatch(CODE_PATTERN)
  return code
}

/** Guest: opens the share link, enters a name, joins. */
export async function joinByLink(guest: Player, code: string): Promise<void> {
  await guest.page.goto(`/j/${code}`)
  await guest.page.getByTestId('name-input').fill(guest.name)
  await guest.page.getByTestId('join-submit').click()
  await expect(guest.page).toHaveURL(new RegExp(`/g/${code}$`))
}

/** Two players at a table with the first hand dealt. */
export async function seatTwoPlayers(
  browser: Browser,
  options: { host?: PlayerOptions; guest?: PlayerOptions } = {},
): Promise<{ host: Player; guest: Player; code: string }> {
  const host = await newPlayer(browser, 'Ada', options.host)
  const guest = await newPlayer(browser, 'Sam', options.guest)
  const code = await startGame(host)
  await joinByLink(guest, code)
  for (const player of [host, guest]) {
    await expect(player.page.getByTestId('game')).toHaveAttribute('data-phase', 'discard')
  }
  return { host, guest, code }
}

export async function phase(page: Page): Promise<string | null> {
  return page.getByTestId('game').getAttribute('data-phase')
}

export async function handNumber(page: Page): Promise<number> {
  return Number(await page.getByTestId('game').getAttribute('data-hand'))
}

/** Everything both players can see, read from one screen. Two synced screens give the same. */
export interface PublicTable {
  phase: string | null
  hand: string | null
  scores: (string | null)[]
  dealer: string | null
  count: string | null
  starter: string | null
  cribCount: string | null
  /** Cards laid by each seat, in order; `*` marks a card from an earlier count. */
  played: string[][]
  /** Totals of the hands counted in the show, in counting order. */
  showTotals: (string | null)[]
  winner: string | null
}

export function publicTable(page: Page): Promise<PublicTable> {
  return page.evaluate(() => {
    const one = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    const all = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
    const text = (id: string) => one(id)?.textContent?.trim() ?? null
    const laid = (seat: number) =>
      all(`[data-testid="played-${seat}"] [data-testid="laid-card"]`).map(
        (el) => `${el.dataset.card}${el.dataset.turned === 'true' ? '*' : ''}`,
      )
    const game = one('game')
    return {
      phase: game?.dataset.phase ?? null,
      hand: game?.dataset.hand ?? null,
      scores: [text('score-0'), text('score-1')],
      dealer: one('dealer-0') ? '0' : one('dealer-1') ? '1' : null,
      count: text('count'),
      starter: one('starter')?.dataset.card ?? null,
      cribCount: one('crib')?.dataset.count ?? null,
      played: [laid(0), laid(1)],
      showTotals: all('[data-testid="show-total"]').map((el) => el.dataset.total ?? null),
      winner: one('winner')?.dataset.winner ?? null,
    }
  })
}

/** Waits until both screens show the same table (the slower one has polled), and returns it. */
export async function expectSameTable(a: Player, b: Player): Promise<PublicTable> {
  let table: PublicTable | undefined
  await expect(async () => {
    table = await publicTable(a.page)
    expect(await publicTable(b.page)).toEqual(table)
  }).toPass({ timeout: 20_000 })
  return table as PublicTable
}

/** Which card to play when several are legal. */
export type Policy = 'lowest' | 'highest'

export interface Choice {
  /** The data-testid of the control to press. */
  testId: string
  /** For a card in the hand: which one. */
  card?: string
  /** pick: choose a card for the crib. play: lay a card. press: one of the buttons. */
  kind: 'pick' | 'play' | 'press'
}

/**
 * The control this player would press next, or null if there is nothing to do right now (not
 * their turn, or the table is not taking input: a move is on its way, the hand has just
 * changed). Decided in one look at the page. Controls named in `leave` are never chosen.
 */
export function nextChoice(
  page: Page,
  policy: Policy = 'lowest',
  leave: readonly string[] = [],
): Promise<Choice | null> {
  return page.evaluate(
    ({ policy, leave }): Choice | null => {
      const one = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
      const enabled = (el: HTMLElement | null): el is HTMLElement =>
        !!el && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true'
      const game = one('game')
      if (!game) return null
      for (const testId of ['action-ready', 'action-cut', 'action-go']) {
        if (!leave.includes(testId) && enabled(one(testId))) return { testId, kind: 'press' }
      }
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="hand-card"]'))
      const send = one('action-discard')
      if (send) {
        if (send.getAttribute('aria-disabled') === 'true') return null // on its way
        if (enabled(send)) return { testId: 'action-discard', kind: 'press' }
        const pick = cards.find((c) => c.getAttribute('aria-pressed') === 'false' && enabled(c))
        return pick ? { testId: 'hand-card', card: pick.dataset.card, kind: 'pick' } : null
      }
      if (game.dataset.phase !== 'play') return null
      // The hand is sorted by rank, so the last playable card is the highest.
      const playable = cards.filter(enabled)
      const card = policy === 'highest' ? playable.at(-1) : playable[0]
      return card ? { testId: 'hand-card', card: card.dataset.card, kind: 'play' } : null
    },
    { policy, leave: [...leave] },
  )
}

export function control(page: Page, choice: Choice) {
  return choice.card
    ? page.locator(`[data-testid="hand-card"][data-card="${choice.card}"]`)
    : page.getByTestId(choice.testId)
}

/**
 * What a press must lead to: a picked card is marked as picked; a played card leaves the hand;
 * a pressed button goes away once the server has answered. A control that looks usable but
 * does nothing fails here, at the press that did nothing.
 */
export async function expectEffect(page: Page, choice: Choice): Promise<void> {
  const target = control(page, choice)
  if (choice.kind === 'pick') await expect(target).toHaveAttribute('aria-pressed', 'true')
  else await expect(target).toHaveCount(0)
}

/**
 * Makes this player's next move with a real click, if they have one, and waits for it to take
 * effect. Returns what was pressed.
 */
export async function move(
  page: Page,
  policy: Policy = 'lowest',
  leave: readonly string[] = [],
): Promise<Choice | null> {
  const choice = await nextChoice(page, policy, leave)
  if (!choice) return null
  await control(page, choice).click()
  await expectEffect(page, choice)
  return choice
}

/**
 * Both players keep making whatever move the UI offers until `done` says so. `afterMove` runs
 * after every move (to compare the two screens, say). Fails if the game stops moving.
 */
export async function play(
  players: readonly Player[],
  options: {
    until: () => Promise<boolean>
    policy?: Policy
    /**
     * Controls (by data-testid) this loop must not press. A test that wants to look at a
     * state before acting on it - a player who has to say Go, say - leaves that control
     * alone here: the play then stops when it is the only move left, and `until` sees it.
     */
    leave?: readonly string[]
    afterMove?: (by: Player, choice: Choice) => Promise<void>
    /** Give up when nobody has been able to move for this long. */
    stuckAfterMs?: number
  },
): Promise<void> {
  const stuckAfterMs = options.stuckAfterMs ?? 30_000
  let lastMove = Date.now()
  for (;;) {
    if (await options.until()) return
    let moved = false
    for (const player of players) {
      const choice = await move(player.page, options.policy, options.leave)
      if (!choice) continue
      moved = true
      await options.afterMove?.(player, choice)
    }
    if (moved) lastMove = Date.now()
    else {
      expect(Date.now() - lastMove, 'nobody could move: the game is stuck').toBeLessThan(
        stuckAfterMs,
      )
      // Waiting for the other screen's next poll, or for the table to take input again.
      await players[0]?.page.waitForTimeout(100)
    }
  }
}

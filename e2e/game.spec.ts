import { expect, test } from '@playwright/test'
import {
  CODE_PATTERN,
  expectSameTable,
  handNumber,
  newPlayer,
  nextChoice,
  phase,
  play,
  publicTable,
  seatTwoPlayers,
} from './table'

test('one player starts a game, the other joins with the link, and they play a hand', async ({
  browser,
}) => {
  const host = await newPlayer(browser, 'Ada')
  const guest = await newPlayer(browser, 'Sam')

  // Host: landing page, Start game, chat on and video off (the defaults), a name, Start.
  await host.page.goto('/')
  await host.page.getByTestId('start-game').click()
  await expect(host.page).toHaveURL(/\/new$/)
  const chat = host.page.getByTestId('chat-toggle').getByRole('switch')
  const video = host.page.getByTestId('video-toggle').getByRole('switch')
  await expect(chat).toHaveAttribute('aria-checked', 'true')
  await expect(video).toHaveAttribute('aria-checked', 'false')
  await host.page.getByTestId('name-input').fill(host.name)
  await host.page.getByTestId('start-submit').click()

  // A five-letter code to share, and a link that carries it.
  const code = (await host.page.getByTestId('game-code').innerText()).trim()
  expect(code).toMatch(CODE_PATTERN)
  await expect(host.page).toHaveURL(new RegExp(`/g/${code}$`))
  await expect(host.page.getByTestId('join-link')).toHaveAttribute(
    'href',
    new RegExp(`/j/${code}$`),
  )

  // Refreshing the waiting room keeps the host in the same game.
  await host.page.reload()
  await expect(host.page.getByTestId('game-code')).toHaveText(code)

  // Guest: the share link asks only for a name, and shows whose game it is and their choices.
  await guest.page.goto(`/j/${code}`)
  await expect(guest.page.getByTestId('host-name')).toHaveText(host.name)
  const settings = guest.page.getByTestId('host-settings')
  await expect(settings).toHaveAttribute('data-chat', 'on')
  await expect(settings).toHaveAttribute('data-video', 'off')
  await expect(guest.page.getByTestId('code-input')).toHaveCount(0)
  await guest.page.getByTestId('name-input').fill(guest.name)
  await guest.page.getByTestId('join-submit').click()
  await expect(guest.page).toHaveURL(new RegExp(`/g/${code}$`))

  // The host's screen switches to the game by itself; both are dealt six cards.
  for (const player of [host, guest]) {
    await expect(player.page.getByTestId('game')).toHaveAttribute('data-phase', 'discard')
    await expect(player.page.getByTestId('hand-card')).toHaveCount(6)
    await expect(player.page.getByTestId('opponent-count')).toHaveAttribute('data-count', '6')
  }
  await expect(host.page.getByTestId('player-0')).toContainText(host.name)
  await expect(host.page.getByTestId('player-1')).toContainText(guest.name)

  // One whole hand - discard, cut, the play, the show, Next hand - pressing only what the UI
  // offers. After every move the two screens must agree on everything both can see.
  const seen = new Set<string>()
  const pressed = new Set<string>()
  await play([host, guest], {
    until: async () => (await handNumber(host.page)) === 2 && (await handNumber(guest.page)) === 2,
    afterMove: async (_by, choice) => {
      pressed.add(choice.testId)
      const table = await expectSameTable(host, guest)
      if (table.phase) seen.add(table.phase)
    },
  })
  expect([...seen].sort()).toEqual(['cut', 'discard', 'play', 'show'])
  for (const testId of ['hand-card', 'action-discard', 'action-cut', 'action-ready']) {
    expect(pressed, `${testId} was never pressed`).toContain(testId)
  }

  // The deal passed, the scores carried over and a fresh hand is dealt.
  const table = await expectSameTable(host, guest)
  expect(table.phase).toBe('discard')
  for (const player of [host, guest]) {
    await expect(player.page.getByTestId('hand-card')).toHaveCount(6)
  }
})

test('the dealer changes and the scores add up from hand to hand', async ({ browser }) => {
  const { host, guest } = await seatTwoPlayers(browser)
  const first = await expectSameTable(host, guest)
  expect(first.scores).toEqual(['0', '0'])

  // Up to the first show: every hand counted there has its total on both screens.
  await play([host, guest], {
    until: async () => (await phase(host.page)) === 'show' && (await phase(guest.page)) === 'show',
  })
  const shown = await expectSameTable(host, guest)
  expect(shown.showTotals).toHaveLength(3)
  await expect(host.page.getByTestId('show-hand')).toHaveCount(3)
  const scores = shown.scores.map(Number)
  const counted = shown.showTotals.map(Number).reduce((a, b) => a + b, 0)
  // Everything scored so far is the three counted hands plus the pegging, and the pegging is
  // never nothing: the last card of the hand always scores.
  expect(scores[0]! + scores[1]!).toBeGreaterThan(counted)

  await play([host, guest], {
    until: async () => (await handNumber(host.page)) === 2 && (await handNumber(guest.page)) === 2,
  })
  const second = await expectSameTable(host, guest)
  expect(second.scores).toEqual(shown.scores)
  expect(second.dealer).not.toBe(first.dealer)
})

test('a player who cannot play says Go, and the hand carries on', async ({ browser }) => {
  const { host, guest } = await seatTwoPlayers(browser)
  /** The player who has an enabled Go button, if either does. */
  const stuckPlayer = async () => {
    for (const player of [host, guest]) {
      const go = player.page.getByTestId('action-go')
      if ((await go.count()) > 0 && (await go.getAttribute('aria-disabled')) !== 'true') {
        return player
      }
    }
    return null
  }

  // Deals depend on the game code, which is random, so no seed can promise a Go in the first
  // hand. Playing the highest card first makes one all but certain within a few hands (93% of
  // hands have one; the simulator puts five hands in a row without at about one in 500,000).
  // The play never presses Go itself: it stops when Go is the only move left.
  await play([host, guest], {
    policy: 'highest',
    leave: ['action-go'],
    until: async () => (await stuckPlayer()) !== null || (await handNumber(host.page)) > 5,
  })
  const stuck = await stuckPlayer()
  if (!stuck) throw new Error('No Go was needed in five hands')
  const other = stuck === host ? guest : host

  // Stuck means: it is their turn, they hold cards, and none of them can be played.
  await expect(stuck.page.getByTestId('prompt')).toHaveAttribute('data-mine', 'true')
  const cards = stuck.page.getByTestId('hand-card')
  expect(await cards.count()).toBeGreaterThan(0)
  for (const card of await cards.all()) await expect(card).toHaveAttribute('aria-disabled', 'true')
  await expect(other.page.getByTestId('action-go')).toHaveCount(0)
  // The opponent's screen is up to date and has nothing to press either: the game waits for Go.
  await expectSameTable(host, guest)
  expect(await nextChoice(other.page)).toBeNull()

  const before = await publicTable(stuck.page)
  await stuck.page.getByTestId('action-go').click()
  await expect(stuck.page.getByTestId('action-go')).toHaveCount(0)
  // Saying Go lays no card and scores nothing for the player who said it.
  const after = await expectSameTable(host, guest)
  const seat = stuck === host ? 0 : 1
  expect(after.played[seat]?.length).toBe(before.played[seat]?.length)
  expect(after.scores[seat]).toBe(before.scores[seat])

  // The hand is played out to the show without getting stuck.
  await play([host, guest], {
    policy: 'highest',
    until: async () => (await phase(host.page)) === 'show' && (await phase(guest.page)) === 'show',
  })
  await expectSameTable(host, guest)
})

test('a whole game is played to 121', { tag: '@slow' }, async ({ browser }) => {
  test.slow()
  const { host, guest } = await seatTwoPlayers(browser)
  let hands = 0
  await play([host, guest], {
    until: async () => {
      const [a, b] = [await phase(host.page), await phase(guest.page)]
      return a === 'game_over' && b === 'game_over'
    },
    afterMove: async (_by, choice) => {
      // Once a hand, when the first player asks for the next one: both screens agree.
      if (choice.testId !== 'action-ready') return
      const [a, b] = [await handNumber(host.page), await handNumber(guest.page)]
      if (a === b && a > hands) {
        hands = a
        await expectSameTable(host, guest)
      }
    },
  })

  const final = await expectSameTable(host, guest)
  expect(final.winner).toMatch(/^[01]$/)
  const winner = Number(final.winner)
  expect(final.scores[winner]).toBe('121')
  expect(Number(final.scores[1 - winner])).toBeLessThan(121)
  expect(hands).toBeGreaterThan(2)

  // Both are shown the result, and nothing is left to press.
  for (const player of [host, guest]) {
    await expect(player.page.getByTestId('game-over')).toBeVisible()
    await expect(player.page.getByTestId(`final-score-${winner}`)).toHaveText('121')
    await expect(player.page.getByTestId('prompt')).toHaveAttribute('data-mine', 'false')
    await expect(player.page.getByTestId('hand-card')).toHaveCount(0)
    for (const testId of ['action-discard', 'action-cut', 'action-go', 'action-ready']) {
      await expect(player.page.getByTestId(testId)).toHaveCount(0)
    }
  }

  // Reloading a finished game still shows the result; then back to the start page.
  await host.page.reload()
  await expect(host.page.getByTestId('winner')).toHaveAttribute('data-winner', String(winner))
  await host.page.getByTestId('back-home').click()
  await expect(host.page.getByTestId('start-game')).toBeVisible()
})

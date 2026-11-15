import { expect, test } from '@playwright/test'
import { joinByLink, newPlayer, startGame } from './table'

// A well-formed code that no game has (the odds of the server handing it out during a run are
// one in 3.2 million).
const NO_SUCH_CODE = 'ZXZXZ'

test('a code that matches no game says so and lets you try another', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('join-game').click()
  await expect(page).toHaveURL(/\/join$/)

  // Typed in lower case with a space: still read as a code, and checked on the fifth letter.
  await page.getByTestId('code-input').pressSequentially('zxz xz')
  await expect(page.getByTestId('code-input')).toHaveCount(0)
  await expect(page.getByTestId('join-problem')).toHaveAttribute('data-problem', 'not_found')

  await page.getByTestId('other-code').click()
  await expect(page.getByTestId('code-input')).toBeFocused()
  await expect(page.getByTestId('code-input')).toHaveValue('')
})

test('the code field only takes letters a code can have', async ({ page }) => {
  await page.goto('/join')
  const input = page.getByTestId('code-input')
  await input.pressSequentially('a1e!b-c')
  await expect(input).toHaveValue('BC')
  await expect(page.getByTestId('code-submit')).toBeDisabled()
})

test('a share link for a game that does not exist says so', async ({ page }) => {
  await page.goto(`/j/${NO_SUCH_CODE}`)
  await expect(page.getByTestId('join-problem')).toHaveAttribute('data-problem', 'not_found')
  await expect(page.getByTestId('name-input')).toHaveCount(0)
})

test('typing the code and then a name joins the game', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada')
  const guest = await newPlayer(browser, 'Sam')
  const code = await startGame(host)

  await guest.page.goto('/join')
  await guest.page.getByTestId('code-input').fill(code.toLowerCase())
  await expect(guest.page.getByTestId('host-name')).toHaveText('Ada')
  await guest.page.getByTestId('name-input').fill(guest.name)
  await guest.page.getByTestId('join-submit').click()

  await expect(guest.page).toHaveURL(new RegExp(`/g/${code}$`))
  for (const player of [host, guest]) {
    await expect(player.page.getByTestId('game')).toHaveAttribute('data-phase', 'discard')
  }
})

test('pasting the whole share link into the code field finds the game', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada')
  const guest = await newPlayer(browser, 'Sam')
  const code = await startGame(host)
  const link = await host.page.getByTestId('join-link').getAttribute('href')
  expect(link).toMatch(new RegExp(`^https?://.+/j/${code}$`))

  await guest.page.goto('/join')
  await guest.page.getByTestId('code-input').fill(link as string)
  await expect(guest.page.getByTestId('host-name')).toHaveText('Ada')
})

test('a third person is told the game is full', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada')
  const guest = await newPlayer(browser, 'Sam')
  const third = await newPlayer(browser, 'Tess')
  const code = await startGame(host)
  await joinByLink(guest, code)

  await third.page.goto(`/j/${code}`)
  await expect(third.page.getByTestId('join-problem')).toHaveAttribute('data-problem', 'full')
  await expect(third.page.getByTestId('name-input')).toHaveCount(0)

  // Opening the game's own address without a seat in it leads to the same answer.
  await third.page.goto(`/g/${code}`)
  await expect(third.page).toHaveURL(new RegExp(`/j/${code}$`))
  await expect(third.page.getByTestId('join-problem')).toHaveAttribute('data-problem', 'full')
})

test('a player already in the game goes straight back to it', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada')
  const guest = await newPlayer(browser, 'Sam')
  const code = await startGame(host)
  await joinByLink(guest, code)

  // The guest follows the share link again (say, from the message it came in).
  await guest.page.goto(`/j/${code}`)
  await expect(guest.page).toHaveURL(new RegExp(`/g/${code}$`))
  await expect(guest.page.getByTestId('game')).toHaveAttribute('data-phase', 'discard')
})

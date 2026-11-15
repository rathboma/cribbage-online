import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { LookupGameResponse } from '@shared/protocol'
import { takeStartCursor, useApiClient } from '@/api'
import { ApiError, type ApiClient } from '@/api/client'
import { loadLastName, loadSession, saveLastName, saveSession } from '@/api/session'
import App from '@/App.vue'
import { routes } from '@/router/routes'

let restore: () => void
let lookupGame: ReturnType<typeof vi.fn>
let joinGame: ReturnType<typeof vi.fn>
let sync: ReturnType<typeof vi.fn>

const open: LookupGameResponse = {
  code: 'BCDFG',
  status: 'waiting',
  hostName: 'Ada',
  hostChatOn: true,
  hostVideoOn: false,
  joinable: true,
}

async function visit(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  const wrapper = mount(App, {
    global: { plugins: [router, createPinia()] },
    attachTo: document.body,
  })
  await router.push(path)
  await flushPromises()
  return { wrapper, router }
}

const codeInput = (w: ReturnType<typeof mount>) => w.get('input')
const heading = (w: ReturnType<typeof mount>) => w.get('h1').text()
const buttons = (w: ReturnType<typeof mount>) =>
  w.findAll('main button, main a').map((b) => b.text())

beforeEach(() => {
  lookupGame = vi.fn(async () => open)
  joinGame = vi.fn(async () => ({ seat: 1, playerToken: 'tok', cursor: 17 }))
  // The game screen polls once it opens; give it a harmless answer.
  sync = vi.fn(() => new Promise(() => {}))
  restore = useApiClient({ lookupGame, joinGame, sync } as unknown as ApiClient)
})
afterEach(() => {
  restore()
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('join: entering the code', () => {
  it('upper-cases, drops letters a code can’t have, and checks the code on the fifth letter', async () => {
    const { wrapper } = await visit('/join')
    await codeInput(wrapper).setValue('bca1e')
    expect((codeInput(wrapper).element as HTMLInputElement).value).toBe('BC')
    expect(lookupGame).not.toHaveBeenCalled()
    await codeInput(wrapper).setValue('bcdf')
    await codeInput(wrapper).setValue('bcdfg')
    await flushPromises()
    expect(lookupGame).toHaveBeenCalledWith('BCDFG')
    expect(heading(wrapper)).toContain('Ada')
  })

  it('accepts a pasted code with spaces or dashes', async () => {
    const { wrapper } = await visit('/join')
    await codeInput(wrapper).setValue(' bcd-fg ')
    await flushPromises()
    expect(lookupGame).toHaveBeenCalledWith('BCDFG')
  })

  it.each([
    [new ApiError(404, 'game_not_found', 'x'), 'No game with that code'],
    [new ApiError(0, 'network', 'x'), "Couldn't check the code"],
  ])('explains a failed lookup (%s)', async (error, title) => {
    lookupGame.mockRejectedValueOnce(error)
    const { wrapper } = await visit('/join')
    await codeInput(wrapper).setValue('BCDFG')
    await flushPromises()
    expect(heading(wrapper)).toBe(title)
    expect(buttons(wrapper)).toEqual(expect.arrayContaining(['Enter another code', 'Go home']))
  })

  it('lets you retry after a network error', async () => {
    lookupGame.mockRejectedValueOnce(new ApiError(0, 'network', 'x'))
    const { wrapper } = await visit('/join')
    await codeInput(wrapper).setValue('BCDFG')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Try again')!
      .trigger('click')
    await flushPromises()
    expect(lookupGame).toHaveBeenCalledTimes(2)
    expect(heading(wrapper)).toContain('Ada')
  })

  it.each([
    [{ ...open, status: 'active', joinable: false }, 'That game is full'],
    [{ ...open, status: 'finished', joinable: false }, 'That game has finished'],
    [{ ...open, status: 'abandoned', joinable: false }, 'That game has finished'],
  ] as const)('tells a third person when the game is %#', async (found, title) => {
    lookupGame.mockResolvedValueOnce(found)
    const { wrapper } = await visit('/join')
    await codeInput(wrapper).setValue('BCDFG')
    await flushPromises()
    expect(heading(wrapper)).toBe(title)
  })

  it('goes back to an empty code field from an error', async () => {
    lookupGame.mockRejectedValueOnce(new ApiError(404, 'game_not_found', 'x'))
    const { wrapper } = await visit('/join')
    await codeInput(wrapper).setValue('BCDFG')
    await flushPromises()
    await wrapper.get('[data-testid="other-code"]').trigger('click')
    await flushPromises()
    expect(heading(wrapper)).toBe('Join a game')
    expect((codeInput(wrapper).element as HTMLInputElement).value).toBe('')
  })
})

describe('join: your name', () => {
  it('shows the host and their choices, prefills your name, joins and opens the game', async () => {
    saveLastName('Bo')
    const { wrapper, router } = await visit('/j/BCDFG')
    expect(heading(wrapper)).toContain("Ada's game")
    expect(wrapper.text()).toContain('chat on · video off')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Bo')
    await wrapper.get('input').setValue(' Bob ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(joinGame).toHaveBeenCalledWith('BCDFG', { name: 'Bob' })
    expect(loadSession('BCDFG')).toEqual({ playerToken: 'tok', seat: 1, name: 'Bob' })
    expect(loadLastName()).toBe('Bob')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/g/BCDFG'))
    // The game screen picks up the join cursor, so the guest sees the opening deal.
    await vi.waitFor(() =>
      expect(sync).toHaveBeenCalledWith('BCDFG', 'tok', { cursor: 17, v: undefined }),
    )
    expect(takeStartCursor('BCDFG')).toBeUndefined() // handed over once, in memory
  })

  it('opening a share link asks only for the name', async () => {
    const { wrapper } = await visit('/j/bcdfg')
    expect(lookupGame).toHaveBeenCalledWith('BCDFG')
    expect(wrapper.findAll('input')).toHaveLength(1)
    expect(wrapper.get('label').text()).toBe('Your name')
  })

  it('asks for a name before joining', async () => {
    const { wrapper } = await visit('/j/BCDFG')
    await wrapper.get('input').setValue('   ')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('Enter a name')
    expect(joinGame).not.toHaveBeenCalled()
  })

  it('explains a game that filled up while you typed your name', async () => {
    joinGame.mockRejectedValueOnce(new ApiError(409, 'game_full', 'full'))
    const { wrapper } = await visit('/j/BCDFG')
    await wrapper.get('input').setValue('Bo')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(heading(wrapper)).toBe('That game is full')
  })

  it('keeps the form after a network error, so you can try again', async () => {
    joinGame.mockRejectedValueOnce(new ApiError(0, 'network', 'x'))
    const { wrapper } = await visit('/j/BCDFG')
    await wrapper.get('input').setValue('Bo')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('main [role="alert"]').text()).toContain("Couldn't reach the server")
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('rejects a share link that isn’t a game code', async () => {
    const { wrapper } = await visit('/j/hello')
    expect(heading(wrapper)).toBe("That link doesn't look right")
    expect(lookupGame).not.toHaveBeenCalled()
  })
})

describe('rejoining and the game route', () => {
  it('opens the game straight away when this browser is already in it', async () => {
    saveSession('BCDFG', { playerToken: 'tok', seat: 1, name: 'Bo' })
    const { router } = await visit('/j/BCDFG')
    expect(router.currentRoute.value.fullPath).toBe('/g/BCDFG')
    expect(lookupGame).not.toHaveBeenCalled()
  })

  it('sends a browser with no seat in the game to the join screen', async () => {
    const { router, wrapper } = await visit('/g/BCDFG')
    expect(router.currentRoute.value.fullPath).toBe('/j/BCDFG')
    expect(heading(wrapper)).toContain("Ada's game")
  })
})

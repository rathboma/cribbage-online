import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { takeStartCursor, useApiClient } from '@/api'
import { ApiError, type ApiClient } from '@/api/client'
import { loadLastName, loadSession, removeSession, saveLastName } from '@/api/session'
import { routes } from '@/router/routes'
import { useToasts } from '@/stores/toasts'
import NewGameView from './NewGameView.vue'

let restore: () => void
let createGame: ReturnType<typeof vi.fn>

async function mountForm() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/new')
  const pinia = createPinia()
  const wrapper = mount(NewGameView, { global: { plugins: [router, pinia] } })
  return { wrapper, router, pinia }
}

beforeEach(() => {
  createGame = vi.fn(async () => ({ code: 'BCDFG', seat: 0, playerToken: 'tok', cursor: 0 }))
  restore = useApiClient({ createGame } as unknown as ApiClient)
})
afterEach(() => {
  restore()
  localStorage.clear()
})

describe('start game form', () => {
  it('offers chat (on), video (off, beta) and a name prefilled from last time', async () => {
    saveLastName('Ada')
    const { wrapper } = await mountForm()
    const switches = wrapper.findAll('[role="switch"]')
    expect(switches.map((s) => s.attributes('aria-checked'))).toEqual(['true', 'false'])
    expect(wrapper.text()).toContain('Beta')
    expect(wrapper.text()).toContain('directly between the two players')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('Ada')
  })

  it('asks for a name before starting', async () => {
    const { wrapper } = await mountForm()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('Enter a name')
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    expect(createGame).not.toHaveBeenCalled()
  })

  it('starts the game, remembers the session and the name, and opens the game', async () => {
    const { wrapper, router } = await mountForm()
    await wrapper.get('input').setValue('  Ada ')
    await wrapper.findAll('[role="switch"]')[1]!.trigger('click') // video on
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(createGame).toHaveBeenCalledWith({ name: 'Ada', chatOn: true, videoOn: true })
    expect(loadSession('BCDFG')).toEqual({ playerToken: 'tok', seat: 0, name: 'Ada' })
    expect(loadLastName()).toBe('Ada')
    expect(takeStartCursor('BCDFG')).toBe(0)
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/g/BCDFG'))
  })

  it('still opens the game when the browser will not save anything, and warns the host', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    try {
      const { wrapper, router, pinia } = await mountForm()
      await wrapper.get('input').setValue('Ada')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      // The token came once: without it the host would be asked to join their own game.
      expect(loadSession('BCDFG')).toEqual({ playerToken: 'tok', seat: 0, name: 'Ada' })
      await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/g/BCDFG'))
      expect(useToasts(pinia).toasts).toMatchObject([
        { kind: 'error', message: expect.stringContaining('Keep this tab open') },
      ])
    } finally {
      vi.restoreAllMocks()
      removeSession('BCDFG')
    }
  })

  it('cannot be submitted twice while starting', async () => {
    let finish: () => void = () => {}
    createGame.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ code: 'BCDFG', seat: 0, playerToken: 'tok', cursor: 0 })
        }),
    )
    const { wrapper } = await mountForm()
    await wrapper.get('input').setValue('Ada')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    const button = wrapper.get('button[type="submit"]')
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('aria-disabled')).toBe('true')
    await button.trigger('click')
    expect(createGame).toHaveBeenCalledTimes(1)
    finish()
    await flushPromises()
  })

  it.each([
    [new ApiError(0, 'network', 'Failed to fetch'), "Couldn't reach the server"],
    [new ApiError(500, 'internal', 'boom'), 'Something went wrong on our side'],
  ])('explains a failure (%s) and lets you try again', async (error, message) => {
    createGame.mockRejectedValueOnce(error)
    const { wrapper } = await mountForm()
    await wrapper.get('input').setValue('Ada')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain(message)
    expect(wrapper.get('button[type="submit"]').attributes('aria-disabled')).toBeUndefined()
  })
})

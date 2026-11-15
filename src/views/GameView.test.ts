import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { PlayerView, SyncResponse } from '@shared/protocol'
import { setStartCursor, useApiClient } from '@/api'
import { ApiError, type ApiClient } from '@/api/client'
import { loadSession, saveSession } from '@/api/session'
import App from '@/App.vue'
import { routes } from '@/router/routes'

let restore: () => void
let sync: ReturnType<typeof vi.fn>

const noMoves = { discard: false, cut: false, playable: [], go: false, ready: false }

const waiting: SyncResponse = {
  status: 'waiting',
  version: 0,
  view: { phase: 'lobby', hand: 0, legal: noMoves } as unknown as PlayerView,
  events: [],
  cursor: 0,
  more: false,
  players: [],
  serverTime: 0,
}

async function open(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const wrapper = mount(App, {
    global: { plugins: [router, createPinia()] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  sync = vi.fn(async () => waiting)
  restore = useApiClient({ sync } as unknown as ApiClient)
  saveSession('BCDFG', { playerToken: 'tok', seat: 0, name: 'Ada' })
})
afterEach(() => {
  restore()
  vi.useRealTimers()
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('game screen', () => {
  it('shows the waiting room, then switches to the game when the opponent joins', async () => {
    setStartCursor('BCDFG', 0)
    const { wrapper } = await open('/g/BCDFG')
    await vi.advanceTimersByTimeAsync(0)
    expect(sync).toHaveBeenCalledWith('BCDFG', 'tok', { cursor: 0, v: undefined })
    expect(wrapper.get('[data-testid="game-code"]').text()).toBe('BCDFG')

    sync.mockResolvedValue({
      ...waiting,
      status: 'active',
      version: 1,
      view: { phase: 'discard', hand: 1, legal: noMoves } as unknown as PlayerView,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('[data-testid="game-code"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="game-started"]').text()).toContain('discard')
  })

  it('snaps to the present after a reload (no start cursor)', async () => {
    await open('/g/BCDFG')
    await vi.advanceTimersByTimeAsync(0)
    expect(sync).toHaveBeenCalledWith('BCDFG', 'tok', { cursor: undefined, v: undefined })
  })

  it('explains a game that is gone and forgets its session', async () => {
    sync.mockRejectedValue(new ApiError(404, 'game_not_found', 'gone'))
    const { wrapper } = await open('/g/BCDFG')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.get('main [role="alert"]').text()).toContain("There's no game with that code")
    expect(loadSession('BCDFG')).toBeNull()
  })
})

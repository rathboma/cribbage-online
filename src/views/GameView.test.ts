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
import { PLAYERS, viewWhen } from '@/test/game'

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
      view: viewWhen(0, (s) => s.phase === 'discard'),
      players: PLAYERS,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.find('[data-testid="game-code"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="game"]').attributes('data-phase')).toBe('discard')
    expect(wrapper.findAll('[data-testid="hand-card"]')).toHaveLength(6)
  })

  it('says it is connecting until the first answer arrives', async () => {
    sync.mockReturnValue(new Promise(() => {}))
    const { wrapper } = await open('/g/BCDFG')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.get('main [role="status"]').text()).toBe('Connecting…')
    expect(wrapper.find('[data-testid="game"]').exists()).toBe(false)
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
    expect(wrapper.get('main [role="alert"]').text()).toContain('This game is no longer there')
    expect(loadSession('BCDFG')).toBeNull()
  })

  it('keeps the seat when a request merely fails with a 404 that is not about the game', async () => {
    sync.mockRejectedValue(new ApiError(404, 'not_found', 'No API route'))
    const { wrapper } = await open('/g/BCDFG')
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('main [role="alert"]').exists()).toBe(false)
    expect(loadSession('BCDFG')).not.toBeNull()
  })

  it('picks polling up again when the host touches the waiting room after a quiet spell', async () => {
    setStartCursor('BCDFG', 0)
    await open('/g/BCDFG')
    await vi.advanceTimersByTimeAsync(11 * 60_000) // nothing happens: polling slows to 30s
    const calls = sync.mock.calls.length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(sync.mock.calls.length).toBe(calls)
    window.dispatchEvent(new Event('pointerdown'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sync.mock.calls.length).toBe(calls + 1)
    // ...and stays at the active rate.
    await vi.advanceTimersByTimeAsync(1000)
    expect(sync.mock.calls.length).toBe(calls + 2)
  })
})

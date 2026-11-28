import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { saveSession } from '@/api/session'
import { resetTableView, useTableView, VIEW_STORAGE_KEY } from '@/composables/useTableView'
import { applyViewParam, routes } from './routes'

function makeRouter() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  router.beforeEach(applyViewParam)
  return router
}

describe('routes', () => {
  it.each([
    ['/', 'landing'],
    ['/new', 'new-game'],
    ['/join', 'join'],
    ['/j/BCDFG', 'join-code'],
    ['/g/BCDFG', 'game'],
    ['/no/such/page', 'not-found'],
    // Development builds only (the build fails if it ships: checkClientChunks in vite.config.ts).
    ['/dev/table', 'dev-table'],
  ])('%s resolves to %s', (path, name) => {
    expect(makeRouter().resolve(path).name).toBe(name)
  })

  it.each([
    ['/j/bcd-fg', '/j/BCDFG'],
    ['/j/BCDFG', '/j/BCDFG'],
    ['/j/hello', '/j/hello'],
    // No seat in that game in this browser: offer to join instead.
    ['/g/bcdfg', '/j/BCDFG'],
  ])('navigating to %s lands on %s', async (from, to) => {
    const router = makeRouter()
    await router.push(from)
    expect(router.currentRoute.value.fullPath).toBe(to)
  })

  it('opens the game for a browser with a seat in it, with the canonical code', async () => {
    saveSession('BCDFG', { playerToken: 't', seat: 0, name: 'Ada' })
    const router = makeRouter()
    await router.push('/g/bcdfg')
    expect(router.currentRoute.value.fullPath).toBe('/g/BCDFG')
    localStorage.clear()
  })

  it.each([
    ['/?view=2d', '/', '2d'],
    ['/j/BCDFG?view=3d#top', '/j/BCDFG#top', '3d'],
    ['/new?view=2d&x=1', '/new?x=1', '2d'],
  ])('%s chooses the table and leaves the URL as %s', async (from, to, choice) => {
    resetTableView()
    const router = makeRouter()
    await router.push(from)
    expect(router.currentRoute.value.fullPath).toBe(to)
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe(choice)
    expect(useTableView().choice.value).toBe(choice)
    localStorage.clear()
  })

  it('leaves a view parameter it does not know alone', async () => {
    resetTableView()
    const router = makeRouter()
    await router.push('/?view=fancy')
    expect(router.currentRoute.value.fullPath).toBe('/?view=fancy')
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBeNull()
  })
})

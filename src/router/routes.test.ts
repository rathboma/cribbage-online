import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { saveSession } from '@/api/session'
import { routes } from './routes'

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes })
}

describe('routes', () => {
  it.each([
    ['/', 'landing'],
    ['/new', 'new-game'],
    ['/join', 'join'],
    ['/j/BCDFG', 'join-code'],
    ['/g/BCDFG', 'game'],
    ['/no/such/page', 'not-found'],
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
})

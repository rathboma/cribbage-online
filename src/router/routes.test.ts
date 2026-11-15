import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
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
    ['/g/bcdfg', '/g/BCDFG'],
    ['/j/BCDFG', '/j/BCDFG'],
    ['/j/hello', '/j/hello'],
  ])('navigating to %s lands on %s', async (from, to) => {
    const router = makeRouter()
    await router.push(from)
    expect(router.currentRoute.value.fullPath).toBe(to)
  })
})

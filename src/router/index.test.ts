import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { routes } from './index'

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

  it('passes the code from a join deep link', () => {
    expect(makeRouter().resolve('/j/bcdfg').params).toEqual({ code: 'bcdfg' })
  })
})

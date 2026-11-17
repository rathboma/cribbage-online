import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadLastName, loadSession, removeSession, saveLastName, saveSession } from './session'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('sessions', () => {
  it('stores a session per game code under cribbage:session:<CODE>', () => {
    saveSession('BCDFG', { playerToken: 'tok', seat: 1, name: 'Bo' })
    expect(JSON.parse(localStorage.getItem('cribbage:session:BCDFG')!)).toEqual({
      playerToken: 'tok',
      seat: 1,
      name: 'Bo',
    })
    expect(loadSession('BCDFG')).toEqual({ playerToken: 'tok', seat: 1, name: 'Bo' })
    expect(loadSession('ZZZZZ')).toBeNull()
  })

  it('forgets a session when asked', () => {
    saveSession('BCDFG', { playerToken: 'tok', seat: 0, name: 'Ada' })
    removeSession('BCDFG')
    expect(loadSession('BCDFG')).toBeNull()
  })

  it.each([
    'not json',
    '{"playerToken":1,"seat":0,"name":"x"}',
    '{"playerToken":"t","seat":2,"name":"x"}',
  ])('ignores damaged data %j', (raw) => {
    localStorage.setItem('cribbage:session:BCDFG', raw)
    expect(loadSession('BCDFG')).toBeNull()
  })

  it('remembers the last name used', () => {
    expect(loadLastName()).toBe('')
    saveLastName('Ada')
    expect(loadLastName()).toBe('Ada')
  })

  it('says the session was saved when storage works', () => {
    expect(saveSession('BCDFG', { playerToken: 't', seat: 0, name: 'A' })).toBe(true)
  })

  it('keeps the seat for this tab when storage is blocked or full, and says so', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const session = { playerToken: 't', seat: 0 as const, name: 'A' }
    expect(saveSession('BCDFG', session)).toBe(false)
    // The token came once and can't be fetched again: it must not be lost.
    expect(loadSession('BCDFG')).toEqual(session)
    expect(loadSession('ZZZZZ')).toBeNull()
    expect(loadLastName()).toBe('')

    removeSession('BCDFG')
    expect(loadSession('BCDFG')).toBeNull()
  })
})

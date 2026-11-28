import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetTableView, useTableView, VIEW_STORAGE_KEY } from './useTableView'

const webgl = vi.hoisted(() => ({ available: true }))
vi.mock('@/three/support', () => ({ webglAvailable: () => webgl.available }))

afterEach(() => {
  localStorage.clear()
  resetTableView()
  webgl.available = true
})

describe('useTableView', () => {
  it('shows the 3D table by default where WebGL works', () => {
    const table = useTableView()
    expect(table.choice.value).toBe('3d')
    expect(table.canUse3d.value).toBe(true)
    expect(table.view.value).toBe('3d')
  })

  it('remembers the choice in localStorage, and reads it back', () => {
    useTableView().set('2d')
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe('2d')
    expect(useTableView().view.value).toBe('2d')
    // A new page load reads what was stored.
    resetTableView()
    expect(useTableView().view.value).toBe('2d')
    localStorage.setItem(VIEW_STORAGE_KEY, 'nonsense')
    resetTableView()
    expect(useTableView().view.value).toBe('3d')
  })

  it('every user of it sees a change at once', () => {
    const a = useTableView()
    const b = useTableView()
    a.set('2d')
    expect(b.view.value).toBe('2d')
    b.set('3d')
    expect(a.view.value).toBe('3d')
  })

  it('shows the simple table without WebGL, whatever was chosen, and offers no choice', () => {
    webgl.available = false
    const table = useTableView()
    expect(table.canUse3d.value).toBe(false)
    expect(table.view.value).toBe('2d')
    table.set('3d')
    expect(table.view.value).toBe('2d')
  })

  it('falls back to the simple table for the rest of the visit if the 3D one fails', () => {
    const table = useTableView()
    table.markBroken()
    expect(table.canUse3d.value).toBe(false)
    expect(table.view.value).toBe('2d')
    // The choice itself is kept for next time.
    expect(table.choice.value).toBe('3d')
  })

  it('works when storage is blocked', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const table = useTableView()
    expect(table.view.value).toBe('3d')
    table.set('2d')
    expect(table.view.value).toBe('2d')
    getItem.mockRestore()
    setItem.mockRestore()
  })
})

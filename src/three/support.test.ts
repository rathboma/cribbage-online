import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetWebglCheck, webglAvailable } from './support'

afterEach(() => {
  resetWebglCheck()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('webglAvailable', () => {
  it('is false without WebGL 2 (as in jsdom)', () => {
    expect(webglAvailable()).toBe(false)
  })

  it('asks for a real context, gives it straight back and remembers the answer', () => {
    vi.stubGlobal('WebGL2RenderingContext', class {})
    const loseContext = vi.fn()
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ getExtension: () => ({ loseContext }) } as never)
    expect(webglAvailable()).toBe(true)
    expect(webglAvailable()).toBe(true)
    expect(getContext).toHaveBeenCalledTimes(1)
    expect(getContext.mock.calls[0]![0]).toBe('webgl2')
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('is false when the browser refuses a context', () => {
    vi.stubGlobal('WebGL2RenderingContext', class {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    expect(webglAvailable()).toBe(false)
  })

  it('is false when asking throws', () => {
    vi.stubGlobal('WebGL2RenderingContext', class {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(webglAvailable()).toBe(false)
  })
})

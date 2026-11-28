/**
 * Stand-ins for what a TableScene needs from the browser: jsdom has no WebGL, so the renderer
 * counts what the scene asks of it, frames run when the test says, and the page's visibility is
 * switched by hand. Nothing here imports the scene, so a test can mock it with these.
 */
import { vi } from 'vitest'
import type { PageVisibility } from '@/three/TableScene'

/** A renderer stand-in that counts what the scene asks of it (jsdom has no WebGL). */
export function fakeRenderer() {
  let lost = false
  const loseContext = vi.fn(() => (lost = true))
  const renderer = {
    loseContext,
    /** The browser gives the context back. */
    restore: () => (lost = false),
    shadowMap: { enabled: false, type: 0 },
    info: { memory: { geometries: 0, textures: 0 } },
    properties: new Map<unknown, unknown>(),
    capabilities: { maxTextureSize: 4096, getMaxAnisotropy: () => 16 },
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(() => (lost = true)),
    getContext: () => ({
      isContextLost: () => lost,
      getExtension: () => (lost ? null : { loseContext }),
    }),
  }
  return renderer
}

/** Frames that run only when the test says so. */
export function manualFrames() {
  let next = 1
  const pending = new Map<number, (time: number) => void>()
  let now = 0
  return {
    request: vi.fn((callback: (time: number) => void) => {
      pending.set(next, callback)
      return next++
    }),
    cancel: vi.fn((handle: number) => void pending.delete(handle)),
    get pending() {
      return pending.size
    },
    /** Runs the frames that are waiting, `ms` after the last ones. */
    tick(ms = 16) {
      now += ms
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback(now)
    },
  }
}

/** The page's visibility, switched by the test. */
export function fakePage() {
  const page = Object.assign(new EventTarget(), { hidden: false })
  return {
    visibility: page as unknown as PageVisibility,
    set hidden(hidden: boolean) {
      page.hidden = hidden
      page.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

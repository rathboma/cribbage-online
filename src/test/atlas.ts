import { vi } from 'vitest'
import type { AtlasCanvas, AtlasContext, AtlasSources } from '@/three/cardAtlas'

/** A call made on the fake 2D context: the method's name and its arguments. */
export interface DrawCall {
  method: string
  args: unknown[]
}

/** A 2D context that records every call (jsdom has no canvas drawing). */
export function fakeContext(calls: DrawCall[]): AtlasContext {
  const state: Record<string, unknown> = {}
  return new Proxy(state, {
    get(target, key) {
      if (typeof key !== 'string') return undefined
      if (key in target) return target[key]
      return (...args: unknown[]) => void calls.push({ method: key, args })
    },
    set(target, key, value) {
      target[key as string] = value
      return true
    },
  }) as unknown as AtlasContext
}

/** What the fake sources hand back as an image: just where it came from. */
export interface FakeImage {
  url: string
}

/**
 * Canvas and image loading for the card atlas, under the test's control: images load when the
 * test says so (or at once), and the ones it names fail.
 */
export function fakeAtlasSources(
  options: { fail?: (url: string) => boolean; hold?: boolean } = {},
) {
  const calls: DrawCall[] = []
  const pending: (() => void)[] = []
  const canvases: AtlasCanvas[] = []
  const sources: AtlasSources = {
    createCanvas(width, height) {
      const canvas: AtlasCanvas = { width, height, getContext: () => fakeContext(calls) }
      canvases.push(canvas)
      return canvas
    },
    loadImage: vi.fn((url: string) => {
      return new Promise<CanvasImageSource>((resolve, reject) => {
        const settle = () =>
          options.fail?.(url)
            ? reject(new Error(`could not load ${url}`))
            : resolve({ url } as unknown as CanvasImageSource)
        if (options.hold) pending.push(settle)
        else settle()
      })
    }),
  }
  return {
    sources,
    calls,
    canvases,
    /** Lets every image that is waiting finish loading (or fail). */
    releaseImages() {
      for (const settle of pending.splice(0)) settle()
    },
    /** The images drawn so far, by URL. */
    drawnImages(): string[] {
      return calls
        .filter((call) => call.method === 'drawImage')
        .map((call) => (call.args[0] as FakeImage).url)
    },
  }
}

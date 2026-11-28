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
 * Canvas and image loading for the card atlas, under the test's control: images load at once,
 * or when the test releases them if `hold` says so, and the ones `fail` names fail (asked when
 * each one settles, so a test can change its mind before a retry).
 */
export function fakeAtlasSources(
  options: {
    fail?: (url: string) => boolean
    hold?: boolean | ((url: string) => boolean)
  } = {},
) {
  const calls: DrawCall[] = []
  const pending: { url: string; settle: () => void }[] = []
  const contextSettings: (CanvasRenderingContext2DSettings | undefined)[] = []
  const holds = (url: string) =>
    typeof options.hold === 'function' ? options.hold(url) : !!options.hold
  const sources: AtlasSources = {
    createCanvas(width, height) {
      return {
        width,
        height,
        getContext: (_type: '2d', settings?: CanvasRenderingContext2DSettings) => {
          contextSettings.push(settings)
          return fakeContext(calls)
        },
      } satisfies AtlasCanvas
    },
    loadImage: vi.fn((url: string) => {
      return new Promise<CanvasImageSource>((resolve, reject) => {
        const settle = () =>
          options.fail?.(url)
            ? reject(new Error(`could not load ${url}`))
            : resolve({ url } as unknown as CanvasImageSource)
        if (holds(url)) pending.push({ url, settle })
        else settle()
      })
    }),
  }
  return {
    sources,
    calls,
    contextSettings,
    /** Lets the waiting images (those `which` picks, or all) finish loading or fail. */
    releaseImages(which: (url: string) => boolean = () => true) {
      for (const image of pending.filter((p) => which(p.url))) {
        pending.splice(pending.indexOf(image), 1)
        image.settle()
      }
    },
    /** The images drawn so far, by URL. */
    drawnImages(): string[] {
      return calls
        .filter((call) => call.method === 'drawImage')
        .map((call) => (call.args[0] as FakeImage).url)
    },
  }
}

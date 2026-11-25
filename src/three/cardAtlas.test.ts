import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import { cardId, fullDeck } from '@shared/engine/cards'
import { CARD_BACK_URL, CARD_HEIGHT_PER_WIDTH, cardFaceUrl } from '@/game/cardArt'
import { fakeAtlasSources, type FakeImage } from '@/test/atlas'
import {
  ATLAS_SLOTS,
  AtlasImage,
  CardAtlas,
  MAX_ART_WIDTH,
  atlasLayout,
  browserSources,
  cardAtlasImage,
  slotPixels,
  slotUv,
} from './cardAtlas'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('atlas layout', () => {
  it('has a cell for every face, the back and the blank face, each once', () => {
    expect(ATLAS_SLOTS).toHaveLength(54)
    expect(new Set(ATLAS_SLOTS).size).toBe(54)
    for (const card of fullDeck()) expect(ATLAS_SLOTS).toContain(cardId(card))
    expect(ATLAS_SLOTS).toContain('back')
    expect(ATLAS_SLOTS).toContain('blank')
  })

  it('draws cards at full size on any GPU with a 4096 texture limit', () => {
    const layout = atlasLayout(4096)
    expect(layout.artWidth).toBe(MAX_ART_WIDTH)
    expect(layout.width).toBeLessThanOrEqual(4096)
    expect(layout.height).toBeLessThanOrEqual(4096)
    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(ATLAS_SLOTS.length)
  })

  it('shrinks the cards to fit a smaller texture limit', () => {
    for (const max of [2048, 1024]) {
      const layout = atlasLayout(max)
      expect(layout.width).toBeLessThanOrEqual(max)
      expect(layout.height).toBeLessThanOrEqual(max)
      expect(layout.artWidth).toBeLessThan(MAX_ART_WIDTH)
    }
  })

  it("keeps the art's proportions", () => {
    const layout = atlasLayout(4096)
    expect(layout.artHeight / layout.artWidth).toBeCloseTo(CARD_HEIGHT_PER_WIDTH, 2)
  })

  it('gives every slot its own rectangle, inside the texture, with a gap to its neighbours', () => {
    const layout = atlasLayout(4096)
    const rects = ATLAS_SLOTS.map((slot) => slotPixels(layout, slot))
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(layout.gutter)
      expect(r.y).toBeGreaterThanOrEqual(layout.gutter)
      expect(r.x + r.width).toBeLessThanOrEqual(layout.width - layout.gutter)
      expect(r.y + r.height).toBeLessThanOrEqual(layout.height - layout.gutter)
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        const apart =
          a.x + a.width + 2 * layout.gutter <= b.x ||
          b.x + b.width + 2 * layout.gutter <= a.x ||
          a.y + a.height + 2 * layout.gutter <= b.y ||
          b.y + b.height + 2 * layout.gutter <= a.y
        expect(apart, `${ATLAS_SLOTS[i]} and ${ATLAS_SLOTS[j]}`).toBe(true)
      }
    }
  })

  it('maps pixels to texture coordinates, with v = 1 at the top of the canvas', () => {
    const layout = atlasLayout(4096)
    const first = slotUv(layout, 'AC')
    expect(first.u0).toBeCloseTo(layout.gutter / layout.width)
    expect(first.v1).toBeCloseTo(1 - layout.gutter / layout.height)
    expect(first.u1).toBeGreaterThan(first.u0)
    expect(first.v1).toBeGreaterThan(first.v0)
    expect(() => slotUv(layout, 'XX' as never)).toThrow(/Not an atlas slot/)
  })
})

describe('AtlasImage', () => {
  const layout = atlasLayout(4096)

  it('draws a stand-in in every cell at once, before any art has loaded', () => {
    const fake = fakeAtlasSources({ hold: true })
    const image = new AtlasImage(layout, fake.sources)
    expect(image.complete).toBe(false)
    expect(fake.drawnImages()).toEqual([])
    const texts = fake.calls.filter((c) => c.method === 'fillText').map((c) => c.args[0])
    // Every rank, in red and black, in the corners and the middle.
    for (const rank of ['A', '2', '10', 'J', 'Q', 'K']) expect(texts).toContain(rank)
    expect(texts.filter((t) => t === '10').length).toBe(4 * 3)
  })

  it('draws each face and the back into its own cell as it arrives', async () => {
    const fake = fakeAtlasSources()
    const image = new AtlasImage(layout, fake.sources)
    await image.loaded
    expect(image.complete).toBe(true)
    expect(image.missing).toEqual([])
    const draws = fake.calls.filter((c) => c.method === 'drawImage')
    expect(draws).toHaveLength(53)
    const kc = draws.find((c) => (c.args[0] as FakeImage).url === cardFaceUrl('KC'))
    const cell = slotPixels(layout, 'KC')
    expect(kc?.args.slice(1)).toEqual([cell.x, cell.y, cell.width, cell.height])
    expect(fake.drawnImages()).toContain(CARD_BACK_URL)
  })

  it('keeps the stand-in for art that fails to load, and still finishes', async () => {
    const fake = fakeAtlasSources({ fail: (url) => url === cardFaceUrl('QH') })
    const image = new AtlasImage(layout, fake.sources)
    await expect(image.loaded).resolves.toBeUndefined()
    expect(image.complete).toBe(true)
    expect(image.missing).toEqual(['QH'])
    expect(fake.drawnImages()).toHaveLength(52)
    expect(fake.drawnImages()).not.toContain(cardFaceUrl('QH'))
  })

  it('finishes only once every image has settled', async () => {
    const fake = fakeAtlasSources({ hold: true })
    const image = new AtlasImage(layout, fake.sources)
    await flush()
    expect(image.complete).toBe(false)
    fake.releaseImages()
    await image.loaded
    expect(image.complete).toBe(true)
  })

  it('keeps its canvas in main memory, where a GPU reset cannot blank it', () => {
    const fake = fakeAtlasSources()
    void new AtlasImage(layout, fake.sources)
    expect(fake.contextSettings).toEqual([{ willReadFrequently: true }])
  })

  it('does not let one slow image hold back the rest, and draws it if it comes', async () => {
    const kc = cardFaceUrl('KC')
    const fake = fakeAtlasSources({ hold: (url) => url === kc })
    const listener = vi.fn()
    const image = new AtlasImage(layout, fake.sources, { imageTimeout: 20 })
    image.subscribe(listener)
    await flush()
    expect(image.complete).toBe(false)
    expect(fake.drawnImages()).toHaveLength(52) // the rest are drawn already
    expect(listener).toHaveBeenCalledTimes(52)
    await image.loaded // once KC has timed out
    expect(image.complete).toBe(true)
    expect(image.missing).toEqual(['KC'])
    const revision = image.revision
    fake.releaseImages()
    await flush()
    expect(fake.drawnImages()).toContain(kc)
    expect(image.missing).toEqual([])
    expect(image.revision).toBe(revision + 1)
    expect(listener).toHaveBeenCalledTimes(54) // 52, the timeout, and KC
  })

  it('asks again for art that failed when told to', async () => {
    let broken = true
    const fake = fakeAtlasSources({ fail: (url) => broken && url === cardFaceUrl('2H') })
    const image = new AtlasImage(layout, fake.sources)
    await image.loaded
    expect(image.missing).toEqual(['2H'])
    broken = false
    image.retryFailed()
    expect(image.complete).toBe(false)
    await flush()
    expect(image.complete).toBe(true)
    expect(image.missing).toEqual([])
    expect(fake.drawnImages()).toContain(cardFaceUrl('2H'))
  })

  it('stops telling a listener once it unsubscribes', async () => {
    const fake = fakeAtlasSources({ hold: true })
    const image = new AtlasImage(layout, fake.sources)
    const listener = vi.fn()
    image.subscribe(listener)()
    fake.releaseImages()
    await image.loaded
    expect(listener).not.toHaveBeenCalled()
  })

  it('says so when there is no 2D canvas', () => {
    const fake = fakeAtlasSources()
    const sources = {
      ...fake.sources,
      createCanvas: () => ({ width: 1, height: 1, getContext: () => null }),
    }
    expect(() => new AtlasImage(layout, sources)).toThrow(/2D canvas/)
  })
})

/**
 * An <img> as the browser would load it (jsdom loads no images): `load` fires for any URL
 * not in `broken`, with a size, and decode() does what the test says.
 */
function fakeBrowserImages(options: { broken?: string[]; decode?: () => Promise<void> } = {}) {
  const decode = vi.fn(options.decode ?? (() => Promise.resolve()))
  // jsdom's Image is a factory that ignores subclasses, so the fake is a real <img> with its
  // loading replaced.
  function LoadingImage() {
    const image = document.createElement('img')
    let source = ''
    Object.defineProperties(image, {
      decode: { value: decode },
      naturalWidth: { get: () => 500 },
      src: {
        get: () => source,
        set: (url: string) => {
          source = url
          setTimeout(() => {
            if (options.broken?.some((b) => url.endsWith(b))) image.onerror?.(new Event('error'))
            else image.onload?.(new Event('load'))
          }, 0)
        },
      },
    })
    return image
  }
  vi.stubGlobal('Image', LoadingImage)
  return { decode }
}

describe('cardAtlasImage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('draws the atlas once per page, in a real canvas, with images from the card art', async () => {
    const fake = fakeAtlasSources()
    const context = fake.sources.createCanvas(1, 1).getContext('2d')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as RenderingContext,
    )
    const { decode } = fakeBrowserImages({ broken: [cardFaceUrl('9S')] })

    const image = cardAtlasImage(4096)
    expect(cardAtlasImage(8192)).toBe(image) // the same size of card: the same atlas
    const smaller = cardAtlasImage(2048)
    expect(smaller).not.toBe(image)
    expect(image.canvas).toBeInstanceOf(HTMLCanvasElement)
    expect([image.canvas.width, image.canvas.height]).toEqual([
      image.layout.width,
      image.layout.height,
    ])
    await Promise.all([image.loaded, smaller.loaded])
    expect(image.missing).toEqual(['9S'])
    const urls = fake.calls
      .filter((call) => call.method === 'drawImage')
      .map((call) => (call.args[0] as HTMLImageElement).src)
    expect(urls).toHaveLength(52 + 52) // both atlases
    expect(new Set(urls).size).toBe(52)
    expect(urls.some((url) => url.endsWith(cardFaceUrl('5D')))).toBe(true)
    expect(decode).toHaveBeenCalledTimes(52 + 52)

    // A table mounting again asks again for what failed.
    fakeBrowserImages()
    expect(cardAtlasImage(4096)).toBe(image)
    expect(image.complete).toBe(false)
    await new Promise((resolve) => image.subscribe(() => resolve(undefined)))
    expect(image.missing).toEqual([])
  })

  it('takes an image the browser will not decode ahead of time, as some do with SVG', async () => {
    fakeBrowserImages({ decode: () => Promise.reject(new Error('EncodingError')) })
    const image = await browserSources.loadImage('/cards/AS.svg')
    expect((image as HTMLImageElement).src).toMatch(/AS\.svg$/)
  })

  it('fails for an image that does not load', async () => {
    fakeBrowserImages({ broken: ['/nope.svg'] })
    await expect(browserSources.loadImage('/nope.svg')).rejects.toThrow(/Could not load/)
  })
})

describe('CardAtlas', () => {
  const layout = atlasLayout(4096)

  it('is one sRGB texture with mipmaps and anisotropic filtering', () => {
    const atlas = new CardAtlas(new AtlasImage(layout, fakeAtlasSources().sources), {
      anisotropy: 8,
    })
    const { texture } = atlas
    expect(texture.colorSpace).toBe(SRGBColorSpace)
    expect(texture.generateMipmaps).toBe(true)
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
    expect(texture.anisotropy).toBe(8)
    expect(atlas.uv('5H')).toEqual(slotUv(layout, '5H'))
  })

  it('uploads the art that has arrived after a short wait, without waiting for the rest', async () => {
    const fake = fakeAtlasSources({ hold: true })
    const onChange = vi.fn()
    const atlas = new CardAtlas(new AtlasImage(layout, fake.sources), {
      onChange,
      uploadDelay: 20,
    })
    const version = atlas.texture.version
    fake.releaseImages((url) => url !== cardFaceUrl('AD'))
    await flush()
    // Gathered first: 52 images, no upload yet...
    expect(atlas.texture.version).toBe(version)
    await new Promise((resolve) => setTimeout(resolve, 30))
    // ...then one upload for all of them.
    expect(atlas.texture.version).toBe(version + 1)
    expect(onChange).toHaveBeenCalledTimes(1)
    // The last one completes the atlas and goes up at once.
    fake.releaseImages()
    await atlas.image.loaded
    expect(atlas.texture.version).toBe(version + 2)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('does not upload again when nothing new was drawn', async () => {
    const fake = fakeAtlasSources({ fail: () => true })
    const onChange = vi.fn()
    const atlas = new CardAtlas(new AtlasImage(layout, fake.sources), { onChange })
    const version = atlas.texture.version
    await atlas.image.loaded
    await flush()
    expect(atlas.texture.version).toBe(version)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('uploads again, once, when the art has loaded, and asks for a redraw', async () => {
    const fake = fakeAtlasSources({ hold: true })
    const onChange = vi.fn()
    const atlas = new CardAtlas(new AtlasImage(layout, fake.sources), { onChange })
    const version = atlas.texture.version
    expect(atlas.loaded).toBe(false)
    fake.releaseImages()
    await atlas.image.loaded
    await flush()
    expect(atlas.loaded).toBe(true)
    expect(atlas.texture.version).toBe(version + 1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not upload again for art that had already loaded', async () => {
    const image = new AtlasImage(layout, fakeAtlasSources().sources)
    await image.loaded
    const onChange = vi.fn()
    const atlas = new CardAtlas(image, { onChange })
    const version = atlas.texture.version
    await flush()
    expect(atlas.texture.version).toBe(version)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('releases its texture on dispose, and ignores art that arrives afterwards', async () => {
    const fake = fakeAtlasSources({ hold: true })
    const onChange = vi.fn()
    const atlas = new CardAtlas(new AtlasImage(layout, fake.sources), { onChange })
    const disposed = vi.fn()
    atlas.texture.addEventListener('dispose', disposed)
    atlas.dispose()
    expect(disposed).toHaveBeenCalledTimes(1)
    fake.releaseImages()
    await atlas.image.loaded
    await flush()
    expect(onChange).not.toHaveBeenCalled()
  })
})

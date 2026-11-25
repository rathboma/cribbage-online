import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { fakeAtlasSources } from '@/test/atlas'
import { AtlasImage, atlasLayout } from './cardAtlas'
import {
  MAX_ANISOTROPY,
  MAX_PIXEL_RATIO,
  PLAY_AREA,
  TableScene,
  disposeTree,
  type PageVisibility,
  type TableRenderer,
} from './TableScene'

/** A renderer stand-in that counts what the scene asks of it (jsdom has no WebGL). */
function fakeRenderer() {
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
function manualFrames() {
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
function fakePage() {
  const page = Object.assign(new EventTarget(), { hidden: false })
  return {
    visibility: page as unknown as PageVisibility,
    set hidden(hidden: boolean) {
      page.hidden = hidden
      page.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

function setup() {
  const renderer = fakeRenderer()
  const frames = manualFrames()
  const page = fakePage()
  const onFrame = vi.fn()
  const onContextChange = vi.fn()
  const atlas = fakeAtlasSources({ hold: true })
  const atlasImage = vi.fn((max: number) => new AtlasImage(atlasLayout(max), atlas.sources))
  const scene = new TableScene({
    createRenderer: () => renderer as unknown as TableRenderer,
    frames,
    onFrame,
    onContextChange,
    page: page.visibility,
    atlasImage,
  })
  const canvas = document.createElement('canvas')
  scene.mount(canvas)
  frames.tick() // the first frame after mounting
  return { scene, renderer, frames, canvas, page, onFrame, onContextChange, atlas, atlasImage }
}

describe('TableScene', () => {
  it('draws nothing while idle', () => {
    const { scene, renderer, frames } = setup()
    expect(scene.frameCount).toBe(1)
    for (let i = 0; i < 10; i++) frames.tick()
    expect(frames.pending).toBe(0)
    expect(renderer.render).toHaveBeenCalledTimes(1)
    expect(scene.frameCount).toBe(1)
  })

  it('draws one frame however many times it is invalidated', () => {
    const { scene, renderer, frames, onFrame } = setup()
    scene.invalidate()
    scene.invalidate()
    scene.invalidate()
    expect(frames.pending).toBe(1)
    frames.tick()
    expect(renderer.render).toHaveBeenCalledTimes(2)
    expect(onFrame).toHaveBeenLastCalledWith(2)
  })

  it('draws every frame while something is animating, then stops', () => {
    const { scene, frames } = setup()
    const card = { x: 0 }
    scene.animator.tween(card, { x: 1 }, { duration: 100 })
    expect(frames.pending).toBe(1)
    frames.tick() // starts at 0 ms: no jump after the idle spell
    expect(card.x).toBe(0)
    for (let i = 0; i < 10; i++) frames.tick(20)
    expect(card.x).toBe(1)
    expect(frames.pending).toBe(0)
    // 1 after mounting, 1 at the start, 5 while moving (100 ms in 20 ms steps).
    expect(scene.frameCount).toBe(7)
  })

  it('caps a long gap between frames, so a background tab does not skip animations', () => {
    const { scene, frames } = setup()
    const card = { x: 0 }
    scene.animator.tween(card, { x: 1 }, { duration: 1000 })
    frames.tick()
    frames.tick(5000)
    expect(card.x).toBeGreaterThan(0)
    expect(card.x).toBeLessThan(1)
  })

  it('sizes the drawing buffer, caps the pixel ratio and draws at once on resize', () => {
    const { scene, renderer } = setup()
    scene.resize(390, 700, 3)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(MAX_PIXEL_RATIO)
    expect(renderer.setSize).toHaveBeenLastCalledWith(390, 700, false)
    expect(scene.camera.aspect).toBeCloseTo(390 / 700)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    scene.resize(0, 0, 1) // a hidden box: ignored
    expect(renderer.setSize).toHaveBeenCalledTimes(1)
  })

  it('keeps the play area in view whatever the shape of the screen', () => {
    const { scene } = setup()
    for (const [width, height] of [
      [390, 700],
      [700, 390],
      [1200, 800],
      [300, 900],
    ] as const) {
      scene.resize(width, height, 1)
      const camera = scene.camera
      expect(camera.aspect).toBeCloseTo(width / height)
      // A corner of the play area lands inside the view, near its edge in one direction.
      const corners = [-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => {
          const corner = new Vector3((sx * PLAY_AREA.width) / 2, 0, (sz * PLAY_AREA.depth) / 2)
          const v = corner.project(camera)
          return Math.max(Math.abs(v.x), Math.abs(v.y))
        }),
      )
      expect(Math.max(...corners)).toBeLessThanOrEqual(1)
      expect(Math.max(...corners)).toBeGreaterThan(0.9)
    }
  })

  it('stops drawing while the WebGL context is lost, and redraws once it is back', () => {
    const { scene, renderer, frames, canvas, onContextChange } = setup()
    const lost = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lost)
    expect(scene.contextLost).toBe(true)
    expect(onContextChange).toHaveBeenLastCalledWith(true)
    scene.invalidate()
    scene.animator.tween({ x: 0 }, { x: 1 }, { duration: 100 })
    expect(frames.pending).toBe(0)
    expect(renderer.render).toHaveBeenCalledTimes(1)

    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(onContextChange).toHaveBeenLastCalledWith(false)
    frames.tick()
    expect(renderer.render).toHaveBeenCalledTimes(2)
  })

  it('releases everything on dispose and reports what was left', () => {
    const { scene, renderer, frames, canvas } = setup()
    scene.invalidate()
    const report = scene.dispose()
    expect(report).toEqual({ geometries: 0, textures: 0, contextReleased: true })
    expect(frames.cancel).toHaveBeenCalled()
    expect(frames.pending).toBe(0)
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1)
    expect(scene.scene.children).toHaveLength(0)

    // Nothing reacts any more: no frames, no listeners, a second dispose is harmless.
    scene.invalidate()
    scene.animator.tween({ x: 0 }, { x: 1 }, { duration: 100 })
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(frames.pending).toBe(0)
    expect(scene.dispose()).toBe(report)
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
    expect(() => scene.mount(canvas)).toThrow(/disposed/)
  })

  it("frees textures the renderer bound to its materials, like three.js's shared lookup table", () => {
    const { scene, renderer } = setup()
    const lut = new Texture()
    const disposeLut = vi.spyOn(lut, 'dispose')
    const felt = scene.table.getObjectByName('felt') as Mesh
    renderer.properties.set(felt.material, {
      uniforms: { dfgLUT: { value: lut }, roughness: { value: 1 }, empty: null },
    })
    scene.dispose()
    expect(disposeLut).toHaveBeenCalledTimes(1)
  })

  it('jumps animations to their end while the tab is hidden, and draws once it shows', () => {
    const { scene, frames, page } = setup()
    const moving = { x: 0 }
    scene.animator.tween(moving, { x: 1 }, { duration: 1000 })
    frames.tick()
    page.hidden = true
    expect(moving.x).toBe(1)
    expect(scene.animator.busy).toBe(false)

    // Started while hidden: no frames will come, so it finishes at once.
    const later = { x: 0 }
    const animation = scene.animator.tween(later, { x: 1 }, { duration: 1000 })
    expect(animation.done).toBe(true)
    expect(later.x).toBe(1)

    page.hidden = false
    const before = scene.frameCount
    frames.tick()
    expect(scene.frameCount).toBe(before + 1)
  })

  it('jumps animations to their end when the WebGL context is lost', () => {
    const { scene, canvas } = setup()
    const card = { x: 0 }
    scene.animator.tween(card, { x: 1 }, { duration: 1000 })
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(card.x).toBe(1)
    expect(scene.animator.busy).toBe(false)
  })

  it('keeps drawing when an animation throws', () => {
    const { scene, frames } = setup()
    scene.animator.onError = vi.fn()
    const card = { x: 0 }
    scene.animator.tween(card, { x: 1 }, { duration: 100, ease: (t) => t })
    scene.animator.tween(
      { y: 0 },
      { y: 1 },
      {
        duration: 100,
        onUpdate: () => {
          throw new Error('boom')
        },
      },
    )
    frames.tick()
    frames.tick(50)
    expect(card.x).toBeCloseTo(0.5)
    expect(frames.pending).toBe(1)
    expect(scene.animator.onError).toHaveBeenCalled()
  })

  it('stops listening for visibility changes once disposed', () => {
    const { scene, frames, page } = setup()
    scene.dispose()
    page.hidden = true
    page.hidden = false
    expect(frames.pending).toBe(0)
  })

  it('disposed while the context is lost, it hands the context back if the browser restores it', () => {
    const { scene, renderer, canvas } = setup()
    renderer.forceContextLoss() // the browser takes it
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    renderer.forceContextLoss.mockClear()
    const report = scene.dispose()
    expect(renderer.forceContextLoss).not.toHaveBeenCalled()
    expect(report.contextReleased).toBe(true)
    renderer.restore()
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(renderer.loseContext).toHaveBeenCalledTimes(1)
  })

  it('reports anything the renderer still holds when it is disposed', () => {
    const { scene, renderer } = setup()
    renderer.info.memory.geometries = 2
    expect(scene.dispose().geometries).toBe(2)
  })

  it('makes its cards on first use, sized to the GPU, and keeps them', () => {
    const { scene, atlasImage } = setup()
    expect(atlasImage).not.toHaveBeenCalled() // nothing loads until the cards are wanted
    const cards = scene.cards
    expect(scene.cards).toBe(cards)
    expect(atlasImage).toHaveBeenCalledExactlyOnceWith(4096)
    expect(cards.atlas.texture.anisotropy).toBe(MAX_ANISOTROPY)
  })

  it('has no cards before it is mounted or after it is disposed', () => {
    expect(() => new TableScene().cards).toThrow(/not mounted/)
    const { scene } = setup()
    scene.dispose()
    expect(() => scene.cards).toThrow(/disposed/)
  })

  it('draws again when the card art has loaded', async () => {
    const { scene, frames, atlas } = setup()
    const cards = scene.cards
    scene.table.add(cards.acquire('AS', true))
    expect(frames.pending).toBe(0)
    atlas.releaseImages()
    await cards.atlas.image.loaded
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(frames.pending).toBe(1)
  })

  it('releases the cards with everything else: the atlas texture, the material, every card', () => {
    const { scene } = setup()
    const { cards } = scene
    const onTable = cards.acquire('2D', true)
    scene.table.add(onTable)
    const inPool = cards.acquire()
    cards.release(inPool)
    const spies = [
      cards.atlas.texture,
      cards.material,
      onTable.body.geometry,
      inPool.body.geometry,
    ].map((thing) => {
      const spy = vi.fn()
      thing.addEventListener('dispose', spy)
      return spy
    })
    scene.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })

  it('reports what the GPU holds while mounted', () => {
    const { scene, renderer } = setup()
    renderer.info.memory.textures = 4
    expect(scene.gpuMemory).toEqual({ geometries: 0, textures: 4 })
    scene.dispose()
    expect(scene.gpuMemory).toBeNull()
  })

  it('refuses to mount twice', () => {
    const { scene, canvas } = setup()
    expect(() => scene.mount(canvas)).toThrow(/already mounted/)
  })
})

describe('disposeTree', () => {
  it('disposes every geometry, material and texture once, shared or not', () => {
    const geometry = new BoxGeometry()
    const map = new Texture()
    const material = new MeshStandardMaterial({ map })
    const root = new Mesh(geometry, material)
    root.add(new Mesh(geometry, [material, material]))
    const spies = [geometry, material, map].map((thing) => vi.spyOn(thing, 'dispose'))
    disposeTree(root)
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
  })
})

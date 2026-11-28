import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Light,
  Material,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three'
import { colors } from '@/design/tokens'
import { Animator } from './anim'
import { cardAtlasImage, type AtlasImage } from './cardAtlas'
import { CardPool } from './CardPool'

/**
 * The 3D table: renderer, camera, lights, the felt and its wooden rail. A plain class with no
 * Vue in it; GameTable.vue owns the canvas and calls mount/resize/dispose.
 *
 * Frames are drawn on demand: after invalidate() (something changed), after a resize, and
 * while the animator has something playing. An idle table draws nothing.
 *
 * World units: 1 unit is about 6 cm, so a card is about 1 unit wide. +x is to the right,
 * +y is up, and +z points towards this player, who sits on the near (+z) side.
 */

/** The part of the table the camera always keeps in view, centred on the origin. */
export const PLAY_AREA = { width: 8, depth: 11 } as const

/** The whole table top (felt), larger than the play area so the felt fills a phone screen. */
export const TABLE = { width: 15, depth: 19, railWidth: 0.7, railHeight: 0.18 } as const

/** Sharper than this costs a lot of fill rate on phones for little visible gain. */
export const MAX_PIXEL_RATIO = 2

/** Sharper card art at glancing angles than this costs phones more than it shows. */
export const MAX_ANISOTROPY = 8

/** After a long pause (a background tab), animations jump at most this far in one frame. */
const MAX_FRAME_MS = 100

/** How far the camera leans back from looking straight down. */
const CAMERA_TILT = MathUtils.degToRad(24)
/** Fraction of the view kept clear around the play area. */
const VIEW_MARGIN = 0.04

/** The parts of a WebGLRenderer the scene uses (tests pass a stand-in). */
export type TableRenderer = Pick<
  WebGLRenderer,
  | 'setPixelRatio'
  | 'setSize'
  | 'render'
  | 'dispose'
  | 'forceContextLoss'
  | 'getContext'
  | 'info'
  | 'properties'
  | 'shadowMap'
  | 'capabilities'
>

/** When to draw: requestAnimationFrame in the browser, by hand in tests. */
export interface FrameScheduler {
  request(callback: (time: number) => void): number
  cancel(handle: number): void
}

export interface TableSceneOptions {
  createRenderer?: (canvas: HTMLCanvasElement) => TableRenderer
  frames?: FrameScheduler
  /** Called after every frame that is drawn. */
  onFrame?: (frameCount: number) => void
  /** Called when the browser takes the WebGL context away (true) and gives it back (false). */
  onContextChange?: (lost: boolean) => void
  /** Whether the page is hidden, and its `visibilitychange` events: `document` by default. */
  page?: PageVisibility
  /** The card atlas for a GPU's texture size limit: the page's cached one by default. */
  atlasImage?: (maxTextureSize: number) => AtlasImage
}

export type PageVisibility = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>

/** What was still allocated on the GPU when the scene was disposed: all zero when clean. */
export interface DisposeReport {
  geometries: number
  textures: number
  /** The WebGL context was handed back to the browser. */
  contextReleased: boolean
}

function defaultRenderer(canvas: HTMLCanvasElement): TableRenderer {
  return new WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' })
}

const browserFrames: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
}

export class TableScene {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(36, 1, 0.5, 200)
  /** Everything that moves goes through this; it wakes the frame loop when it starts. */
  readonly animator = new Animator()
  /** The table top: things on the table (cards, the board) are added here. */
  readonly table = new Group()

  private renderer: TableRenderer | null = null
  private cardPool: CardPool | null = null
  private canvas: HTMLCanvasElement | null = null
  private frameHandle: number | null = null
  private lastFrameTime: number | null = null
  private frames = 0
  private lost = false
  private disposed = false
  private report: DisposeReport | null = null

  private readonly createRenderer: (canvas: HTMLCanvasElement) => TableRenderer
  private readonly scheduler: FrameScheduler
  private readonly onFrame?: (frameCount: number) => void
  private readonly onContextChange?: (lost: boolean) => void
  private readonly page: PageVisibility | null
  private readonly atlasImage: (maxTextureSize: number) => AtlasImage

  constructor(options: TableSceneOptions = {}) {
    this.createRenderer = options.createRenderer ?? defaultRenderer
    this.scheduler = options.frames ?? browserFrames
    this.onFrame = options.onFrame
    this.onContextChange = options.onContextChange
    this.page = options.page ?? (typeof document === 'undefined' ? null : document)
    this.atlasImage = options.atlasImage ?? cardAtlasImage
    this.animator.onWake = () => {
      if (this.paused) this.animator.completeAll()
      this.invalidate()
    }
    this.build()
  }

  /**
   * No frames can be drawn: the tab is hidden (the browser stops animation frames) or the
   * WebGL context is gone. Animations then jump straight to their end instead of waiting, so
   * nothing that awaits one stalls, and the table shows the latest state once it can draw.
   */
  private get paused(): boolean {
    return this.lost || (this.page?.hidden ?? false)
  }

  /** Frames drawn since mount. */
  get frameCount(): number {
    return this.frames
  }

  /** True while the browser has taken the WebGL context away. */
  get contextLost(): boolean {
    return this.lost
  }

  /**
   * The cards: meshes to put on the table, sharing one atlas texture and one material. Made on
   * first use, which starts loading the card art; only once mounted, because the atlas is
   * sized to the GPU's limits. Disposed with the scene.
   */
  get cards(): CardPool {
    if (this.disposed) throw new Error('TableScene: already disposed')
    const renderer = this.renderer
    if (!renderer) throw new Error('TableScene: not mounted')
    this.cardPool ??= new CardPool({
      image: this.atlasImage(renderer.capabilities.maxTextureSize),
      anisotropy: Math.min(renderer.capabilities.getMaxAnisotropy(), MAX_ANISOTROPY),
      onChange: () => this.invalidate(),
    })
    return this.cardPool
  }

  /** Geometries and textures the renderer holds on the GPU now (null before mounting). */
  get gpuMemory(): { geometries: number; textures: number } | null {
    if (!this.renderer) return null
    const { geometries, textures } = this.renderer.info.memory
    return { geometries, textures }
  }

  /** Starts drawing into `canvas`. Throws if WebGL is not available. */
  mount(canvas: HTMLCanvasElement): void {
    if (this.disposed) throw new Error('TableScene: already disposed')
    if (this.renderer) throw new Error('TableScene: already mounted')
    const renderer = this.createRenderer(canvas)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFShadowMap
    // three.js listens for these too (and restores its own state first, having been added
    // first); the scene stops drawing while the context is gone and redraws once it is back.
    canvas.addEventListener('webglcontextlost', this.handleContextLost)
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored)
    this.page?.addEventListener('visibilitychange', this.handleVisibility)
    this.renderer = renderer
    this.canvas = canvas
    this.invalidate()
  }

  /**
   * Matches the drawing buffer to the canvas's CSS size and redraws at once, so the browser
   * never shows a stretched or cleared canvas in between.
   */
  resize(width: number, height: number, devicePixelRatio: number): void {
    const renderer = this.renderer
    if (!renderer || width <= 0 || height <= 0) return
    renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1), MAX_PIXEL_RATIO))
    renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.fitCamera()
    this.draw()
  }

  /** Something changed: draw a frame soon (once, however many times this is called). */
  invalidate(): void {
    if (!this.renderer || this.lost || this.frameHandle !== null) return
    this.frameHandle = this.scheduler.request(this.frame)
  }

  /**
   * Releases everything: frames, listeners, geometries, materials, textures and the WebGL
   * context. The scene can't be used afterwards. Returns what was left on the GPU.
   */
  dispose(): DisposeReport {
    if (this.report) return this.report
    this.disposed = true
    if (this.frameHandle !== null) this.scheduler.cancel(this.frameHandle)
    this.frameHandle = null
    this.animator.onWake = null
    this.animator.cancelAll()
    const canvas = this.canvas
    canvas?.removeEventListener('webglcontextlost', this.handleContextLost)
    canvas?.removeEventListener('webglcontextrestored', this.handleContextRestored)
    this.page?.removeEventListener('visibilitychange', this.handleVisibility)

    // The cards first, on and off the table (those back in the pool are not in the scene for
    // disposeTree to find). They leave the scene, so their atlas is released once, here.
    this.cardPool?.dispose()
    this.cardPool = null
    const renderer = this.renderer
    // Collected before the rest: disposing a material makes the renderer forget its uniforms.
    const bound = renderer ? boundTextures(this.scene, renderer) : []
    disposeTree(this.scene)
    if (this.scene.background instanceof Texture) this.scene.background.dispose()
    for (const texture of bound) texture.dispose()
    this.scene.clear()

    let report: DisposeReport = { geometries: 0, textures: 0, contextReleased: true }
    if (renderer) {
      // Counted before the renderer's own clean-up, so anything the scene forgot shows here.
      const { geometries, textures } = renderer.info.memory
      renderer.dispose()
      const gl = renderer.getContext()
      if (this.lost) {
        // Already gone, so there is nothing to hand back now. But three.js asked the browser
        // to restore it, so hand it back if that happens.
        canvas?.addEventListener(
          'webglcontextrestored',
          () => gl.getExtension('WEBGL_lose_context')?.loseContext(),
          { once: true },
        )
      } else {
        renderer.forceContextLoss()
      }
      report = { geometries, textures, contextReleased: gl.isContextLost() }
    }
    this.renderer = null
    this.canvas = null
    this.report = report
    return report
  }

  private readonly frame = (time: number) => {
    this.frameHandle = null
    if (!this.renderer || this.lost) return
    const dt = this.lastFrameTime === null ? 0 : Math.min(time - this.lastFrameTime, MAX_FRAME_MS)
    try {
      this.animator.advance(dt)
    } finally {
      // Whatever an animation did, the frame is drawn and the loop goes on.
      this.draw()
      if (this.animator.busy) {
        this.lastFrameTime = time
        this.invalidate()
      } else {
        // The next animation starts from its first frame, not from the end of a long idle gap.
        this.lastFrameTime = null
      }
    }
  }

  private draw() {
    if (!this.renderer || this.lost) return
    this.renderer.render(this.scene, this.camera)
    this.frames++
    this.onFrame?.(this.frames)
  }

  private readonly handleContextLost = () => {
    this.lost = true
    if (this.frameHandle !== null) this.scheduler.cancel(this.frameHandle)
    this.frameHandle = null
    this.lastFrameTime = null
    this.animator.completeAll()
    this.onContextChange?.(true)
  }

  private readonly handleVisibility = () => {
    if (this.page?.hidden) {
      this.animator.completeAll()
      this.lastFrameTime = null
    }
    // Drawn when the tab shows again (the browser holds animation frames until then).
    this.invalidate()
  }

  private readonly handleContextRestored = () => {
    this.lost = false
    this.onContextChange?.(false)
    this.invalidate()
  }

  /** Puts the camera as close as it can be while the whole play area stays in view. */
  private fitCamera() {
    const camera = this.camera
    const target = new Vector3(0, 0, 0)
    const direction = new Vector3(0, Math.cos(CAMERA_TILT), Math.sin(CAMERA_TILT))
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => new Vector3((sx * PLAY_AREA.width) / 2, 0, (sz * PLAY_AREA.depth) / 2)),
    )
    const place = (distance: number) => {
      camera.position.copy(direction).multiplyScalar(distance).add(target)
      camera.lookAt(target)
      camera.updateMatrixWorld()
    }
    const point = new Vector3()
    const fits = () =>
      corners.every((corner) => {
        point.copy(corner).applyMatrix4(camera.matrixWorldInverse)
        if (point.z > -camera.near) return false // behind the camera
        point.applyMatrix4(camera.projectionMatrix)
        return Math.abs(point.x) <= 1 - VIEW_MARGIN && Math.abs(point.y) <= 1 - VIEW_MARGIN
      })

    camera.updateProjectionMatrix()
    // Further away always shows more, so a binary search finds the closest distance that fits.
    let near = 1
    let far = 150
    for (let i = 0; i < 32; i++) {
      const mid = (near + far) / 2
      place(mid)
      if (fits()) far = mid
      else near = mid
    }
    place(far)
  }

  private build() {
    const { scene } = this
    scene.background = new Color(colors.feltDark)

    // Soft light from everywhere, warm from above and green bouncing off the felt...
    scene.add(new HemisphereLight(0xfff6e6, colors.feltDark, 1.2))
    // ...and one lamp above and to the right. Its light is parallel, so every card on the table
    // casts the same soft shadow wherever it lies.
    const lamp = new DirectionalLight(0xfff8ee, 1.9)
    lamp.position.set(3, 12, 6)
    lamp.castShadow = true
    lamp.shadow.mapSize.set(1024, 1024)
    lamp.shadow.radius = 4
    lamp.shadow.bias = -0.0005
    lamp.shadow.normalBias = 0.02
    const reach = Math.max(PLAY_AREA.width, PLAY_AREA.depth) / 2 + 1.5
    Object.assign(lamp.shadow.camera, {
      left: -reach,
      right: reach,
      top: reach,
      bottom: -reach,
      near: 4,
      far: 26,
    })
    lamp.shadow.camera.updateProjectionMatrix()
    scene.add(lamp, lamp.target)

    const felt = new Mesh(
      feltGeometry(),
      new MeshStandardMaterial({
        color: colors.felt,
        vertexColors: true,
        roughness: 0.95,
        metalness: 0,
      }),
    )
    felt.name = 'felt'
    felt.rotation.x = -Math.PI / 2
    felt.receiveShadow = true
    this.table.add(felt)
    this.table.add(rail())
    scene.add(this.table)
  }
}

/**
 * The felt, shaded from the middle out: full brightness over the play area, darker towards
 * the rail, like a table under a lamp. The shading is in the vertex colours, so it costs no
 * texture.
 */
function feltGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(TABLE.width, TABLE.depth, 30, 38)
  const position = geometry.getAttribute('position')
  const shade = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    // The plane lies in x/y before it is turned flat; y becomes -z.
    const dx = position.getX(i) / (PLAY_AREA.width * 0.8)
    const dy = position.getY(i) / (PLAY_AREA.depth * 0.8)
    const t = MathUtils.smoothstep(Math.hypot(dx, dy), 0.45, 1.5)
    shade.fill(1 - 0.42 * t, i * 3, i * 3 + 3)
  }
  geometry.setAttribute('color', new BufferAttribute(shade, 3))
  return geometry
}

/** The wooden rail around the felt: two long sides and two short ones. */
function rail(): Group {
  const { width, depth, railWidth: w, railHeight: h } = TABLE
  const wood = new MeshStandardMaterial({ color: colors.wood, roughness: 0.6, metalness: 0 })
  const sides = new BoxGeometry(w, h, depth + 2 * w)
  const ends = new BoxGeometry(width, h, w)
  const group = new Group()
  group.name = 'rail'
  for (const [geometry, x, z] of [
    [sides, -(width + w) / 2, 0],
    [sides, (width + w) / 2, 0],
    [ends, 0, -(depth + w) / 2],
    [ends, 0, (depth + w) / 2],
  ] as const) {
    const piece = new Mesh(geometry, wood)
    piece.position.set(x, h / 2, z)
    piece.castShadow = true
    piece.receiveShadow = true
    group.add(piece)
  }
  return group
}

/**
 * Textures the renderer bound to the materials under `root` that the materials don't own. One
 * matters: three.js gives physically based materials a lookup table texture that every renderer
 * shares, so disposing a material never frees it. Disposing a texture only frees its GPU copy,
 * so this is safe even for a texture something else still uses: it is uploaded again if needed.
 */
function boundTextures(root: Object3D, renderer: TableRenderer): Texture[] {
  const found = new Set<Texture>()
  root.traverse((object) => {
    const { material } = object as Partial<Mesh>
    for (const m of [material ?? []].flat() as Material[]) {
      if (!renderer.properties.has(m)) continue
      const { uniforms } = renderer.properties.get(m) as { uniforms?: Record<string, unknown> }
      for (const uniform of Object.values(uniforms ?? {})) {
        const value = (uniform as { value?: unknown } | null)?.value
        if (value instanceof Texture) found.add(value)
      }
    }
  })
  return [...found]
}

/** Disposes every geometry, material, texture and shadow map under `root`, each once. */
export function disposeTree(root: Object3D): void {
  const seen = new Set<{ dispose(): void }>()
  const release = (thing: { dispose(): void } | null | undefined) => {
    if (!thing || seen.has(thing)) return
    seen.add(thing)
    thing.dispose()
  }
  root.traverse((object) => {
    const { geometry, material } = object as Partial<Mesh>
    release(geometry)
    for (const m of [material ?? []].flat() as Material[]) {
      for (const value of Object.values(m)) if (value instanceof Texture) release(value)
      release(m)
    }
    if (object instanceof Light) release(object) // a light's dispose frees its shadow map
  })
}

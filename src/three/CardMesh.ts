import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Mesh,
  Object3D,
  type Material,
} from 'three'
import type { CardId } from '@shared/engine/cards'
import { CARD_HEIGHT_PER_WIDTH } from '@/game/cardArt'
import { ease, stopTweensOf, Timeline } from './anim'
import { CORNER_RADIUS_PER_WIDTH, type AtlasSlot, type UvRect } from './cardAtlas'

/**
 * A playing card on the 3D table: a thin rounded rectangle whose faces show cells of the card
 * atlas. Every card shares one material (and with it the one atlas texture); a card picks its
 * face by rewriting the UVs of its own small geometry.
 *
 * A card the client hasn't seen (the opponent's hand, the deck) has no face: its front shows
 * the atlas's blank cell, so nothing about the card is in the mesh until `setFace` is called,
 * e.g. when the opponent plays it or at the show.
 *
 * In its own space the card lies flat, front up (+y), with the top of its art away from the
 * player (−z). The layout moves and turns the CardMesh; turning the card over happens inside
 * it, on `body`, about the card's long axis, so the two never interfere.
 */

/** World units; a unit is about 6 cm, so this is close to a real card's 6.35 cm. */
export const CARD_WIDTH = 1
export const CARD_HEIGHT = CARD_WIDTH * CARD_HEIGHT_PER_WIDTH
/** About 0.5 mm: a little thicker than a real card, so stacks and edges read on screen. */
export const CARD_THICKNESS = 0.008
const CORNER_RADIUS = CARD_WIDTH * CORNER_RADIUS_PER_WIDTH
const CORNER_SEGMENTS = 6

/** Looks up a slot's rectangle in the atlas (CardAtlas.uv). */
export type AtlasUv = (slot: AtlasSlot) => UvRect

/**
 * The outline, counter-clockwise seen from above, as [x, z] pairs with the outward direction
 * of the edge at each point.
 */
function outline(): { x: number; z: number; nx: number; nz: number }[] {
  const hw = CARD_WIDTH / 2 - CORNER_RADIUS
  const hh = CARD_HEIGHT / 2 - CORNER_RADIUS
  // Corner centres in (x, up) where up = −z, going round counter-clockwise from top right.
  const corners = [
    [hw, hh],
    [-hw, hh],
    [-hw, -hh],
    [hw, -hh],
  ] as const
  const points: { x: number; z: number; nx: number; nz: number }[] = []
  corners.forEach(([cx, cy], quarter) => {
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const angle = ((quarter + i / CORNER_SEGMENTS) * Math.PI) / 2
      const nx = Math.cos(angle)
      const ny = Math.sin(angle)
      points.push({ x: cx + CORNER_RADIUS * nx, z: -(cy + CORNER_RADIUS * ny), nx, nz: -ny })
    }
  })
  return points
}

/**
 * The card's shape, shared by every card: positions, normals and triangles, and for each front
 * and back vertex where it falls on the card (0..1 across, 0..1 bottom to top), from which
 * `setFace` works out its UVs.
 */
const template = (() => {
  const ring = outline()
  const n = ring.length
  const half = CARD_THICKNESS / 2
  const positions: number[] = []
  const normals: number[] = []
  /** Where each vertex is on the art, for the front (s, t) and back (mirrored) faces. */
  const along: number[] = []
  const indices: number[] = []
  const toArt = (x: number, z: number) => [x / CARD_WIDTH + 0.5, -z / CARD_HEIGHT + 0.5]

  // Front: a fan from the centre (the outline is convex). Vertices 0..n.
  positions.push(0, half, 0)
  normals.push(0, 1, 0)
  along.push(...toArt(0, 0))
  for (const p of ring) {
    positions.push(p.x, half, p.z)
    normals.push(0, 1, 0)
    along.push(...toArt(p.x, p.z))
  }
  for (let i = 0; i < n; i++) indices.push(0, 1 + i, 1 + ((i + 1) % n))
  const frontCount = n + 1

  // Back: the same fan facing down. It is seen after the card turns over about its long axis,
  // which mirrors x, so its art is mirrored back to read the right way round.
  const back = frontCount
  positions.push(0, -half, 0)
  normals.push(0, -1, 0)
  along.push(...toArt(0, 0))
  for (const p of ring) {
    positions.push(p.x, -half, p.z)
    normals.push(0, -1, 0)
    along.push(...toArt(-p.x, p.z))
  }
  for (let i = 0; i < n; i++) indices.push(back, back + 1 + ((i + 1) % n), back + 1 + i)
  const backCount = n + 1

  // Edge: a strip of quads around the outline, facing outwards.
  const edge = back + backCount
  for (const p of ring) {
    positions.push(p.x, half, p.z, p.x, -half, p.z)
    normals.push(p.nx, 0, p.nz, p.nx, 0, p.nz)
    along.push(0.5, 0.5, 0.5, 0.5)
  }
  for (let i = 0; i < n; i++) {
    const a = edge + 2 * i
    const b = edge + 2 * ((i + 1) % n)
    indices.push(a, a + 1, b, b, a + 1, b + 1)
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    along: new Float32Array(along),
    indices,
    front: { start: 0, count: frontCount },
    back: { start: back, count: backCount },
    edge: { start: edge, count: 2 * n },
    vertexCount: positions.length / 3,
  }
})()

/** Which vertices of a card's geometry belong to each part (for tests). */
export const CARD_PARTS = {
  front: template.front,
  back: template.back,
  edge: template.edge,
} as const

function cardGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(template.positions.slice(), 3))
  geometry.setAttribute('normal', new BufferAttribute(template.normals.slice(), 3))
  const uv = new BufferAttribute(new Float32Array(template.vertexCount * 2), 2)
  uv.setUsage(DynamicDrawUsage)
  geometry.setAttribute('uv', uv)
  geometry.setIndex(template.indices)
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

/** Points the UVs of vertices [start, start + count) at `rect`. */
function mapPart(uv: BufferAttribute, part: { start: number; count: number }, rect: UvRect) {
  for (let i = part.start; i < part.start + part.count; i++) {
    const s = template.along[2 * i]!
    const t = template.along[2 * i + 1]!
    uv.setXY(i, rect.u0 + s * (rect.u1 - rect.u0), rect.v0 + t * (rect.v1 - rect.v0))
  }
}

export interface FlipOptions {
  /** Which way up the card ends; by default, the other way from now. */
  faceUp?: boolean
  /**
   * The face to show, set at the moment the card is edge-on so it is never seen before it is
   * revealed. Null clears it (for a card turned down that the viewer may no longer know).
   * Left out, the face stays as it is.
   */
  face?: CardId | null
  /** Milliseconds. */
  duration?: number
  /** How high the card rises while it turns, in world units: enough to clear the table. */
  lift?: number
}

export const FLIP_DURATION = 420
/** Half a card's width, so its edge never dips into the table, and a little more. */
export const FLIP_LIFT = CARD_WIDTH * 0.6

/**
 * The angle that shows the same side as `goal` (0 front up, π face down) nearest to `from`,
 * forwards when there is a tie: a fresh flip always rolls the same way, and one that reverses
 * another part way through rolls back the short way.
 */
function nearestTurn(from: number, goal: number): number {
  const turn = 2 * Math.PI
  const forwards = goal + turn * Math.ceil((from - goal) / turn - 1e-9)
  const backwards = forwards - turn
  return forwards - from <= from - backwards + 1e-9 ? forwards : backwards
}

export class CardMesh extends Object3D {
  readonly isCardMesh = true
  /** The card itself. It turns over inside the CardMesh, which the layout positions. */
  readonly body: Mesh<BufferGeometry, Material>
  private currentFace: CardId | null = null
  private frontUp = false
  /**
   * Counts turns of the card (flips, setFaceUp, going back to the pool). A flip only finishes
   * while it is the latest, so the newest instruction wins, as it does for tweens.
   */
  private turns = 0

  constructor(
    material: Material,
    private readonly atlasUv: AtlasUv,
  ) {
    super()
    this.name = 'card'
    const body = new Mesh(cardGeometry(), material)
    body.name = 'card-body'
    body.castShadow = true
    body.receiveShadow = true
    this.body = body
    this.add(body)
    const uv = body.geometry.getAttribute('uv') as BufferAttribute
    mapPart(uv, template.back, atlasUv('back'))
    // The edge is card stock: the middle of the blank face.
    const blank = atlasUv('blank')
    const u = (blank.u0 + blank.u1) / 2
    const v = (blank.v0 + blank.v1) / 2
    mapPart(uv, template.edge, { u0: u, v0: v, u1: u, v1: v })
    this.setFace(null)
    this.setFaceUp(false)
  }

  /** The card this mesh shows, or null for a card nobody has seen. */
  get face(): CardId | null {
    return this.currentFace
  }

  /** Whether the front is up: as last set, or as it will be when the flip in progress ends. */
  get faceUp(): boolean {
    return this.frontUp
  }

  /** Shows this card on the front, or the blank face for null. */
  setFace(face: CardId | null): void {
    this.currentFace = face
    const uv = this.body.geometry.getAttribute('uv') as BufferAttribute
    mapPart(uv, template.front, this.atlasUv(face ?? 'blank'))
    uv.needsUpdate = true
  }

  /** Turns the card front up or down at once, ending any flip in progress. */
  setFaceUp(faceUp: boolean): void {
    this.turns++
    this.frontUp = faceUp
    this.body.rotation.z = faceUp ? 0 : Math.PI
    this.body.position.y = 0
  }

  /**
   * Turns the card over: it rises, rolls about its long axis and settles where it was. Returns
   * the animation as a timeline, for the animator or a longer timeline.
   *
   * Which way up it ends is decided now (by default, the other way from `faceUp`), so build it
   * just before playing it. If the card already lies, or is already turning, that way up, only
   * the face changes, at once. Otherwise the newest instruction wins: a flip that starts while
   * another is playing takes over from wherever the card is, and setFaceUp or returning the
   * card to the pool stops a flip, reveal and all.
   */
  flip(options: FlipOptions = {}): Timeline {
    const faceUp = options.faceUp ?? !this.frontUp
    const reveal = () => {
      if (options.face !== undefined) this.setFace(options.face)
    }
    if (faceUp === this.frontUp) return new Timeline().call(reveal)

    const duration = Math.max(0, options.duration ?? FLIP_DURATION)
    const lift = options.lift ?? FLIP_LIFT
    const { body } = this
    // One tween drives the whole motion, so a flip that is no longer current moves nothing.
    const progress = { t: 0 }
    let turn = -1
    let fromAngle = 0
    let toAngle = 0
    let fromHeight = 0
    const current = () => this.turns === turn
    return new Timeline()
      .call(() => {
        turn = ++this.turns
        this.frontUp = faceUp
        progress.t = 0
        fromAngle = body.rotation.z
        fromHeight = body.position.y
        toAngle = nearestTurn(fromAngle, faceUp ? 0 : Math.PI)
      })
      .to(
        progress,
        { t: 1 },
        {
          duration,
          ease: ease.linear,
          onUpdate: () => {
            if (!current()) return
            const t = progress.t
            body.rotation.z = fromAngle + (toAngle - fromAngle) * ease.inOutCubic(t)
            // Up and down again, highest when the card is edge-on.
            body.position.y = fromHeight * (1 - t) + lift * 4 * t * (1 - t)
          },
        },
        0,
      )
      .call(() => {
        if (current()) reveal()
      }, duration / 2)
      .call(() => {
        if (current()) this.setFaceUp(faceUp)
      }, duration)
  }

  /** Back to how a new card starts: no face, face down, at the origin, nothing animating it. */
  reset(): void {
    stopTweensOf(this.position)
    stopTweensOf(this.rotation)
    stopTweensOf(this.scale)
    stopTweensOf(this.body.position)
    stopTweensOf(this.body.rotation)
    this.removeFromParent()
    this.position.set(0, 0, 0)
    this.rotation.set(0, 0, 0)
    this.scale.set(1, 1, 1)
    this.visible = true
    this.setFace(null)
    this.setFaceUp(false)
  }

  /** Frees the card's geometry. The shared material and texture belong to the pool. */
  override dispose(): void {
    this.removeFromParent()
    this.body.geometry.dispose()
    super.dispose()
  }
}

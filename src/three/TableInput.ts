import { Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three'
import { ease, stopTweensOf } from './anim'
import type { CardLayer } from './applyLayout'
import { toScreen } from './camera'
import { CARD_HEIGHT, CARD_WIDTH, CardMesh } from './CardMesh'
import type { TableScene } from './TableScene'

/**
 * Pointer and touch input on the 3D table: which card is under a finger or the mouse, what a
 * tap means for it, and the small responses that say so (a hovered card lifts, a card that
 * can't be used now is dimmed and shakes when tapped).
 *
 * It knows no rules. The game screen says which cards respond and how (`setTargets`, by layout
 * key, worked out from the view's legal moves) and is told which one was tapped (`onTap`); what
 * a tap does is decided there, through the same store actions the simple table uses.
 *
 * Hit areas are the cards as drawn: a ray from the camera through the pointer, against every
 * card on the table, nearest first, so a card that overlaps another in a fan takes the taps on
 * the part of it that is on top. Pointer positions are in CSS pixels from the canvas's top left.
 */

/**
 * How a card responds. usable: lifts under the mouse and can be tapped. selected: picked (for
 * the crib), and tapping puts it back. blocked: it's this player's move, but not with this
 * card: dimmed, and it shakes when tapped. idle: nothing to do with it now: a little dimmed.
 */
export type TargetState = 'usable' | 'selected' | 'blocked' | 'idle'

/** How bright each state draws its card (1 is as printed). */
export const TARGET_TINT: Record<TargetState, number> = {
  usable: 1,
  selected: 1,
  idle: 0.86,
  blocked: 0.55,
}

/** How far a hovered card slides up the table, in the card's own units. */
export const HOVER_LIFT = 0.1 * CARD_HEIGHT
export const HOVER_MS = 110
/** The "no" shake: side to side, dying away. */
export const SHAKE = { distance: 0.06 * CARD_WIDTH, duration: 340, swings: 3 }
/** A press that moves further than this (CSS pixels) is a drag, not a tap. */
export const TAP_SLOP = 10

/** One pointer event, in canvas coordinates. */
export interface TablePointer {
  x: number
  y: number
  /** PointerEvent.pointerId. */
  id: number
  /** PointerEvent.pointerType: 'mouse', 'touch' or 'pen'. */
  type: string
  /** PointerEvent.button: only the main mouse button taps. */
  button?: number
  /** PointerEvent.isPrimary: a second finger is never a tap. */
  primary?: boolean
}

export type TableCursor = 'pointer' | 'default'

export interface TableInputOptions {
  /** A usable or selected card was tapped. */
  onTap: (key: string) => void
  /** The cursor the canvas should show, when it changes. */
  onCursor?: (cursor: TableCursor) => void
  /** prefers-reduced-motion: hovering moves at once and nothing shakes. */
  reducedMotion?: () => boolean
}

interface Press {
  id: number
  x: number
  y: number
  key: string | null
  moved: boolean
}

export class TableInput {
  private targets = new Map<string, TargetState>()
  private hovered: string | null = null
  private press: Press | null = null
  /** Where the mouse is over the table, so hovering follows a layout that moves under it. */
  private mouse: { x: number; y: number } | null = null
  private cursor: TableCursor = 'default'
  /** The shake each card is doing, so a newer one (or the card's next use) stops the old one. */
  private readonly shakes = new WeakMap<CardMesh, object>()
  private readonly raycaster = new Raycaster()
  private readonly ndc = new Vector2()
  private readonly centre = new Vector3()
  private disposed = false

  private readonly onTap: (key: string) => void
  private readonly onCursor?: (cursor: TableCursor) => void
  private readonly reducedMotion: () => boolean

  constructor(
    private readonly scene: TableScene,
    private readonly layer: CardLayer,
    options: TableInputOptions,
  ) {
    this.onTap = options.onTap
    this.onCursor = options.onCursor
    this.reducedMotion = options.reducedMotion ?? (() => false)
  }

  /** The card the mouse is over, lifted, if it is usable. */
  get hoveredKey(): string | null {
    return this.hovered
  }

  /** How the card with this key responds now (undefined: it takes no input). */
  stateOf(key: string): TargetState | undefined {
    return this.targets.get(key)
  }

  /**
   * Which cards respond, and how, by layout key; every other card takes no input and is drawn
   * as printed. Call it after every layout, with the targets for that layout.
   */
  setTargets(targets: ReadonlyMap<string, TargetState>): void {
    if (this.disposed) return
    for (const key of this.targets.keys()) {
      if (!targets.has(key)) this.layer.get(key)?.setTint(1)
    }
    this.targets = new Map(targets)
    for (const [key, state] of this.targets) this.layer.get(key)?.setTint(TARGET_TINT[state])
    // The cards may have moved under a mouse that hasn't: hover whatever is there now.
    const under = this.mouse ? this.pick(this.mouse.x, this.mouse.y) : null
    this.hover(under)
    this.updateCursor(under)
    this.scene.invalidate()
  }

  pointerDown(p: TablePointer): void {
    if (this.disposed) return
    if (p.type === 'mouse' && (p.button ?? 0) !== 0) return
    if (p.primary === false || (this.press && this.press.id !== p.id)) {
      // A second finger: a pinch or a slip, not a tap.
      this.press = null
      return
    }
    this.press = { id: p.id, x: p.x, y: p.y, key: this.pick(p.x, p.y), moved: false }
  }

  pointerMove(p: TablePointer): void {
    if (this.disposed) return
    const press = this.press
    if (press && press.id === p.id && Math.hypot(p.x - press.x, p.y - press.y) > TAP_SLOP) {
      press.moved = true
    }
    if (p.type !== 'mouse') return
    this.mouse = { x: p.x, y: p.y }
    const under = this.pick(p.x, p.y)
    this.hover(under)
    this.updateCursor(under)
  }

  pointerUp(p: TablePointer): void {
    if (this.disposed) return
    const press = this.press
    if (!press || press.id !== p.id) return
    this.press = null
    if (press.moved || Math.hypot(p.x - press.x, p.y - press.y) > TAP_SLOP) return
    const key = this.pick(p.x, p.y)
    // Pressed on one card and let go on another: neither is tapped.
    if (key === null || key !== press.key) return
    this.activate(key)
  }

  pointerCancel(p: Pick<TablePointer, 'id'>): void {
    if (this.press?.id === p.id) this.press = null
  }

  /** The pointer left the table (or went over the HUD): nothing is hovered any more. */
  pointerLeave(): void {
    if (this.disposed) return
    this.mouse = null
    this.press = null
    this.hover(null)
    this.updateCursor(null)
  }

  /**
   * The key of the card drawn at (x, y), or null. The card the mouse has lifted keeps the
   * pointer while it is over either where the card is or where it would lie unlifted, so the
   * edge it slid away from doesn't flicker between hovered and not.
   */
  pick(x: number, y: number): string | null {
    const viewport = this.scene.viewport
    if (this.disposed || !viewport) return null
    this.ndc.set((x / viewport.width) * 2 - 1, 1 - (y / viewport.height) * 2)
    this.scene.scene.updateMatrixWorld()
    this.raycaster.setFromCamera(this.ndc, this.scene.camera)
    const hit = this.nearest()
    const held = this.hovered === null ? undefined : this.layer.get(this.hovered)
    if (!held || hit === this.hovered || held.body.position.z === 0) return hit
    const lift = held.body.position.z
    held.body.position.z = 0
    held.body.updateMatrixWorld()
    const resting = this.nearest()
    held.body.position.z = lift
    held.body.updateMatrixWorld()
    return resting === this.hovered ? this.hovered : hit
  }

  /**
   * Where the middle of the card with this key is drawn, in CSS pixels from the canvas's top
   * left: the spot to tap it (the end-to-end tests do).
   */
  screenPoint(key: string): { x: number; y: number } | null {
    const mesh = this.layer.get(key)
    const viewport = this.scene.viewport
    if (!mesh || !viewport) return null
    this.scene.scene.updateMatrixWorld()
    mesh.body.getWorldPosition(this.centre)
    const { x, y, inFront } = toScreen(this.scene.camera, viewport, this.centre)
    return inFront ? { x, y } : null
  }

  dispose(): void {
    this.disposed = true
    this.press = null
    this.mouse = null
    this.targets.clear()
    this.hovered = null
  }

  /** The nearest card the raycaster's ray hits, by key. */
  private nearest(): string | null {
    const bodies: Object3D[] = []
    for (const child of this.scene.table.children) {
      if (child instanceof CardMesh && child.visible && child.userData.key !== undefined) {
        bodies.push(child.body)
      }
    }
    const hits: Intersection[] = this.raycaster.intersectObjects(bodies, false)
    const card = hits[0]?.object.parent
    return card instanceof CardMesh ? (card.userData.key as string) : null
  }

  private activate(key: string) {
    const state = this.targets.get(key)
    if (state === 'usable' || state === 'selected') this.onTap(key)
    else if (state === 'blocked') this.shake(key)
  }

  /** Lifts the card with this key (if it is usable), and lowers the one lifted before. */
  private hover(key: string | null) {
    const next = key !== null && this.targets.get(key) === 'usable' ? key : null
    if (next === this.hovered) return
    const previous = this.hovered
    this.hovered = next
    if (previous !== null) this.slide(previous, 0)
    if (next !== null) this.slide(next, -HOVER_LIFT)
  }

  private slide(key: string, z: number) {
    const mesh = this.layer.get(key)
    if (!mesh) return
    // One tween, which takes the property over from any slide still on its way and stops when
    // the card goes back to the pool.
    this.scene.animator.tween(
      mesh.body.position,
      { z },
      { duration: this.reducedMotion() ? 0 : HOVER_MS, ease: ease.outQuad },
    )
    this.scene.invalidate()
  }

  /** A quick side-to-side "no", dying away. */
  private shake(key: string) {
    const mesh = this.layer.get(key)
    if (!mesh || this.reducedMotion()) return
    const body = mesh.body
    const generation = mesh.generation
    const progress = { t: 0 }
    stopTweensOf(body.position, ['x'])
    this.shakes.set(mesh, progress)
    this.scene.animator.tween(
      progress,
      { t: 1 },
      {
        duration: SHAKE.duration,
        ease: ease.linear,
        onUpdate: () => {
          // A newer shake has taken over, or the card is someone else's now.
          if (mesh.generation !== generation || this.shakes.get(mesh) !== progress) return
          const t = progress.t
          body.position.x =
            t >= 1 ? 0 : SHAKE.distance * Math.sin(t * SHAKE.swings * 2 * Math.PI) * (1 - t)
        },
      },
    )
    this.scene.invalidate()
  }

  /** A pointer over a card that can be tapped; `key` is the card under the mouse. */
  private updateCursor(key: string | null) {
    const state = key === null ? undefined : this.targets.get(key)
    const cursor: TableCursor = state === 'usable' || state === 'selected' ? 'pointer' : 'default'
    if (cursor === this.cursor) return
    this.cursor = cursor
    this.onCursor?.(cursor)
  }
}

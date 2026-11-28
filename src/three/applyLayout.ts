import { stopTweensOf } from './anim'
import type { CardMesh } from './CardMesh'
import type { CardTarget, Layout } from './layout'
import type { TableScene } from './TableScene'

/** A card in a layout and the mesh that shows it. */
export interface Placement {
  target: CardTarget
  mesh: CardMesh
  /** Just taken from the pool for a card new to the table: it is at the table's centre. */
  entering: boolean
}

/**
 * The cards on a table, by layout key: which mesh shows which card. Given a new layout it keeps
 * every card's mesh (and finds the mesh of a slot that was just revealed), takes new meshes from
 * the pool for new cards, and hands back the ones no longer in the layout.
 *
 * `apply` snaps every card to its target. The animation director (P4.5) will use `reconcile`
 * instead, to learn which mesh is which, which are new (to bring in from the deck, say) and
 * which are leaving (to gather up), and move them itself.
 */
export class CardLayer {
  private meshes = new Map<string, CardMesh>()
  /** Meshes that have left the layout but are still on the table until released. */
  private leaving = new Set<CardMesh>()

  constructor(private readonly scene: TableScene) {}

  /** The mesh showing the card with this key, if it is on the table. */
  get(key: string): CardMesh | undefined {
    return this.meshes.get(key)
  }

  /** How many cards the layout has on the table (leaving ones not counted). */
  get size(): number {
    return this.meshes.size
  }

  /**
   * Matches the layout's cards to meshes and adds new ones to the table. Nothing is moved.
   * Cards no longer in the layout stay on the table, where they are, and come back in
   * `leaving`: pass them to `release` once they have gone (gathered up, say). Any still held
   * when reconcile is next called are released then.
   */
  reconcile(layout: Layout): { placed: Placement[]; leaving: CardMesh[] } {
    this.release([...this.leaving])
    const pool = this.scene.cards
    const previous = this.meshes
    const next = new Map<string, CardMesh>()
    const claimed = new Set<string>()
    const pending: CardTarget[] = []

    for (const target of layout.cards) {
      const mesh = previous.get(target.key)
      if (mesh && !next.has(target.key)) {
        next.set(target.key, mesh)
        claimed.add(target.key)
      } else pending.push(target)
    }
    // A card just revealed takes over the mesh of the slot it was in: one that has just gone.
    const entering = new Set<CardMesh>()
    for (const target of pending) {
      let mesh: CardMesh | undefined
      for (const slot of target.from ?? []) {
        const candidate = previous.get(slot)
        if (candidate && !claimed.has(slot)) {
          mesh = candidate
          claimed.add(slot)
          break
        }
      }
      if (!mesh) {
        mesh = pool.acquire()
        entering.add(mesh)
      }
      next.set(target.key, mesh)
    }
    const leaving: CardMesh[] = []
    for (const [key, mesh] of previous) {
      if (claimed.has(key)) continue
      leaving.push(mesh)
      this.leaving.add(mesh)
    }
    this.meshes = next

    const placed = layout.cards.map((target) => {
      const mesh = next.get(target.key)!
      if (mesh.parent !== this.scene.table) this.scene.table.add(mesh)
      mesh.name = `card-${target.key}`
      mesh.userData.key = target.key
      mesh.userData.zone = target.zone
      return { target, mesh, entering: entering.has(mesh) }
    })
    return { placed, leaving }
  }

  /** Returns meshes that left the layout to the pool (and so takes them off the table). */
  release(meshes: readonly CardMesh[]): void {
    const pool = this.scene.cards
    for (const mesh of meshes) {
      if (!this.leaving.delete(mesh)) continue
      pool.release(mesh)
    }
    if (meshes.length) this.scene.invalidate()
  }

  /** Puts every card exactly where the layout says, at once, and frames the camera on it. */
  apply(layout: Layout): void {
    const { placed, leaving } = this.reconcile(layout)
    this.release(leaving)
    for (const { target, mesh } of placed) snap(mesh, target)
    this.scene.setFrame(layout.frame, layout.insets)
    this.scene.invalidate()
  }

  /** Takes every card off the table. */
  clear(): void {
    this.release([...this.leaving])
    const pool = this.scene.cards
    for (const mesh of this.meshes.values()) pool.release(mesh)
    this.meshes.clear()
    this.scene.invalidate()
  }
}

/**
 * Moves a card to its target at once, stopping the tweens that are moving it and any flip. A
 * step still waiting its turn on a timeline will move it when it starts, so whoever queued
 * timelines for the card (the animation director) must cancel them first.
 */
export function snap(mesh: CardMesh, target: CardTarget): void {
  stopTweensOf(mesh.position)
  stopTweensOf(mesh.rotation)
  stopTweensOf(mesh.scale)
  const { position: p, rotation: r, scale } = target
  mesh.position.set(p.x, p.y, p.z)
  mesh.rotation.set(r.x, r.y, r.z)
  mesh.scale.set(scale, scale * target.stack, scale)
  if (mesh.face !== target.face) mesh.setFace(target.face)
  // Always set: it also ends a flip that was on its way.
  mesh.setFaceUp(target.faceUp)
}

const layers = new WeakMap<TableScene, CardLayer>()

/** The card layer of `scene`, made on first use. */
export function cardLayer(scene: TableScene): CardLayer {
  let layer = layers.get(scene)
  if (!layer) layers.set(scene, (layer = new CardLayer(scene)))
  return layer
}

/** Snaps the cards on `scene` to `layout` (see CardLayer.apply). */
export function applyLayout(scene: TableScene, layout: Layout): void {
  cardLayer(scene).apply(layout)
}

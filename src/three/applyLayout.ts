import { stopTweensOf } from './anim'
import type { CardMesh } from './CardMesh'
import type { CardTarget, Layout } from './layout'
import type { TableScene } from './TableScene'

/**
 * The cards on a table, by layout key: which mesh shows which card. Given a new layout it keeps
 * every card's mesh (and finds the mesh of a slot that was just revealed), takes new meshes from
 * the pool for new cards and returns the ones no longer on the table.
 *
 * `apply` snaps every card to its target. The animation director (P4.5) will use `reconcile`
 * to learn which mesh is which and move them there itself.
 */
export class CardLayer {
  private meshes = new Map<string, CardMesh>()

  constructor(private readonly scene: TableScene) {}

  /** The mesh showing the card with this key, if it is on the table. */
  get(key: string): CardMesh | undefined {
    return this.meshes.get(key)
  }

  /** How many cards are on the table. */
  get size(): number {
    return this.meshes.size
  }

  /**
   * Matches the layout's cards to meshes and adds new ones to the table; cards that left the
   * layout go back to the pool. Meshes are not moved. Returns each target with its mesh.
   */
  reconcile(layout: Layout): { target: CardTarget; mesh: CardMesh }[] {
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
      next.set(target.key, mesh ?? pool.acquire())
    }
    for (const [key, mesh] of previous) if (!claimed.has(key)) pool.release(mesh)
    this.meshes = next

    return layout.cards.map((target) => {
      const mesh = next.get(target.key)!
      if (mesh.parent !== this.scene.table) this.scene.table.add(mesh)
      mesh.name = `card-${target.key}`
      mesh.userData.key = target.key
      mesh.userData.zone = target.zone
      return { target, mesh }
    })
  }

  /** Puts every card exactly where the layout says, at once, and frames the camera on it. */
  apply(layout: Layout): void {
    for (const { target, mesh } of this.reconcile(layout)) snap(mesh, target)
    this.scene.setFrame(layout.frame)
    this.scene.invalidate()
  }

  /** Takes every card off the table. */
  clear(): void {
    const pool = this.scene.cards
    for (const mesh of this.meshes.values()) pool.release(mesh)
    this.meshes.clear()
    this.scene.invalidate()
  }
}

/** Moves a card to its target at once, stopping anything that was moving it. */
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

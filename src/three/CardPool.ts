import { MeshStandardMaterial } from 'three'
import type { CardId } from '@shared/engine/cards'
import { CardAtlas, type AtlasImage } from './cardAtlas'
import { CardMesh } from './CardMesh'

export interface CardPoolOptions {
  /** The atlas canvas (cardAtlasImage). */
  image: AtlasImage
  /** Anisotropic filtering for the atlas texture. */
  anisotropy?: number
  /** Called when the cards need drawing again (the atlas finished loading). */
  onChange?: () => void
}

/**
 * Every card on a table: one atlas texture, one material, and card meshes that are reused from
 * hand to hand instead of being made and thrown away. The TableScene owns one and disposes it.
 */
export class CardPool {
  readonly atlas: CardAtlas
  /** The one material every card uses, front, back and edge. */
  readonly material: MeshStandardMaterial
  private readonly free: CardMesh[] = []
  private readonly cards = new Set<CardMesh>()
  private disposed = false

  constructor(options: CardPoolOptions) {
    this.atlas = new CardAtlas(options.image, {
      anisotropy: options.anisotropy,
      onChange: options.onChange,
    })
    this.material = new MeshStandardMaterial({
      name: 'card',
      map: this.atlas.texture,
      // Each card's own shade (CardMesh.setTint): dimmed cards share the material too.
      vertexColors: true,
      // Satin card stock: a soft sheen under the lamp that doesn't wash out the print.
      roughness: 0.62,
      metalness: 0,
    })
  }

  /** Cards made so far, in use or not. */
  get size(): number {
    return this.cards.size
  }

  /** Cards handed out and not yet released. */
  get inUse(): number {
    return this.cards.size - this.free.length
  }

  /**
   * A card for the table, made or reused: by default face down with no face. Add it to the
   * scene yourself; release it when it leaves the table.
   */
  acquire({
    face = null,
    faceUp = false,
  }: { face?: CardId | null; faceUp?: boolean } = {}): CardMesh {
    if (this.disposed) throw new Error('CardPool: already disposed')
    let card = this.free.pop()
    if (!card) {
      card = new CardMesh(this.material, (slot) => this.atlas.uv(slot))
      this.cards.add(card)
    }
    card.setFace(face)
    card.setFaceUp(faceUp)
    return card
  }

  /**
   * Takes a card back: it leaves the scene, forgets its face, and its `generation` goes up.
   * Flips built for it do nothing from now on and tweens already moving it stop; other steps
   * that act on it should check its generation (see CardMesh.reset).
   */
  release(card: CardMesh): void {
    if (!this.cards.has(card)) throw new Error('CardPool: this card is not from this pool')
    if (this.free.includes(card)) return
    card.reset()
    this.free.push(card)
  }

  /** Releases every card in use. */
  releaseAll(): void {
    for (const card of this.cards) this.release(card)
  }

  /** Frees every card's geometry, the material and the atlas texture. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const card of this.cards) card.dispose()
    this.cards.clear()
    this.free.length = 0
    this.material.dispose()
    this.atlas.dispose()
  }
}

import { describe, expect, it, vi } from 'vitest'
import { Group, Material, Mesh, Texture } from 'three'
import { cardId, fullDeck } from '@shared/engine/cards'
import { fakeAtlasSources } from '@/test/atlas'
import { Animator } from './anim'
import { AtlasImage, atlasLayout } from './cardAtlas'
import { CardPool } from './CardPool'

function newPool(onChange?: () => void) {
  const image = new AtlasImage(atlasLayout(4096), fakeAtlasSources().sources)
  return new CardPool({ image, anisotropy: 4, onChange })
}

describe('CardPool', () => {
  it('hands out cards face down with no face unless told otherwise', () => {
    const pool = newPool()
    const unknown = pool.acquire()
    expect(unknown.face).toBeNull()
    expect(unknown.faceUp).toBe(false)
    const known = pool.acquire('5C', true)
    expect(known.face).toBe('5C')
    expect(known.faceUp).toBe(true)
    expect(pool.size).toBe(2)
    expect(pool.inUse).toBe(2)
  })

  it('reuses released cards, which come back blank, face down and off the table', () => {
    const pool = newPool()
    const table = new Group()
    const card = pool.acquire('JH', true)
    card.position.set(1, 2, 3)
    card.rotation.y = 1
    card.scale.setScalar(2)
    table.add(card)
    pool.release(card)
    expect(table.children).toHaveLength(0)
    expect(pool.inUse).toBe(0)

    const again = pool.acquire()
    expect(again).toBe(card)
    expect(again.face).toBeNull()
    expect(again.faceUp).toBe(false)
    expect(again.position.toArray()).toEqual([0, 0, 0])
    expect(again.rotation.y).toBe(0)
    expect(again.scale.x).toBe(1)
    expect(pool.size).toBe(1)
  })

  it('stops anything still moving a card it takes back', () => {
    const pool = newPool()
    const animator = new Animator()
    const card = pool.acquire()
    animator.tween(card.position, { x: 5 }, { duration: 100 })
    animator.advance(50)
    pool.release(card)
    animator.advance(100)
    expect(card.position.x).toBe(0)
  })

  it('takes a card back only once, and only its own', () => {
    const pool = newPool()
    const card = pool.acquire()
    pool.release(card)
    pool.release(card)
    expect(pool.acquire()).toBe(card)
    expect(pool.acquire()).not.toBe(card)
    expect(() => pool.release(newPool().acquire())).toThrow(/not from this pool/)
  })

  it('releases every card at once', () => {
    const pool = newPool()
    const table = new Group()
    for (let i = 0; i < 6; i++) table.add(pool.acquire())
    pool.releaseAll()
    expect(table.children).toHaveLength(0)
    expect(pool.inUse).toBe(0)
  })

  it('shares one atlas texture and one material between every card: none of their own', () => {
    const pool = newPool()
    const table = new Group()
    for (const card of fullDeck()) table.add(pool.acquire(cardId(card), true))
    for (let i = 0; i < 8; i++) table.add(pool.acquire())
    const materials = new Set<Material>()
    const textures = new Set<Texture>()
    table.traverse((object) => {
      if (!(object instanceof Mesh)) return
      for (const material of [object.material].flat() as Material[]) {
        materials.add(material)
        for (const value of Object.values(material)) {
          if (value instanceof Texture) textures.add(value)
        }
      }
    })
    expect(materials).toEqual(new Set([pool.material]))
    expect(textures).toEqual(new Set([pool.atlas.texture]))
    expect(pool.material.map).toBe(pool.atlas.texture)
  })

  it('passes on the anisotropy and the atlas redraw', async () => {
    const onChange = vi.fn()
    const fake = fakeAtlasSources({ hold: true })
    const image = new AtlasImage(atlasLayout(4096), fake.sources)
    const pool = new CardPool({ image, anisotropy: 4, onChange })
    expect(pool.atlas.texture.anisotropy).toBe(4)
    fake.releaseImages()
    await image.loaded
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('frees every geometry, the material and the atlas texture on dispose, in use or not', () => {
    const pool = newPool()
    const table = new Group()
    const inUse = pool.acquire()
    const released = pool.acquire()
    table.add(inUse, released)
    pool.release(released)
    const spies = [
      inUse.body.geometry,
      released.body.geometry,
      pool.material,
      pool.atlas.texture,
    ].map((thing) => {
      const spy = vi.fn()
      thing.addEventListener('dispose', spy)
      return spy
    })
    pool.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(table.children).toHaveLength(0)
    pool.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1)
    expect(() => pool.acquire()).toThrow(/disposed/)
  })
})

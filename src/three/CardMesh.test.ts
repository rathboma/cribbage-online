import { describe, expect, it, vi } from 'vitest'
import { Box3, BufferAttribute, Group, MeshStandardMaterial, Vector3 } from 'three'
import { cardId, fullDeck, type CardId } from '@shared/engine/cards'
import { Animator, Timeline } from './anim'
import { atlasLayout, slotUv, type AtlasSlot, type UvRect } from './cardAtlas'
import {
  CARD_HEIGHT,
  CARD_PARTS,
  CARD_THICKNESS,
  CARD_WIDTH,
  CardMesh,
  FLIP_DURATION,
} from './CardMesh'

const layout = atlasLayout(4096)
const uvOf = (slot: AtlasSlot) => slotUv(layout, slot)
const material = new MeshStandardMaterial()
const FACES = fullDeck().map(cardId)
type Part = keyof typeof CARD_PARTS

function newCard(): CardMesh {
  return new CardMesh(material, uvOf)
}

function attribute(card: CardMesh, name: string): BufferAttribute {
  return card.body.geometry.getAttribute(name) as BufferAttribute
}

/** The UVs of a part of the card (all of it by default). */
function uvs(card: CardMesh, part?: Part): [number, number][] {
  const uv = attribute(card, 'uv')
  const { start, count } = part ? CARD_PARTS[part] : { start: 0, count: uv.count }
  return Array.from({ length: count }, (_, i) => [uv.getX(start + i), uv.getY(start + i)])
}

const EPSILON = 1e-6
function inside(rect: UvRect, [u, v]: [number, number]): boolean {
  return (
    u >= rect.u0 - EPSILON &&
    u <= rect.u1 + EPSILON &&
    v >= rect.v0 - EPSILON &&
    v <= rect.v1 + EPSILON
  )
}

/** The faces any of the card's UVs fall on: none, for a card that carries no information. */
function facesShown(card: CardMesh): CardId[] {
  const points = uvs(card)
  return FACES.filter((face) => points.some((point) => inside(uvOf(face), point)))
}

/** Which way the front points, in the CardMesh's own space (+1 up, −1 down, 0 edge-on). */
function frontUpness(card: CardMesh): number {
  card.updateMatrixWorld(true)
  return new Vector3(0, 1, 0).applyQuaternion(card.body.quaternion).y
}

/** The lowest point of the card in the CardMesh's space. */
function lowest(card: CardMesh): number {
  card.updateMatrixWorld(true)
  return new Box3().setFromObject(card.body, true).min.y
}

describe('CardMesh geometry', () => {
  it("is a thin card with the art's proportions and rounded corners", () => {
    const card = newCard()
    card.setFaceUp(true)
    const box = new Box3().setFromObject(card, true)
    const size = box.getSize(new Vector3())
    expect(size.x).toBeCloseTo(CARD_WIDTH)
    expect(size.z).toBeCloseTo(CARD_HEIGHT)
    expect(size.y).toBeCloseTo(CARD_THICKNESS)
    const position = attribute(card, 'position')
    for (let i = 0; i < position.count; i++) {
      // Nothing reaches the corners of the bounding rectangle.
      const dx = CARD_WIDTH / 2 - Math.abs(position.getX(i))
      const dz = CARD_HEIGHT / 2 - Math.abs(position.getZ(i))
      expect(Math.hypot(dx, dz)).toBeGreaterThan(0.01)
    }
  })

  it('faces outwards everywhere: every triangle winds the way its normals point', () => {
    const card = newCard()
    const position = attribute(card, 'position')
    const normal = attribute(card, 'normal')
    const index = card.body.geometry.getIndex()!
    const [a, b, c, n] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
    for (let i = 0; i < index.count; i += 3) {
      const [ia, ib, ic] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
      a.fromBufferAttribute(position, ia)
      b.fromBufferAttribute(position, ib)
      c.fromBufferAttribute(position, ic)
      const winding = b.clone().sub(a).cross(c.clone().sub(a))
      n.fromBufferAttribute(normal, ia)
      expect(winding.dot(n), `triangle ${i / 3}`).toBeGreaterThan(0)
    }
  })

  it('casts and receives shadows', () => {
    const card = newCard()
    expect(card.body.castShadow).toBe(true)
    expect(card.body.receiveShadow).toBe(true)
  })
})

describe('CardMesh faces', () => {
  it('carries no information about any card until it is given a face', () => {
    const card = newCard()
    expect(card.face).toBeNull()
    expect(card.faceUp).toBe(false)
    expect(facesShown(card)).toEqual([])
    for (const point of uvs(card, 'front')) expect(inside(uvOf('blank'), point)).toBe(true)
  })

  it('shows the whole of its face, and only that, once it has one', () => {
    const card = newCard()
    for (const face of FACES) {
      card.setFace(face)
      expect(card.face).toBe(face)
      expect(facesShown(card)).toEqual([face])
      const front = uvs(card, 'front')
      const rect = uvOf(face)
      expect(Math.min(...front.map(([u]) => u))).toBeCloseTo(rect.u0)
      expect(Math.max(...front.map(([u]) => u))).toBeCloseTo(rect.u1)
      expect(Math.min(...front.map(([, v]) => v))).toBeCloseTo(rect.v0)
      expect(Math.max(...front.map(([, v]) => v))).toBeCloseTo(rect.v1)
    }
  })

  it('forgets its face for null', () => {
    const card = newCard()
    card.setFace('QS')
    card.setFace(null)
    expect(card.face).toBeNull()
    expect(facesShown(card)).toEqual([])
  })

  it('marks its UVs for upload when the face changes', () => {
    const card = newCard()
    const version = attribute(card, 'uv').version
    card.setFace('3H')
    expect(attribute(card, 'uv').version).toBeGreaterThan(version)
  })

  it('reads the art the right way up on the front, and the right way round on the back', () => {
    const card = newCard()
    card.setFace('7C')
    const position = attribute(card, 'position')
    const uv = attribute(card, 'uv')
    /** The UV of the part's vertex furthest along `axis` (x: right, −z: top of the art). */
    const extreme = (part: Part, along: (i: number) => number) => {
      const { start, count } = CARD_PARTS[part]
      let best = start
      for (let i = start; i < start + count; i++) if (along(i) > along(best)) best = i
      return [uv.getX(best), uv.getY(best)] as const
    }
    const right = (i: number) => position.getX(i)
    const top = (i: number) => -position.getZ(i)
    const face = uvOf('7C')
    expect(extreme('front', right)[0]).toBeCloseTo(face.u1) // its right on the art's right
    expect(extreme('front', top)[1]).toBeCloseTo(face.v1) // its top (−z) at the art's top
    // The back is seen after turning over about the long axis, which swaps left and right.
    const back = uvOf('back')
    expect(extreme('back', right)[0]).toBeCloseTo(back.u0)
    expect(extreme('back', top)[1]).toBeCloseTo(back.v1)
    for (const point of uvs(card, 'back')) expect(inside(back, point)).toBe(true)
  })

  it('has an edge of plain card stock', () => {
    const card = newCard()
    card.setFace('JD')
    for (const point of uvs(card, 'edge')) expect(inside(uvOf('blank'), point)).toBe(true)
  })

  it('turns face up and down at once with setFaceUp', () => {
    const card = newCard()
    expect(frontUpness(card)).toBeCloseTo(-1)
    card.setFaceUp(true)
    expect(card.faceUp).toBe(true)
    expect(frontUpness(card)).toBeCloseTo(1)
    card.setFaceUp(false)
    expect(frontUpness(card)).toBeCloseTo(-1)
  })

  it('frees its geometry on dispose', () => {
    const card = newCard()
    const parent = new Group().add(card)
    const disposed = vi.fn()
    card.body.geometry.addEventListener('dispose', disposed)
    card.dispose()
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(parent.children).toHaveLength(0)
  })
})

describe('CardMesh.flip', () => {
  /** Plays the flip 5 ms at a time, calling `each` after every step. */
  function play(animator: Animator, step: Timeline, each: (time: number) => void = () => {}) {
    const animation = animator.play(step)
    for (let time = 0; time <= step.duration + 10; time += 5) {
      each(time)
      animator.advance(5)
    }
    return animation
  }

  it('turns a card over and reveals its face only when it is edge-on', () => {
    const card = newCard()
    const animator = new Animator()
    const samples: { time: number; face: CardId | null; shown: CardId[]; upness: number }[] = []
    const flip = card.flip({ face: '9D' })
    expect(flip.duration).toBe(FLIP_DURATION)
    const animation = play(animator, flip, (time) => {
      samples.push({ time, face: card.face, shown: facesShown(card), upness: frontUpness(card) })
    })
    expect(animation.done).toBe(true)
    // Until the reveal the mesh shows no face at all...
    const before = samples.filter((sample) => sample.face === null)
    expect(before.flatMap((sample) => sample.shown)).toEqual([])
    // ...which comes half way, as the card stands on its edge.
    const revealed = samples.find((sample) => sample.face !== null)!
    expect(revealed.time).toBeGreaterThanOrEqual(FLIP_DURATION / 2)
    expect(Math.abs(revealed.upness)).toBeLessThan(0.15)
    expect(card.face).toBe('9D')
    expect(card.faceUp).toBe(true)
    // Settled exactly: front up, back on the table.
    expect(card.body.rotation.z).toBe(0)
    expect(card.body.position.y).toBe(0)
  })

  it('lifts the card clear of the table while it turns', () => {
    const card = newCard()
    const animator = new Animator()
    const rest = lowest(card)
    let highest = -Infinity
    play(animator, card.flip(), () => {
      expect(lowest(card)).toBeGreaterThanOrEqual(rest - 1e-6)
      highest = Math.max(highest, card.body.position.y)
    })
    expect(highest).toBeGreaterThan(CARD_WIDTH / 2)
  })

  it('turns the other way by default, rolling forwards both ways', () => {
    const card = newCard()
    card.setFaceUp(true)
    const animator = new Animator()
    const ascending = (angles: number[]) => [...angles].sort((a, b) => a - b)
    const down: number[] = []
    play(animator, card.flip(), () => down.push(card.body.rotation.z))
    expect(down).toEqual(ascending(down))
    expect(card.faceUp).toBe(false)
    expect(frontUpness(card)).toBeCloseTo(-1)
    // Up again by going on round to 2π (then settling at 0), not by rolling back.
    const up: number[] = []
    play(animator, card.flip(), () => up.push(card.body.rotation.z))
    const turning = up.filter((angle) => angle !== 0)
    expect(turning).toEqual(ascending(turning))
    expect(Math.max(...turning)).toBeCloseTo(2 * Math.PI)
    expect(card.faceUp).toBe(true)
  })

  it('reports the way up it is heading as soon as the flip starts', () => {
    const card = newCard()
    const animator = new Animator()
    const flip = card.flip()
    expect(card.faceUp).toBe(false) // built, not started
    animator.play(flip)
    expect(card.faceUp).toBe(true)
    // So asking for the same again only sets the face, and leaves the turn alone.
    const again = card.flip({ faceUp: true, face: '2S' })
    expect(again.duration).toBe(0)
    animator.play(again)
    expect(card.face).toBe('2S')
    animator.advance(FLIP_DURATION)
    expect(frontUpness(card)).toBeCloseTo(1)
  })

  it('can turn a card face down and forget its face as it goes over', () => {
    const card = newCard()
    card.setFace('TC')
    card.setFaceUp(true)
    const animator = new Animator()
    play(animator, card.flip({ faceUp: false, face: null }))
    expect(card.faceUp).toBe(false)
    expect(card.face).toBeNull()
    expect(facesShown(card)).toEqual([])
  })

  it('is stopped by setFaceUp, reveal and all', () => {
    const card = newCard()
    const animator = new Animator()
    animator.play(card.flip({ face: '4H' }))
    animator.advance(FLIP_DURATION / 4)
    card.setFaceUp(false)
    animator.advance(FLIP_DURATION)
    expect(card.face).toBeNull()
    expect(card.faceUp).toBe(false)
    expect(frontUpness(card)).toBeCloseTo(-1)
    expect(card.body.position.y).toBe(0)
  })

  it('is stopped by going back to the pool, so a reused card never shows an old face', () => {
    const card = newCard()
    const animator = new Animator()
    animator.play(card.flip({ face: 'AH' }))
    animator.advance(FLIP_DURATION / 4)
    card.reset()
    animator.advance(FLIP_DURATION)
    expect(card.face).toBeNull()
    expect(facesShown(card)).toEqual([])
  })

  it('a flip that reverses another takes over from where the card is, the short way back', () => {
    const card = newCard()
    const animator = new Animator()
    animator.play(card.flip({ face: '8S' }))
    animator.advance(FLIP_DURATION / 4) // under half way: no face yet
    const angle = card.body.rotation.z
    const height = card.body.position.y
    expect(card.face).toBeNull()
    animator.play(card.flip({ faceUp: false }))
    // No jump: it carries on from the same angle and height...
    expect(card.body.rotation.z).toBeCloseTo(angle)
    expect(card.body.position.y).toBeCloseTo(height)
    let previous = angle
    for (let t = 0; t < FLIP_DURATION; t += 5) {
      animator.advance(5)
      // ...rolling back, not on round.
      expect(card.body.rotation.z).toBeLessThanOrEqual(previous + 1e-9)
      previous = card.body.rotation.z
    }
    animator.advance(10)
    // The first flip's reveal never happened.
    expect(card.face).toBeNull()
    expect(card.faceUp).toBe(false)
    expect(frontUpness(card)).toBeCloseTo(-1)
  })

  it('can be placed on a longer timeline, and plays again from the start', () => {
    const card = newCard()
    const animator = new Animator()
    const timeline = new Timeline().wait(100).add(card.flip({ face: 'KD' }))
    expect(timeline.duration).toBe(100 + FLIP_DURATION)
    animator.play(timeline)
    animator.advance(100 + FLIP_DURATION)
    expect(card.faceUp).toBe(true)
    expect(card.face).toBe('KD')
  })
})

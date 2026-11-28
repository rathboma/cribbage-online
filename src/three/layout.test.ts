import { describe, expect, it, vi } from 'vitest'
import { Euler, Group, Matrix4, Quaternion, Vector3 } from 'three'
import type { CardId } from '@shared/engine/cards'
import type { PlayerView } from '@shared/engine/view'
import type { Seat } from '@shared/engine/types'
import { fakeAtlasSources } from '@/test/atlas'
import { CardLayer } from './applyLayout'
import { frameCamera, makeCamera, toScreen, type Viewport } from './camera'
import { AtlasImage, atlasLayout } from './cardAtlas'
import { CARD_HEIGHT, CARD_THICKNESS, CARD_WIDTH } from './CardMesh'
import { CardPool } from './CardPool'
import { computeLayout, type CardTarget, type Layout } from './layout'
import { LAYOUT_FIXTURES, fixtureView, type LayoutFixture } from './layoutFixtures'
import type { TableScene } from './TableScene'

const VIEWPORTS: Viewport[] = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]
const PHONE = VIEWPORTS[0]!
const SEATS: Seat[] = [0, 1]
/** The smallest comfortable touch target. */
const MIN_TAP_PX = 44

const fixture = (id: string): LayoutFixture => {
  const found = LAYOUT_FIXTURES.find((f) => f.id === id)
  if (!found) throw new Error(`No fixture ${id}`)
  return found
}

/** Every fixture, as each seat sees it, laid out at every viewport. */
function* everyLayout(): Generator<{
  name: string
  view: PlayerView
  viewport: Viewport
  layout: Layout
}> {
  for (const f of LAYOUT_FIXTURES) {
    for (const seat of SEATS) {
      const { view, selected } = fixtureView(f, seat)
      for (const viewport of VIEWPORTS) {
        yield {
          name: `${f.id} seat ${seat} at ${viewport.width}×${viewport.height}`,
          view,
          viewport,
          layout: computeLayout(view, viewport, { selected }),
        }
      }
    }
  }
}

/** The four corners of a card's top face, in table space. */
function corners(target: CardTarget): Vector3[] {
  const matrix = new Matrix4().compose(
    new Vector3(target.position.x, target.position.y, target.position.z),
    new Quaternion().setFromEuler(
      new Euler(target.rotation.x, target.rotation.y, target.rotation.z),
    ),
    new Vector3(target.scale, target.scale * target.stack, target.scale),
  )
  const top = CARD_THICKNESS / 2
  return [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) =>
      new Vector3((sx * CARD_WIDTH) / 2, top, (sz * CARD_HEIGHT) / 2).applyMatrix4(matrix),
    ),
  )
}

/** Where a horizontal line crosses a convex polygon on screen: [left, right] or null. */
function crossing(polygon: { x: number; y: number }[], y: number): [number, number] | null {
  const xs: number[] = []
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) return
    xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
  })
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null
}

/** A card's outline on screen, corners in order round the card. */
function outline(target: CardTarget, layout: Layout, viewport: Viewport) {
  const camera = makeCamera()
  frameCamera(camera, layout.frame, viewport)
  const [a, b, c, d] = corners(target).map((p) => toScreen(camera, viewport, p))
  // corners() gives (−x−z, −x+z, +x−z, +x+z): reorder to go round.
  return [a!, b!, d!, c!]
}

/** The widest stretch of a card's middle line that no card above it covers, in pixels. */
function widestUncovered(target: CardTarget, layout: Layout, viewport: Viewport): number {
  const own = outline(target, layout, viewport)
  const y = own.reduce((sum, p) => sum + p.y, 0) / own.length
  const span = crossing(own, y)
  if (!span) return 0
  let free: [number, number][] = [[Math.max(0, span[0]), Math.min(viewport.width, span[1])]]
  for (const other of layout.cards) {
    if (other === target || other.position.y <= target.position.y) continue
    const cover = crossing(outline(other, layout, viewport), y)
    if (!cover) continue
    free = free.flatMap(([l, r]) => {
      const parts: [number, number][] = []
      if (cover[0] > l) parts.push([l, Math.min(r, cover[0])])
      if (cover[1] < r) parts.push([Math.max(l, cover[1]), r])
      return parts.filter(([pl, pr]) => pr > pl)
    })
  }
  return Math.max(0, ...free.map(([l, r]) => r - l))
}

describe('computeLayout', () => {
  it('is deterministic', () => {
    for (const f of LAYOUT_FIXTURES) {
      const { view, selected } = fixtureView(f, 0)
      const first = computeLayout(view, PHONE, { selected })
      const second = computeLayout(structuredClone(view), { ...PHONE }, { selected: [...selected] })
      expect(second).toEqual(first)
    }
  })

  it('gives every card in the view exactly one target, and the deck one more', () => {
    for (const { name, view, layout } of everyLayout()) {
      const keys = layout.cards.map((c) => c.key)
      expect(new Set(keys).size, name).toBe(keys.length)

      // Each card this seat can see is on the table once, face and all...
      const visible: CardId[] = [
        ...view.myHand,
        ...(view.crib ?? view.myDiscards),
        ...view.played[0],
        ...view.played[1],
        ...(view.starter ? [view.starter] : []),
      ]
      const faces = layout.cards.flatMap((c) => (c.face ? [c.face] : []))
      expect([...faces].sort(), name).toEqual([...visible].sort())
      // ...and every card it can't see is there too, as a slot with no face.
      const hidden =
        view.opponentHandCount + (view.crib ? 0 : view.cribCount - view.myDiscards.length)
      const blank = layout.cards.filter((c) => c.face === null && c.zone !== 'deck')
      expect(blank, name).toHaveLength(hidden)
      expect(
        layout.cards.filter((c) => c.zone === 'deck'),
        name,
      ).toHaveLength(1)
    }
  })

  it('never puts two cards in the same place', () => {
    for (const { name, layout } of everyLayout()) {
      const places = layout.cards.map(
        (c) => `${c.position.x.toFixed(3)},${c.position.y.toFixed(3)},${c.position.z.toFixed(3)}`,
      )
      expect(new Set(places).size, name).toBe(places.length)
    }
  })

  it('keeps every card on the frame, off the board and inside the camera’s view', () => {
    for (const { name, viewport, layout } of everyLayout()) {
      const camera = makeCamera()
      frameCamera(camera, layout.frame, viewport)
      const { frame, board } = layout
      for (const card of layout.cards) {
        for (const p of corners(card)) {
          const where = `${name}: ${card.key}`
          expect(Math.abs(p.x - frame.x), where).toBeLessThanOrEqual(frame.width / 2)
          expect(Math.abs(p.z - frame.z), where).toBeLessThanOrEqual(frame.depth / 2)
          const onBoard =
            Math.abs(p.x - board.x) < board.width / 2 && Math.abs(p.z - board.z) < board.depth / 2
          expect(onBoard, where).toBe(false)
          const ndc = p.clone().project(camera)
          expect(Math.abs(ndc.x), where).toBeLessThanOrEqual(1)
          expect(Math.abs(ndc.y), where).toBeLessThanOrEqual(1)
          expect(ndc.z, where).toBeLessThan(1)
        }
      }
    }
  })

  it('leaves the board room inside the frame', () => {
    for (const { name, layout } of everyLayout()) {
      const { frame, board } = layout
      expect(Math.abs(board.x - frame.x) + board.width / 2, name).toBeLessThanOrEqual(
        frame.width / 2,
      )
      expect(Math.abs(board.z - frame.z) + board.depth / 2, name).toBeLessThanOrEqual(
        frame.depth / 2,
      )
    }
  })

  it('gives each card in a full hand a clear strip at least 44 px wide on a small phone', () => {
    // Both seats with six cards dealt, and seat 0 with two of them picked for the crib.
    const cases = [
      ...SEATS.map((seat) => ({
        ...fixtureView(fixture('deal'), seat),
        name: `deal, seat ${seat}`,
      })),
      { ...fixtureView(fixture('discard'), 0), name: 'two picked, seat 0' },
    ]
    for (const { view, selected, name } of cases) {
      const layout = computeLayout(view, PHONE, { selected })
      const hand = layout.cards.filter((c) => c.zone === 'my-hand')
      expect(hand).toHaveLength(6)
      for (const card of hand) {
        const width = widestUncovered(card, layout, PHONE)
        expect(width, `${name}: ${card.key}`).toBeGreaterThanOrEqual(MIN_TAP_PX)
      }
    }
  })

  it('fans the hand left to right in hand order, each card over the one before', () => {
    const { view } = fixtureView(fixture('deal'), 0)
    const hand = computeLayout(view, PHONE).cards.filter((c) => c.zone === 'my-hand')
    expect(hand.map((c) => c.face)).toEqual(view.myHand)
    for (let i = 1; i < hand.length; i++) {
      expect(hand[i]!.position.x).toBeGreaterThan(hand[i - 1]!.position.x)
      expect(hand[i]!.position.y).toBeGreaterThan(hand[i - 1]!.position.y)
    }
  })

  it('raises the cards picked for the crib out of the hand', () => {
    const { view, selected } = fixtureView(fixture('discard'), 0)
    expect(selected).toHaveLength(2)
    const flat = computeLayout(view, PHONE).cards
    const picked = computeLayout(view, PHONE, { selected }).cards
    const moved = picked
      .filter((c) => c.zone === 'my-hand')
      .map((card) => {
        const before = flat.find((c) => c.key === card.key)!
        return { face: card.face, back: before.position.z - card.position.z }
      })
    // Picked cards slide away from the player; the rest stay put.
    expect(moved.filter((m) => m.back > 0).map((m) => m.face)).toEqual(selected)
    expect(moved.filter((m) => m.back === 0)).toHaveLength(4)
  })

  it('shows this player’s hand face up and every hidden card face down', () => {
    for (const { name, layout } of everyLayout()) {
      const cards = layout.cards
      expect(
        cards.filter((c) => c.zone === 'my-hand' && !c.faceUp),
        name,
      ).toEqual([])
      expect(
        cards.filter((c) => c.face === null && c.faceUp),
        name,
      ).toEqual([])
      expect(
        cards.filter((c) => c.zone === 'crib' && c.faceUp),
        name,
      ).toEqual([])
    }
  })

  it('puts the crib on the dealer’s side', () => {
    const { view: pone } = fixtureView(fixture('cut'), 0)
    const { view: dealer } = fixtureView(fixture('cut'), 1)
    const cribZ = (view: PlayerView) =>
      computeLayout(view, PHONE).cards.find((c) => c.zone === 'crib')!.position.z
    // Seat 1 deals: away from seat 0, towards seat 1.
    expect(cribZ(pone)).toBeLessThan(0)
    expect(cribZ(dealer)).toBeGreaterThan(0)
  })

  it('lays each player’s cards on their own side, turning earlier counts face down', () => {
    const { view } = fixtureView(fixture('go'), 0)
    const cards = computeLayout(view, PHONE).cards
    const mine = cards.filter((c) => c.zone === 'my-played')
    const theirs = cards.filter((c) => c.zone === 'opponent-played')
    expect(mine.map((c) => c.face)).toEqual(view.played[0])
    expect(theirs.map((c) => c.face)).toEqual(view.played[1])
    for (const c of mine) expect(c.position.z).toBeGreaterThan(0)
    for (const c of theirs) expect(c.position.z).toBeLessThan(0)
    // K♥ 8♦ and Q♦ 2♠ were the first count; 7♠ and 8♣ are the count in progress.
    const up = cards.filter((c) => c.zone.endsWith('played') && c.faceUp).map((c) => c.face)
    expect(up.sort()).toEqual(['7S', '8C'])
    // In play order, each over the one before.
    for (let i = 1; i < mine.length; i++) {
      expect(mine[i]!.position.x).toBeGreaterThan(mine[i - 1]!.position.x)
      expect(mine[i]!.position.y).toBeGreaterThan(mine[i - 1]!.position.y)
    }
  })

  it('puts the starter on the deck once it is cut', () => {
    const { view } = fixtureView(fixture('play'), 0)
    const cards = computeLayout(view, PHONE).cards
    const deck = cards.find((c) => c.zone === 'deck')!
    const starter = cards.find((c) => c.zone === 'starter')!
    expect(starter).toMatchObject({ face: '5H', faceUp: true })
    expect(starter.position.x).toBe(deck.position.x)
    expect(starter.position.z).toBe(deck.position.z)
    expect(starter.position.y).toBeGreaterThan(deck.position.y)
    // The deck is one block, as thick as the 39 cards left.
    expect(deck.stack).toBeCloseTo(39 * 0.5)
  })

  it('spreads the hand being counted next to the starter, and only that hand', () => {
    for (const [id, counted] of [
      ['show-1', ['3C', '7S', '8D', 'KH']],
      ['show-2', ['2S', '8C', '9H', 'QD']],
      ['show-3', ['4D', '6S', 'AC', 'JH']],
    ] as const) {
      for (const seat of SEATS) {
        const { view } = fixtureView(fixture(id), seat)
        const spread = computeLayout(view, PHONE).cards.filter((c) => c.zone === 'show')
        expect(spread.map((c) => c.face).sort(), `${id} seat ${seat}`).toEqual(
          ['5H', ...counted].sort(),
        )
        expect(spread[0]!.face).toBe('5H')
        for (const c of spread) expect(c.faceUp).toBe(true)
      }
    }
  })

  it('in the show, turns every laid card face up', () => {
    const { view } = fixtureView(fixture('show-1'), 0)
    const laid = computeLayout(view, PHONE).cards.filter((c) => c.zone.endsWith('played'))
    expect(laid).toHaveLength(4)
    for (const c of laid) expect(c.faceUp).toBe(true)
  })

  it('stands the table up on a phone and lays it out wide on a desktop', () => {
    const { view } = fixtureView(fixture('deal'), 0)
    expect(computeLayout(view, { width: 360, height: 640 }).mode).toBe('portrait')
    expect(computeLayout(view, { width: 390, height: 844 }).mode).toBe('portrait')
    expect(computeLayout(view, { width: 1440, height: 900 }).mode).toBe('landscape')
    expect(computeLayout(view, { width: 844, height: 390 }).mode).toBe('landscape')
  })

  it('copes with an empty viewport', () => {
    const { view } = fixtureView(fixture('deal'), 0)
    expect(computeLayout(view, { width: 0, height: 0 }).cards).toHaveLength(13)
  })

  it('keeps the HUD’s insets clear', () => {
    const viewport: Viewport = {
      width: 390,
      height: 844,
      insets: { top: 120, bottom: 160, left: 0, right: 0 },
    }
    const { view } = fixtureView(fixture('deal'), 0)
    const layout = computeLayout(view, viewport)
    const camera = makeCamera()
    frameCamera(camera, layout.frame, viewport)
    for (const card of layout.cards) {
      for (const p of corners(card)) {
        const screen = toScreen(camera, viewport, p)
        expect(screen.y).toBeGreaterThanOrEqual(120)
        expect(screen.y).toBeLessThanOrEqual(844 - 160)
      }
    }
  })
})

describe('CardLayer', () => {
  function fakeScene() {
    const image = new AtlasImage(atlasLayout(4096), fakeAtlasSources().sources)
    const scene = {
      cards: new CardPool({ image }),
      table: new Group(),
      setFrame: vi.fn(),
      invalidate: vi.fn(),
    }
    return scene as typeof scene & TableScene
  }

  const HAND = ['deal', 'discard', 'cut', 'play', 'go', 'show-1', 'show-2', 'show-3']

  it('keeps each card on one mesh from the deal to the show, revealed cards included', () => {
    for (const seat of SEATS) {
      const scene = fakeScene()
      const layer = new CardLayer(scene)
      /** Every mesh each key has had, in order. */
      const history = new Map<string, Set<object>>()
      const meshesSeen = new Set<object>()
      const dealtMeshes = new Set<object>()
      HAND.forEach((id, step) => {
        const { view, selected } = fixtureView(fixture(id), seat)
        const layout = computeLayout(view, PHONE, { selected })
        for (const { target, mesh } of layer.reconcile(layout)) {
          if (!history.has(target.key)) history.set(target.key, new Set())
          history.get(target.key)!.add(mesh)
          meshesSeen.add(mesh)
          if (step === 0) dealtMeshes.add(mesh)
        }
      })
      // No key ever changes mesh...
      for (const [key, meshes] of history) expect(meshes.size, key).toBe(1)
      // ...and no card is ever made after the deal (starter aside): the twelve dealt cards,
      // the opponent's six by slot, move through the whole hand on the same meshes.
      expect(meshesSeen.size).toBe(dealtMeshes.size + 1)
    }
  })

  it('snaps each mesh to its target and puts it on the table', () => {
    const scene = fakeScene()
    const layer = new CardLayer(scene)
    const { view, selected } = fixtureView(fixture('discard'), 0)
    const layout = computeLayout(view, PHONE, { selected })
    layer.apply(layout)
    expect(scene.table.children).toHaveLength(layout.cards.length)
    for (const target of layout.cards) {
      const mesh = layer.get(target.key)!
      expect(mesh.parent).toBe(scene.table)
      expect(mesh.position.toArray()).toEqual([
        target.position.x,
        target.position.y,
        target.position.z,
      ])
      expect(mesh.rotation.y).toBeCloseTo(target.rotation.y)
      expect(mesh.scale.y).toBeCloseTo(target.scale * target.stack)
      expect(mesh.face).toBe(target.face)
      expect(mesh.faceUp).toBe(target.faceUp)
    }
    expect(scene.setFrame).toHaveBeenCalledWith(layout.frame)
    expect(scene.invalidate).toHaveBeenCalled()
  })

  it('returns cards that leave the table to the pool, and takes them all off on clear', () => {
    const scene = fakeScene()
    const layer = new CardLayer(scene)
    layer.apply(computeLayout(fixtureView(fixture('deal'), 0).view, PHONE))
    expect(scene.cards.inUse).toBe(13)
    layer.apply(computeLayout(fixtureView(fixture('lobby'), 0).view, PHONE))
    expect(scene.cards.inUse).toBe(1)
    expect(scene.table.children).toHaveLength(1)
    layer.clear()
    expect(scene.cards.inUse).toBe(0)
    expect(scene.table.children).toHaveLength(0)
  })
})

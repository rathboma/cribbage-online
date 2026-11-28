import { afterEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import type { Seat } from '@shared/engine/types'
import { testScene } from '@/test/scene'
import { cardLayer } from './applyLayout'
import { CARD_HEIGHT } from './CardMesh'
import { toScreen, type Insets } from './camera'
import { computeLayout } from './layout'
import { LAYOUT_FIXTURES, fixtureView } from './layoutFixtures'
import {
  HOVER_LIFT,
  SHAKE,
  TARGET_TINT,
  TableInput,
  type TablePointer,
  type TargetState,
} from './TableInput'
import type { TableScene } from './TableScene'

const scenes: TableScene[] = []
afterEach(() => {
  for (const scene of scenes.splice(0)) scene.dispose()
})

/** A fixture laid out on a scene of the given size, with a TableInput on it. */
function table(
  fixtureId: string,
  seat: Seat = 0,
  size: { width: number; height: number; insets?: Partial<Insets> } = {
    width: 390,
    height: 760,
  },
  options: { reducedMotion?: boolean } = {},
) {
  const { scene } = testScene(size.width, size.height)
  scenes.push(scene)
  const fixture = LAYOUT_FIXTURES.find((f) => f.id === fixtureId)!
  const { view, options: layoutOptions } = fixtureView(fixture, seat)
  const layout = computeLayout(view, size, layoutOptions)
  const layer = cardLayer(scene)
  layer.apply(layout)
  const onTap = vi.fn()
  const onCursor = vi.fn()
  const input = new TableInput(scene, layer, {
    onTap,
    onCursor,
    reducedMotion: () => options.reducedMotion ?? false,
  })
  const hand = layout.cards.filter((c) => c.zone === 'my-hand').map((c) => c.key)
  return { scene, layer, layout, view, input, onTap, onCursor, hand }
}

const mouse = (x: number, y: number, extra: Partial<TablePointer> = {}): TablePointer => ({
  x,
  y,
  id: 1,
  type: 'mouse',
  button: 0,
  primary: true,
  ...extra,
})
const finger = (x: number, y: number, id = 7): TablePointer => ({
  x,
  y,
  id,
  type: 'touch',
  primary: true,
})

function tap(input: TableInput, p: TablePointer) {
  input.pointerDown(p)
  input.pointerUp(p)
}

/** Where a point on a card (in its own space, unscaled) is on screen. */
function pointOnCard(t: ReturnType<typeof table>, key: string, x: number, z: number) {
  const mesh = t.layer.get(key)!
  t.scene.scene.updateMatrixWorld()
  const world = mesh.localToWorld(new Vector3(x, 0, z))
  return toScreen(t.scene.camera, t.scene.viewport!, world)
}

describe('TableInput', () => {
  describe('hit areas', () => {
    // Phones upright and on their side, tablets, laptops and desktops; with and without the
    // HUD over the top and bottom of the canvas.
    const VIEWPORTS = [
      [320, 568],
      [360, 640],
      [375, 667],
      [390, 844],
      [412, 915],
      [568, 320],
      [844, 390],
      [768, 1024],
      [1024, 768],
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const
    const INSETS: Partial<Insets>[] = [{}, { top: 90, bottom: 190 }]

    it.each(VIEWPORTS)('the middle of every card in hand picks that card at %i×%i', (w, h) => {
      for (const insets of INSETS) {
        for (const fixture of ['deal', 'discard', 'cut', 'play']) {
          for (const seat of [0, 1] as const) {
            const t = table(fixture, seat, { width: w, height: h, insets })
            // The deck is tapped to cut, before the starter lies on it.
            const keys = fixture === 'cut' ? [...t.hand, 'deck'] : t.hand
            expect(keys.length).toBeGreaterThan(0)
            for (const key of keys) {
              const point = t.input.screenPoint(key)!
              const where = `${key} (${fixture}, seat ${seat}, insets ${JSON.stringify(insets)})`
              expect(point, where).not.toBeNull()
              expect(point.x, where).toBeGreaterThan(0)
              expect(point.x, where).toBeLessThan(w)
              expect(point.y, where).toBeGreaterThan(insets.top ?? 0)
              expect(point.y, where).toBeLessThan(h - (insets.bottom ?? 0))
              expect(t.input.pick(point.x, point.y), where).toBe(key)
            }
            t.scene.dispose()
          }
        }
      }
    })

    it('gives an overlapped card in the fan only the part of it on top', () => {
      // A narrow phone: the six cards overlap.
      const t = table('deal', 0, { width: 320, height: 568 })
      const [first, second] = t.hand as [string, string]
      // The right edge of the first card is under the second card.
      const covered = pointOnCard(t, first, 0.45, 0)
      expect(t.input.pick(covered.x, covered.y)).toBe(second)
      const open = pointOnCard(t, first, -0.3, 0)
      expect(t.input.pick(open.x, open.y)).toBe(first)
    })

    it('picks nothing on the bare felt', () => {
      const t = table('play', 0)
      expect(t.input.pick(5, 5)).toBeNull()
    })
  })

  describe('taps', () => {
    it('reports a tap on a usable card, by key, for touch and the mouse', () => {
      const t = table('deal', 0)
      t.input.setTargets(new Map(t.hand.map((k) => [k, 'usable' as const])))
      const [a, b] = t.hand as [string, string]
      const pa = t.input.screenPoint(a)!
      tap(t.input, finger(pa.x, pa.y))
      const pb = t.input.screenPoint(b)!
      t.input.pointerMove(mouse(pb.x, pb.y))
      tap(t.input, mouse(pb.x, pb.y))
      expect(t.onTap.mock.calls).toEqual([[a], [b]])
    })

    it('reports a tap on a picked card, so it can be put back', () => {
      const t = table('discard', 0)
      const [a] = t.hand as [string]
      t.input.setTargets(new Map([[a, 'selected']]))
      const p = t.input.screenPoint(a)!
      tap(t.input, finger(p.x, p.y))
      expect(t.onTap).toHaveBeenCalledExactlyOnceWith(a)
    })

    it('takes no tap from a card that takes no input, or from the felt', () => {
      const t = table('play', 0)
      const [a, b] = t.hand as [string, string]
      t.input.setTargets(new Map([[a, 'idle']]))
      for (const key of [a, b]) {
        const p = t.input.screenPoint(key)!
        tap(t.input, finger(p.x, p.y))
      }
      tap(t.input, finger(5, 5))
      expect(t.onTap).not.toHaveBeenCalled()
    })

    it('is not a tap when the finger drags, or lets go on another card', () => {
      const t = table('deal', 0)
      t.input.setTargets(new Map(t.hand.map((k) => [k, 'usable' as const])))
      const [a, b] = t.hand as [string, string]
      const pa = t.input.screenPoint(a)!
      const pb = t.input.screenPoint(b)!
      t.input.pointerDown(finger(pa.x, pa.y))
      t.input.pointerMove(finger(pa.x + 30, pa.y))
      t.input.pointerUp(finger(pa.x, pa.y))
      t.input.pointerDown(finger(pa.x, pa.y))
      t.input.pointerUp(finger(pb.x, pb.y))
      expect(t.onTap).not.toHaveBeenCalled()
      // A small wobble is still a tap.
      t.input.pointerDown(finger(pa.x, pa.y))
      t.input.pointerMove(finger(pa.x + 4, pa.y - 3))
      t.input.pointerUp(finger(pa.x + 4, pa.y - 3))
      expect(t.onTap).toHaveBeenCalledExactlyOnceWith(a)
    })

    it('ignores other mouse buttons, a second finger and a cancelled touch', () => {
      const t = table('deal', 0)
      t.input.setTargets(new Map(t.hand.map((k) => [k, 'usable' as const])))
      const p = t.input.screenPoint(t.hand[0]!)!
      tap(t.input, mouse(p.x, p.y, { button: 2 }))
      t.input.pointerDown(finger(p.x, p.y, 1))
      t.input.pointerDown(finger(p.x + 50, p.y, 2))
      t.input.pointerUp(finger(p.x, p.y, 1))
      t.input.pointerDown(finger(p.x, p.y, 3))
      t.input.pointerCancel({ id: 3 })
      t.input.pointerUp(finger(p.x, p.y, 3))
      tap(t.input, { ...finger(p.x, p.y, 4), primary: false })
      expect(t.onTap).not.toHaveBeenCalled()
    })

    it('shakes a blocked card and reports nothing', () => {
      const t = table('play', 1)
      const [blocked] = t.hand.filter((k) => !k.endsWith('2S')) as [string]
      t.input.setTargets(new Map([[blocked, 'blocked']]))
      const mesh = t.layer.get(blocked)!
      const p = t.input.screenPoint(blocked)!
      tap(t.input, finger(p.x, p.y))
      expect(t.onTap).not.toHaveBeenCalled()
      let widest = 0
      for (let ms = 0; ms < SHAKE.duration; ms += 16) {
        t.scene.animator.advance(16)
        widest = Math.max(widest, Math.abs(mesh.body.position.x))
      }
      t.scene.animator.advance(100)
      expect(widest).toBeGreaterThan(SHAKE.distance / 2)
      expect(mesh.body.position.x).toBe(0)
      expect(t.scene.animator.busy).toBe(false)
    })

    it('does not shake with reduced motion', () => {
      const t = table('play', 1, undefined, { reducedMotion: true })
      const key = t.hand[0]!
      t.input.setTargets(new Map([[key, 'blocked']]))
      const p = t.input.screenPoint(key)!
      tap(t.input, finger(p.x, p.y))
      expect(t.scene.animator.busy).toBe(false)
      expect(t.layer.get(key)!.body.position.x).toBe(0)
    })

    it('a card going back to the pool mid-shake is not moved again', () => {
      const t = table('play', 1)
      const key = t.hand[0]!
      t.input.setTargets(new Map([[key, 'blocked']]))
      const mesh = t.layer.get(key)!
      const p = t.input.screenPoint(key)!
      tap(t.input, finger(p.x, p.y))
      t.scene.animator.advance(40)
      t.layer.clear()
      expect(mesh.body.position.x).toBe(0)
      t.scene.animator.advance(100)
      expect(mesh.body.position.x).toBe(0)
    })
  })

  describe('hovering', () => {
    it('lifts a usable card under the mouse and shows a pointer', () => {
      const t = table('deal', 0)
      t.input.setTargets(new Map(t.hand.map((k) => [k, 'usable' as const])))
      const [a, b] = t.hand as [string, string]
      const pa = t.input.screenPoint(a)!
      t.input.pointerMove(mouse(pa.x, pa.y))
      expect(t.input.hoveredKey).toBe(a)
      expect(t.onCursor).toHaveBeenLastCalledWith('pointer')
      t.scene.animator.advance(500)
      expect(t.layer.get(a)!.body.position.z).toBeCloseTo(-HOVER_LIFT)

      const pb = t.input.screenPoint(b)!
      t.input.pointerMove(mouse(pb.x, pb.y))
      t.scene.animator.advance(500)
      expect(t.input.hoveredKey).toBe(b)
      expect(t.layer.get(a)!.body.position.z).toBe(0)

      t.input.pointerLeave()
      t.scene.animator.advance(500)
      expect(t.input.hoveredKey).toBeNull()
      expect(t.layer.get(b)!.body.position.z).toBe(0)
      expect(t.onCursor).toHaveBeenLastCalledWith('default')
    })

    it('keeps the lifted card under the pointer at the edge it slid away from', () => {
      const t = table('deal', 0)
      t.input.setTargets(new Map(t.hand.map((k) => [k, 'usable' as const])))
      const key = t.hand[2]!
      // Near the bottom edge of the card as it lies: no longer covered once it has lifted.
      const edge = pointOnCard(t, key, 0, CARD_HEIGHT / 2 - HOVER_LIFT / 3)
      t.input.pointerMove(mouse(edge.x, edge.y))
      expect(t.input.hoveredKey).toBe(key)
      t.scene.animator.advance(500)
      t.input.pointerMove(mouse(edge.x, edge.y + 0.5))
      expect(t.input.hoveredKey).toBe(key)
      // Clearly off the card: let go.
      const below = pointOnCard(t, key, 0, CARD_HEIGHT)
      t.input.pointerMove(mouse(below.x, below.y))
      expect(t.input.hoveredKey).toBeNull()
    })

    it('does not lift cards that are idle, blocked or picked, nor for touch', () => {
      const t = table('discard', 0)
      const [a, b, c, d] = t.hand as [string, string, string, string]
      const states: [string, TargetState][] = [
        [a, 'idle'],
        [b, 'blocked'],
        [c, 'selected'],
        [d, 'usable'],
      ]
      t.input.setTargets(new Map(states))
      for (const [key] of states.slice(0, 3)) {
        const p = t.input.screenPoint(key)!
        t.input.pointerMove(mouse(p.x, p.y))
        expect(t.input.hoveredKey).toBeNull()
      }
      // A picked card can be put back: it shows a pointer, but stays where it is.
      expect(t.onCursor).toHaveBeenLastCalledWith('pointer')
      t.input.pointerLeave()
      const p = t.input.screenPoint(d)!
      t.input.pointerDown(finger(p.x, p.y))
      t.input.pointerMove(finger(p.x, p.y))
      expect(t.input.hoveredKey).toBeNull()
    })

    it('moves at once with reduced motion', () => {
      const t = table('deal', 0, undefined, { reducedMotion: true })
      const key = t.hand[0]!
      t.input.setTargets(new Map([[key, 'usable']]))
      const p = t.input.screenPoint(key)!
      t.input.pointerMove(mouse(p.x, p.y))
      expect(t.layer.get(key)!.body.position.z).toBeCloseTo(-HOVER_LIFT)
      expect(t.scene.animator.busy).toBe(false)
    })

    it('lowers the hovered card when it stops taking input', () => {
      const t = table('deal', 0)
      const key = t.hand[0]!
      t.input.setTargets(new Map([[key, 'usable']]))
      const p = t.input.screenPoint(key)!
      t.input.pointerMove(mouse(p.x, p.y))
      t.scene.animator.advance(500)
      t.input.setTargets(new Map([[key, 'idle']]))
      t.scene.animator.advance(500)
      expect(t.input.hoveredKey).toBeNull()
      expect(t.layer.get(key)!.body.position.z).toBe(0)
      expect(t.onCursor).toHaveBeenLastCalledWith('default')
    })
  })

  describe('dimming', () => {
    it('shades each card by its state, and restores cards that stop taking input', () => {
      const t = table('discard', 0)
      const [a, b, c, d] = t.hand as [string, string, string, string]
      t.input.setTargets(
        new Map<string, TargetState>([
          [a, 'usable'],
          [b, 'selected'],
          [c, 'idle'],
          [d, 'blocked'],
        ]),
      )
      expect([a, b, c, d].map((k) => t.layer.get(k)!.tint)).toEqual([
        TARGET_TINT.usable,
        TARGET_TINT.selected,
        TARGET_TINT.idle,
        TARGET_TINT.blocked,
      ])
      expect(TARGET_TINT.blocked).toBeLessThan(TARGET_TINT.idle)
      expect(TARGET_TINT.idle).toBeLessThan(1)
      t.input.setTargets(new Map([[a, 'usable']]))
      expect([b, c, d].map((k) => t.layer.get(k)!.tint)).toEqual([1, 1, 1])
      // Cards that never took input are drawn as printed.
      expect(t.layer.get('deck')!.tint).toBe(1)
    })
  })

  it('does nothing once disposed', () => {
    const t = table('deal', 0)
    t.input.setTargets(new Map(t.hand.map((k) => [k, 'usable' as const])))
    t.input.dispose()
    const p = t.input.screenPoint(t.hand[0]!)!
    t.input.pointerMove(mouse(p.x, p.y))
    tap(t.input, finger(p.x, p.y))
    expect(t.onTap).not.toHaveBeenCalled()
    expect(t.input.hoveredKey).toBeNull()
    expect(t.input.pick(p.x, p.y)).toBeNull()
  })
})

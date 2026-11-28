import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import type { CardId, PlayerView } from '@shared/protocol'
import { playerView, viewWhen, workedExample } from '@/test/game'
import type { TableRenderer, TableScene } from '@/three/TableScene'
import ThreeTable from './ThreeTable.vue'

// The real scene, cards and picking, on a stand-in renderer: jsdom has no WebGL. Every scene
// made is kept, so a test can look inside it.
const created = vi.hoisted(() => ({ scenes: [] as TableScene[] }))
vi.mock('@/three/TableScene', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/three/TableScene')>()
  const { fakePage, fakeRenderer, manualFrames } = await import('@/test/renderer')
  const { fakeAtlasSources } = await import('@/test/atlas')
  const { AtlasImage, atlasLayout } = await import('@/three/cardAtlas')
  class TestScene extends real.TableScene {
    constructor(options: ConstructorParameters<typeof real.TableScene>[0] = {}) {
      super({
        ...options,
        createRenderer: () => fakeRenderer() as unknown as TableRenderer,
        frames: manualFrames(),
        page: fakePage().visibility,
        atlasImage: (max) => new AtlasImage(atlasLayout(max), fakeAtlasSources().sources),
      })
      created.scenes.push(this)
    }
  }
  return { ...real, TableScene: TestScene }
})

const SIZE = { width: 390, height: 760 }
/** The HUD covers the canvas above and below this band. */
const HOLE = { top: 90, bottom: 560 }

let observers: { callback: ResizeObserverCallback; target: Element | null }[]
beforeEach(() => {
  observers = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private entry: (typeof observers)[number]
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, target: null }
        observers.push(this.entry)
      }
      observe(target: Element) {
        this.entry.target = target
      }
      disconnect() {
        observers.splice(observers.indexOf(this.entry), 1)
      }
    },
  )
  // jsdom lays nothing out: the canvas fills the screen, the hole is the band between the HUD's
  // scores and its buttons.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const band = this.dataset.testid === 'table-hole' ? HOLE : { top: 0, bottom: SIZE.height }
    return {
      x: 0,
      y: band.top,
      left: 0,
      top: band.top,
      right: SIZE.width,
      bottom: band.bottom,
      width: SIZE.width,
      height: band.bottom - band.top,
      toJSON: () => ({}),
    }
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function holeElement() {
  const hole = document.createElement('div')
  hole.dataset.testid = 'table-hole'
  document.body.append(hole)
  return hole
}

async function open(view: PlayerView, props: { selected?: CardId[]; busy?: boolean } = {}) {
  const hole = holeElement()
  const wrapper = mount(ThreeTable, {
    props: { view, selected: props.selected ?? [], busy: props.busy ?? false, hole },
    attachTo: document.body,
  })
  // The canvas gets its size, as a ResizeObserver reports it in the browser.
  const box = observers.find((o) => o.target !== hole)!
  box.callback(
    [{ contentRect: { width: SIZE.width, height: SIZE.height } } as ResizeObserverEntry],
    {} as ResizeObserver,
  )
  await nextTick()
  return { wrapper, hole }
}

type Wrapper = Awaited<ReturnType<typeof open>>['wrapper']

interface Target {
  card: string
  state: string
  x: number
  y: number
}
function targets(wrapper: Wrapper): Target[] {
  return wrapper.findAll('[data-testid="table-target"]').map((li) => {
    const el = li.element as HTMLElement
    return {
      card: el.dataset.card!,
      state: el.dataset.state!,
      x: Number(el.dataset.x),
      y: Number(el.dataset.y),
    }
  })
}
function target(wrapper: Wrapper, card: string): Target {
  const found = targets(wrapper).find((t) => t.card === card)
  if (!found) throw new Error(`${card} is not a target`)
  return found
}

function tapAt(on: Element, x: number, y: number, type = 'touch') {
  const init = { clientX: x, clientY: y, pointerId: 5, pointerType: type, isPrimary: true }
  on.dispatchEvent(new PointerEvent('pointerdown', { ...init, bubbles: true }))
  on.dispatchEvent(new PointerEvent('pointerup', { ...init, bubbles: true }))
}
const canvasOf = (wrapper: Wrapper) => wrapper.get('canvas').element

const discarding = () => viewWhen(0, (s) => s.phase === 'discard')

describe('ThreeTable', () => {
  it('lays out the hand, and lists where each card it takes input from is drawn', async () => {
    const view = discarding()
    const { wrapper } = await open(view)
    const list = targets(wrapper)
    expect(list.map((t) => t.card)).toEqual(view.myHand)
    expect(new Set(list.map((t) => t.state))).toEqual(new Set(['usable']))
    // Kept in the hole the HUD leaves, not under the scores or the buttons.
    for (const t of list) {
      expect(t.y).toBeGreaterThan(HOLE.top)
      expect(t.y).toBeLessThan(HOLE.bottom)
    }
    expect(wrapper.get('[data-testid="table-targets"]').attributes('data-layout')).toBe('portrait')
  })

  it('picks and puts back cards for the crib with taps on the canvas or the hole', async () => {
    const view = discarding()
    const [a] = view.myHand as [CardId]
    const { wrapper, hole } = await open(view)
    const t = target(wrapper, a)
    tapAt(canvasOf(wrapper), t.x, t.y)
    expect(wrapper.emitted('update:selected')).toEqual([[[a]]])

    await wrapper.setProps({ selected: [a] })
    const picked = target(wrapper, a)
    expect(picked.state).toBe('selected')
    // Raised out of the hand.
    expect(picked.y).toBeLessThan(t.y)
    tapAt(hole, picked.x, picked.y)
    expect(wrapper.emitted('update:selected')![1]).toEqual([[]])
  })

  it('lays a playable card, and nothing for one that cannot be played', async () => {
    const view: PlayerView = {
      ...playerView(workedExample(), 0),
      legal: { discard: false, cut: false, playable: ['7S'], go: false, ready: false },
    }
    const { wrapper } = await open(view)
    expect(target(wrapper, 'KH').state).toBe('blocked')
    const king = target(wrapper, 'KH')
    tapAt(canvasOf(wrapper), king.x, king.y)
    expect(wrapper.emitted('play')).toBeUndefined()
    const seven = target(wrapper, '7S')
    tapAt(canvasOf(wrapper), seven.x, seven.y, 'mouse')
    expect(wrapper.emitted('play')).toEqual([['7S']])
  })

  it('cuts when the pone taps the deck', async () => {
    const cutting = (s: { phase: string }) => s.phase === 'cut'
    const pone = viewWhen(0, cutting)
    const seat = pone.legal.cut ? 0 : 1
    const { wrapper } = await open(viewWhen(seat, cutting))
    const deck = target(wrapper, 'deck')
    expect(deck.state).toBe('usable')
    tapAt(canvasOf(wrapper), deck.x, deck.y)
    expect(wrapper.emitted('cut')).toEqual([[]])
    // The dealer can't: the deck is not a target for them.
    const dealer = await open(viewWhen(seat === 0 ? 1 : 0, cutting))
    expect(targets(dealer.wrapper).map((t) => t.card)).not.toContain('deck')
  })

  it('takes nothing while busy', async () => {
    const view = playerView(workedExample(), 0)
    const { wrapper } = await open(view, { busy: true })
    expect(new Set(targets(wrapper).map((t) => t.state))).toEqual(new Set(['idle']))
    const t = target(wrapper, '7S')
    tapAt(canvasOf(wrapper), t.x, t.y)
    expect(wrapper.emitted('play')).toBeUndefined()
  })

  it('ignores presses that land on the HUD', async () => {
    const view = playerView(workedExample(), 0)
    const { wrapper } = await open(view)
    const button = document.createElement('button')
    document.body.append(button)
    const t = target(wrapper, '7S')
    tapAt(button, t.x, t.y)
    expect(wrapper.emitted('play')).toBeUndefined()
  })

  it('follows the view: a card played leaves the hand', async () => {
    const view = playerView(workedExample(), 0)
    const { wrapper } = await open(view)
    expect(targets(wrapper)).toHaveLength(4)
    const after: PlayerView = {
      ...view,
      myHand: view.myHand.filter((c) => c !== '7S'),
      played: [['7S'], []],
      sequence: [{ seat: 0, card: '7S' }],
      count: 7,
      turn: 1,
      legal: { discard: false, cut: false, playable: [], go: false, ready: false },
    }
    await wrapper.setProps({ view: after })
    expect(targets(wrapper).map((t) => t.card)).toEqual(['3C', '8D', 'KH'])
    expect(new Set(targets(wrapper).map((t) => t.state))).toEqual(new Set(['idle']))
  })

  it('shows a pointer over a card that can be used', async () => {
    const view = playerView(workedExample(), 0)
    const { wrapper, hole } = await open(view)
    const t = target(wrapper, '7S')
    const move = { clientX: t.x, clientY: t.y, pointerId: 1, pointerType: 'mouse', bubbles: true }
    canvasOf(wrapper).dispatchEvent(new PointerEvent('pointermove', move))
    expect(hole.style.cursor).toBe('pointer')
    expect((wrapper.element as HTMLElement).style.cursor).toBe('pointer')
    wrapper.unmount()
    expect(hole.style.cursor).toBe('')
  })

  it('stops listening once unmounted', async () => {
    const view = playerView(workedExample(), 0)
    const { wrapper } = await open(view)
    const t = target(wrapper, '7S')
    const canvas = canvasOf(wrapper)
    const removed = vi.spyOn(window, 'removeEventListener')
    wrapper.unmount()
    const kinds = removed.mock.calls.map(([kind]) => kind)
    for (const kind of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      expect(kinds).toContain(kind)
    }
    document.body.append(canvas)
    tapAt(canvas, t.x, t.y)
    expect(wrapper.emitted('play')).toBeUndefined()
  })

  it('does not move a card when only busy changes, so nothing moving is stopped', async () => {
    const view = playerView(workedExample(), 0)
    const { wrapper } = await open(view)
    const scene = created.scenes.at(-1)!
    const card = scene.table.getObjectByName(`card-${view.hand}:7S`)!
    const rest = card.position.x
    // A card on its way somewhere, as the animation director will move them.
    scene.animator.tween(card.position, { x: rest + 1 }, { duration: 1000 })
    scene.animator.advance(500)
    const midway = card.position.x
    await wrapper.setProps({ busy: true })
    expect(target(wrapper, '7S').state).toBe('idle')
    expect(card.position.x).toBe(midway)
    scene.animator.advance(500)
    expect(card.position.x).toBeCloseTo(rest + 1)
    // A new view is laid out again.
    await wrapper.setProps({ view: { ...view } })
    expect(card.position.x).toBeCloseTo(rest)
  })

  it('lists every card on the table, and the canvas size the layout is for', async () => {
    const view = playerView(workedExample(), 0)
    const { wrapper } = await open(view)
    const list = wrapper.get('[data-testid="table-targets"]')
    expect(list.attributes('data-size')).toBe(`${SIZE.width}x${SIZE.height}`)
    const cards = wrapper.findAll('[data-testid="table-card"]').map((li) => {
      const el = li.element as HTMLElement
      return { card: el.dataset.card ?? null, zone: el.dataset.zone, faceUp: el.dataset.faceUp }
    })
    expect(cards).toContainEqual({ card: '5H', zone: 'starter', faceUp: 'true' })
    expect(cards.filter((c) => c.zone === 'my-hand').map((c) => c.card)).toEqual(view.myHand)
    // The opponent's cards are on the table, with no faces.
    const theirs = cards.filter((c) => c.zone === 'opponent-hand')
    expect(theirs).toHaveLength(4)
    expect(theirs.every((c) => c.card === null && c.faceUp === 'false')).toBe(true)
  })
})

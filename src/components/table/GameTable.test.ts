import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { isReactive } from 'vue'
import GameTable from './GameTable.vue'

// The real scene needs WebGL, which jsdom lacks; this stand-in records how the component uses it.
const fake = vi.hoisted(() => {
  const state = { scenes: [] as FakeScene[], mountError: null as Error | null }
  class FakeScene {
    options: unknown
    canvas: HTMLCanvasElement | null = null
    resize = vi.fn()
    dispose = vi.fn(() => ({ geometries: 0, textures: 0, contextReleased: true }))
    constructor(options: unknown) {
      this.options = options
      state.scenes.push(this)
    }
    mount(canvas: HTMLCanvasElement) {
      if (state.mountError) throw state.mountError
      this.canvas = canvas
    }
  }
  return { state, FakeScene }
})
type FakeScene = InstanceType<typeof fake.FakeScene>
const scenes = fake.state.scenes
vi.mock('@/three/TableScene', () => ({ TableScene: fake.FakeScene }))

let observed: { callback: ResizeObserverCallback; target: Element | null; disconnected: boolean }[]
beforeEach(() => {
  scenes.length = 0
  fake.state.mountError = null
  observed = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private entry: (typeof observed)[number]
      constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, target: null, disconnected: false }
        observed.push(this.entry)
      }
      observe(target: Element) {
        this.entry.target = target
      }
      disconnect() {
        this.entry.disconnected = true
      }
    },
  )
  vi.stubGlobal('devicePixelRatio', 3)
})
afterEach(() => vi.unstubAllGlobals())

function resizeTo(width: number, height: number) {
  const { callback } = observed[0]!
  callback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver)
}

describe('GameTable', () => {
  it('mounts one scene on its own canvas, held outside Vue reactivity', () => {
    const wrapper = mount(GameTable, { props: { options: { onFrame: () => {} } } })
    expect(scenes).toHaveLength(1)
    const scene = scenes[0]!
    expect(scene.canvas).toBe(wrapper.get('canvas').element)
    const [ready] = wrapper.emitted('ready')![0] as unknown as [FakeScene]
    expect(ready).toBe(scene)
    expect(isReactive(ready)).toBe(false)
    expect(scene.options).toEqual({ onFrame: expect.any(Function) })
  })

  it('passes its size and the pixel ratio to the scene whenever the box changes', () => {
    mount(GameTable)
    const scene = scenes[0]!
    expect(scene.resize).toHaveBeenCalledTimes(1) // its size at mount
    resizeTo(390, 640)
    expect(scene.resize).toHaveBeenLastCalledWith(390, 640, 3)
  })

  it('disposes the scene and stops watching the size when it unmounts', () => {
    const onDisposed = vi.fn()
    const wrapper = mount(GameTable, { attrs: { onDisposed } })
    wrapper.unmount()
    expect(scenes[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(observed[0]!.disconnected).toBe(true)
    expect(onDisposed).toHaveBeenCalledExactlyOnceWith({
      geometries: 0,
      textures: 0,
      contextReleased: true,
    })
  })

  it('reports a scene that cannot start, and cleans up after it', () => {
    const mountError = new Error('WebGL is not available')
    fake.state.mountError = mountError
    const onDisposed = vi.fn()
    const wrapper = mount(GameTable, { attrs: { onDisposed } })
    expect(wrapper.emitted('failed')![0]).toEqual([mountError])
    expect(wrapper.emitted('ready')).toBeUndefined()
    expect(scenes[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(observed).toHaveLength(0)
    wrapper.unmount()
    expect(onDisposed).not.toHaveBeenCalled()
  })
})

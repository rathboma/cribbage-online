import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useToasts } from '@/stores/toasts'
import WaitingRoom from './WaitingRoom.vue'

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
})

const mountRoom = () => mount(WaitingRoom, { props: { code: 'BCDFG' } })

describe('WaitingRoom', () => {
  it('shows the code large and the join link', () => {
    const wrapper = mountRoom()
    expect(wrapper.get('[data-testid="game-code"]').text()).toBe('BCDFG')
    expect(wrapper.get('a').attributes('href')).toBe(`${window.location.origin}/j/BCDFG`)
    expect(wrapper.get('[role="status"]').text()).toContain('Waiting for your opponent')
  })

  it('copies the code and the link, and says so', async () => {
    const wrapper = mountRoom()
    const buttons = wrapper.findAll('button')
    await buttons.find((b) => b.text() === 'Copy code')!.trigger('click')
    await buttons.find((b) => b.text() === 'Copy link')!.trigger('click')
    await flushPromises()
    expect(writeText.mock.calls).toEqual([['BCDFG'], [`${window.location.origin}/j/BCDFG`]])
    expect(useToasts().toasts.map((t) => t.message)).toEqual(['Code copied', 'Link copied'])
  })

  it('says so when copying fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    document.execCommand = vi.fn(() => false)
    const wrapper = mountRoom()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Copy code')!
      .trigger('click')
    await flushPromises()
    expect(useToasts().toasts[0]).toMatchObject({ kind: 'error' })
  })

  it('offers the native share sheet only where there is one', async () => {
    expect(
      mountRoom()
        .findAll('button')
        .map((b) => b.text()),
    ).not.toContain('Share')
    const share = vi.fn(async () => {})
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    const wrapper = mountRoom()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Share')!
      .trigger('click')
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${window.location.origin}/j/BCDFG` }),
    )
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useToasts } from '@/stores/toasts'
import ToastHost from './ToastHost.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const politeRegion = (w: ReturnType<typeof mount>) => w.get('[role="status"][aria-live="polite"]')
const alertRegion = (w: ReturnType<typeof mount>) => w.get('[role="alert"]')

describe('ToastHost', () => {
  it('has its live regions in place before any toast, so the first one is announced', () => {
    const wrapper = mount(ToastHost)
    expect(politeRegion(wrapper).text()).toBe('')
    expect(politeRegion(wrapper).attributes('aria-atomic')).toBe('false')
    expect(alertRegion(wrapper).text()).toBe('')
  })

  it('announces only the message text: politely for info, as an alert for errors', async () => {
    const wrapper = mount(ToastHost)
    const toasts = useToasts()
    toasts.push('Code copied')
    toasts.push('Connection lost', { kind: 'error' })
    await nextTick()
    expect(politeRegion(wrapper).text()).toBe('Code copied')
    expect(alertRegion(wrapper).text()).toBe('Connection lost')
  })

  it('removes a toast after a while', async () => {
    const wrapper = mount(ToastHost)
    useToasts().push('Code copied')
    await nextTick()
    expect(wrapper.find('.toast-host__toast').exists()).toBe(true)
    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(wrapper.find('.toast-host__toast').exists()).toBe(false)
  })

  it('keeps a toast while it is hovered or focused', async () => {
    const wrapper = mount(ToastHost)
    useToasts().push('Code copied')
    await nextTick()
    await wrapper.get('.toast-host__toast').trigger('focusin')
    vi.advanceTimersByTime(60_000)
    await nextTick()
    expect(wrapper.find('.toast-host__toast').exists()).toBe(true)
    await wrapper.get('.toast-host__toast').trigger('focusout')
    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(wrapper.find('.toast-host__toast').exists()).toBe(false)
  })

  it('can be dismissed, and can stay until dismissed', async () => {
    const wrapper = mount(ToastHost)
    useToasts().push('Connection lost', { kind: 'error', timeoutMs: 0 })
    await nextTick()
    vi.advanceTimersByTime(60_000)
    await nextTick()
    expect(wrapper.find('.toast-host__toast--error').exists()).toBe(true)
    await wrapper.get('[aria-label="Dismiss: Connection lost"]').trigger('click')
    expect(wrapper.find('.toast-host__toast').exists()).toBe(false)
  })
})

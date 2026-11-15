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

describe('ToastHost', () => {
  it('announces toasts politely and removes them after a while', async () => {
    const wrapper = mount(ToastHost)
    const toasts = useToasts()
    toasts.push('Code copied')
    await nextTick()
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Code copied')
    vi.advanceTimersByTime(4000)
    await nextTick()
    expect(wrapper.text()).not.toContain('Code copied')
  })

  it('can be dismissed, and can stay until dismissed', async () => {
    const wrapper = mount(ToastHost)
    useToasts().push('Connection lost', { kind: 'error', timeoutMs: 0 })
    await nextTick()
    vi.advanceTimersByTime(60_000)
    await nextTick()
    expect(wrapper.find('.toast-host__toast--error').exists()).toBe(true)
    await wrapper.get('[aria-label="Dismiss"]').trigger('click')
    expect(wrapper.find('.toast-host__toast').exists()).toBe(false)
  })
})

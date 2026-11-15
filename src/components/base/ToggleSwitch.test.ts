import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ToggleSwitch from './ToggleSwitch.vue'

function mountSwitch(initial = false, extra: Record<string, unknown> = {}) {
  const wrapper = mount(ToggleSwitch, {
    props: {
      label: 'Video',
      modelValue: initial,
      'onUpdate:modelValue': (v: boolean) => wrapper.setProps({ modelValue: v }),
      ...extra,
    },
    slots: { badge: '<span class="badge">Beta</span>' },
    attachTo: document.body,
  })
  return wrapper
}

describe('ToggleSwitch', () => {
  it('is a labelled switch that reports its state', () => {
    const wrapper = mountSwitch(true)
    const control = wrapper.get('[role="switch"]')
    expect(control.attributes('aria-checked')).toBe('true')
    const label = wrapper.get(`#${CSS.escape(control.attributes('aria-labelledby')!)}`)
    expect(label.text()).toContain('Video')
    expect(label.text()).toContain('Beta')
    wrapper.unmount()
  })

  it('toggles on click', async () => {
    const wrapper = mountSwitch(false)
    await wrapper.get('[role="switch"]').trigger('click')
    expect(wrapper.props('modelValue')).toBe(true)
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    await wrapper.get('[role="switch"]').trigger('click')
    expect(wrapper.props('modelValue')).toBe(false)
    wrapper.unmount()
  })

  it('is a native button, so it is focusable and keyboard-operable', () => {
    const wrapper = mountSwitch()
    const control = wrapper.get('[role="switch"]').element as HTMLButtonElement
    expect(control.tagName).toBe('BUTTON')
    expect(control.type).toBe('button')
    control.focus()
    expect(document.activeElement).toBe(control)
    wrapper.unmount()
  })

  it('reports the off state explicitly', () => {
    const wrapper = mountSwitch(false)
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
    wrapper.unmount()
  })

  it('toggles when the label text is clicked', async () => {
    const wrapper = mountSwitch(false)
    ;(wrapper.get('.toggle-switch__label').element as HTMLElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.props('modelValue')).toBe(true)
    wrapper.unmount()
  })

  it('describes itself and can be disabled', () => {
    const wrapper = mountSwitch(false, { description: 'Peer to peer', disabled: true })
    const control = wrapper.get('[role="switch"]')
    expect(wrapper.get(`#${CSS.escape(control.attributes('aria-describedby')!)}`).text()).toBe(
      'Peer to peer',
    )
    expect((control.element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })
})

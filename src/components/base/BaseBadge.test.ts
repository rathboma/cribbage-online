import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BaseBadge from './BaseBadge.vue'

describe('BaseBadge', () => {
  it('shows its text in the accent style by default', () => {
    const wrapper = mount(BaseBadge, { slots: { default: 'Beta' } })
    expect(wrapper.text()).toBe('Beta')
    expect(wrapper.classes()).toContain('base-badge--accent')
  })

  it('has a neutral style', () => {
    const wrapper = mount(BaseBadge, { props: { variant: 'neutral' } })
    expect(wrapper.classes()).toContain('base-badge--neutral')
  })
})

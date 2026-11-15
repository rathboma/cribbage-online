import { describe, expect, it } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import BaseButton from './BaseButton.vue'

const stubs = { RouterLink: RouterLinkStub }

describe('BaseButton', () => {
  it('is a real button that emits clicks', async () => {
    const wrapper = mount(BaseButton, { slots: { default: 'Go' } })
    const button = wrapper.get('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.text()).toBe('Go')
    await button.trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('can submit a form', () => {
    expect(
      mount(BaseButton, { props: { type: 'submit' } })
        .get('button')
        .attributes('type'),
    ).toBe('submit')
  })

  it('is disabled while disabled or loading, and says it is busy', () => {
    expect(mount(BaseButton, { props: { disabled: true } }).get('button').element.disabled).toBe(
      true,
    )
    const loading = mount(BaseButton, { props: { loading: true } }).get('button')
    expect(loading.element.disabled).toBe(true)
    expect(loading.attributes('aria-busy')).toBe('true')
  })

  it('renders a link when given a route', () => {
    const wrapper = mount(BaseButton, {
      props: { to: '/new' },
      slots: { default: 'Start' },
      global: { stubs },
    })
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/new')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('falls back to a disabled button when a link is disabled', () => {
    const wrapper = mount(BaseButton, { props: { to: '/new', disabled: true }, global: { stubs } })
    expect(wrapper.findComponent(RouterLinkStub).exists()).toBe(false)
    expect(wrapper.get('button').element.disabled).toBe(true)
  })

  it('applies its variant and size', () => {
    const classes = mount(BaseButton, { props: { variant: 'secondary', size: 'lg', block: true } })
      .get('button')
      .classes()
    expect(classes).toEqual(
      expect.arrayContaining(['base-button--secondary', 'base-button--lg', 'base-button--block']),
    )
  })
})

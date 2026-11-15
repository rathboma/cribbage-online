import { describe, expect, it, vi } from 'vitest'
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

  it('is disabled when disabled', () => {
    expect(mount(BaseButton, { props: { disabled: true } }).get('button').element.disabled).toBe(
      true,
    )
  })

  it('stays focusable while loading, says it is busy, and ignores clicks', async () => {
    const onClick = vi.fn()
    const wrapper = mount(BaseButton, {
      props: { loading: true, type: 'submit', onClick },
      attachTo: document.body,
    })
    const button = wrapper.get('button')
    expect(button.element.disabled).toBe(false)
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('aria-disabled')).toBe('true')
    button.element.focus()
    expect(document.activeElement).toBe(button.element)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    button.element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true) // so a submit button doesn't submit again
    expect(onClick).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('renders a link styled as a button when given a route', () => {
    const wrapper = mount(BaseButton, {
      props: { to: '/new' },
      slots: { default: 'Start' },
      global: { stubs },
    })
    const link = wrapper.findComponent(RouterLinkStub)
    expect(link.props('to')).toBe('/new')
    expect(link.classes()).toEqual(
      expect.arrayContaining(['base-button', 'base-button--primary', 'base-button--md']),
    )
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

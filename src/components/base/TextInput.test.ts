import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TextInput from './TextInput.vue'

describe('TextInput', () => {
  it('labels its input', () => {
    const wrapper = mount(TextInput, { props: { label: 'Your name' } })
    const input = wrapper.get('input')
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
    expect(wrapper.get('label').text()).toBe('Your name')
  })

  it('works with v-model', async () => {
    const wrapper = mount(TextInput, {
      props: {
        label: 'Name',
        modelValue: 'Ada',
        'onUpdate:modelValue': (v: string) => wrapper.setProps({ modelValue: v }),
      },
    })
    expect(wrapper.get('input').element.value).toBe('Ada')
    await wrapper.get('input').setValue('Bo')
    expect(wrapper.props('modelValue')).toBe('Bo')
  })

  it('passes attributes such as maxlength and autocomplete to the input', () => {
    const wrapper = mount(TextInput, {
      props: { label: 'Name' },
      attrs: { maxlength: 20, autocomplete: 'nickname' },
    })
    expect(wrapper.get('input').attributes()).toMatchObject({
      maxlength: '20',
      autocomplete: 'nickname',
    })
    expect(wrapper.classes()).toContain('text-input')
  })

  it('links the hint and the error to the input for screen readers', () => {
    const wrapper = mount(TextInput, {
      props: { label: 'Name', hint: 'Up to 20 characters', error: 'Enter a name' },
    })
    const input = wrapper.get('input')
    expect(input.attributes('aria-invalid')).toBe('true')
    const ids = input.attributes('aria-describedby')!.split(' ')
    expect(ids.map((id) => wrapper.get(`#${CSS.escape(id)}`).text())).toEqual([
      'Enter a name',
      'Up to 20 characters',
    ])
    expect(wrapper.get('[role="alert"]').text()).toBe('Enter a name')
  })

  it('is not marked invalid without an error', () => {
    const input = mount(TextInput, { props: { label: 'Name' } }).get('input')
    expect(input.attributes('aria-invalid')).toBeUndefined()
    expect(input.attributes('aria-describedby')).toBeUndefined()
  })
})

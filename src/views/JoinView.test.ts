import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import JoinView from './JoinView.vue'

function mountWithCode(code?: string) {
  return mount(JoinView, {
    props: code === undefined ? {} : { code },
    global: { stubs: { RouterLink: true } },
  })
}

describe('JoinView', () => {
  it('shows a deep-linked code normalized by the shared module', () => {
    expect(mountWithCode('bcd-fg').get('[data-testid="game-code"]').text()).toBe('BCDFG')
  })

  it('explains an invalid code', () => {
    expect(mountWithCode('hello').text()).toContain("isn't a valid game code")
  })

  it('shows the join placeholder without a code', () => {
    expect(mountWithCode().text()).toContain('join flow')
  })
})

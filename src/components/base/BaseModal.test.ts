import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import BaseModal from './BaseModal.vue'

let wrapper: VueWrapper | null = null
/** The modal's `open` model, as the parent sees it. */
let isOpen = true
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

async function openModal(props: Record<string, unknown> = {}) {
  isOpen = true
  const opener = document.createElement('button')
  opener.textContent = 'Open'
  document.body.append(opener)
  opener.focus()
  wrapper = mount(BaseModal, {
    props: {
      title: 'Leave the game?',
      open: true,
      'onUpdate:open': (v: boolean) => {
        isOpen = v
        return wrapper!.setProps({ open: v })
      },
      ...props,
    },
    slots: {
      default: '<p>Your opponent will be told.</p>',
      actions: '<button class="stay">Stay</button><button class="leave">Leave</button>',
    },
    attachTo: document.body,
  })
  await nextTick()
  await nextTick()
  return opener
}

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null

describe('BaseModal', () => {
  it('is a labelled modal dialog', async () => {
    await openModal()
    const el = dialog()!
    expect(el.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(el.getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe('Leave the game?')
  })

  it('moves focus into the dialog and gives it back when closed', async () => {
    const opener = await openModal()
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    await wrapper!.setProps({ open: false })
    await nextTick()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Escape, the close button and the backdrop', async () => {
    await openModal()
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(isOpen).toBe(false)

    await wrapper!.setProps({ open: true })
    isOpen = true
    await nextTick()
    ;(document.querySelector('[aria-label="Close"]') as HTMLElement).click()
    await nextTick()
    expect(isOpen).toBe(false)

    await wrapper!.setProps({ open: true })
    isOpen = true
    await nextTick()
    ;(document.querySelector('[data-testid="modal-backdrop"]') as HTMLElement).click()
    await nextTick()
    expect(isOpen).toBe(false)
  })

  it('keeps Tab inside the dialog', async () => {
    await openModal()
    const buttons = [...dialog()!.querySelectorAll('button')]
    const last = buttons.at(-1)!
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(buttons[0])

    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    buttons[0]!.dispatchEvent(shiftTab)
    expect(document.activeElement).toBe(last)
  })

  it('can be made impossible to dismiss', async () => {
    await openModal({ dismissible: false })
    expect(document.querySelector('[aria-label="Close"]')).toBeNull()
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(isOpen).toBe(true)
  })
})

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

const dialog = () => document.querySelector('dialog') as HTMLDialogElement

async function reopen() {
  await wrapper!.setProps({ open: true })
  isOpen = true
  await nextTick()
  await nextTick()
}

describe('BaseModal', () => {
  it('opens a native modal dialog, labelled and described', async () => {
    await openModal()
    const el = dialog()
    expect(el.open).toBe(true)
    expect(el.getAttribute('role')).toBe('dialog')
    expect(document.getElementById(el.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Leave the game?',
    )
    expect(document.getElementById(el.getAttribute('aria-describedby')!)?.textContent).toContain(
      'Your opponent will be told.',
    )
    expect(document.documentElement.classList.contains('modal-open')).toBe(true)
  })

  it('focuses the element asked for, and gives focus back when closed', async () => {
    const opener = await openModal({ initialFocus: '.stay' })
    expect(document.activeElement?.className).toBe('stay')
    await wrapper!.setProps({ open: false })
    await nextTick()
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(document.documentElement.classList.contains('modal-open')).toBe(false)
  })

  it('closes on Escape (the cancel event), the close button and the backdrop', async () => {
    await openModal()
    const cancel = new Event('cancel', { cancelable: true })
    dialog().dispatchEvent(cancel)
    await nextTick()
    expect(cancel.defaultPrevented).toBe(true)
    expect(isOpen).toBe(false)

    await reopen()
    ;(document.querySelector('[aria-label="Close"]') as HTMLElement).click()
    await nextTick()
    expect(isOpen).toBe(false)

    await reopen()
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(isOpen).toBe(false)
  })

  it('stays open when its content is clicked', async () => {
    await openModal()
    ;(document.querySelector('.base-modal__body p') as HTMLElement).click()
    await nextTick()
    expect(isOpen).toBe(true)
  })

  it('can be an alertdialog that cannot be dismissed', async () => {
    await openModal({ dismissible: false, role: 'alertdialog' })
    expect(dialog().getAttribute('role')).toBe('alertdialog')
    expect(document.querySelector('[aria-label="Close"]')).toBeNull()
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }))
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(isOpen).toBe(true)
    expect(dialog().open).toBe(true)
  })
})

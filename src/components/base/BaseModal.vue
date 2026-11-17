<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

/**
 * A modal dialog built on the native <dialog>: the browser makes the rest of the page inert,
 * handles Escape and puts it above everything. Centred on wide screens, a bottom sheet on phones.
 */
const props = withDefaults(
  defineProps<{
    title: string
    /** Escape, the close button and a click outside close it. */
    dismissible?: boolean
    /** CSS selector of the element to focus when it opens (e.g. the least destructive action). */
    initialFocus?: string
    /** `alertdialog` for confirmations that interrupt (e.g. "Leave the game?"). */
    role?: 'dialog' | 'alertdialog'
  }>(),
  { dismissible: true, initialFocus: undefined, role: 'dialog' },
)
const open = defineModel<boolean>('open', { default: false })

const id = useId()
const dialog = ref<HTMLDialogElement | null>(null)
let returnFocusTo: HTMLElement | null = null

function close() {
  if (props.dismissible) open.value = false
}

function onCancel(event: Event) {
  // Escape: the browser would close the dialog itself; keep `open` in charge instead.
  event.preventDefault()
  close()
}

function onClick(event: MouseEvent) {
  // A click on the dialog element itself (not its content) is a click on the backdrop.
  if (event.target === dialog.value) close()
}

async function show() {
  await nextTick()
  const el = dialog.value
  if (!el || el.open) return
  returnFocusTo = document.activeElement as HTMLElement | null
  el.showModal()
  document.documentElement.classList.add('modal-open')
  const target = props.initialFocus
    ? el.querySelector<HTMLElement>(props.initialFocus)
    : el.querySelector<HTMLElement>('[autofocus]')
  ;(target ?? el.querySelector<HTMLElement>('.base-modal__panel'))?.focus()
}

function hide() {
  const el = dialog.value
  if (el?.open) el.close()
  document.documentElement.classList.remove('modal-open')
  returnFocusTo?.focus?.()
  returnFocusTo = null
}

watch(open, (isOpen) => (isOpen ? show() : hide()), { immediate: true })
onBeforeUnmount(hide)
</script>

<template>
  <dialog
    ref="dialog"
    class="base-modal"
    :role="role"
    :aria-labelledby="`${id}-title`"
    :aria-describedby="`${id}-body`"
    @cancel="onCancel"
    @click="onClick"
  >
    <div class="base-modal__panel" tabindex="-1">
      <header class="base-modal__header">
        <h2 :id="`${id}-title`" class="base-modal__title">{{ title }}</h2>
        <button
          v-if="dismissible"
          type="button"
          class="base-modal__close"
          aria-label="Close"
          @click="close"
        >
          ×
        </button>
      </header>
      <div :id="`${id}-body`" class="base-modal__body"><slot /></div>
      <footer v-if="$slots.actions" class="base-modal__actions"><slot name="actions" /></footer>
    </div>
  </dialog>
</template>

<style scoped>
.base-modal {
  width: 100%;
  max-width: 100%;
  max-height: 90dvh;
  margin: auto 0 0;
  padding: 0;
  border: 0;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-cream);
  color: var(--color-ink);
  box-shadow: var(--shadow-lg);
}
.base-modal::backdrop {
  background: rgb(0 0 0 / 0.45);
}
@media (min-width: 600px) {
  .base-modal {
    width: min(480px, calc(100% - 2 * var(--space-5)));
    margin: auto;
    border-radius: var(--radius-lg);
  }
}
.base-modal__panel {
  padding: var(--space-5) var(--space-5) calc(var(--space-5) + env(safe-area-inset-bottom));
  outline: none;
}
.base-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.base-modal__title {
  margin: 0;
  font-size: var(--font-size-xl);
}
.base-modal__close {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 1.75rem;
  line-height: 1;
  cursor: pointer;
}
.base-modal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-5);
}
</style>

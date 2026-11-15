<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

/**
 * A dialog: centred on wide screens, a bottom sheet on phones. Traps focus while open, closes on
 * Escape or a click outside, and gives focus back to whatever had it before.
 */
const props = withDefaults(defineProps<{ title: string; dismissible?: boolean }>(), {
  dismissible: true,
})
const open = defineModel<boolean>('open', { default: false })

const id = useId()
const panel = ref<HTMLElement | null>(null)
let returnFocusTo: HTMLElement | null = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(): HTMLElement[] {
  return panel.value ? [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)] : []
}

function close() {
  if (props.dismissible) open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
  } else if (event.key === 'Tab') {
    // Keep focus inside the dialog.
    const items = focusables()
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0] as HTMLElement
    const last = items.at(-1) as HTMLElement
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      returnFocusTo = document.activeElement as HTMLElement | null
      await nextTick()
      ;(focusables()[0] ?? panel.value)?.focus()
    } else {
      returnFocusTo?.focus?.()
      returnFocusTo = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (open.value) returnFocusTo?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="base-modal" @keydown="onKeydown">
      <div class="base-modal__backdrop" data-testid="modal-backdrop" @click="close" />
      <div
        ref="panel"
        class="base-modal__panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${id}-title`"
        tabindex="-1"
      >
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
        <div class="base-modal__body"><slot /></div>
        <footer v-if="$slots.actions" class="base-modal__actions"><slot name="actions" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.base-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.base-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 0.45);
}
.base-modal__panel {
  position: relative;
  width: 100%;
  max-height: 90dvh;
  overflow: auto;
  padding: var(--space-5) var(--space-5) calc(var(--space-5) + env(safe-area-inset-bottom));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-cream);
  color: var(--color-ink);
  box-shadow: var(--shadow-lg);
}
@media (min-width: 600px) {
  .base-modal {
    align-items: center;
  }
  .base-modal__panel {
    width: min(480px, calc(100% - 2 * var(--space-5)));
    border-radius: var(--radius-lg);
  }
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

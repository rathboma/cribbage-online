<script setup lang="ts">
import { computed } from 'vue'
import { useToasts } from '@/stores/toasts'

const store = useToasts()
const infos = computed(() => store.toasts.filter((t) => t.kind === 'info'))
const errors = computed(() => store.toasts.filter((t) => t.kind === 'error'))
</script>

<template>
  <!-- Screen readers hear only the message text, from regions that are always present. -->
  <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="false">
    <p v-for="toast in infos" :key="toast.id">{{ toast.message }}</p>
  </div>
  <div class="visually-hidden" role="alert" aria-atomic="false">
    <p v-for="toast in errors" :key="toast.id">{{ toast.message }}</p>
  </div>

  <div class="toast-host on-dark">
    <div
      v-for="toast in store.toasts"
      :key="toast.id"
      class="toast-host__toast"
      :class="`toast-host__toast--${toast.kind}`"
      @mouseenter="store.hold(toast.id)"
      @mouseleave="store.release(toast.id)"
      @focusin="store.hold(toast.id)"
      @focusout="store.release(toast.id)"
    >
      <span aria-hidden="true">{{ toast.message }}</span>
      <button
        type="button"
        class="toast-host__dismiss"
        :aria-label="`Dismiss: ${toast.message}`"
        @click="store.dismiss(toast.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  top: calc(var(--space-3) + env(safe-area-inset-top));
  right: 0;
  left: 0;
  z-index: 200;
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
  pointer-events: none;
}
.toast-host__toast {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 480px;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
  border-radius: var(--radius-pill);
  background: var(--color-ink);
  color: var(--color-cream);
  box-shadow: var(--shadow-md);
  pointer-events: auto;
}
.toast-host__toast--error {
  background: var(--color-danger);
  color: var(--color-white);
}
.toast-host__dismiss {
  width: 44px;
  height: 44px;
  flex: none;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 1.25rem;
  cursor: pointer;
}
</style>

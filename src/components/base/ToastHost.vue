<script setup lang="ts">
import { useToasts } from '@/stores/toasts'

const store = useToasts()
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <div
      v-for="toast in store.toasts"
      :key="toast.id"
      class="toast-host__toast"
      :class="`toast-host__toast--${toast.kind}`"
    >
      <span>{{ toast.message }}</span>
      <button
        type="button"
        class="toast-host__dismiss"
        aria-label="Dismiss"
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
  right: 0;
  bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
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
  gap: var(--space-3);
  max-width: 480px;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
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
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 1.25rem;
  cursor: pointer;
}
</style>

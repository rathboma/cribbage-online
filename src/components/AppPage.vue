<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

/** The standard screen: a cream panel on the felt, with an optional link back. */
defineProps<{ back?: RouteLocationRaw; backLabel?: string }>()
</script>

<template>
  <main class="app-page">
    <div class="app-page__panel">
      <RouterLink v-if="back" :to="back" class="app-page__back">
        <span aria-hidden="true">←</span> {{ backLabel ?? 'Back' }}
      </RouterLink>
      <slot />
    </div>
  </main>
</template>

<style scoped>
.app-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  /* Keep clear of notches and home indicators, without making the page taller than the screen. */
  padding: max(var(--space-4), env(safe-area-inset-top))
    max(var(--space-4), env(safe-area-inset-right)) max(var(--space-4), env(safe-area-inset-bottom))
    max(var(--space-4), env(safe-area-inset-left));
}
.app-page :slotted(h1) {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-2xl);
}
.app-page :slotted(h1:focus) {
  outline: none;
}
.app-page__panel {
  width: 100%;
  max-width: 28rem;
  padding: var(--space-6) var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--color-cream);
  box-shadow: var(--shadow-lg);
}
.app-page__back {
  display: inline-flex;
  gap: var(--space-1);
  min-height: 44px;
  align-items: center;
  margin: calc(-1 * var(--space-4)) 0 var(--space-1);
  color: var(--color-ink-muted);
  font-weight: 600;
  text-decoration: none;
}
.app-page__back:hover {
  color: var(--color-ink);
  text-decoration: underline;
}
</style>

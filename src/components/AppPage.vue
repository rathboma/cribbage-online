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
  padding: var(--space-4);
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
  margin: calc(-1 * var(--space-3)) 0 var(--space-2);
  color: var(--color-ink-muted);
  font-weight: 600;
  text-decoration: none;
}
.app-page__back:hover {
  color: var(--color-ink);
  text-decoration: underline;
}
</style>

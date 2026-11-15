<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'accent' | 'neutral' }>(), { variant: 'accent' })
</script>

<template>
  <span class="base-badge" :class="`base-badge--${variant}`"><slot /></span>
</template>

<style scoped>
.base-badge {
  display: inline-block;
  padding: 0.1em 0.6em;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  vertical-align: middle;
}
.base-badge--accent {
  background: var(--color-accent);
  color: var(--color-accent-ink);
}
.base-badge--neutral {
  background: var(--color-cream-dark);
  color: var(--color-ink);
}
</style>

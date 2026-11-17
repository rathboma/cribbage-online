<script setup lang="ts">
/**
 * A face-down card. Decorative: say how many there are in text next to it. Sized like
 * PlayingCard (`--card-width`, or a default for the size).
 */
withDefaults(defineProps<{ size?: 'sm' | 'md' }>(), { size: 'md' })
</script>

<template>
  <span class="card-back" :class="`card-back--${size}`" aria-hidden="true" />
</template>

<style scoped>
.card-back {
  --w: var(--card-width, 3.25rem);
  display: inline-block;
  flex: none;
  width: var(--w);
  aspect-ratio: 5 / 7;
  border: calc(var(--w) * 0.07) solid var(--color-cream);
  border-radius: calc(var(--w) * 0.12);
  background:
    repeating-linear-gradient(45deg, transparent 0 4px, rgb(0 0 0 / 0.18) 4px 8px),
    var(--color-wood);
  box-shadow: var(--shadow-sm);
}
.card-back--sm {
  --w: var(--card-width, 2.25rem);
}
</style>

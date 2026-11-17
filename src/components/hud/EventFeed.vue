<script setup lang="ts">
import { computed } from 'vue'
import type { FeedLine } from '@/game/narrate'

/**
 * The last few things that happened in the play, newest last: who played what and why points
 * were scored. A log region, so screen readers read each new line out; for that it has to be
 * on the page before the lines arrive, so it is rendered even while empty.
 */
const props = withDefaults(defineProps<{ lines: readonly FeedLine[]; max?: number }>(), { max: 2 })
const recent = computed(() => props.lines.slice(-props.max))
</script>

<template>
  <ol class="event-feed" role="log" aria-label="What just happened" data-testid="feed">
    <li v-for="line in recent" :key="line.id" class="event-feed__line">{{ line.text }}</li>
  </ol>
</template>

<style scoped>
.event-feed {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  color: var(--color-ink-muted);
  font-size: var(--font-size-sm);
  line-height: 1.35;
  list-style: none;
}
.event-feed__line {
  overflow-wrap: anywhere;
}
.event-feed__line:last-child {
  color: var(--color-ink);
}
/* On a short screen only the latest move is shown. */
@media (max-height: 620px) {
  .event-feed__line:not(:last-child) {
    display: none;
  }
}
</style>

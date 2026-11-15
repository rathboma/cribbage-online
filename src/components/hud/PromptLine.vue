<script setup lang="ts">
import type { Prompt } from '@/game/prompt'

/** What is going on and what to do next, with the running count during the play. */
defineProps<{ prompt: Prompt; count: number | null }>()
</script>

<template>
  <div class="prompt-line">
    <p
      class="prompt-line__text"
      :class="{ 'prompt-line__text--mine': prompt.mine }"
      role="status"
      data-testid="prompt"
      :data-mine="prompt.mine"
    >
      {{ prompt.text }}
    </p>
    <p v-if="count !== null" class="prompt-line__count">
      <span class="prompt-line__count-label">Count</span>
      <strong data-testid="count">{{ count }}</strong>
    </p>
  </div>
</template>

<style scoped>
.prompt-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.prompt-line__text {
  margin: 0;
  font-size: var(--font-size-md);
}
.prompt-line__text--mine {
  font-weight: 700;
}
.prompt-line__count {
  display: grid;
  flex: none;
  justify-items: center;
  min-width: 3.25rem;
  margin: 0;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  background: var(--color-cream-dark);
  line-height: 1.1;
}
.prompt-line__count-label {
  font-size: var(--font-size-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.prompt-line__count strong {
  font-size: var(--font-size-xl);
  font-variant-numeric: tabular-nums;
}
</style>

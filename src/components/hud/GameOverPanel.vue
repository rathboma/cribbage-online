<script setup lang="ts">
import { computed } from 'vue'
import type { Pair, Seat, Skunk } from '@shared/protocol'
import BaseButton from '@/components/base/BaseButton.vue'
import type { Seats } from '@/game/seats'

/** The result: who won, the final scores and whether it was a skunk. */
const props = defineProps<{
  winner: Seat
  scores: Pair<number>
  skunk: Skunk | null
  seats: Seats
}>()

const won = computed(() => props.winner === props.seats.me)
const loser = computed<Seat>(() => (props.winner === 0 ? 1 : 0))
const loserName = computed(() => (won.value ? props.seats.names[loser.value] : 'You'))

const skunkText = computed(() => {
  if (props.skunk === 'double') return `Double skunk! ${loserName.value} didn't reach 61.`
  if (props.skunk === 'skunk') return `Skunk! ${loserName.value} didn't reach 91.`
  return null
})
</script>

<template>
  <section class="game-over" aria-labelledby="game-over-title" data-testid="game-over">
    <h2
      id="game-over-title"
      class="game-over__title"
      data-testid="winner"
      :data-winner="winner"
      :data-skunk="skunk ?? 'none'"
    >
      {{ won ? 'You won!' : `${seats.names[winner]} won` }}
    </h2>
    <dl class="game-over__scores">
      <div v-for="seat in [seats.me, seats.opponent]" :key="seat" class="game-over__score">
        <dt>{{ seat === seats.me ? 'You' : seats.names[seat] }}</dt>
        <dd :data-testid="`final-score-${seat}`">{{ scores[seat] }}</dd>
      </div>
    </dl>
    <p v-if="skunkText" class="game-over__skunk" data-testid="skunk">{{ skunkText }}</p>
    <BaseButton to="/" size="lg" block data-testid="back-home">Back to home</BaseButton>
  </section>
</template>

<style scoped>
.game-over {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-5) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-cream);
  color: var(--color-ink);
  text-align: center;
}
.game-over__title {
  margin: 0;
  font-size: var(--font-size-2xl);
  overflow-wrap: anywhere;
}
.game-over__scores {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2) var(--space-6);
  margin: 0;
}
.game-over__score {
  min-width: 0;
}
.game-over__score dt {
  overflow: hidden;
  max-width: min(9rem, 100%);
  color: var(--color-ink-muted);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.game-over__score dd {
  margin: 0;
  font-size: var(--font-size-2xl);
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  line-height: 1.1;
}
.game-over__skunk {
  margin: 0;
  font-weight: 600;
}
</style>

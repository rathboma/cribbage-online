<script setup lang="ts">
import { computed } from 'vue'
import { WINNING_SCORE } from '@shared/engine'
import type { PlayerView, Seat } from '@shared/protocol'
import type { Seats } from '@/game/seats'
import BaseBadge from '@/components/base/BaseBadge.vue'

/** Both players: name, score out of 121, who deals and who the game is waiting for. */
const props = defineProps<{ view: PlayerView; seats: Seats; toAct: readonly Seat[] }>()

const rows = computed(() =>
  [props.seats.me, props.seats.opponent].map((seat) => ({
    seat,
    name: props.seats.names[seat],
    isMe: seat === props.seats.me,
    score: props.view.scores[seat],
    dealer: props.view.dealer === seat && props.view.phase !== 'lobby',
    acting: props.toAct.includes(seat),
  })),
)
</script>

<template>
  <ul class="score-board" aria-label="Scores">
    <li
      v-for="row in rows"
      :key="row.seat"
      class="score-board__player"
      :class="{ 'score-board__player--acting': row.acting }"
      :data-testid="`player-${row.seat}`"
    >
      <span class="score-board__name">{{ row.name }}</span>
      <span v-if="row.isMe" class="score-board__you">(you)</span>
      <BaseBadge v-if="row.dealer" variant="neutral" :data-testid="`dealer-${row.seat}`">
        Dealer
      </BaseBadge>
      <BaseBadge v-if="row.acting" class="score-board__turn" :data-testid="`turn-${row.seat}`">
        <span class="score-board__turn-text">{{ row.isMe ? 'Your move' : 'Their move' }}</span>
      </BaseBadge>
      <span class="score-board__score">
        <strong :data-testid="`score-${row.seat}`">{{ row.score }}</strong>
        <span class="score-board__of"> / {{ WINNING_SCORE }}</span>
      </span>
    </li>
  </ul>
</template>

<style scoped>
.score-board {
  display: grid;
  flex: none;
  container-type: inline-size;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.score-board__player {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 2.5rem;
  padding: var(--space-1) var(--space-3);
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  background: var(--color-cream);
  color: var(--color-ink);
}
/* The amber edge repeats what the "Your move" / "Their move" badge already says in words. */
.score-board__player--acting {
  border-color: var(--color-accent);
}
.score-board__player > * {
  flex: none;
}
.score-board__player > .score-board__name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* On a narrow screen the badge becomes a small pointer in front of the name, so the name
   keeps its room; the words stay for screen readers. */
@container (max-width: 26rem) {
  .score-board__player > .score-board__turn {
    order: -1;
    width: 0;
    height: 0;
    padding: 0;
    border: 0.4rem solid transparent;
    border-right-width: 0;
    border-left: 0.6rem solid var(--color-ink);
    border-radius: 0;
    background: none;
  }
  .score-board__turn-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
.score-board__you {
  color: var(--color-ink-muted);
  font-size: var(--font-size-sm);
}
.score-board__score {
  margin-left: auto;
  white-space: nowrap;
}
.score-board__score strong {
  font-size: var(--font-size-xl);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.score-board__of {
  color: var(--color-ink-muted);
  font-size: var(--font-size-sm);
}
@media (max-height: 620px) {
  .score-board__player {
    min-height: 2.1rem;
    padding-block: 0;
  }
  .score-board__score strong {
    font-size: var(--font-size-lg);
  }
}
</style>

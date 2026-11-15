<script setup lang="ts">
import { computed } from 'vue'
import type { CardId, ShowView } from '@shared/protocol'
import PlayingCard from '@/components/cards/PlayingCard.vue'
import { cardText } from '@/game/cards'
import { Whose, type Seats } from '@/game/seats'
import { countAloud, pointsText } from '@/game/showCount'

/**
 * The show: each hand counted so far (pone's hand, dealer's hand, crib), with its cards and the
 * engine's itemised breakdown read the traditional way. A hand the game never got to count
 * (someone reached 121 first) simply isn't listed.
 */
const props = defineProps<{ show: readonly ShowView[]; starter: CardId | null; seats: Seats }>()

const hands = computed(() =>
  props.show.map((result) => ({
    key: `${result.source}-${result.seat}`,
    seat: result.seat,
    source: result.source,
    title: `${Whose(props.seats, result.seat)} ${result.source === 'crib' ? 'crib' : 'hand'}`,
    cards: result.cards,
    total: result.breakdown.total,
    lines: countAloud(result.breakdown),
  })),
)
</script>

<template>
  <section class="show-panel" aria-labelledby="show-title" data-testid="show-panel">
    <h2 id="show-title" class="show-panel__title">The show</h2>
    <article
      v-for="hand in hands"
      :key="hand.key"
      class="show-panel__hand"
      data-testid="show-hand"
      :data-seat="hand.seat"
      :data-source="hand.source"
    >
      <h3 class="show-panel__heading">
        <span>{{ hand.title }}</span>
        <span class="show-panel__total" data-testid="show-total" :data-total="hand.total">
          {{ pointsText(hand.total) }}
        </span>
      </h3>
      <ul class="show-panel__cards" :aria-label="`${hand.title}: cards`">
        <li v-for="card in hand.cards" :key="card" data-testid="show-card" :data-card="card">
          <PlayingCard :card="card" size="sm" />
        </li>
        <li v-if="starter" class="show-panel__starter" data-testid="show-starter">
          <span class="show-panel__plus" aria-hidden="true">+</span>
          <span class="visually-hidden">with the starter, </span>
          <PlayingCard :card="starter" size="sm" />
        </li>
      </ul>
      <ol v-if="hand.lines.length" class="show-panel__items">
        <li
          v-for="(line, i) in hand.lines"
          :key="i"
          class="show-panel__item"
          data-testid="show-item"
          :data-points="line.points"
        >
          <span class="show-panel__phrase">{{ line.phrase }}</span>
          <span class="show-panel__item-cards">{{ line.cards.map(cardText).join(' ') }}</span>
        </li>
      </ol>
      <p v-else class="show-panel__nothing" data-testid="show-nothing">Nothing to count.</p>
    </article>
  </section>
</template>

<style scoped>
.show-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-cream);
  color: var(--color-ink);
}
.show-panel__title {
  margin: 0;
  font-size: var(--font-size-lg);
}
.show-panel__hand {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-cream-dark);
}
.show-panel__heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
  font-size: var(--font-size-md);
}
.show-panel__heading > :first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.show-panel__total {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.show-panel__cards {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.show-panel__cards li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.show-panel__starter {
  margin-left: var(--space-1);
}
.show-panel__plus {
  color: var(--color-ink-muted);
  font-weight: 700;
}
.show-panel__items {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.show-panel__item {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}
.show-panel__item-cards {
  color: var(--color-ink-muted);
  font-size: var(--font-size-sm);
  text-align: right;
  white-space: nowrap;
}
.show-panel__nothing {
  margin: 0;
  color: var(--color-ink-muted);
}
</style>

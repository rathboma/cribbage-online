<script setup lang="ts">
import { computed } from 'vue'
import type { CardId } from '@shared/protocol'
import { cardFace } from '@/game/cards'

/**
 * A face-up card. Not interactive by itself: wrap it in a button to make it playable.
 * Screen readers get the card's name ("10 of hearts"); the glyphs are decoration.
 * Its width is `--card-width` when a parent sets one (a length), else a default for the size.
 */
const props = withDefaults(defineProps<{ card: CardId; size?: 'sm' | 'md' }>(), { size: 'md' })
const face = computed(() => cardFace(props.card))
</script>

<template>
  <span
    class="playing-card"
    :class="[`playing-card--${size}`, { 'playing-card--red': face.red }]"
    :data-card="card"
  >
    <span class="playing-card__rank" aria-hidden="true">{{ face.rank }}</span>
    <span class="playing-card__suit" aria-hidden="true">{{ face.suit }}</span>
    <span class="visually-hidden">{{ face.name }}</span>
  </span>
</template>

<style scoped>
.playing-card {
  --w: var(--card-width, 3.25rem);
  position: relative;
  display: inline-flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: var(--w);
  aspect-ratio: 5 / 7;
  border: 1px solid var(--color-cream-dark);
  border-radius: calc(var(--w) * 0.12);
  background: var(--color-white);
  color: var(--color-ink);
  box-shadow: var(--shadow-sm);
  /* The rank and suit scale with the card. */
  font-size: calc(var(--w) * 0.4);
  font-weight: 700;
  line-height: 1;
  user-select: none;
}
.playing-card--sm {
  --w: var(--card-width, 2.25rem);
}
.playing-card--red {
  color: var(--color-card-red);
}
.playing-card__rank {
  letter-spacing: -0.04em;
}
.playing-card__suit {
  margin-top: 0.08em;
  /* Suit symbols from a text font, never the colour-emoji font. */
  font-family: 'Segoe UI Symbol', 'Noto Sans Symbols 2', 'Apple Symbols', sans-serif;
  font-weight: 400;
}
</style>

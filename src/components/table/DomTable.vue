<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import type { CardId, PlayerView, Seat } from '@shared/protocol'
import CardBack from '@/components/cards/CardBack.vue'
import PlayingCard from '@/components/cards/PlayingCard.vue'
import { canUseCard, handCardState, tapCard, type HandCardState } from '@/game/handInput'
import { Whose, type Seats } from '@/game/seats'

/**
 * The simple view of the table, in plain HTML: your hand as real buttons, the opponent's hand
 * as card backs, the deck or starter, the crib, and the cards each player has laid. It is the
 * keyboard and screen-reader way to play, the fallback without WebGL and what the end-to-end
 * tests drive. It draws the view it is given and reports what the player picks; it sends
 * nothing itself.
 */
const props = defineProps<{
  view: PlayerView
  seats: Seats
  /** Cards picked for the crib (v-model:selected). */
  selected: readonly CardId[]
  /** Nothing can be picked or played right now (a move is on its way, say). */
  busy: boolean
}>()

const emit = defineEmits<{ 'update:selected': [cards: CardId[]]; play: [card: CardId] }>()

const opponentName = computed(() => props.seats.names[props.seats.opponent])
const picking = computed(() => props.view.legal.discard)

function stateOf(card: CardId): HandCardState {
  return handCardState(props.view, props.selected, props.busy, card)
}

function canUse(card: CardId): boolean {
  return canUseCard(stateOf(card), props.busy)
}

function use(card: CardId) {
  const tap = tapCard(props.view, props.selected, props.busy, card)
  if (!tap) return
  if ('play' in tap) emit('play', tap.play)
  else emit('update:selected', tap.select)
}

/** Holding Enter down must not play card after card: only the first press counts. */
function ignoreRepeat(event: KeyboardEvent) {
  if (event.repeat) event.preventDefault()
}

/** A seat's laid cards in order; `turned` marks those from an earlier count. */
function laid(seat: Seat) {
  const current = new Set(props.view.sequence.map((p) => p.card))
  return props.view.played[seat].map((card) => ({ card, turned: !current.has(card) }))
}

/** The crib: face up once it has been counted; until then only this player's own discards. */
const crib = computed(() => {
  if (props.view.crib) return { faceUp: props.view.crib, backs: 0, counted: true }
  const mine = props.view.myDiscards
  return { faceUp: mine, backs: Math.max(0, props.view.cribCount - mine.length), counted: false }
})

const cards = (n: number) => (n === 1 ? '1 card' : `${n} cards`)

// Playing or discarding a card removes its button. Keep keyboard focus in the hand (on the
// card that takes its place) instead of dropping it to the top of the page.
const hand = useTemplateRef<HTMLElement>('hand')
const handButtons = () => Array.from(hand.value?.querySelectorAll<HTMLElement>('button') ?? [])
let focusedIndex = -1
watch(
  () => props.view.myHand,
  () => {
    focusedIndex = handButtons().indexOf(document.activeElement as HTMLElement)
  },
  { flush: 'pre' },
)
watch(
  () => props.view.myHand,
  () => {
    if (focusedIndex < 0) return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    const buttons = handButtons()
    buttons[Math.min(focusedIndex, buttons.length - 1)]?.focus()
  },
  { flush: 'post' },
)
</script>

<template>
  <section class="dom-table on-dark" aria-label="The table" data-testid="dom-table">
    <div class="dom-table__inner">
      <div class="dom-table__upper">
        <div class="dom-table__zone">
          <p class="dom-table__label">
            <span class="dom-table__name">{{ opponentName }}</span>
            <span>
              ·
              <span data-testid="opponent-count" :data-count="view.opponentHandCount">
                {{ cards(view.opponentHandCount) }}
              </span>
              in hand
            </span>
          </p>
          <div class="dom-table__row">
            <span v-if="view.opponentHandCount > 0" class="dom-table__fan">
              <CardBack v-for="n in view.opponentHandCount" :key="n" size="sm" />
            </span>
            <ul
              class="dom-table__laid"
              :aria-label="`Cards ${opponentName} has played`"
              :data-testid="`played-${seats.opponent}`"
            >
              <li
                v-for="item in laid(seats.opponent)"
                :key="item.card"
                :class="{ 'dom-table__turned': item.turned }"
                data-testid="laid-card"
                :data-card="item.card"
                :data-turned="item.turned"
              >
                <PlayingCard :card="item.card" size="sm" />
                <span v-if="item.turned" class="visually-hidden"> (earlier count)</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="dom-table__zone dom-table__zone--middle">
          <div class="dom-table__pile">
            <p class="dom-table__label">{{ view.starter ? 'Starter' : 'Deck' }}</p>
            <PlayingCard v-if="view.starter" :card="view.starter" size="sm" data-testid="starter" />
            <CardBack v-else size="sm" />
          </div>
          <div
            class="dom-table__pile dom-table__pile--crib"
            data-testid="crib"
            :data-count="view.cribCount"
          >
            <p class="dom-table__label">
              <span class="dom-table__name">{{ Whose(seats, view.dealer) }}</span>
              <span> crib · {{ cards(view.cribCount) }}</span>
            </p>
            <div class="dom-table__row dom-table__row--tight">
              <span v-if="crib.faceUp.length > 0 && !crib.counted" class="visually-hidden">
                You put in:
              </span>
              <PlayingCard v-for="card in crib.faceUp" :key="card" :card="card" size="sm" />
              <CardBack v-for="n in crib.backs" :key="n" size="sm" />
              <span v-if="view.cribCount === 0" class="dom-table__empty" aria-hidden="true" />
            </div>
          </div>
        </div>

        <div class="dom-table__zone">
          <p class="dom-table__label">You played</p>
          <ul
            class="dom-table__laid"
            aria-label="Cards you have played"
            :data-testid="`played-${seats.me}`"
          >
            <li
              v-for="item in laid(seats.me)"
              :key="item.card"
              :class="{ 'dom-table__turned': item.turned }"
              data-testid="laid-card"
              :data-card="item.card"
              :data-turned="item.turned"
            >
              <PlayingCard :card="item.card" size="sm" />
              <span v-if="item.turned" class="visually-hidden"> (earlier count)</span>
            </li>
          </ul>
        </div>
      </div>

      <ul ref="hand" class="dom-table__hand" aria-label="Your hand" data-testid="hand">
        <li v-for="card in view.myHand" :key="card">
          <button
            type="button"
            class="hand-card"
            :class="`hand-card--${stateOf(card)}`"
            :aria-pressed="picking ? selected.includes(card) : undefined"
            :aria-disabled="canUse(card) ? undefined : 'true'"
            data-testid="hand-card"
            :data-card="card"
            @click="use(card)"
            @keydown.enter="ignoreRepeat"
          >
            <PlayingCard :card="card" />
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
/* A size container: the cards scale with the room the table is given, so the whole table
   fits between the scores and the prompt on a small phone. */
.dom-table {
  flex: 1;
  min-height: 0;
  color: var(--color-cream);
  container-type: size;
}
.dom-table__inner {
  --small-h: clamp(2.5rem, 15cqh, 4.25rem);
  --big-h: clamp(3.5rem, 24cqh, 6rem);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  height: 100%;
}
/* Everything but the hand. If the screen is too short for all of it, this part scrolls and
   the hand stays where it is: the player's own cards are never out of reach. */
.dom-table__upper {
  /* Positioned, so visually hidden text inside scrolls with it instead of stretching the page. */
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: space-around;
  gap: var(--space-1);
  min-height: 0;
  overflow-y: auto;
}
.dom-table__zone {
  --card-width: calc(var(--small-h) * 5 / 7);
  display: grid;
  flex: none;
  /* The column is as wide as the table, not as wide as a long name. */
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  gap: 2px;
}
.dom-table__zone--middle {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: var(--space-6);
}
.dom-table__pile {
  display: grid;
  flex: none;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  gap: 2px;
}
/* Only the crib gives way to a long name: the deck or starter beside it keeps its place. */
.dom-table__pile--crib {
  flex: 0 1 auto;
  min-width: 0;
}
.dom-table__label {
  display: flex;
  gap: 0.35em;
  justify-content: center;
  max-width: 100%;
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
/* A long name gives way; how many cards there are never does. */
.dom-table__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dom-table__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--small-h);
}
.dom-table__row--tight {
  gap: var(--space-1);
}
/* The opponent's cards overlap like a held fan: only how many matters. */
.dom-table__fan {
  display: inline-flex;
}
.dom-table__fan > * + * {
  margin-left: calc(var(--card-width) * -0.62);
}
.dom-table__laid {
  display: flex;
  gap: var(--space-1);
  min-height: var(--small-h);
  margin: 0;
  padding: 0;
  list-style: none;
}
.dom-table__laid li {
  display: flex;
}
.dom-table__turned {
  opacity: 0.5;
}
.dom-table__empty {
  width: var(--card-width);
  aspect-ratio: 5 / 7;
  border: 2px dashed var(--color-felt-light);
  border-radius: var(--radius-sm);
}
.dom-table__hand {
  --card-width: min(calc(var(--big-h) * 5 / 7), calc((100cqw - 5 * var(--space-2)) / 6));
  display: flex;
  flex: none;
  justify-content: center;
  gap: var(--space-2);
  /* Room for a picked card to rise. */
  min-height: calc(var(--big-h) + 0.9rem);
  margin: 0;
  padding: 0.9rem 0 0;
  list-style: none;
}
.hand-card {
  display: block;
  padding: 0;
  border: 0;
  border-radius: calc(var(--card-width) * 0.12);
  background: none;
  font: inherit;
  cursor: default;
  transition: transform 0.12s;
  -webkit-tap-highlight-color: transparent;
}
/* The focus ring is cream and stands off the card, so it can't be mistaken for the amber
   ring of a picked card; and it stays solid on a dimmed card, because only the card inside
   the button is dimmed. */
.hand-card:focus-visible {
  outline: 3px solid var(--color-cream);
  outline-offset: 4px;
}
.hand-card :deep(.playing-card) {
  transition: opacity 0.12s;
}
.hand-card--usable,
.hand-card--selected {
  cursor: pointer;
}
.hand-card--usable {
  transform: translateY(-0.3rem);
}
.hand-card--usable:hover {
  transform: translateY(-0.55rem);
}
.hand-card--selected {
  box-shadow: 0 0 0 3px var(--color-accent);
  transform: translateY(-0.8rem);
}
/* Not this player's move: the cards lie flat and a shade darker, still easy to read. */
.hand-card--idle :deep(.playing-card) {
  opacity: 0.8;
}
/* This player's move, but not with this card. */
.hand-card--blocked :deep(.playing-card) {
  opacity: 0.5;
}
.hand-card[aria-disabled='true'] {
  cursor: default;
}
@media (prefers-reduced-motion: reduce) {
  .hand-card {
    transition: none;
  }
}
</style>

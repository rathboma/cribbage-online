<script setup lang="ts">
import { computed } from 'vue'
import type { CardId, GameEvent, GameStatus, PlayerView } from '@shared/protocol'
import { narrate } from '@/game/narrate'
import { promptFor, seatsToAct } from '@/game/prompt'
import type { Seats } from '@/game/seats'
import ActionBar from './ActionBar.vue'
import EventFeed from './EventFeed.vue'
import GameOverPanel from './GameOverPanel.vue'
import PromptLine from './PromptLine.vue'
import ScoreBoard from './ScoreBoard.vue'
import ShowPanel from './ShowPanel.vue'

/**
 * Everything around the table: scores, the prompt, the buttons, the show and the result. It
 * knows nothing about how the table is drawn - the table goes in the default slot - so the
 * simple view and the 3D view share it unchanged. It shows exactly the view it is given.
 */
const props = defineProps<{
  view: PlayerView
  status: GameStatus
  seats: Seats
  /** The hand's game events so far, for the "what just happened" lines. */
  events: readonly GameEvent[]
  /** Cards picked for the crib on the table. */
  selected: readonly CardId[]
  /** A move is on its way to the server. */
  busy: boolean
}>()

defineEmits<{ discard: []; cut: []; go: []; ready: [] }>()

const prompt = computed(() => promptFor(props.view, props.seats, props.status))
const toAct = computed(() => seatsToAct(props.view))
const lines = computed(() => narrate(props.events, props.seats))
const count = computed(() => (props.view.phase === 'play' ? props.view.count : null))
const over = computed(() => props.view.phase === 'game_over')
const counted = computed(() => props.view.show.length > 0)
</script>

<template>
  <div class="game-hud" data-testid="game" :data-phase="view.phase" :data-hand="view.hand">
    <ScoreBoard :view="view" :seats="seats" :to-act="toAct" />

    <div class="game-hud__main">
      <div v-if="$slots.default" class="game-hud__table">
        <slot />
      </div>
      <!-- Focusable so the keyboard can scroll a long count on a small screen. -->
      <div
        v-if="over || counted"
        class="game-hud__panels"
        tabindex="0"
        role="group"
        :aria-label="over ? 'Result' : 'The show'"
      >
        <GameOverPanel
          v-if="over && view.winner !== null"
          :winner="view.winner"
          :scores="view.scores"
          :skunk="view.skunk"
          :seats="seats"
        />
        <ShowPanel v-if="counted" :show="view.show" :starter="view.starter" :seats="seats" />
      </div>
    </div>

    <div class="game-hud__tray">
      <PromptLine :prompt="prompt" :count="count" />
      <!-- Once the hand is being counted the show panel does the explaining. -->
      <EventFeed v-if="lines.length > 0 && view.phase !== 'show' && !over" :lines="lines" />
      <ActionBar
        :legal="view.legal"
        :selected-count="selected.length"
        :busy="busy"
        @discard="$emit('discard')"
        @cut="$emit('cut')"
        @go="$emit('go')"
        @ready="$emit('ready')"
      />
    </div>
  </div>
</template>

<style scoped>
/* Fills the screen it is given: the scores stay at the top, the prompt and buttons at the
   bottom, and whatever is in between (the table, a long count) shrinks or scrolls. */
.game-hud {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}
.game-hud__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}
.game-hud__table {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-height: 0;
}
/* The show and the result scroll inside their own space when they are long. */
.game-hud__panels {
  display: grid;
  flex: 0 1 auto;
  gap: var(--space-2);
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--radius-lg);
}
.game-hud__tray {
  display: grid;
  flex: none;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-cream);
  color: var(--color-ink);
  box-shadow: var(--shadow-md);
}
/* Short screens (a small phone with the browser's bars showing): give the table the room. */
@media (max-height: 620px) {
  .game-hud__tray {
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
  }
}
</style>

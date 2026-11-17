<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
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
  /** A move is on its way to the server (the button that sent it shows it is working). */
  sending: boolean
}>()

defineEmits<{ discard: []; cut: []; go: []; ready: [] }>()

const prompt = computed(() => promptFor(props.view, props.seats, props.status))
const toAct = computed(() => seatsToAct(props.view))
const lines = computed(() => narrate(props.events, props.seats))
const count = computed(() => (props.view.phase === 'play' ? props.view.count : null))
const over = computed(() => props.view.phase === 'game_over')
const counted = computed(() => props.view.show.length > 0)
// During the play the last two moves; once the panels have the screen, only the move that
// ended the play (or won the game), which the panels don't show.
const feedLines = computed(() => (props.view.phase === 'show' || over.value ? 1 : 2))

// On a small phone the three counted hands don't fit: the crib is below the fold. Say so
// while there is more to see, with a button that scrolls on.
const panels = useTemplateRef<HTMLElement>('panels')
const moreBelow = ref(false)
function measure() {
  const el = panels.value
  moreBelow.value = !!el && el.scrollHeight - el.scrollTop - el.clientHeight > 8
}
function scrollOn() {
  const el = panels.value
  if (!el) return
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollBy({ top: el.clientHeight * 0.8, behavior: calm ? 'auto' : 'smooth' })
}
watch(() => [panels.value, props.view] as const, measure, { flush: 'post' })
onMounted(() => window.addEventListener('resize', measure))
onBeforeUnmount(() => window.removeEventListener('resize', measure))

// Send to crib, Cut, Go and Next hand disappear once pressed. Keyboard focus would fall back
// to the top of the page; put it on the prompt instead, which says what happens next and
// sits just before the next button to appear.
const tray = useTemplateRef<HTMLElement>('tray')
const promptLine = useTemplateRef<InstanceType<typeof PromptLine>>('promptLine')
let focusWasOnButton = false
watch(
  () => props.view,
  () => {
    const active = document.activeElement
    focusWasOnButton = active instanceof HTMLButtonElement && !!tray.value?.contains(active)
  },
  { flush: 'pre' },
)
watch(
  () => props.view,
  () => {
    if (!focusWasOnButton) return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    promptLine.value?.focus()
  },
  { flush: 'post' },
)
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
        ref="panels"
        class="game-hud__panels"
        tabindex="0"
        role="group"
        :aria-label="over ? 'Result' : 'The show'"
        @scroll.passive="measure"
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
      <!-- Under the panels, not over them: it must never cover a button or a total. -->
      <button
        v-if="moreBelow"
        type="button"
        class="game-hud__more on-dark"
        data-testid="more-below"
        @click="scrollOn"
      >
        More below <span aria-hidden="true">↓</span>
      </button>
    </div>

    <div ref="tray" class="game-hud__tray">
      <div class="game-hud__says">
        <PromptLine ref="promptLine" :prompt="prompt" :count="count" />
        <EventFeed :lines="lines" :max="feedLines" />
      </div>
      <ActionBar
        :legal="view.legal"
        :selected-count="selected.length"
        :busy="sending"
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
  min-width: 0;
  min-height: 0;
}
.game-hud__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}
/* A table in the slot keeps close to half of the room even when the show or the result is
   long (they scroll): the 3D table stays in view while the hands are counted. Without panels
   it grows to fill everything. */
.game-hud__table {
  display: flex;
  flex: 1 0 45%;
  flex-direction: column;
  min-height: 0;
}
/* The show and the result scroll inside their own space when they are long. Positioned, so
   visually hidden text inside scrolls with them instead of stretching the page. */
.game-hud__panels {
  position: relative;
  display: grid;
  flex: 0 1 auto;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  align-content: start;
  min-height: 0;
  overflow-y: auto;
  border-radius: var(--radius-lg);
}
/* Shown while part of the panels is out of sight. */
.game-hud__more {
  flex: none;
  align-self: center;
  min-height: 2.25rem;
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-cream);
  color: var(--color-ink);
  box-shadow: var(--shadow-md);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
}
.game-hud__tray {
  display: grid;
  flex: none;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-cream);
  color: var(--color-ink);
  box-shadow: var(--shadow-md);
}
.game-hud__says {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1);
}
/* Short screens (a small phone with the browser's bars showing): give the table the room. */
@media (max-height: 620px) {
  .game-hud__tray {
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
  }
}
</style>

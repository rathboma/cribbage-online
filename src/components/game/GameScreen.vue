<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { CardId } from '@shared/protocol'
import { friendlyError } from '@/api/messages'
import GameHud from '@/components/hud/GameHud.vue'
import DomTable from '@/components/table/DomTable.vue'
import { seatsFor } from '@/game/seats'
import { useGameStore } from '@/stores/game'
import { useToasts } from '@/stores/toasts'

/**
 * A game in progress: the HUD around a table. This is the only place that connects them to
 * the store. Both are handed what is on screen (`presentedView`, `presentedStatus`), never the
 * server's latest, so they can wait for animations; every move goes out through the store's
 * actions; a move the server refuses becomes a toast. The table is the simple DOM one; the 3D
 * table takes its place in Phase 4.
 */
defineProps<{ code: string }>()

const game = useGameStore()
const toasts = useToasts()

const view = computed(() => game.presentedView)
const status = computed(() => game.presentedStatus ?? game.status)
const seats = computed(() =>
  view.value ? seatsFor(view.value.seat, game.players) : seatsFor(0, []),
)

/** Cards picked for the crib, shared by the table (which picks) and the HUD (which sends). */
const selected = ref<CardId[]>([])
const picked = computed(() => selected.value.filter((c) => view.value?.myHand.includes(c)))
watch(
  () => [view.value?.hand, view.value?.legal.discard] as const,
  ([hand, canDiscard], [previousHand]) => {
    if (hand !== previousHand || !canDiscard) selected.value = []
  },
)

async function act(move: () => Promise<void>) {
  // One move at a time, and none while the screen is still catching up with the server.
  if (game.busy) return
  try {
    await move()
  } catch (err) {
    toasts.push(friendlyError(err), { kind: 'error' })
  }
}

// When a card leaves the hand the others close up, so a second tap in the same place (or a
// second Enter: focus moves to the next card) would hit a different card. Right after the
// hand changes, a tap is far more likely a double tap than a decision, so for a moment the
// table takes none - and shows it: the cards lie flat until they can be played again.
const HAND_SETTLE_MS = 400
const settling = ref(false)
let settleTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => view.value?.myHand.length,
  (now, before) => {
    if (before === undefined || now === undefined) return
    settling.value = true
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => (settling.value = false), HAND_SETTLE_MS)
  },
)
onBeforeUnmount(() => clearTimeout(settleTimer))
/** The table takes no input: a move is out, the screen is catching up, or the hand just moved. */
const tableBusy = computed(() => game.busy || settling.value)

function play(card: CardId) {
  if (tableBusy.value) return
  void act(() => game.play(card))
}

function discard() {
  const [first, second] = picked.value
  if (first && second && picked.value.length === 2) void act(() => game.discard([first, second]))
}

// The simple table has nothing more to show once the hand is being counted or the game is
// over: the HUD's panels carry all of it, so they get the room.
const tableVisible = computed(
  () => view.value?.phase !== 'show' && view.value?.phase !== 'game_over',
)
</script>

<template>
  <main v-if="view && status" class="game-screen">
    <header class="game-screen__bar on-dark">
      <RouterLink to="/" class="game-screen__home">
        <span aria-hidden="true">←</span> Home
      </RouterLink>
      <h1 class="game-screen__title">Game {{ code }}</h1>
    </header>
    <GameHud
      :view="view"
      :status="status"
      :seats="seats"
      :events="game.handEvents"
      :selected="picked"
      :sending="game.sending"
      @discard="discard"
      @cut="act(game.cut)"
      @go="act(game.go)"
      @ready="act(game.ready)"
    >
      <template v-if="tableVisible" #default>
        <DomTable
          v-model:selected="selected"
          :view="view"
          :seats="seats"
          :busy="tableBusy"
          @play="play"
        />
      </template>
    </GameHud>
  </main>
</template>

<style scoped>
/* Exactly one screen tall, so the scores, the hand and the buttons are always in view. (On a
   very short screen, such as a phone on its side, the page scrolls instead.) */
.game-screen {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  max-width: 40rem;
  height: 100vh;
  height: 100dvh;
  min-height: 30rem;
  margin: 0 auto;
  padding: max(var(--space-2), env(safe-area-inset-top))
    max(var(--space-3), env(safe-area-inset-right)) max(var(--space-3), env(safe-area-inset-bottom))
    max(var(--space-3), env(safe-area-inset-left));
}
.game-screen__bar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  color: var(--color-cream);
}
.game-screen__home {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 2.25rem;
  padding-right: var(--space-3);
  font-weight: 600;
  text-decoration: none;
}
.game-screen__home:hover {
  text-decoration: underline;
}
.game-screen__title {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.06em;
}
.game-screen__title:focus {
  outline: none;
}
</style>

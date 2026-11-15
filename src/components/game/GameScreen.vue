<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
 * the store. Both are handed `presentedView` (never `view`), so what is on screen can wait for
 * animations; every move goes out through the store's actions; a move the server refuses
 * becomes a toast. The table is the simple DOM one; the 3D table takes its place in Phase 4.
 */
defineProps<{ code: string }>()

const game = useGameStore()
const toasts = useToasts()

const view = computed(() => game.presentedView)
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
  if (game.sending) return
  try {
    await move()
  } catch (err) {
    toasts.push(friendlyError(err), { kind: 'error' })
  }
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

// Any tap or key press means the player is here: if polling had slowed down (nothing
// happening for a while), go back to the active rate.
const onActivity = () => game.nudge()
onMounted(() => {
  window.addEventListener('pointerdown', onActivity, { passive: true })
  window.addEventListener('keydown', onActivity)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onActivity)
  window.removeEventListener('keydown', onActivity)
})
</script>

<template>
  <main v-if="view && game.status" class="game-screen">
    <header class="game-screen__bar on-dark">
      <RouterLink to="/" class="game-screen__home">
        <span aria-hidden="true">←</span> Home
      </RouterLink>
      <h1 class="game-screen__title">Game {{ code }}</h1>
    </header>
    <GameHud
      :view="view"
      :status="game.status"
      :seats="seats"
      :events="game.handEvents"
      :selected="picked"
      :busy="game.sending"
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
          :busy="game.sending"
          @play="(card) => act(() => game.play(card))"
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

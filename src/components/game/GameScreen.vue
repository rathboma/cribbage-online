<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { CardId } from '@shared/protocol'
import { friendlyError } from '@/api/messages'
import GameMenu from '@/components/game/GameMenu.vue'
import GameHud from '@/components/hud/GameHud.vue'
import DomTable from '@/components/table/DomTable.vue'
import { useTableView } from '@/composables/useTableView'
import { seatsFor } from '@/game/seats'
import { useGameStore } from '@/stores/game'
import { useToasts } from '@/stores/toasts'

/**
 * A game in progress: the HUD around a table. This is the only place that connects them to
 * the store. Both are handed what is on screen (`presentedView`, `presentedStatus`), never the
 * server's latest, so they can wait for animations; every move goes out through the store's
 * actions; a move the server refuses becomes a toast.
 *
 * The table is the 3D one where WebGL works, unless the player chose the simple one (the game
 * menu, or `?view=2d`). The simple table sits in the HUD's slot. The 3D one fills the whole
 * screen behind the HUD, so the felt runs edge to edge; the slot is left empty (the "hole") and
 * the 3D table keeps its cards, and takes its taps, there.
 */
defineProps<{ code: string }>()

const game = useGameStore()
const toasts = useToasts()
const table = useTableView()
const use3d = computed(() => table.view.value === '3d')
const hole = useTemplateRef<HTMLElement>('hole')

/** The 3D table, with three.js, downloaded only by players who will see it. */
const ThreeTable = defineAsyncComponent({
  loader: () => import('@/components/table/ThreeTable.vue').then((module) => module.default),
  onError: (error, _retry, fail) => {
    threeFailed(error)
    fail()
  },
})

function threeFailed(error: unknown) {
  if (!use3d.value) return
  console.warn('The 3D table could not start; showing the simple one.', error)
  table.markBroken()
  toasts.push("The 3D table can't run in this browser, so here is the simple one.")
}

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
  <div v-if="view && status" class="game-screen" :class="{ 'game-screen--3d': use3d }">
    <ThreeTable
      v-if="use3d"
      v-model:selected="selected"
      :view="view"
      :busy="tableBusy"
      :hole="hole"
      @play="play"
      @cut="act(game.cut)"
      @failed="threeFailed"
    />
    <main class="game-screen__main">
      <header class="game-screen__bar on-dark">
        <RouterLink to="/" class="game-screen__home">
          <span aria-hidden="true">←</span> Home
        </RouterLink>
        <h1 class="game-screen__title">Game {{ code }}</h1>
        <GameMenu v-if="table.canUse3d.value" />
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
        <template v-if="use3d" #default>
          <div ref="hole" class="game-screen__hole" data-testid="table-hole">
            <!-- The canvas can't be used with a keyboard or a screen reader; this says so, and
                 offers the table that can. Out of sight until it has focus. -->
            <button
              type="button"
              class="game-screen__simple visually-hidden-until-focus"
              data-testid="use-simple-table"
              @click="table.set('2d')"
            >
              Playing with a keyboard or screen reader? Switch to the simple table
            </button>
          </div>
        </template>
        <template v-else-if="tableVisible" #default>
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
  </div>
</template>

<style scoped>
/* The 3D table is drawn behind everything, across the whole screen (and the whole page, when
   a short screen scrolls). */
.game-screen {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
}
/* Exactly one screen tall, so the scores, the hand and the buttons are always in view. (On a
   very short screen, such as a phone on its side, the page scrolls instead.) */
.game-screen__main {
  position: relative;
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
/* Where the 3D table's cards are, between the HUD's scores and its buttons. Taps here go to the
   table; the page must not scroll, zoom or select text under a finger that is playing. */
.game-screen__hole {
  position: relative;
  flex: 1;
  min-height: 0;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
.game-screen__simple {
  position: absolute;
  top: var(--space-2);
  left: 50%;
  max-width: calc(100% - 2 * var(--space-3));
  padding: var(--space-2) var(--space-4);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--color-cream);
  color: var(--color-ink);
  box-shadow: var(--shadow-md);
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  transform: translateX(-50%);
  cursor: pointer;
}
/* Out of sight, but in the tab order: it appears when it gets focus. */
.visually-hidden-until-focus:not(:focus) {
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>

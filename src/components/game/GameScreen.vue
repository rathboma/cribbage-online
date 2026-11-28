<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
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

/** Over the felt, in the middle of the screen (the HUD floats over it). */
const LOADING_STYLE = {
  position: 'absolute',
  inset: '0',
  display: 'grid',
  placeItems: 'center',
  color: 'var(--color-cream)',
  fontSize: 'var(--font-size-sm)',
} as const

/** How long the 3D table's code may take to arrive before the simple table takes its place. */
const THREE_LOAD_TIMEOUT_MS = 20_000

/**
 * The 3D table, with three.js, downloaded only by players who will see it. A failed download is
 * tried once more; if it still fails, or takes too long, the simple table takes its place.
 */
const ThreeTable = defineAsyncComponent({
  loader: () => import('@/components/table/ThreeTable.vue').then((module) => module.default),
  onError: (_error, retry, fail, attempts) => (attempts <= 1 ? retry() : fail()),
  timeout: THREE_LOAD_TIMEOUT_MS,
  delay: 300,
  // Shown, over the felt, while it downloads (after `delay`): the HUD already says what to do.
  loadingComponent: defineComponent({
    name: 'TableLoading',
    setup: () => () =>
      h('div', { style: LOADING_STYLE, 'data-testid': 'table-loading' }, [
        h('p', { role: 'status' }, 'Setting the table…'),
      ]),
  }),
  // It never arrived (or not in time): say so and show the simple table.
  errorComponent: defineComponent({
    name: 'TableUnavailable',
    props: { error: { type: null, default: null } },
    setup(props) {
      onMounted(() => threeUnavailable('load', props.error))
      return () => null
    },
  }),
})

const UNAVAILABLE = {
  webgl: "The 3D table can't run in this browser, so here is the simple one.",
  load: "The 3D table didn't load, so here is the simple one. Reload the page to try again.",
} as const

/** The 3D table can't be shown in this visit: its code didn't load, or WebGL failed. */
function threeUnavailable(why: keyof typeof UNAVAILABLE, error: unknown) {
  if (!use3d.value) return
  console.warn('The 3D table could not start; showing the simple one.', error)
  table.markBroken()
  toasts.push(UNAVAILABLE[why])
}

const main = useTemplateRef<HTMLElement>('main')

/**
 * The way to the simple table for keyboard and screen-reader players. The button goes with the
 * 3D table, so focus goes on to the hand they can now play (or the screen's heading).
 */
async function useSimpleTable() {
  table.set('2d')
  await nextTick()
  const card = main.value?.querySelector<HTMLElement>('[data-testid="hand-card"]')
  const heading = main.value?.querySelector<HTMLElement>('h1')
  if (card) card.focus()
  else if (heading) {
    heading.setAttribute('tabindex', '-1')
    heading.focus()
  }
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
  <div v-if="view && status" class="game-screen">
    <ThreeTable
      v-if="use3d"
      v-model:selected="selected"
      :view="view"
      :busy="tableBusy"
      :hole="hole"
      @play="play"
      @cut="act(game.cut)"
      @failed="threeUnavailable('webgl', $event)"
    />
    <main ref="main" class="game-screen__main">
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
              @click="useSimpleTable"
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
   a short screen scrolls). A finger on the table is playing, so the page neither scrolls nor
   zooms under it... */
.game-screen {
  --table-touch-action: none;
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
}
/* ...unless the screen is too short for the game (see min-height below) and the page has to
   scroll to reach the buttons: then an upward or downward drag on the table scrolls it. */
@media (max-height: 30rem) {
  .game-screen {
    --table-touch-action: pan-y;
  }
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
  touch-action: var(--table-touch-action, none);
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

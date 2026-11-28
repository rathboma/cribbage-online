<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { CardId, PlayerView } from '@shared/protocol'
import GameTable from '@/components/table/GameTable.vue'
import { deckState, handCardState, tapCard } from '@/game/handInput'
import { cardLayer, type CardLayer } from '@/three/applyLayout'
import type { Viewport } from '@/three/camera'
import { computeLayout, type Layout, type LayoutMode } from '@/three/layout'
import { TableInput, type TablePointer, type TargetState } from '@/three/TableInput'
import type { TableScene, TableSceneOptions } from '@/three/TableScene'

/**
 * The 3D table in a live game. It fills its box (the whole game screen, behind the HUD) and
 * keeps the cards in `hole`, the part of the screen the HUD leaves free: they are laid out
 * there, and taps there go to the table. The layout follows the view it is given (the store's
 * `presentedView`) and the cards picked for the crib, and snaps to it whenever either changes;
 * animating the changes is the animation director's job (P4.5). `busy` only changes which cards
 * respond, so it never moves a card.
 *
 * Like the simple table it only reports what the player picks: a card to lay, the cards picked
 * for the crib, or a cut. Which cards respond comes from the view's legal moves (handInput.ts,
 * shared with the simple table); the game screen sends the moves.
 *
 * It imports three.js: load it lazily, and only when WebGL is there (see useTableView).
 */
const props = defineProps<{
  view: PlayerView
  /** Cards picked for the crib (v-model:selected). */
  selected: readonly CardId[]
  /** Nothing can be picked or played right now (a move is on its way, say). */
  busy: boolean
  /** The part of the screen the HUD leaves for the table. */
  hole: HTMLElement | null
}>()

const emit = defineEmits<{
  'update:selected': [cards: CardId[]]
  play: [card: CardId]
  cut: []
  /** The 3D table could not start (most likely no WebGL context): show the simple one. */
  failed: [error: unknown]
}>()

const root = useTemplateRef<HTMLElement>('root')
// three.js objects are held raw, outside Vue's reactivity.
const scene = shallowRef<TableScene | null>(null)
let layer: CardLayer | null = null
let input: TableInput | null = null
let layout: Layout | null = null
let mode: LayoutMode | undefined

/**
 * For the end-to-end tests and nothing else, a hidden copy of what the canvas shows: where
 * each card that takes input is drawn and how it responds (the tests tap there), every card on
 * the table and where it lies, and the size of canvas the layout is for.
 */
interface Target {
  key: string
  card: CardId | 'deck'
  state: TargetState
  x: number
  y: number
}
interface TableCard {
  key: string
  card: CardId | null
  zone: string
  faceUp: boolean
}
const targets = ref<Target[]>([])
const tableCards = ref<TableCard[]>([])
const laidOut = ref<{ mode: LayoutMode; size: string } | null>(null)

const sceneOptions: Omit<TableSceneOptions, 'createRenderer' | 'frames'> = {
  // Laid out again for the new size before the resized frame is drawn.
  onResize: (viewport) => layOut(viewport),
}

/** The canvas's size, with the HUD's share of it (above and below the hole) as insets. */
function framing(size: Viewport): Viewport {
  const box = root.value?.getBoundingClientRect()
  const hole = props.hole?.getBoundingClientRect()
  if (!box || !hole || hole.height <= 0) return { width: size.width, height: size.height }
  return {
    width: size.width,
    height: size.height,
    // The sides stay open: the felt is the same all the way across, so on a wide screen the
    // cards may spread beyond the HUD's column.
    insets: {
      top: Math.max(0, hole.top - box.top),
      bottom: Math.max(0, box.bottom - hole.bottom),
    },
  }
}

/** Lays the table out for the view, the picked cards and the canvas's size, and snaps to it. */
function layOut(size: Viewport | null = scene.value?.viewport ?? null) {
  if (!scene.value || !layer || !input || !size) return
  layout = computeLayout(props.view, framing(size), {
    selected: props.selected,
    previousMode: mode,
  })
  mode = layout.mode
  layer.apply(layout)
  laidOut.value = {
    mode: layout.mode,
    size: `${Math.round(size.width)}x${Math.round(size.height)}`,
  }
  tableCards.value = layout.cards.map((c) => ({
    key: c.key,
    card: c.face,
    zone: c.zone,
    faceUp: c.faceUp,
  }))
  updateTargets()
}

/** Tells the input which cards respond now, and publishes where they are. Moves nothing. */
function updateTargets() {
  if (!layout || !input) return
  input.setTargets(targetStates(layout))
  publishTargets()
}

/** Which cards respond, and how: this player's hand, and the deck when it is theirs to cut. */
function targetStates(next: Layout): Map<string, TargetState> {
  const states = new Map<string, TargetState>()
  for (const card of next.cards) {
    if (card.zone === 'my-hand' && card.face) {
      states.set(card.key, handCardState(props.view, props.selected, props.busy, card.face))
    } else if (card.zone === 'deck') {
      const deck = deckState(props.view, props.busy)
      if (deck) states.set(card.key, deck)
    }
  }
  return states
}

function publishTargets() {
  if (!layout || !input) return
  const list: Target[] = []
  for (const card of layout.cards) {
    const state = input.stateOf(card.key)
    const point = state && input.screenPoint(card.key)
    if (!state || !point) continue
    const id = card.zone === 'deck' ? 'deck' : card.face
    if (id) list.push({ key: card.key, card: id, state, ...point })
  }
  targets.value = list
}

function onTap(key: string) {
  const card = layout?.cards.find((c) => c.key === key)
  if (!card) return
  if (card.zone === 'deck') {
    if (deckState(props.view, props.busy) === 'usable') emit('cut')
    return
  }
  if (card.zone !== 'my-hand' || !card.face) return
  const tap = tapCard(props.view, props.selected, props.busy, card.face)
  if (!tap) return
  if ('play' in tap) emit('play', tap.play)
  else emit('update:selected', tap.select)
}

function onCursor(cursor: string) {
  for (const el of [root.value, props.hole]) if (el) el.style.cursor = cursor
}

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function onReady(instance: TableScene) {
  scene.value = instance
  layer = cardLayer(instance)
  input = new TableInput(instance, layer, { onTap, onCursor, reducedMotion })
  layOut()
}

function onDisposed() {
  input?.dispose()
  input = null
  layer = null
  layout = null
  scene.value = null
}

// A new view, or a card picked or put back, moves cards. Busy coming and going only changes
// which of them respond: snapping the table then would stop whatever is moving (P4.5).
watch(
  () => [props.view, props.selected] as const,
  () => layOut(),
)
watch(
  () => props.busy,
  () => updateTargets(),
)

// The HUD changing size (a longer prompt, the show's panels appearing) moves the hole.
let holeObserver: ResizeObserver | null = null
watch(
  () => props.hole,
  (hole) => {
    holeObserver?.disconnect()
    holeObserver = null
    if (!hole || typeof ResizeObserver === 'undefined') return
    holeObserver = new ResizeObserver(() => layOut())
    holeObserver.observe(hole)
    layOut()
  },
  { immediate: true },
)

// Input: presses and moves over the canvas, or over the hole the HUD leaves for it, in canvas
// coordinates. Elsewhere (the HUD) is not the table's. Releases count wherever they happen, so
// a press is never left hanging.
function canvas(): HTMLCanvasElement | null {
  return root.value?.querySelector('canvas') ?? null
}
function onTable(target: EventTarget | null): boolean {
  return target !== null && (target === canvas() || target === props.hole)
}
function pointer(event: PointerEvent): TablePointer | null {
  const rect = canvas()?.getBoundingClientRect()
  if (!rect) return null
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    id: event.pointerId,
    type: event.pointerType,
    button: event.button,
    primary: event.isPrimary,
  }
}
let over = false
function onPointerDown(event: PointerEvent) {
  if (!onTable(event.target)) return
  const p = pointer(event)
  if (p) input?.pointerDown(p)
}
function onPointerMove(event: PointerEvent) {
  if (onTable(event.target)) {
    over = true
    const p = pointer(event)
    if (p) input?.pointerMove(p)
  } else if (over) {
    // Onto the HUD: nothing is hovered, and a press dragged off the table is no tap.
    over = false
    input?.pointerLeave()
  }
}
function onPointerUp(event: PointerEvent) {
  const p = pointer(event)
  if (p) input?.pointerUp(p)
}
function onPointerCancel(event: PointerEvent) {
  input?.pointerCancel({ id: event.pointerId })
}
function onLeave() {
  over = false
  input?.pointerLeave()
}
// The page scrolling moves the cards out from under a mouse that hasn't moved: the card it
// lifted no longer is under it. It is picked again on the next move.
function onScroll() {
  if (over) onLeave()
}
onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('blur', onLeave)
  window.addEventListener('scroll', onScroll, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('blur', onLeave)
  window.removeEventListener('scroll', onScroll)
  document.documentElement.removeEventListener('pointerleave', onLeave)
  holeObserver?.disconnect()
  holeObserver = null
  onCursor('')
})
</script>

<template>
  <div ref="root" class="three-table" aria-hidden="true" data-testid="three-table">
    <GameTable
      :options="sceneOptions"
      @ready="onReady"
      @failed="emit('failed', $event)"
      @disposed="onDisposed"
    />
    <ul hidden data-testid="table-targets" :data-layout="laidOut?.mode" :data-size="laidOut?.size">
      <li
        v-for="t in targets"
        :key="t.key"
        data-testid="table-target"
        :data-key="t.key"
        :data-card="t.card"
        :data-state="t.state"
        :data-x="t.x.toFixed(1)"
        :data-y="t.y.toFixed(1)"
      />
    </ul>
    <ul hidden data-testid="table-cards">
      <li
        v-for="c in tableCards"
        :key="c.key"
        data-testid="table-card"
        :data-key="c.key"
        :data-card="c.card ?? undefined"
        :data-zone="c.zone"
        :data-face-up="c.faceUp"
      />
    </ul>
  </div>
</template>

<style scoped>
.three-table {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
</style>

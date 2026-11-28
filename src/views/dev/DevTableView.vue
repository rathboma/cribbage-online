<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Material, Texture } from 'three'
import { cardId, fullDeck, type CardId } from '@shared/engine/cards'
import type { Seat } from '@shared/engine/types'
import GameTable from '@/components/table/GameTable.vue'
import { Timeline } from '@/three/anim'
import { cardLayer } from '@/three/applyLayout'
import type { Viewport } from '@/three/camera'
import { computeLayout, type LayoutMode } from '@/three/layout'
import { LAYOUT_FIXTURES, fixtureView } from '@/three/layoutFixtures'
import { CARD_HEIGHT, CARD_THICKNESS, CARD_WIDTH, CardMesh } from '@/three/CardMesh'
import { webglAvailable } from '@/three/support'
import {
  PLAY_AREA,
  type DisposeReport,
  type TableScene,
  type TableSceneOptions,
} from '@/three/TableScene'

/**
 * /dev/table, development builds only: the 3D table on its own, with no game and no server.
 * By default it lays out all 52 faces and the back for review; the switcher (or `?fixture=`
 * and `?seat=` in the URL) shows instead one hand at each point of the game, laid out by the
 * layout engine from fixture views. The end-to-end scene tests drive it (frame counting,
 * resizing, remounting, losing the WebGL context, the card atlas, the layouts).
 */

const route = useRoute()
const router = useRouter()
const GALLERY_ID = 'gallery'
const fixtureId = ref(String(route.query.fixture ?? GALLERY_ID))
const seat = ref<Seat>(route.query.seat === '1' ? 1 : 0)
const fixture = computed(() => LAYOUT_FIXTURES.find((f) => f.id === fixtureId.value) ?? null)
const layoutMode = ref<LayoutMode | null>(null)
/** `?controls=0`: the table alone, filling the window (for screenshots at phone sizes). */
const bare = route.query.controls === '0'
watch([fixtureId, seat], ([id, s]) => {
  const query: Record<string, string> = id === GALLERY_ID ? {} : { fixture: id, seat: String(s) }
  if (bare) query.controls = '0'
  void router.replace({ query })
  if (scene.value) present(scene.value)
})

const frames = ref(0)
const cameraAspect = ref<number | null>(null)
const contextLost = ref(false)
const failure = ref<string | null>(null)
const shown = ref(true)
const mountKey = ref(0)
const reports = ref<DisposeReport[]>([])
const remounting = ref(false)
const scene = shallowRef<TableScene | null>(null)
const webgl = webglAvailable()
/** The card atlas: loading, then which faces (if any) kept their stand-in. */
const atlas = ref<{ loaded: boolean; missing: string[] }>({ loaded: false, missing: [] })
const gpuTextures = ref<number | null>(null)
const cardStats = ref({ cards: 0, materials: 0, textures: 0 })

const options: Omit<TableSceneOptions, 'createRenderer' | 'frames'> = {
  onFrame: (count) => {
    frames.value = count
    cameraAspect.value = scene.value?.camera.aspect ?? null
    gpuTextures.value = scene.value?.gpuMemory?.textures ?? null
  },
  onContextChange: (lost) => (contextLost.value = lost),
  // Laid out again for the new shape before the resized frame is drawn.
  onResize: (viewport) => {
    if (scene.value && fixture.value) layOutFixture(scene.value, viewport)
  },
}

/** The deck in order (clubs A–K, diamonds, hearts, spades) and then the back. */
const GALLERY: (CardId | 'back')[] = [...fullDeck().map(cardId), 'back']
const COLUMNS = 8
const ROWS = Math.ceil(GALLERY.length / COLUMNS)

/** The gallery's cards, taken straight from the pool (the fixtures go through a CardLayer). */
let galleryCards: CardMesh[] = []

/** Puts the chosen fixture, or the gallery, on the table. */
function present(instance: TableScene) {
  for (const card of galleryCards) instance.cards.release(card)
  galleryCards = []
  if (fixture.value) {
    if (instance.viewport) layOutFixture(instance, instance.viewport)
  } else {
    cardLayer(instance).clear()
    layoutMode.value = null
    instance.setFrame({ x: 0, z: 0, ...PLAY_AREA })
    layOutGallery(instance)
  }
  updateCardStats(instance)
  instance.invalidate()
}

function layOutFixture(instance: TableScene, viewport: Viewport) {
  if (!fixture.value) return
  const { view, options } = fixtureView(fixture.value, seat.value)
  const layout = computeLayout(view, viewport, {
    ...options,
    previousMode: layoutMode.value ?? undefined,
  })
  cardLayer(instance).apply(layout)
  layoutMode.value = layout.mode
  updateCardStats(instance)
}

/** Every card face up in a grid filling the play area; the last one face down with no face. */
function layOutGallery(instance: TableScene) {
  const cellWidth = PLAY_AREA.width / COLUMNS
  const cellDepth = PLAY_AREA.depth / ROWS
  const scale = 0.94 * Math.min(cellWidth / CARD_WIDTH, cellDepth / CARD_HEIGHT)
  GALLERY.forEach((slot, i) => {
    const card =
      slot === 'back'
        ? instance.cards.acquire()
        : instance.cards.acquire({ face: slot, faceUp: true })
    const column = i % COLUMNS
    const row = Math.floor(i / COLUMNS)
    card.name = `card-${slot}`
    card.userData.slot = slot
    card.scale.setScalar(scale)
    card.position.set(
      (column - (COLUMNS - 1) / 2) * cellWidth,
      (scale * CARD_THICKNESS) / 2,
      (row - (ROWS - 1) / 2) * cellDepth,
    )
    instance.table.add(card)
    galleryCards.push(card)
  })
}

/** What the cards on the table share: one atlas texture and one material, however many. */
function updateCardStats(instance: TableScene) {
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  const cards = tableCards(instance)
  for (const card of cards) {
    materials.add(card.body.material)
    const map = (card.body.material as { map?: Texture | null }).map
    if (map) textures.add(map)
  }
  cardStats.value = { cards: cards.length, materials: materials.size, textures: textures.size }
}

function tableCards(instance: TableScene): CardMesh[] {
  return instance.table.children.filter((child): child is CardMesh => child instanceof CardMesh)
}

let stopWatchingAtlas: (() => void) | null = null

function onReady(instance: TableScene) {
  scene.value = instance
  failure.value = null
  galleryCards = []
  present(instance)
  const image = instance.cards.atlas.image
  const show = () => (atlas.value = { loaded: image.complete, missing: image.missing })
  show()
  stopWatchingAtlas?.()
  stopWatchingAtlas = image.subscribe(show)
  instance.invalidate()
}

function onFailed(error: unknown) {
  failure.value = error instanceof Error ? error.message : String(error)
}

function onDisposed(report: DisposeReport) {
  stopWatchingAtlas?.()
  stopWatchingAtlas = null
  if (scene.value) scene.value = null
  frames.value = 0
  gpuTextures.value = null
  reports.value = [...reports.value, report]
}

const lastReport = computed(() => reports.value.at(-1) ?? null)
const cleanDisposals = computed(
  () =>
    reports.value.filter((r) => r.geometries === 0 && r.textures === 0 && r.contextReleased).length,
)

/**
 * Turns every face over in a wave across the grid, and back again the next time. A card turned
 * down forgets its face as it goes over, and gets it back as it comes up: as an opponent's card
 * is revealed when it is played.
 */
const animating = ref(false)
async function animate() {
  const instance = scene.value
  if (!instance) return
  animating.value = true
  const timeline = new Timeline()
  tableCards(instance).forEach((card, i) => {
    // A fixture's cards keep their faces; a hidden one (no face) stays as it is.
    const gallery = card.userData.slot !== undefined
    const slot = (gallery ? card.userData.slot : card.face) as CardId | 'back' | null
    if (slot === 'back' || slot === null) return
    const faceUp = !card.faceUp
    const wave = (i % COLUMNS) + Math.floor(i / COLUMNS)
    timeline.add(
      card.flip({ faceUp, face: gallery ? (faceUp ? slot : null) : undefined }),
      wave * 35,
    )
  })
  await instance.animator.play(timeline).finished
  animating.value = false
}

/** Mounts and unmounts the table `times` times in a row, a frame apart. */
async function remount(times: number) {
  remounting.value = true
  reports.value = []
  for (let i = 0; i < times; i++) {
    mountKey.value++
    await nextTick()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  remounting.value = false
}

// Losing the context on purpose, the way a phone's browser does under memory pressure.
let loseContext: WEBGL_lose_context | null = null
function canvasContext() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="table-canvas"]')
  return canvas?.getContext('webgl2') ?? null
}
function dropContext() {
  loseContext = canvasContext()?.getExtension('WEBGL_lose_context') ?? null
  loseContext?.loseContext()
}
function restoreContext() {
  loseContext?.restoreContext()
  loseContext = null
}
</script>

<template>
  <main class="dev-table on-dark">
    <header class="dev-table__bar" :class="{ 'visually-hidden': bare }">
      <h1 class="dev-table__title">Table (dev)</h1>
      <div class="dev-table__controls">
        <label>
          Show
          <select v-model="fixtureId" data-testid="fixture">
            <option :value="GALLERY_ID">All cards</option>
            <option v-for="f in LAYOUT_FIXTURES" :key="f.id" :value="f.id">{{ f.label }}</option>
          </select>
        </label>
        <label>
          As
          <select v-model.number="seat" data-testid="seat" :disabled="!fixture">
            <option :value="0">Seat 0 (pone)</option>
            <option :value="1">Seat 1 (dealer)</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="animate"
          :disabled="!scene || animating"
          @click="animate"
        >
          Flip cards
        </button>
        <button type="button" data-testid="toggle" @click="shown = !shown">
          {{ shown ? 'Unmount' : 'Mount' }}
        </button>
        <button
          type="button"
          data-testid="remount-20"
          :disabled="!shown || remounting"
          @click="remount(20)"
        >
          Remount ×20
        </button>
        <button type="button" data-testid="lose-context" :disabled="!scene" @click="dropContext">
          Lose context
        </button>
        <button type="button" data-testid="restore-context" @click="restoreContext">
          Restore context
        </button>
      </div>
      <dl class="dev-table__stats">
        <dt>WebGL 2</dt>
        <dd data-testid="webgl">{{ webgl ? 'yes' : 'no' }}</dd>
        <dt>Frames</dt>
        <dd data-testid="frame-count">{{ frames }}</dd>
        <dt>Camera aspect</dt>
        <dd data-testid="camera-aspect">{{ cameraAspect?.toFixed(3) ?? '–' }}</dd>
        <dt>Layout</dt>
        <dd data-testid="layout-mode">{{ layoutMode ?? '–' }}</dd>
        <dt>Card art</dt>
        <dd data-testid="atlas-state">
          {{ atlas.loaded ? 'loaded' : 'loading' }}
          <template v-if="atlas.missing.length">
            (missing: <span data-testid="atlas-missing">{{ atlas.missing.join(' ') }}</span>)
          </template>
        </dd>
        <dt>Cards</dt>
        <dd data-testid="card-stats">
          {{ cardStats.cards }} cards, {{ cardStats.materials }} material(s),
          {{ cardStats.textures }} texture(s)
        </dd>
        <dt>GPU textures</dt>
        <dd data-testid="gpu-textures">{{ gpuTextures ?? '–' }}</dd>
        <dt>Context</dt>
        <dd data-testid="context-state">{{ contextLost ? 'lost' : 'ok' }}</dd>
        <dt>Disposed</dt>
        <dd data-testid="dispose-summary">
          {{ cleanDisposals }} clean of {{ reports.length }}
          <template v-if="lastReport">
            (last: {{ lastReport.geometries }} geometries, {{ lastReport.textures }} textures,
            context {{ lastReport.contextReleased ? 'released' : 'kept' }})
          </template>
        </dd>
      </dl>
    </header>
    <p v-if="failure" role="alert" data-testid="table-failed">
      The table could not start: {{ failure }}
    </p>
    <div class="dev-table__stage" :data-remounting="remounting || undefined">
      <GameTable
        v-if="shown"
        :key="mountKey"
        :options="options"
        @ready="onReady"
        @failed="onFailed"
        @disposed="onDisposed"
      />
    </div>
    <span v-if="scene && !remounting" hidden data-testid="table-ready" />
  </main>
</template>

<style scoped>
.dev-table {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  color: var(--color-cream);
}
.dev-table__bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-sm);
}
.dev-table__title {
  margin: 0;
  font-size: var(--font-size-md);
}
.dev-table__controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
/* Flowing, not one line per stat, so the table keeps most of a short window. */
.dev-table__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-1);
  margin: 0;
}
.dev-table__stats dt::after {
  content: ':';
}
.dev-table__stats dd {
  margin: 0 var(--space-2) 0 0;
  font-variant-numeric: tabular-nums;
}
.dev-table__stage {
  flex: 1;
  min-height: 0;
}
</style>

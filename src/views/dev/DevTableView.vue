<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'
import type { Material, Texture } from 'three'
import { cardId, fullDeck, type CardId } from '@shared/engine/cards'
import GameTable from '@/components/table/GameTable.vue'
import { Timeline } from '@/three/anim'
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
 * It lays out all 52 faces and the back for review. The end-to-end scene tests drive it (frame
 * counting, resizing, remounting, losing the WebGL context, the card atlas), and later Phase 4
 * work adds fixture views of every phase of a hand here.
 */

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
}

/** The deck in order (clubs A–K, diamonds, hearts, spades) and then the back. */
const GALLERY: (CardId | 'back')[] = [...fullDeck().map(cardId), 'back']
const COLUMNS = 8
const ROWS = Math.ceil(GALLERY.length / COLUMNS)

/** Every card face up in a grid filling the play area; the last one face down with no face. */
function layOutGallery(instance: TableScene) {
  const cellWidth = PLAY_AREA.width / COLUMNS
  const cellDepth = PLAY_AREA.depth / ROWS
  const scale = 0.94 * Math.min(cellWidth / CARD_WIDTH, cellDepth / CARD_HEIGHT)
  GALLERY.forEach((slot, i) => {
    const card = slot === 'back' ? instance.cards.acquire() : instance.cards.acquire(slot, true)
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
  })
  updateCardStats(instance)
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

function onReady(instance: TableScene) {
  scene.value = instance
  failure.value = null
  atlas.value = { loaded: false, missing: [] }
  layOutGallery(instance)
  const image = instance.cards.atlas.image
  void image.loaded.then(() => {
    if (scene.value !== instance) return
    atlas.value = { loaded: true, missing: [...image.missing].sort() }
  })
  instance.invalidate()
}

function onFailed(error: unknown) {
  failure.value = error instanceof Error ? error.message : String(error)
}

function onDisposed(report: DisposeReport) {
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
    const slot = card.userData.slot as CardId | 'back'
    if (slot === 'back') return
    const faceUp = !card.faceUp
    const wave = (i % COLUMNS) + Math.floor(i / COLUMNS)
    timeline.add(card.flip({ faceUp, face: faceUp ? slot : null }), wave * 35)
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
    <header class="dev-table__bar">
      <h1 class="dev-table__title">Table (dev)</h1>
      <div class="dev-table__controls">
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
.dev-table__stats {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0 var(--space-2);
  margin: 0;
}
.dev-table__stats dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.dev-table__stage {
  flex: 1;
  min-height: 0;
}
</style>

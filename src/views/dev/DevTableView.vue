<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three'
import GameTable from '@/components/table/GameTable.vue'
import { colors } from '@/design/tokens'
import { ease, Timeline } from '@/three/anim'
import { webglAvailable } from '@/three/support'
import type { DisposeReport, TableScene, TableSceneOptions } from '@/three/TableScene'

/**
 * /dev/table, development builds only: the 3D table on its own, with no game and no server.
 * The end-to-end scene tests drive it (frame counting, resizing, remounting, losing the WebGL
 * context), and later Phase 4 work adds fixture views of every phase of a hand here.
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

const options: Omit<TableSceneOptions, 'createRenderer' | 'frames'> = {
  onFrame: (count) => {
    frames.value = count
    cameraAspect.value = scene.value?.camera.aspect ?? null
  },
  onContextChange: (lost) => (contextLost.value = lost),
}

function onReady(instance: TableScene) {
  scene.value = instance
  failure.value = null
  // A stand-in card, so there is something to cast a shadow and to animate.
  const card = new Mesh(
    new BoxGeometry(1, 0.02, 1.45),
    new MeshStandardMaterial({ color: colors.cream, roughness: 0.7 }),
  )
  card.name = 'demo-card'
  card.position.set(-2, 0.01, 2.5)
  card.castShadow = true
  card.receiveShadow = true
  instance.table.add(card)
  instance.invalidate()
}

function onFailed(error: unknown) {
  failure.value = error instanceof Error ? error.message : String(error)
}

function onDisposed(report: DisposeReport) {
  if (scene.value) scene.value = null
  frames.value = 0
  reports.value = [...reports.value, report]
}

const lastReport = computed(() => reports.value.at(-1) ?? null)
const cleanDisposals = computed(
  () =>
    reports.value.filter((r) => r.geometries === 0 && r.textures === 0 && r.contextReleased).length,
)

const animating = ref(false)
async function animate() {
  const card = scene.value?.table.getObjectByName('demo-card')
  if (!scene.value || !card) return
  animating.value = true
  const there = card.position.x < 0
  const timeline = new Timeline()
    .to(card.position, { y: 0.9 }, { duration: 250, ease: ease.outCubic })
    .to(card.rotation, { z: there ? Math.PI : 0 }, { duration: 500 }, '<')
    .to(card.position, { x: there ? 2 : -2, z: there ? -2.5 : 2.5 }, { duration: 500 }, '<')
    .to(card.position, { y: 0.01 }, { duration: 250, ease: ease.inQuad }, 250)
  await scene.value.animator.play(timeline).finished
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
          Animate
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

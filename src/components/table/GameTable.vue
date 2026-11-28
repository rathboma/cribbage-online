<script setup lang="ts">
import { markRaw, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
import { TableScene, type DisposeReport, type TableSceneOptions } from '@/three/TableScene'

/**
 * The 3D table's canvas. This component owns the <canvas>, keeps the drawing buffer the size
 * of its box, and creates and disposes the TableScene; everything three.js lives in the scene,
 * outside Vue's reactivity. It fills whatever box its parent gives it.
 *
 * It imports three.js, so load it lazily (`defineAsyncComponent(() => import(...))`) and only
 * once `webglAvailable()` says yes: players who get the simple table never download three.js.
 */
const props = defineProps<{
  /** Passed through to the scene (the dev page counts frames with onFrame). */
  options?: Omit<TableSceneOptions, 'createRenderer' | 'frames'>
}>()

const emit = defineEmits<{
  /** The scene is drawing. */
  ready: [scene: TableScene]
  /** The scene could not start, most likely because WebGL is unavailable. */
  failed: [error: unknown]
  /** The scene was torn down on unmount; the report says what was left on the GPU. */
  disposed: [report: DisposeReport]
  /** The browser took the WebGL context away (true), or gave it back (false). */
  context: [lost: boolean]
}>()

const box = useTemplateRef<HTMLDivElement>('box')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
// Held raw: making three.js objects reactive would wrap every vector in a proxy.
const scene = shallowRef<TableScene | null>(null)
let observer: ResizeObserver | null = null
let pixelRatioQuery: MediaQueryList | null = null
let size = { width: 0, height: 0 }

function resize() {
  scene.value?.resize(size.width, size.height, window.devicePixelRatio || 1)
}

// Moving the window to another screen or zooming changes the pixel ratio without changing the
// box's size, which a ResizeObserver doesn't report; a media query on the current ratio does.
function watchPixelRatio() {
  pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
  pixelRatioQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
  pixelRatioQuery?.addEventListener('change', onPixelRatioChange)
}
function onPixelRatioChange() {
  resize()
  watchPixelRatio()
}

onMounted(() => {
  if (!box.value || !canvas.value) return
  const instance = markRaw(
    new TableScene({
      ...props.options,
      onContextChange: (lost) => {
        props.options?.onContextChange?.(lost)
        emit('context', lost)
      },
    }),
  )
  try {
    instance.mount(canvas.value)
  } catch (error) {
    instance.dispose()
    emit('failed', error)
    return
  }
  scene.value = instance
  const rect = box.value.getBoundingClientRect()
  size = { width: rect.width, height: rect.height }
  resize()
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return
    size = { width: entry.contentRect.width, height: entry.contentRect.height }
    resize()
  })
  observer.observe(box.value)
  watchPixelRatio()
  emit('ready', instance)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
  pixelRatioQuery = null
  const instance = scene.value
  scene.value = null
  if (instance) emit('disposed', instance.dispose())
})
</script>

<template>
  <div ref="box" class="game-table">
    <canvas ref="canvas" class="game-table__canvas" data-testid="table-canvas" />
  </div>
</template>

<style scoped>
.game-table {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
/* Out of the flow, so the canvas's own size can never feed back into the box it measures. A
   finger on the table is playing: the page must not scroll or zoom under it (unless the page
   around it says otherwise, as the game screen does on a very short screen). */
.game-table__canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  touch-action: var(--table-touch-action, none);
}
</style>

/**
 * A TableScene for client tests, on the stand-ins in renderer.ts, with fake card art. Everything
 * else (the camera, the cards, picking) is the real thing.
 */
import { fakeAtlasSources } from './atlas'
import { fakePage, fakeRenderer, manualFrames } from './renderer'
import { AtlasImage, atlasLayout } from '@/three/cardAtlas'
import { TableScene, type TableRenderer } from '@/three/TableScene'

export { fakePage, fakeRenderer, manualFrames }

/** A mounted scene of `width` × `height` CSS pixels, with the card art loaded. */
export function testScene(width = 390, height = 760) {
  const renderer = fakeRenderer()
  const frames = manualFrames()
  const scene = new TableScene({
    createRenderer: () => renderer as unknown as TableRenderer,
    frames,
    page: fakePage().visibility,
    atlasImage: (max) => new AtlasImage(atlasLayout(max), fakeAtlasSources().sources),
  })
  scene.mount(document.createElement('canvas'))
  scene.resize(width, height, 1)
  return { scene, renderer, frames }
}

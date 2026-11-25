import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import { cardId, fullDeck, type CardId } from '@shared/engine/cards'
import { colors, fonts } from '@/design/tokens'
import { CARD_BACK_URL, CARD_HEIGHT_PER_WIDTH, cardFaceUrl } from '@/game/cardArt'
import { cardFace } from '@/game/cards'

/**
 * The card atlas: all 52 faces, the back and a blank face drawn onto one canvas, which every
 * card on the 3D table samples from a single texture. Each card picks its face with its UVs
 * (see CardMesh), so there are no per-card textures or materials.
 *
 * The canvas is drawn once per page and cached (`cardAtlasImage`); each table makes its own
 * texture from it, because a texture belongs to one WebGL context and is released with the
 * scene. Until the art has loaded every cell holds a stand-in drawn in code (rank and suit in
 * plain type), so the table is playable at once; a face whose image fails to load keeps it.
 */

/** What a cell of the atlas holds: a face, the back, or the blank face of an unknown card. */
export type AtlasSlot = CardId | 'back' | 'blank'

/** Every cell, in atlas order: clubs A–K, diamonds, hearts, spades, then the back and blank. */
export const ATLAS_SLOTS: readonly AtlasSlot[] = [...fullDeck().map(cardId), 'back', 'blank']

const COLUMNS = 9
const ROWS = 6
/** Width of a card in the atlas, in pixels, when the GPU allows it. */
export const MAX_ART_WIDTH = 256
/**
 * Plain card stock around each card, in pixels at full size. Smaller mipmap levels average
 * neighbouring pixels, and this keeps a card's edge from picking up its neighbour's colours.
 */
const GUTTER = 8
/** The art's corner radius as a fraction of the card's width (6.87 of 167.087 in the SVGs). */
export const CORNER_RADIUS_PER_WIDTH = 6.87 / 167.087

/** The colour of the card stock: the art's own white. */
const STOCK = '#ffffff'
/** The back's colours, for its stand-in (from back.svg). */
const BACK = { field: '#8c1c13', line: '#5e120c', trim: '#f2d7b6' }

export interface AtlasLayout {
  columns: number
  rows: number
  /** One card's size in pixels. */
  artWidth: number
  artHeight: number
  gutter: number
  cellWidth: number
  cellHeight: number
  /** The whole canvas, in pixels. */
  width: number
  height: number
}

function layoutFor(artWidth: number): AtlasLayout {
  const artHeight = Math.round(artWidth * CARD_HEIGHT_PER_WIDTH)
  const cellWidth = artWidth + 2 * GUTTER
  const cellHeight = artHeight + 2 * GUTTER
  return {
    columns: COLUMNS,
    rows: ROWS,
    artWidth,
    artHeight,
    gutter: GUTTER,
    cellWidth,
    cellHeight,
    width: COLUMNS * cellWidth,
    height: ROWS * cellHeight,
  }
}

/**
 * The atlas layout: cards MAX_ART_WIDTH wide (about 2450 × 2330 pixels in all), or as wide as
 * fits in `maxTextureSize` on a GPU with a smaller limit. (WebGL 2 guarantees at least 2048.)
 */
export function atlasLayout(maxTextureSize = Infinity): AtlasLayout {
  for (let artWidth = MAX_ART_WIDTH; artWidth > 16; artWidth -= 8) {
    const layout = layoutFor(artWidth)
    if (layout.width <= maxTextureSize && layout.height <= maxTextureSize) return layout
  }
  return layoutFor(16)
}

/** A card's rectangle in texture coordinates: u left to right, v bottom to top. */
export interface UvRect {
  u0: number
  v0: number
  u1: number
  v1: number
}

const slotIndex = new Map(ATLAS_SLOTS.map((slot, i) => [slot, i]))

/** Where a slot's card is drawn on the canvas, in pixels (y down). */
export function slotPixels(layout: AtlasLayout, slot: AtlasSlot) {
  const index = slotIndex.get(slot)
  if (index === undefined) throw new Error(`Not an atlas slot: ${String(slot)}`)
  const column = index % layout.columns
  const row = Math.floor(index / layout.columns)
  return {
    x: column * layout.cellWidth + layout.gutter,
    y: row * layout.cellHeight + layout.gutter,
    width: layout.artWidth,
    height: layout.artHeight,
  }
}

/**
 * The slot's card in texture coordinates. Textures from a canvas are flipped on upload
 * (`flipY`), so v = 1 is the canvas's top row.
 */
export function slotUv(layout: AtlasLayout, slot: AtlasSlot): UvRect {
  const { x, y, width, height } = slotPixels(layout, slot)
  return {
    u0: x / layout.width,
    u1: (x + width) / layout.width,
    v0: 1 - (y + height) / layout.height,
    v1: 1 - y / layout.height,
  }
}

/** The surface the atlas is drawn on: a canvas in the browser, a stand-in in unit tests. */
export interface AtlasCanvas {
  width: number
  height: number
  getContext(type: '2d'): AtlasContext | null
}

export type AtlasContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'moveTo'
  | 'arcTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'fillText'
  | 'drawImage'
  | 'translate'
  | 'rotate'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'imageSmoothingEnabled'
  | 'imageSmoothingQuality'
>

export interface AtlasSources {
  createCanvas(width: number, height: number): AtlasCanvas
  /** Loads and decodes an image; rejects if it can't. */
  loadImage(url: string): Promise<CanvasImageSource>
}

export const browserSources: AtlasSources = {
  createCanvas(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas as AtlasCanvas
  },
  async loadImage(url) {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    // decode() rejects for an image that fails to load or can't be decoded.
    await image.decode()
    return image
  },
}

/** The art for each slot that has some; the blank face is only ever drawn in code. */
function artUrl(slot: AtlasSlot): string | null {
  if (slot === 'blank') return null
  if (slot === 'back') return CARD_BACK_URL
  return cardFaceUrl(slot)
}

/**
 * The atlas canvas. Every cell holds its stand-in from the start; the card art replaces each
 * one as it arrives. `loaded` settles once every image has been drawn or has failed.
 */
export class AtlasImage {
  readonly canvas: AtlasCanvas
  /** Slots whose art could not be loaded: they keep their stand-in. */
  readonly missing: AtlasSlot[] = []
  /** Settles when every image has been drawn or has failed. Never rejects. */
  readonly loaded: Promise<void>
  private done = false

  constructor(
    readonly layout: AtlasLayout,
    sources: AtlasSources = browserSources,
  ) {
    const canvas = sources.createCanvas(layout.width, layout.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The card atlas needs a 2D canvas, which is not available')
    this.canvas = canvas
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = STOCK
    context.fillRect(0, 0, layout.width, layout.height)
    for (const slot of ATLAS_SLOTS) drawStandIn(context, slotPixels(layout, slot), slot)

    const loads = ATLAS_SLOTS.map(async (slot) => {
      const url = artUrl(slot)
      if (!url) return
      try {
        const image = await sources.loadImage(url)
        const cell = slotPixels(layout, slot)
        // The art has transparent corners: card stock goes under it, over the stand-in.
        context.fillStyle = STOCK
        context.fillRect(cell.x, cell.y, cell.width, cell.height)
        context.drawImage(image, cell.x, cell.y, cell.width, cell.height)
      } catch {
        this.missing.push(slot)
      }
    })
    this.loaded = Promise.all(loads).then(() => {
      this.done = true
    })
  }

  /** Every image has been drawn or has failed. */
  get complete(): boolean {
    return this.done
  }
}

const cache = new Map<number, AtlasImage>()

/**
 * The page's atlas canvas for a GPU with this texture size limit, drawn on first use and kept
 * for the life of the page, so a table that mounts again doesn't load the art again.
 */
export function cardAtlasImage(maxTextureSize: number): AtlasImage {
  const layout = atlasLayout(maxTextureSize)
  let image = cache.get(layout.artWidth)
  if (!image) cache.set(layout.artWidth, (image = new AtlasImage(layout)))
  return image
}

export interface CardAtlasOptions {
  /** Anisotropic filtering, for cards seen at a glancing angle (1 turns it off). */
  anisotropy?: number
  /** Called when the texture has new content to draw: the scene redraws. */
  onChange?: () => void
}

/**
 * One table's atlas texture. While the art is loading it shows the stand-ins; once every image
 * has settled it is uploaded again (once, not image by image: each upload is the whole atlas).
 */
export class CardAtlas {
  readonly texture: CanvasTexture
  private disposed = false

  constructor(
    readonly image: AtlasImage,
    options: CardAtlasOptions = {},
  ) {
    const texture = new CanvasTexture(image.canvas as HTMLCanvasElement)
    texture.name = 'card-atlas'
    texture.colorSpace = SRGBColorSpace
    texture.generateMipmaps = true
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.anisotropy = Math.max(1, options.anisotropy ?? 1)
    this.texture = texture
    if (!image.complete) {
      void image.loaded.then(() => {
        if (this.disposed) return
        texture.needsUpdate = true
        options.onChange?.()
      })
    }
  }

  get layout(): AtlasLayout {
    return this.image.layout
  }

  /** True once all the card art has been drawn (or has failed and kept its stand-in). */
  get loaded(): boolean {
    return this.image.complete
  }

  uv(slot: AtlasSlot): UvRect {
    return slotUv(this.image.layout, slot)
  }

  /** Releases the texture. The canvas stays cached for the next table. */
  dispose(): void {
    this.disposed = true
    this.texture.dispose()
  }
}

type Cell = ReturnType<typeof slotPixels>

/** A rounded rectangle path (arcTo, for browsers older than roundRect). */
function roundedRect(c: AtlasContext, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

/**
 * What a slot shows until its art arrives, and for good if it never does: for a face, its rank
 * and suit in plain type (in the corners and large in the middle); for the back, the back's
 * colours; for the blank face, card stock and an outline.
 */
function drawStandIn(c: AtlasContext, cell: Cell, slot: AtlasSlot) {
  const { x, y, width: w, height: h } = cell
  const r = w * CORNER_RADIUS_PER_WIDTH
  const line = Math.max(1, w / 160)
  c.save()
  roundedRect(c, x + line / 2, y + line / 2, w - line, h - line, r)
  c.fillStyle = STOCK
  c.fill()
  c.lineWidth = line
  c.strokeStyle = colors.inkMuted
  c.stroke()

  if (slot === 'back') {
    const inset = w * 0.06
    roundedRect(c, x + inset, y + inset, w - 2 * inset, h - 2 * inset, r)
    c.fillStyle = BACK.field
    c.fill()
    c.lineWidth = line * 1.5
    c.strokeStyle = BACK.line
    c.stroke()
    const trim = inset * 1.5
    roundedRect(c, x + trim, y + trim, w - 2 * trim, h - 2 * trim, r / 2)
    c.lineWidth = line
    c.strokeStyle = BACK.trim
    c.stroke()
  } else if (slot !== 'blank') {
    const face = cardFace(slot)
    c.fillStyle = face.red ? colors.cardRed : colors.ink
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    const corner = (size: number) => {
      c.font = `bold ${Math.round(size)}px ${fonts.body}`
      c.fillText(face.rank, 0, 0)
      c.font = `${Math.round(size * 0.9)}px ${fonts.body}`
      c.fillText(face.suit, 0, size * 0.95)
    }
    const indexSize = w * 0.15
    // Top left, then bottom right turned upside down, as on a real card.
    c.save()
    c.translate(x + w * 0.12, y + w * 0.13)
    corner(indexSize)
    c.restore()
    c.save()
    c.translate(x + w * 0.88, y + h - w * 0.13)
    c.rotate(Math.PI)
    corner(indexSize)
    c.restore()
    c.font = `bold ${Math.round(w * 0.36)}px ${fonts.body}`
    c.fillText(face.rank, x + w / 2, y + h * 0.4)
    c.font = `${Math.round(w * 0.36)}px ${fonts.body}`
    c.fillText(face.suit, x + w / 2, y + h * 0.64)
  }
  c.restore()
}

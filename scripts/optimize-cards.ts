// Parts of this script run inside Chromium (page.evaluate), so it needs the DOM types too.
/// <reference lib="dom" />
/**
 * Builds the card faces in src/assets/cards/ from Byron Knoll's public-domain SVGs.
 *
 *   yarn cards:optimize <folder>
 *
 * where <folder> is the `cards-svg` folder of https://github.com/notpeter/Vector-Playing-Cards
 * (commit 861b338). It needs Playwright's Chromium (`npx playwright install chromium`).
 *
 * What it makes, and why (the budget, from issue #53: all 53 files at most 1 MB gzipped, none
 * over 150 KB, and no visible change at 500 px wide):
 *
 * - Aces and number cards: SVG, through svgo (multipass, coordinates to 3 decimal places;
 *   editor metadata, comments and unused ids removed). 6-12 KB each, a few KB gzipped.
 * - Court cards (J, Q, K): the artwork is traced, thousands of short curves, and stays far over
 *   budget as SVG (KC is still 200 KB with every coordinate rounded to a whole number). They are
 *   drawn by Chromium at RASTER_WIDTH px wide and saved as 256-colour PNGs (dithered, quantised
 *   by libimagequant through sharp): 40-80 KB each and about 48 dB PSNR against the SVG.
 *
 * Both keep the upstream proportions (CARD_HEIGHT_PER_WIDTH in src/game/cardArt.ts). Files are
 * named by the engine's CardId (`10H.svg` becomes `TH.svg`); the jokers are left out.
 *
 * Upstream draws the corner indices as live text in Arial or Bitstream Vera Sans, so they would
 * look different on every device (and the PNGs would depend on the fonts of the machine that
 * drew them). They are turned into outlines first, in Arimo (@fontsource/arimo, SIL OFL), which
 * is metric-compatible with Arial: every face looks the same everywhere and the output is the
 * same on any machine.
 *
 * back.svg and CREDITS.md in the output folder are not touched; the other faces there are
 * replaced, once every new one has been made. `yarn cards:compare` checks the result against
 * another set.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium, type Page } from '@playwright/test'
import opentype, { type Font } from 'opentype.js'
import sharp from 'sharp'
import { optimize } from 'svgo'

export const OUTPUT_DIR = 'src/assets/cards'
export const RASTER_WIDTH = 500
/** The upstream art's size in SVG units. */
export const ART_WIDTH = 167.0869
export const ART_HEIGHT = 242.667
export const RASTER_HEIGHT = Math.round((RASTER_WIDTH * ART_HEIGHT) / ART_WIDTH)

const FACE_FILE = /^[2-9TJQKA][CDHS]\.(svg|png)$/

/** Arimo Regular, the font the corner indices are drawn in. */
function loadFont(): Font {
  const file = createRequire(import.meta.url).resolve(
    '@fontsource/arimo/files/arimo-latin-400-normal.woff',
  )
  const bytes = readFileSync(file)
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

const attribute = (attrs: string, name: string) =>
  attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const styleProperty = (attrs: string, name: string) =>
  attribute(attrs, 'style')
    ?.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1]
    ?.trim()

/**
 * Replaces each corner index - upstream's `<text><tspan>K</tspan></text>`, one character each,
 * placed by the tspan's x and y - with the same glyph as a filled path.
 */
function textToPaths(svg: string, font: Font): string {
  const out = svg.replace(
    /<text\b([^>]*)>\s*<tspan\b([^>]*)>([^<]*)<\/tspan>\s*<\/text>/g,
    (_match, text: string, span: string, chars: string) => {
      // The tspan's own value wins over the text element's, as in CSS.
      const get = (name: string) => styleProperty(span, name) ?? styleProperty(text, name)
      const x = Number(attribute(span, 'x') ?? attribute(text, 'x'))
      const y = Number(attribute(span, 'y') ?? attribute(text, 'y'))
      const size = Number.parseFloat(get('font-size') ?? '')
      if (![x, y, size].every(Number.isFinite)) throw new Error(`Can't place the text "${chars}"`)
      const d = font.getPath(chars, x, y, size).toPathData(3)
      const opacity = get('fill-opacity')
      const transform = attribute(text, 'transform')
      return (
        `<path d="${d}" fill="${get('fill') ?? '#000000'}"` +
        (opacity && opacity !== '1' ? ` fill-opacity="${opacity}"` : '') +
        (transform ? ` transform="${transform}"` : '') +
        '/>'
      )
    },
  )
  if (/<text\b/.test(out)) throw new Error('A <text> element was left that this script cannot read')
  return out
}

/** What svgo leaves alone: the corner text, and a size in px rather than pt. */
function prepare(svg: string, font: Font): string {
  return textToPaths(svg, font).replace(/(\s(?:width|height)="[\d.]+)pt"/g, '$1"')
}

function optimizeSvg(svg: string): string {
  return optimize(svg, { multipass: true, floatPrecision: 3, plugins: ['preset-default'] }).data
}

/** Draws an SVG at RASTER_WIDTH and returns a lossless PNG. */
async function rasterize(page: Page, svg: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ svg, width, height }) => {
      const image = new Image()
      image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(image, 0, 0, width, height)
      return canvas.toDataURL('image/png').split(',')[1]!
    },
    { svg, width: RASTER_WIDTH, height: RASTER_HEIGHT },
  )
  return Buffer.from(base64, 'base64')
}

/** 256 colours with dithering: visually lossless for this flat-coloured art, a third the size. */
function quantize(png: Buffer): Promise<Buffer> {
  return sharp(png)
    .png({ palette: true, colours: 256, dither: 1, effort: 10, compressionLevel: 9 })
    .toBuffer()
}

async function main() {
  const source = process.argv[2]
  if (!source || !existsSync(source)) {
    console.error('Usage: yarn cards:optimize <cards-svg folder of notpeter/Vector-Playing-Cards>')
    process.exit(1)
  }
  const upstream = readdirSync(source).filter((f) => f.endsWith('.svg') && !f.startsWith('Joker'))
  if (upstream.length !== 52)
    throw new Error(`Expected 52 faces in ${source}, found ${upstream.length}`)

  const font = loadFont()
  const browser = await chromium.launch()
  const faces = new Map<string, Buffer>()
  let before = 0
  try {
    const page = await browser.newPage()
    for (const file of upstream.sort()) {
      const id = file.replace(/^10/, 'T').replace(/\.svg$/, '')
      const original = readFileSync(join(source, file), 'utf8')
      before += Buffer.byteLength(original)
      const svg = prepare(original, font)
      const court = /^[JQK]/.test(id)
      faces.set(
        `${id}.${court ? 'png' : 'svg'}`,
        court ? await quantize(await rasterize(page, svg)) : Buffer.from(optimizeSvg(svg)),
      )
    }
  } finally {
    await browser.close()
  }

  // Only now that every face is ready: replace the old ones.
  for (const old of readdirSync(OUTPUT_DIR).filter((f) => FACE_FILE.test(f))) {
    rmSync(join(OUTPUT_DIR, old))
  }
  let raw = 0
  let gzipped = 0
  let largest = { name: '', size: 0 }
  for (const [name, out] of faces) {
    writeFileSync(join(OUTPUT_DIR, name), out)
    raw += out.length
    gzipped += gzipSync(out, { level: 9 }).length
    if (out.length > largest.size) largest = { name, size: out.length }
  }
  const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`
  console.log(
    `52 faces: ${mb(before)} -> ${mb(raw)} (${mb(gzipped)} gzipped); ` +
      `largest ${largest.name}, ${(largest.size / 1e3).toFixed(0)} KB`,
  )
}

await main()

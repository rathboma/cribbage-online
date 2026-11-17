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
 * named by the engine's CardId (`10H.svg` becomes `TH.svg`); the jokers are left out. The
 * corner indices are live text in Arial: the SVGs get a fallback stack ending in sans-serif,
 * and the PNGs carry whatever Arial-compatible font Chromium found when they were drawn
 * (Liberation Sans on Linux). back.svg and CREDITS.md in the output folder are not touched;
 * other faces there are replaced. `yarn cards:compare` checks the result against another set.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium, type Page } from '@playwright/test'
import sharp from 'sharp'
import { optimize } from 'svgo'

export const OUTPUT_DIR = 'src/assets/cards'
export const RASTER_WIDTH = 500
/** The upstream art's size in SVG units. */
export const ART_WIDTH = 167.0869
export const ART_HEIGHT = 242.667
export const RASTER_HEIGHT = Math.round((RASTER_WIDTH * ART_HEIGHT) / ART_WIDTH)

const FACE_FILE = /^[2-9TJQKA][CDHS]\.(svg|png)$/

/**
 * Upstream asks only for Arial (or Bitstream Vera Sans). Arial's metric-compatible stand-ins
 * and a generic family keep the corner "10" spaced right on devices without Arial.
 */
const FONT_STACK = "Arial,Helvetica,Arimo,'Liberation Sans',sans-serif"

/** Fixes svgo leaves alone: the font stack, and a size in px rather than pt. */
function prepare(svg: string): string {
  return svg
    .replace(/;?-inkscape-font-specification:[^;"]*/g, '')
    .replace(/font-family:(?:Arial|Bitstream Vera Sans)(?=[;"])/g, `font-family:${FONT_STACK}`)
    .replace(/(\s(?:width|height)="[\d.]+)pt"/g, '$1"')
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

  for (const old of readdirSync(OUTPUT_DIR).filter((f) => FACE_FILE.test(f))) {
    rmSync(join(OUTPUT_DIR, old))
  }

  const browser = await chromium.launch()
  const page = await browser.newPage()
  let before = 0
  let raw = 0
  let gzipped = 0
  let largest = { name: '', size: 0 }
  try {
    for (const file of upstream.sort()) {
      const id = file.replace(/^10/, 'T').replace(/\.svg$/, '')
      const original = readFileSync(join(source, file), 'utf8')
      before += Buffer.byteLength(original)
      const svg = prepare(original)
      const court = /^[JQK]/.test(id)
      const name = `${id}.${court ? 'png' : 'svg'}`
      const out = court ? await quantize(await rasterize(page, svg)) : Buffer.from(optimizeSvg(svg))
      writeFileSync(join(OUTPUT_DIR, name), out)
      raw += out.length
      gzipped += gzipSync(out, { level: 9 }).length
      if (out.length > largest.size) largest = { name, size: out.length }
    }
  } finally {
    await browser.close()
  }
  const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`
  console.log(
    `52 faces: ${mb(before)} -> ${mb(raw)} (${mb(gzipped)} gzipped); ` +
      `largest ${largest.name}, ${(largest.size / 1e3).toFixed(0)} KB`,
  )
}

await main()

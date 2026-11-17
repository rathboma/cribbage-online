// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { cardId, fullDeck } from '@shared/engine/cards'
import { CARD_BACK_URL, CARD_HEIGHT_PER_WIDTH, cardFaceUrl } from './cardArt'

const dir = fileURLToPath(new URL('../assets/cards', import.meta.url))
const images = readdirSync(dir).filter((f) => /\.(svg|png)$/.test(f))
const read = (file: string) => readFileSync(`${dir}/${file}`)

/** Width and height: from the viewBox of an SVG, from the header of a PNG. */
function size(file: string): [number, number] {
  const bytes = read(file)
  if (file.endsWith('.png')) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  const viewBox = bytes.toString('utf8').match(/viewBox="([^"]*)"/)?.[1]
  const [, , width, height] = (viewBox ?? '').split(/[\s,]+/).map(Number)
  return [width!, height!]
}

describe('card art', () => {
  it('has a different image for every card in the deck, and a back', () => {
    const urls = fullDeck().map((card) => cardFaceUrl(cardId(card)))
    expect(new Set([...urls, CARD_BACK_URL]).size).toBe(53)
  })

  it('ships exactly the 52 faces and the back', () => {
    expect(images).toHaveLength(53)
    expect(images).toContain('back.svg')
  })

  // Issue #53: the 3D table loads every face at once, on phones over mobile data too.
  it('stays within the download budget', () => {
    const sizes = images.map((file) => ({ file, raw: read(file).length }))
    for (const { file, raw } of sizes) expect(raw, file).toBeLessThanOrEqual(150_000)
    const gzipped = images.reduce((sum, file) => sum + gzipSync(read(file)).length, 0)
    expect(gzipped).toBeLessThanOrEqual(1_000_000)
  })

  it('gives every image the same proportions', () => {
    for (const file of images) {
      const [width, height] = size(file)
      expect(height / width, file).toBeCloseTo(CARD_HEIGHT_PER_WIDTH, 2)
    }
  })

  it('needs no font: the corner indices are outlines', () => {
    for (const file of images.filter((f) => f.endsWith('.svg'))) {
      expect(read(file).toString('utf8'), file).not.toMatch(/<text\b/)
    }
  })

  it('draws the court cards at 500 px wide', () => {
    const courts = images.filter((file) => file.endsWith('.png'))
    expect(courts.map((file) => file[0]).sort()).toEqual([...'JJJJKKKKQQQQ'])
    for (const file of courts) expect(size(file)[0], file).toBe(500)
  })
})

// Parts of this script run inside Chromium (page.evaluate), so it needs the DOM types too.
/// <reference lib="dom" />
/**
 * Checks that two sets of card faces look the same:
 *
 *   yarn cards:compare <before-folder> <after-folder> [<out-folder>]
 *
 * Each face (by CardId, as .svg or .png in either folder) is drawn by Chromium at 500 px wide
 * on the felt colour, and the two drawings are compared pixel by pixel. Prints the PSNR and the
 * share of pixels that moved by more than 32 (of 255) for each card, worst first. Above about
 * 40 dB a difference is not visible. With an out-folder, it also saves the worst card before
 * and after, side by side, with the difference amplified 4x below.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { colors } from '../src/design/tokens.ts'

const WIDTH = 500
const HEIGHT = Math.round((WIDTH * 242.667) / 167.0869)

/** A face's file, by CardId: "KC.png", "TH.svg", or upstream's "10H.svg" for a ten. */
const FACE = /^(?:[2-9TJQKA]|10)[CDHS]\.(svg|png)$/
const idOf = (file: string) => file.replace(/^10/, 'T').slice(0, 2)

/** The faces in a folder: CardId → file name. */
function faces(folder: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of readdirSync(folder).filter((f) => FACE.test(f))) {
    const id = idOf(file)
    if (found.has(id)) throw new Error(`${folder} has two files for ${id}`)
    found.set(id, file)
  }
  return found
}

function dataUrl(folder: string, file: string): string {
  const type = file.endsWith('.png') ? 'image/png' : 'image/svg+xml'
  return `data:${type};base64,${readFileSync(join(folder, file)).toString('base64')}`
}

interface Result {
  id: string
  psnr: number
  moved: number
}

async function main() {
  const [before, after, out] = process.argv.slice(2)
  if (!before || !after) {
    console.error('Usage: yarn cards:compare <before-folder> <after-folder> [<out-folder>]')
    process.exit(1)
  }
  const [a, b] = [faces(before), faces(after)]
  const unmatched = [...a.keys(), ...b.keys()].filter((id) => !a.has(id) || !b.has(id))
  if (unmatched.length > 0 || a.size === 0) {
    throw new Error(`The two folders don't hold the same cards: ${unmatched.join(', ') || 'none'}`)
  }
  const ids = [...a.keys()].sort()
  const browser = await chromium.launch()
  const page = await browser.newPage()
  // tsx names inner functions with a __name helper that the page doesn't have.
  await page.evaluate('globalThis.__name = (f) => f')
  const results: Result[] = []
  try {
    for (const id of ids) {
      const x = dataUrl(before, a.get(id)!)
      const y = dataUrl(after, b.get(id)!)
      const result = await page.evaluate(
        async ({ a, b, width, height, felt }) => {
          const draw = async (src: string) => {
            const image = new Image()
            image.src = src
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const g = canvas.getContext('2d')!
            g.fillStyle = felt
            g.fillRect(0, 0, width, height)
            g.drawImage(image, 0, 0, width, height)
            return g.getImageData(0, 0, width, height).data
          }
          const [x, y] = [await draw(a), await draw(b)]
          let squared = 0
          let moved = 0
          for (let i = 0; i < x.length; i += 4) {
            let most = 0
            for (let k = 0; k < 3; k++) {
              const d = x[i + k]! - y[i + k]!
              squared += d * d
              most = Math.max(most, Math.abs(d))
            }
            if (most > 32) moved++
          }
          const mse = squared / (width * height * 3)
          return {
            psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse),
            moved: (moved / (width * height)) * 100,
          }
        },
        { a: x, b: y, width: WIDTH, height: HEIGHT, felt: colors.felt },
      )
      results.push({ id, ...result })
    }

    results.sort((p, q) => p.psnr - q.psnr)
    for (const r of results) {
      const psnr = Number.isFinite(r.psnr) ? `${r.psnr.toFixed(1)} dB` : 'identical'
      console.log(`${r.id}  ${psnr.padStart(9)}  ${r.moved.toFixed(3)}% of pixels moved by >32`)
    }
    const worst = results[0]
    if (out && worst) {
      mkdirSync(out, { recursive: true })
      const png = await sideBySide(
        page,
        dataUrl(before, a.get(worst.id)!),
        dataUrl(after, b.get(worst.id)!),
      )
      const file = join(out, `${worst.id}-before-after.png`)
      writeFileSync(file, png)
      console.log(`Worst card, before | after, difference x4 below: ${file}`)
    }
  } finally {
    await browser.close()
  }
}

async function sideBySide(
  page: import('@playwright/test').Page,
  a: string,
  b: string,
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ a, b, width, height, felt }) => {
      const load = async (src: string) => {
        const image = new Image()
        image.src = src
        await image.decode()
        return image
      }
      const [x, y] = [await load(a), await load(b)]
      const canvas = document.createElement('canvas')
      canvas.width = width * 2
      canvas.height = height * 2
      const g = canvas.getContext('2d')!
      g.fillStyle = felt
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.drawImage(x, 0, 0, width, height)
      g.drawImage(y, width, 0, width, height)
      // The difference, amplified, under each.
      const read = (left: number) => g.getImageData(left, 0, width, height)
      const [p, q] = [read(0), read(width)]
      const diff = g.createImageData(width, height)
      for (let i = 0; i < p.data.length; i += 4) {
        for (let k = 0; k < 3; k++) {
          diff.data[i + k] = Math.min(255, Math.abs(p.data[i + k]! - q.data[i + k]!) * 4)
        }
        diff.data[i + 3] = 255
      }
      g.putImageData(diff, 0, height)
      g.putImageData(diff, width, height)
      return canvas.toDataURL('image/png').split(',')[1]!
    },
    { a, b, width: WIDTH, height: HEIGHT, felt: colors.felt },
  )
  return Buffer.from(base64, 'base64')
}

await main()

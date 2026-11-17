import type { CardId } from '@shared/engine/cards'

/**
 * URLs of the card images in `src/assets/cards/` (faces by Byron Knoll, public domain; see
 * `CREDITS.md` there), built from the upstream SVGs by `yarn cards:optimize`: aces and number
 * cards are SVG, court cards are 500 px wide PNG. Every image shares the same proportions,
 * height = width × CARD_HEIGHT_PER_WIDTH.
 *
 * Vite puts a hash of each file's contents in its URL (`/assets/KC-<hash>.png`), so the files
 * are cached for good (`public/_headers`) and changed art always arrives under a new URL. Only
 * the code that imports this module pulls the images into the build.
 */

export const CARD_HEIGHT_PER_WIDTH = 242.667 / 167.0869

// `no-inline`: small SVGs would otherwise be inlined as data: URLs, outside the cache rules.
const files = import.meta.glob<string>('../assets/cards/*.{svg,png}', {
  query: '?no-inline',
  import: 'default',
  eager: true,
})

/** File name without its extension ("KC", "back") → URL. */
const urls = new Map(
  Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.\w+$/g, ''), url]),
)

function urlOf(name: string): string {
  const url = urls.get(name)
  if (!url) throw new Error(`No card image named ${name} in src/assets/cards`)
  return url
}

export function cardFaceUrl(id: CardId): string {
  return urlOf(id)
}

export const CARD_BACK_URL = urlOf('back')

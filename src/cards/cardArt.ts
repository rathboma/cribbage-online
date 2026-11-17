import type { CardId } from '@shared/engine/cards'

/**
 * URLs of the card images in `public/cards/` (faces by Byron Knoll, public domain; see
 * `public/cards/CREDITS.md`). Each face file is named by its `CardId`, e.g. `TD.svg`.
 * Every image shares the same proportions, height = width × CARD_HEIGHT_PER_WIDTH.
 */

export const CARD_HEIGHT_PER_WIDTH = 242.667 / 167.0869

export function cardFaceUrl(id: CardId): string {
  return `${import.meta.env.BASE_URL}cards/${id}.svg`
}

export const CARD_BACK_URL = `${import.meta.env.BASE_URL}cards/back.svg`

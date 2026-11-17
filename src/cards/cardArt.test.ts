// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cardId, fullDeck } from '@shared/engine/cards'
import { CARD_BACK_URL, cardFaceUrl } from './cardArt'

const publicDir = fileURLToPath(new URL('../../public', import.meta.url))
const fileFor = (url: string) => `${publicDir}${url}`

describe('card art', () => {
  it('has a face image for every card in the deck', () => {
    for (const card of fullDeck()) {
      const url = cardFaceUrl(cardId(card))
      expect(existsSync(fileFor(url)), url).toBe(true)
    }
  })

  it('has a card back', () => {
    expect(existsSync(fileFor(CARD_BACK_URL))).toBe(true)
  })

  it('ships exactly the 52 faces and the back', () => {
    const svgs = readdirSync(`${publicDir}/cards`).filter((f) => f.endsWith('.svg'))
    expect(svgs).toHaveLength(53)
  })

  it('gives every image the same proportions', () => {
    const svgs = readdirSync(`${publicDir}/cards`).filter((f) => f.endsWith('.svg'))
    for (const f of svgs) {
      const svg = readFileSync(`${publicDir}/cards/${f}`, 'utf8')
      expect(svg.match(/viewBox="([^"]*)"/)?.[1], f).toBe('0 0 167.0869 242.667')
    }
  })
})

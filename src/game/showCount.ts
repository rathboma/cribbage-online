/**
 * Reads a counted hand aloud the traditional way: "fifteen two, fifteen four, pair is six".
 * The items, their order and their points come straight from the engine's breakdown; this only
 * adds the running total and the words. See cribbage_rules.md section 6.
 */
import type { CardId, ScoreBreakdown, ScoreItem } from '@shared/protocol'

export interface CountLine {
  /** "Fifteen two", "Pair is six", "Run of three is nine" ... */
  phrase: string
  /** The cards this item uses. */
  cards: CardId[]
  points: number
  /** The total after this item. */
  running: number
}

const SMALL = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty']

/** Numbers as words, for the scores a hand can reach (and a little beyond). */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 60) return String(n)
  if (n < 20) return SMALL[n] as string
  const ones = n % 10
  const tens = TENS[Math.floor(n / 10)] as string
  return ones === 0 ? tens : `${tens}-${SMALL[ones] as string}`
}

function phraseFor(item: ScoreItem, running: number): string {
  const total = numberWord(running)
  switch (item.kind) {
    case 'fifteen':
      return `Fifteen ${total}`
    case 'pair':
      return `Pair is ${total}`
    case 'run':
      return `Run of ${numberWord(item.cards.length)} is ${total}`
    case 'flush':
      return `Flush of ${numberWord(item.cards.length)} is ${total}`
    case 'nobs':
      return `His nobs is ${total}`
  }
}

export function countAloud(breakdown: ScoreBreakdown): CountLine[] {
  let running = 0
  return breakdown.items.map((item) => {
    running += item.points
    return { phrase: phraseFor(item, running), cards: item.cards, points: item.points, running }
  })
}

/** "6 points", "1 point", "No points". */
export function pointsText(points: number): string {
  if (points === 0) return 'No points'
  return points === 1 ? '1 point' : `${points} points`
}

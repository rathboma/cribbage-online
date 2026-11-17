/**
 * Turns the hand's game events into short sentences: who played what, and why points were
 * scored. This is how the simple view (and a screen reader) explains the pegging.
 * The show has its own panel and the end of the game its own, so those events add no lines.
 */
import type { GameEvent, PegItem, Seat } from '@shared/protocol'
import { cardText } from './cards'
import { who, type Seats } from './seats'

/** One move and everything it led to: "Sam played 8♣ — count 15. Fifteen for 2." */
export interface FeedLine {
  /** Stable while the hand lasts: the index of the event that started the line. */
  id: number
  text: string
}

/** What a score was for, as players say it. */
function reason(item: PegItem): string {
  switch (item.kind) {
    case 'fifteen':
      return 'fifteen'
    case 'thirtyone':
      return 'thirty-one'
    case 'pair':
      if (item.cards.length === 3) return 'three of a kind'
      if (item.cards.length === 4) return 'four of a kind'
      return 'a pair'
    case 'run':
      return `a run of ${item.cards.length}`
    case 'go':
      return 'the go'
    case 'last_card':
      return 'last card'
    case 'heels':
      return 'his heels'
  }
}

/** "Fifteen for 2, a pair for 2": points made by the card just played. */
function madeByCard(items: readonly PegItem[]): string {
  const text = items.map((item) => `${reason(item)} for ${item.points}`).join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "2 for his heels": points that came without a card of the scorer's own. */
function scored(items: readonly PegItem[]): string {
  return items.map((item) => `${item.points} for ${reason(item)}`).join(' and ')
}

export function narrate(events: readonly GameEvent[], seats: Seats): FeedLine[] {
  const lines: FeedLine[] = []
  /** Whose card the last line describes, while later points may still belong to that card. */
  let cardBy: Seat | null = null

  events.forEach((event, id) => {
    const start = (text: string) => lines.push({ id, text })
    /** Adds to the line of the move this event belongs to (or starts one, if there is none). */
    const append = (text: string) => {
      const last = lines.at(-1)
      if (last) last.text += ` ${text}`
      else start(text)
    }
    const name = (seat: Seat) => seats.names[seat]

    switch (event.type) {
      case 'cut_for_deal': {
        const mine = cardText(event.cards[seats.me])
        const theirs = cardText(event.cards[seats.opponent])
        const first = event.dealer === seats.me ? 'You deal' : `${name(event.dealer)} deals`
        start(
          `Cut for first deal: you drew ${mine}, ${name(seats.opponent)} drew ${theirs}. ` +
            `${first} first.`,
        )
        break
      }
      case 'hand_dealt':
        // The first deal is announced by the cut for deal just before it.
        if (event.hand > 1) {
          start(
            event.dealer === seats.me
              ? `Hand ${event.hand}: you deal.`
              : `Hand ${event.hand}: ${name(event.dealer)} deals.`,
          )
        }
        break
      case 'starter_cut':
        start(`The starter is ${cardText(event.card)}.`)
        break
      case 'card_played':
        start(`${who(seats, event.seat)} played ${cardText(event.card)} — count ${event.count}.`)
        cardBy = event.seat
        return
      case 'go':
        start(`${who(seats, event.seat)} said Go.`)
        break
      case 'points':
        // Points always belong to the move before them: the card just played, the go just
        // said, or the starter just cut (his heels).
        append(
          cardBy === event.seat
            ? `${madeByCard(event.items)}.`
            : `${who(seats, event.seat)} scored ${scored(event.items)}.`,
        )
        return
      case 'count_reset':
        append(
          event.leader === seats.me
            ? 'New count — you lead.'
            : `New count — ${name(event.leader)} leads.`,
        )
        break
      default:
        // discarded, show_scored, hand_complete, game_over: shown elsewhere on the screen.
        break
    }
    cardBy = null
  })
  return lines
}

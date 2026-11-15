/**
 * The one line that tells a player what is going on and what to do next. Every stage of a hand
 * must be understandable from this line alone, so it is derived from nothing but the view.
 */
import type { GameStatus, PlayerView, Seat } from '@shared/protocol'
import type { Seats } from './seats'

export interface Prompt {
  text: string
  /** True when the game is waiting for this player. */
  mine: boolean
}

/** The seats the game is waiting for right now (both, while both are still discarding). */
export function seatsToAct(view: PlayerView): Seat[] {
  const both: Seat[] = [0, 1]
  switch (view.phase) {
    case 'discard':
      return both.filter((seat) => !view.hasDiscarded[seat])
    case 'cut':
      return [view.dealer === 0 ? 1 : 0]
    case 'play':
      return [view.turn]
    case 'show':
      return both.filter((seat) => !view.ready[seat])
    default:
      return []
  }
}

export function promptFor(view: PlayerView, seats: Seats, status: GameStatus): Prompt {
  const opponent = seats.names[seats.opponent]
  const wait = (text: string): Prompt => ({ text, mine: false })
  const act = (text: string): Prompt => ({ text, mine: true })

  if (view.phase === 'game_over') {
    return wait(view.winner === seats.me ? 'You won the game!' : `${opponent} won the game.`)
  }
  // Only a game ended without a result. A finished game always has a winner; if the view on
  // screen is not there yet (an animation still playing), it gets its ordinary prompt.
  if (status === 'abandoned') return wait('This game has ended.')

  switch (view.phase) {
    case 'lobby':
      return wait('Waiting for your opponent…')

    case 'discard':
      if (!view.legal.discard) return wait(`Waiting for ${opponent} to discard`)
      return act(
        view.dealer === seats.me
          ? 'Choose 2 cards for your crib'
          : `Choose 2 cards for ${opponent}'s crib`,
      )

    case 'cut':
      return view.legal.cut ? act('Cut the deck') : wait(`Waiting for ${opponent} to cut the deck`)

    case 'play':
      if (view.legal.playable.length > 0) {
        if (view.saidGo[seats.opponent]) {
          return act(`${opponent} said Go — keep playing. Count is ${view.count}`)
        }
        if (view.opponentHandCount === 0) {
          return act(`${opponent} is out of cards — your turn. Count is ${view.count}`)
        }
        return act(`Your turn — count is ${view.count}`)
      }
      if (view.legal.go) return act("You can't play — say Go")
      if (view.saidGo[seats.me]) return wait(`You said Go — ${opponent} plays on`)
      if (view.myHand.length === 0) return wait(`You're out of cards — ${opponent} plays on`)
      return wait(`${opponent} is thinking…`)

    case 'show':
      if (!view.legal.ready) return wait(`Waiting for ${opponent} to be ready`)
      return act(
        view.ready[seats.opponent]
          ? `${opponent} is ready — press Next hand`
          : "Hand counted — press Next hand when you're ready",
      )
  }
}

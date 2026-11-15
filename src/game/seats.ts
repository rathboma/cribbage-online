/** Who is who at the table, from this player's side: "You" and the opponent's name. */
import type { Pair, PlayerInfo, Seat } from '@shared/protocol'

export interface Seats {
  /** The seat this browser plays. */
  me: Seat
  opponent: Seat
  /** Display names by seat. */
  names: Pair<string>
}

export function seatsFor(me: Seat, players: readonly PlayerInfo[]): Seats {
  const name = (seat: Seat) => players.find((p) => p.seat === seat)?.name
  const opponent: Seat = me === 0 ? 1 : 0
  const names: Pair<string> = ['', '']
  names[me] = name(me) ?? 'You'
  names[opponent] = name(opponent) ?? 'Your opponent'
  return { me, opponent, names }
}

/** "You" or the opponent's name. */
export function who(seats: Seats, seat: Seat): string {
  return seat === seats.me ? 'You' : seats.names[seat]
}

/** "your" or "Sam's". */
export function whose(seats: Seats, seat: Seat): string {
  return seat === seats.me ? 'your' : `${seats.names[seat]}'s`
}

/** "Your" or "Sam's", for the start of a sentence or a heading. */
export function Whose(seats: Seats, seat: Seat): string {
  return seat === seats.me ? 'Your' : `${seats.names[seat]}'s`
}

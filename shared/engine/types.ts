/** A seat at the table. Seat 0 created the game; seat 1 joined it. */
export type Seat = 0 | 1

export const SEATS: readonly Seat[] = [0, 1]

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0
}

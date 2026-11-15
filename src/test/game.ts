/**
 * Game states for client tests, made by the real rules engine so views and events are always
 * what the server would send.
 */
import {
  applyAction,
  createGame,
  playerView,
  seededRng,
  simulateGame,
  type Action,
  type CardId,
  type GameEvent,
  type GameState,
  type Pair,
  type PlayerView,
  type Seat,
} from '@shared/engine'
import type { PlayerInfo } from '@shared/protocol'
import { seatsFor, type Seats } from '@/game/seats'

export const PLAYERS: PlayerInfo[] = [
  { seat: 0, name: 'Ada', connected: true, chatOn: true, videoOn: false },
  { seat: 1, name: 'Sam', connected: true, chatOn: true, videoOn: false },
]

/** The table as seat `me` sees it: Ada is seat 0, Sam seat 1. */
export function seats(me: Seat): Seats {
  return seatsFor(me, PLAYERS)
}

/**
 * The first state of a seeded random game for which `when` holds. `scores` starts the game
 * near the end, to reach a win quickly.
 */
export function stateWhen(
  when: (state: GameState) => boolean,
  options: { seed?: string; scores?: Pair<number> } = {},
): GameState {
  let found: GameState | null = null
  simulateGame(options.seed ?? 'client-tests', {
    scores: options.scores,
    onStep: ({ after }) => {
      if (!found && when(after)) found = after
    },
  })
  if (!found) throw new Error('No state in this game matches')
  return found
}

export function viewWhen(
  seat: Seat,
  when: (state: GameState) => boolean,
  options: { seed?: string; scores?: Pair<number> } = {},
): PlayerView {
  return playerView(stateWhen(when, options), seat)
}

/**
 * The play from the worked example in cribbage_rules.md section 5, about to start: seat 0 is
 * the pone (7♠ 8♦ K♥ 3♣), seat 1 the dealer (8♣ 9♥ Q♦ 2♠), the starter is 5♥ and the crib
 * holds 4♦ 6♠ J♥ A♣.
 */
export function workedExample(): GameState {
  const pone: CardId[] = ['3C', '7S', '8D', 'KH']
  const dealer: CardId[] = ['2S', '8C', '9H', 'QD']
  return {
    ...createGame(),
    phase: 'play',
    hand: 1,
    dealer: 1,
    hands: [[...pone], [...dealer]],
    kept: [[...pone], [...dealer]],
    discards: [
      ['4D', '6S'],
      ['AC', 'JH'],
    ],
    starter: '5H',
    play: { count: 0, turn: 0, sequence: [], played: [[], []], goSaid: null },
  }
}

/** The moves of that worked example, in order. */
export const WORKED_EXAMPLE_MOVES: { seat: Seat; action: Action }[] = [
  { seat: 0, action: { type: 'play', card: '7S' } },
  { seat: 1, action: { type: 'play', card: '8C' } },
  { seat: 0, action: { type: 'play', card: '8D' } },
  { seat: 1, action: { type: 'play', card: '2S' } },
  { seat: 0, action: { type: 'play', card: '3C' } },
  { seat: 1, action: { type: 'go' } },
  { seat: 1, action: { type: 'play', card: '9H' } },
  { seat: 0, action: { type: 'play', card: 'KH' } },
  { seat: 1, action: { type: 'play', card: 'QD' } },
]

/** Applies moves to a state; throws if the engine refuses one. */
export function playMoves(
  state: GameState,
  moves: readonly { seat: Seat; action: Action }[],
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = []
  for (const { seat, action } of moves) {
    const result = applyAction(state, seat, action, seededRng('client-tests'))
    if ('error' in result) throw new Error(`${JSON.stringify(action)} -> ${result.error}`)
    state = result.state
    events.push(...result.events)
  }
  return { state, events }
}

export { playerView }

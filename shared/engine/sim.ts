/**
 * A random-play bot and a whole-game simulator. Used by the engine's property tests, and
 * reusable by the API integration test (P2.4) and the end-to-end tests (P3.6).
 */
import type { CardId } from './cards'
import { applyAction, createGame } from './game'
import { seededRng, type Rng } from './rng'
import type { Action, GameEvent, GameState, Pair } from './state'
import { SEATS, type Seat } from './types'
import { playerView, type PlayerView } from './view'

/** An action a client can send (everything but the server's `start`). */
export type BotAction = Exclude<Action, { type: 'start' }>

/**
 * Picks a random legal action using only the player's view: the same information a real
 * client has. Returns null when this seat has nothing to do right now.
 */
export function randomBot(view: PlayerView, rng: Rng): BotAction | null {
  const { legal } = view
  const options: BotAction[] = []
  if (legal.discard && view.myHand.length >= 2) {
    const first = rng.nextInt(view.myHand.length)
    let second = rng.nextInt(view.myHand.length - 1)
    if (second >= first) second++
    options.push({
      type: 'discard',
      cards: [view.myHand[first] as CardId, view.myHand[second] as CardId],
    })
  }
  if (legal.cut) options.push({ type: 'cut' })
  for (const card of legal.playable) options.push({ type: 'play', card })
  if (legal.go) options.push({ type: 'go' })
  if (legal.ready) options.push({ type: 'ready' })
  return options.length ? (options[rng.nextInt(options.length)] as BotAction) : null
}

/**
 * Picks the next move from both players' views: each seat that has something to do proposes a
 * random legal action, and one of them is chosen at random (both may be able to act, e.g. while
 * discarding). Null when neither seat can act.
 */
export function chooseMove(
  views: Pair<PlayerView>,
  rng: Rng,
): { seat: Seat; action: BotAction } | null {
  const moves: { seat: Seat; action: BotAction }[] = []
  for (const seat of SEATS) {
    const action = randomBot(views[seat], rng)
    if (action) moves.push({ seat, action })
  }
  return moves.length ? (moves[rng.nextInt(moves.length)] as (typeof moves)[number]) : null
}

export interface SimStep {
  before: GameState
  after: GameState
  seat: Seat
  action: Action
  events: GameEvent[]
}

export interface SimResult {
  finalState: GameState
  /** Every event of the game, in order. */
  events: GameEvent[]
  /** Every action applied, starting with the server's `start`. */
  actionsTaken: { seat: Seat; action: Action }[]
}

/** Stops a broken engine from looping forever; real games take a few hundred actions. */
export const MAX_SIM_ACTIONS = 5000

/**
 * Plays a whole game between two random bots through `applyAction`. The same seed always
 * plays the same game. `onStep` sees every transition (for invariant checks). Throws if the
 * engine rejects a bot's legal action, deadlocks, or runs past MAX_SIM_ACTIONS.
 */
export function simulateGame(
  seed: number | string,
  options: {
    onStep?: (step: SimStep) => void
    /** Start from these scores instead of 0-0, e.g. to make every kind of win likely. */
    scores?: Pair<number>
  } = {},
): SimResult {
  const rng = seededRng(seed)
  const events: GameEvent[] = []
  const actionsTaken: SimResult['actionsTaken'] = []

  const apply = (state: GameState, seat: Seat, action: Action): GameState => {
    const result = applyAction(state, seat, action, rng)
    if ('error' in result) {
      throw new Error(`seed ${seed}: seat ${seat} ${JSON.stringify(action)} -> ${result.error}`)
    }
    options.onStep?.({ before: state, after: result.state, seat, action, events: result.events })
    events.push(...result.events)
    actionsTaken.push({ seat, action })
    return result.state
  }

  const initial = createGame()
  if (options.scores) {
    initial.scores = [...options.scores]
    initial.previousScores = [...options.scores]
  }
  let state = apply(initial, 0, { type: 'start' })
  while (state.phase !== 'game_over') {
    if (actionsTaken.length > MAX_SIM_ACTIONS) {
      throw new Error(`seed ${seed}: no result after ${MAX_SIM_ACTIONS} actions`)
    }
    const move = chooseMove([playerView(state, 0), playerView(state, 1)], rng)
    if (!move) throw new Error(`seed ${seed}: deadlock in phase ${state.phase}`)
    state = apply(state, move.seat, move.action)
  }
  return { finalState: state, events, actionsTaken }
}

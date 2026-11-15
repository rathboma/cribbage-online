import { describe, expect, it } from 'vitest'
import { cardIds, fullDeck, type CardId } from './cards'
import { applyAction, createGame } from './game'
import { seededRng } from './rng'
import { MAX_SIM_ACTIONS, randomBot, simulateGame, type SimStep } from './sim'
import { WINNING_SCORE, type GameEvent, type GameState, type Pair } from './state'
import { otherSeat, SEATS, type Seat } from './types'
import { playerView } from './view'

const GAMES = 1000

/** Every CardId that appears anywhere in the JSON of a value. */
function cardsIn(value: unknown): string[] {
  return (JSON.stringify(value).match(/"[A2-9TJQK][CDHS]"/g) ?? []).map((s) => s.slice(1, -1))
}

/** Cards `seat` must not see: the opponent's hand, the deck, the opponent's crib cards. */
function hiddenFrom(state: GameState, seat: Seat): Set<string> {
  const cribShown = state.show.some((r) => r.source === 'crib')
  return new Set([
    ...state.hands[otherSeat(seat)],
    ...state.deck,
    ...(cribShown ? [] : state.discards[otherSeat(seat)]),
  ])
}

/** Checks one transition; returns a description of each broken invariant. */
function checkStep({ before, after, events }: SimStep): string[] {
  const problems: string[] = []

  // Card conservation: deck + hands + crib + played + starter are the 52 cards, once each.
  if (after.phase !== 'lobby') {
    const cards = [
      ...after.deck,
      ...after.hands.flat(),
      ...after.discards.flat(),
      ...after.play.played.flat(),
      ...(after.starter ? [after.starter] : []),
    ]
    if (cards.length !== 52 || new Set(cards).size !== 52) {
      problems.push(`card conservation: ${cards.length} cards, ${new Set(cards).size} distinct`)
    }
  }

  // Scores never decrease, and every change is one event whose items add up to it.
  const running = [...before.scores]
  for (const e of events) {
    if (e.type !== 'points' && e.type !== 'show_scored') continue
    const sum = e.items.reduce((t, i) => t + i.points, 0)
    if (e.from !== running[e.seat])
      problems.push(`${e.type} from ${e.from}, score was ${running[e.seat]}`)
    if (e.to - e.from !== Math.min(sum, WINNING_SCORE - e.from)) {
      problems.push(`${e.type} moves ${e.from}->${e.to} but its items add up to ${sum}`)
    }
    if (e.type === 'show_scored' && e.total !== sum) problems.push('show total is not its items')
    running[e.seat] = e.to
  }
  // The rear peg sits where the front peg was before the seat's last (non-zero) award.
  for (const seat of SEATS) {
    const awards = events.filter(
      (e) => (e.type === 'points' || e.type === 'show_scored') && e.seat === seat && e.to > e.from,
    ) as { from: number }[]
    const rear = awards.length ? awards.at(-1)!.from : before.previousScores[seat]
    if (after.previousScores[seat] !== rear) {
      problems.push(`seat ${seat} rear peg on ${after.previousScores[seat]}, expected ${rear}`)
    }
  }
  for (const seat of SEATS) {
    if (after.scores[seat] < before.scores[seat]) problems.push(`seat ${seat} score went down`)
    if (after.scores[seat] !== running[seat]) {
      problems.push(`seat ${seat} score ${after.scores[seat]} not explained by events`)
    }
  }

  // No event shows a card still hidden from either player. (The cut for first deal happens
  // before the deck is reshuffled for the deal, so its cards say nothing about any hand.)
  const hiddenFromSomeone = new Set([...hiddenFrom(after, 0), ...hiddenFrom(after, 1)])
  for (const e of events) {
    if (e.type === 'cut_for_deal') continue
    const leaked = cardsIn(e).filter((c) => hiddenFromSomeone.has(c))
    if (leaked.length) problems.push(`${e.type} event shows hidden ${leaked.join(' ')}`)
  }

  // Neither player's view shows a card hidden from them.
  for (const seat of SEATS) {
    const hidden = hiddenFrom(after, seat)
    const leaked = cardsIn(playerView(after, seat)).filter((c) => hidden.has(c))
    if (leaked.length) problems.push(`seat ${seat} view shows hidden ${leaked.join(' ')}`)
  }

  // No deadlock: until the game ends, someone always has a legal action.
  if (after.phase !== 'game_over') {
    const canAct = SEATS.some((seat) => randomBot(playerView(after, seat), seededRng(0)) !== null)
    if (!canAct) problems.push(`deadlock in phase ${after.phase}`)
  }
  return problems
}

/** At most one explicit go per count, over the whole game's events. */
function goesPerCount(events: GameEvent[]): number {
  let max = 0
  let current = 0
  for (const e of events) {
    if (e.type === 'count_reset' || e.type === 'hand_dealt') current = 0
    if (e.type === 'go') max = Math.max(max, ++current)
  }
  return max
}

function checkGame(seed: number, scores?: Pair<number>): string[] {
  const problems: string[] = []
  let result
  try {
    result = simulateGame(seed, {
      scores,
      onStep: (step) => {
        for (const p of checkStep(step)) problems.push(`hand ${step.after.hand}: ${p}`)
      },
    })
  } catch (err) {
    return [String(err)]
  }
  const { finalState: s, events } = result
  if (s.phase !== 'game_over') problems.push(`ended in ${s.phase}`)
  const winner = s.winner
  if (winner === null) problems.push('no winner')
  else {
    if (s.scores[winner] !== WINNING_SCORE) problems.push(`winner on ${s.scores[winner]}`)
    if (s.scores[otherSeat(winner)] >= WINNING_SCORE) problems.push('loser reached 121 too')
  }
  const gameOvers = events.filter((e) => e.type === 'game_over')
  if (gameOvers.length !== 1 || events.at(-1)?.type !== 'game_over') {
    problems.push('game_over is not the single last event')
  }
  if (goesPerCount(events) > 1) problems.push('a count needed more than one go')
  // Hands are numbered 1, 2, 3, ... and the deal alternates every hand.
  const deals = events.filter((e) => e.type === 'hand_dealt')
  deals.forEach((e, i) => {
    if (e.hand !== i + 1) problems.push(`hand ${i + 1} numbered ${e.hand}`)
    if (i > 0 && e.dealer === deals[i - 1]!.dealer) problems.push(`hand ${e.hand}: same dealer`)
  })
  return problems
}

describe(`${GAMES} seeded bot-vs-bot games`, () => {
  it('all end at 121 with every invariant holding at every step', () => {
    const failures: string[] = []
    for (let seed = 0; seed < GAMES && failures.length < 10; seed++) {
      // Replay a failure with simulateGame(seed).
      for (const problem of checkGame(seed)) failures.push(`seed ${seed}: ${problem}`)
    }
    expect(failures).toEqual([])
  }, 120_000)

  it('hold when games start from high scores, so wins come at every stage', () => {
    const failures: string[] = []
    const winsBy = new Map<string, number>()
    const rng = seededRng('high scores')
    for (let seed = 0; seed < GAMES / 2 && failures.length < 10; seed++) {
      const scores: Pair<number> = [100 + rng.nextInt(21), 100 + rng.nextInt(21)]
      for (const problem of checkGame(seed, scores)) {
        failures.push(`seed ${seed} from ${scores.join('-')}: ${problem}`)
      }
      const { events } = simulateGame(seed, { scores })
      const winning = events.at(-2)!
      const how =
        winning.type === 'show_scored'
          ? `show ${winning.source}`
          : winning.type === 'points'
            ? winning.items.map((i) => i.kind).join('+')
            : winning.type
      winsBy.set(how, (winsBy.get(how) ?? 0) + 1)
    }
    expect(failures).toEqual([])
    // Wins happened in the play, on the go and last-card points, on heels and in the show.
    const kinds = [...winsBy.keys()].join(' ')
    for (const kind of ['show hand', 'show crib', 'go', 'last_card', 'heels', 'fifteen']) {
      expect(kinds, `no win by ${kind}: ${kinds}`).toContain(kind)
    }
  }, 120_000)
})

describe('simulateGame', () => {
  it('replays the same game for the same seed', () => {
    expect(simulateGame(42)).toEqual(simulateGame(42))
    expect(simulateGame(42).actionsTaken).not.toEqual(simulateGame(43).actionsTaken)
  })

  it('starts with the server’s start action and ends the game', () => {
    const { actionsTaken, finalState } = simulateGame('shape')
    expect(actionsTaken[0]).toEqual({ seat: 0, action: { type: 'start' } })
    expect(actionsTaken.length).toBeLessThan(MAX_SIM_ACTIONS)
    expect(finalState.phase).toBe('game_over')
  })
})

describe('randomBot', () => {
  it('only chooses actions the engine accepts, from the view alone', () => {
    const rng = seededRng('bot')
    let state = (applyAction(createGame(), 0, { type: 'start' }, rng) as { state: GameState }).state
    for (let i = 0; i < 300 && state.phase !== 'game_over'; i++) {
      for (const seat of SEATS) {
        const action = randomBot(playerView(state, seat), rng)
        if (!action) continue
        const result = applyAction(state, seat, action, rng)
        expect(result).not.toHaveProperty('error')
        if (!('error' in result)) state = result.state
        break
      }
    }
  })

  it('discards two different cards from its own hand', () => {
    const rng = seededRng('discard')
    const dealt = (applyAction(createGame(), 0, { type: 'start' }, rng) as { state: GameState })
      .state
    for (let i = 0; i < 200; i++) {
      const view = playerView(dealt, 0)
      const action = randomBot(view, rng)
      expect(action?.type).toBe('discard')
      if (action?.type !== 'discard') continue
      expect(new Set(action.cards).size).toBe(2)
      expect(action.cards.every((c) => view.myHand.includes(c))).toBe(true)
    }
  })

  it('returns null when the seat has nothing to do', () => {
    const rng = seededRng('idle')
    const dealt = (applyAction(createGame(), 0, { type: 'start' }, rng) as { state: GameState })
      .state
    const waiting: GameState = { ...dealt, phase: 'cut' }
    expect(randomBot(playerView(waiting, waiting.dealer), rng)).toBeNull()
    expect(randomBot(playerView(createGame(), 0), rng)).toBeNull()
  })

  it('never sees the deck or the opponent’s cards', () => {
    const rng = seededRng('blind')
    const dealt = (applyAction(createGame(), 0, { type: 'start' }, rng) as { state: GameState })
      .state
    const view = playerView(dealt, 0)
    const all = new Set<CardId>(cardIds(fullDeck()))
    const visible = cardsIn(view)
    expect(visible.every((c) => all.has(c as CardId))).toBe(true)
    expect(visible.some((c) => dealt.hands[1].includes(c as CardId))).toBe(false)
  })
})

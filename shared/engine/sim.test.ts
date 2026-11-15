import { describe, expect, it } from 'vitest'
import { cardIds, cardValue, fullDeck, isCardId, parseCard, sortCards, type CardId } from './cards'
import { applyAction, createGame, skunkLevel } from './game'
import { cardIdsInText, hiddenCardsFor } from './leaks'
import { legalPlays } from './pegging'
import { seededRng } from './rng'
import { MAX_SIM_ACTIONS, randomBot, simulateGame, type SimResult, type SimStep } from './sim'
import { WINNING_SCORE, type GameEvent, type GameState, type Pair } from './state'
import { otherSeat, SEATS, type Seat } from './types'
import { playerView } from './view'

const GAMES = 1000
/** Problems reported per failing seed, so one broken invariant doesn't flood the output. */
const MAX_PROBLEMS_PER_SEED = 5

const sorted = (ids: readonly CardId[]) => cardIds(sortCards(ids.map(parseCard)))

/** Checks one transition; returns a description of each broken invariant. */
function checkStep({ before, after, seat, action, events }: SimStep): string[] {
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
    if (cards.length !== 52 || new Set(cards).size !== 52 || !cards.every(isCardId)) {
      problems.push(`card conservation: ${cards.length} cards, ${new Set(cards).size} distinct`)
    }
  }
  // During the play and the show, each kept hand is what's still held plus what was played,
  // and the count is the sum of the current sequence.
  if (after.phase === 'play' || after.phase === 'show') {
    for (const s of SEATS) {
      const held = sorted([...after.hands[s], ...after.play.played[s]])
      if (JSON.stringify(held) !== JSON.stringify(sorted(after.kept[s]))) {
        problems.push(
          `seat ${s} holds and played ${held.join(' ')}, kept ${after.kept[s].join(' ')}`,
        )
      }
    }
    const sum = after.play.sequence.reduce((t, p) => t + cardValue(parseCard(p.card)), 0)
    if (sum !== after.play.count)
      problems.push(`count ${after.play.count}, sequence adds to ${sum}`)
  }

  // A go comes only from the seat on turn, holding cards, none of them playable.
  if (action.type === 'go') {
    const hand = before.hands[seat].map(parseCard)
    if (
      before.play.turn !== seat ||
      hand.length === 0 ||
      legalPlays(hand, before.play.count).length
    ) {
      problems.push(`seat ${seat} said go while able to play or not on turn`)
    }
  }

  // Scores never decrease, and every change is one event whose items add up to it.
  const running = [...before.scores]
  for (const e of events) {
    if (e.type !== 'points' && e.type !== 'show_scored') continue
    const sum = e.items.reduce((t, i) => t + i.points, 0)
    if (e.from !== running[e.seat]) {
      problems.push(`${e.type} from ${e.from}, score was ${running[e.seat]}`)
    }
    if (e.to - e.from !== Math.min(sum, WINNING_SCORE - e.from)) {
      problems.push(`${e.type} moves ${e.from}->${e.to} but its items add up to ${sum}`)
    }
    if (e.type === 'show_scored' && e.total !== sum) problems.push('show total is not its items')
    running[e.seat] = e.to
  }
  for (const s of SEATS) {
    if (after.scores[s] < before.scores[s]) problems.push(`seat ${s} score went down`)
    if (after.scores[s] !== running[s]) {
      problems.push(`seat ${s} score ${after.scores[s]} not explained by events`)
    }
    // The rear peg sits where the front peg was before the seat's last (non-zero) award.
    const awards = events.filter(
      (e) => (e.type === 'points' || e.type === 'show_scored') && e.seat === s && e.to > e.from,
    ) as { from: number }[]
    const rear = awards.length ? awards.at(-1)!.from : before.previousScores[s]
    if (after.previousScores[s] !== rear) {
      problems.push(`seat ${s} rear peg on ${after.previousScores[s]}, expected ${rear}`)
    }
  }

  // The game ends the instant someone reaches 121: that award is followed only by game_over.
  if ((after.phase === 'game_over') !== Math.max(...after.scores) >= WINNING_SCORE) {
    problems.push(`phase ${after.phase} with scores ${after.scores.join('-')}`)
  }
  const winning = events.findIndex(
    (e) => (e.type === 'points' || e.type === 'show_scored') && e.to >= WINNING_SCORE,
  )
  if (
    winning >= 0 &&
    JSON.stringify(events.slice(winning + 1).map((e) => e.type)) !== '["game_over"]'
  ) {
    problems.push(`events after the winning award: ${events.slice(winning + 1).map((e) => e.type)}`)
  }

  // No event shows a card still hidden from either player. The cut for first deal is the one
  // exception, as its cards are shuffled back before the deal: it must show exactly the cut.
  const hiddenFromSomeone = new Set([...hiddenCardsFor(after, 0), ...hiddenCardsFor(after, 1)])
  for (const e of events) {
    if (e.type === 'cut_for_deal') {
      if (JSON.stringify(e.cards) !== JSON.stringify(after.firstCut)) {
        problems.push(`cut_for_deal shows ${e.cards.join(' ')}, the cut was ${after.firstCut}`)
      }
      continue
    }
    const shown = cardIdsInText(JSON.stringify(e))
    const leaked = shown.filter((c) => c === 'rank/suit' || hiddenFromSomeone.has(c as CardId))
    if (leaked.length) problems.push(`${e.type} event shows hidden ${leaked.join(' ')}`)
  }

  // Neither player's view shows a card hidden from them.
  for (const s of SEATS) {
    const hidden = hiddenCardsFor(after, s)
    const shown = cardIdsInText(JSON.stringify(playerView(after, s)))
    const leaked = shown.filter((c) => c === 'rank/suit' || hidden.has(c as CardId))
    if (leaked.length) problems.push(`seat ${s} view shows hidden ${leaked.join(' ')}`)
  }
  // (Deadlocks need no check here: simulateGame throws when neither seat can act.)
  return problems
}

/** Rules that span several actions, checked over the whole event log. */
function checkEventLog(events: GameEvent[]): string[] {
  const problems: string[] = []
  let dealer: Seat = 0
  let hand = 0
  let lastPlayer: Seat | null = null
  let endAwards = 0
  let goes = 0
  let played: Pair<number> = [0, 0]
  let shows: string[] = []
  for (const e of events) {
    switch (e.type) {
      case 'hand_dealt':
        // Hands are numbered 1, 2, 3, ... and the deal alternates every hand.
        if (e.hand !== hand + 1) problems.push(`hand ${hand + 1} numbered ${e.hand}`)
        if (hand > 0 && e.dealer === dealer) problems.push(`hand ${e.hand}: same dealer again`)
        hand = e.hand
        dealer = e.dealer
        played = [0, 0]
        shows = []
        lastPlayer = null
        endAwards = 0
        goes = 0
        break
      case 'card_played':
        lastPlayer = e.seat
        played[e.seat]++
        break
      case 'go':
        // Only the first player to be stuck says go.
        if (++goes > 1) problems.push(`hand ${hand}: two goes in one count`)
        break
      case 'points':
        for (const item of e.items) {
          if (item.kind === 'heels' && e.seat !== dealer) problems.push(`heels to the pone`)
          if (item.kind === 'go' || item.kind === 'last_card' || item.kind === 'thirtyone') {
            // Exactly one end-of-count award, to whoever laid the count's last card.
            endAwards++
            if (e.seat !== lastPlayer) problems.push(`hand ${hand}: ${item.kind} to the wrong seat`)
          }
        }
        break
      case 'count_reset': {
        if (endAwards !== 1) problems.push(`hand ${hand}: count ended with ${endAwards} awards`)
        // The player who did not lay the last card leads, if they still have cards.
        const other = otherSeat(lastPlayer as Seat)
        const expected = played[other] < 4 ? other : lastPlayer
        if (e.leader !== expected) problems.push(`hand ${hand}: seat ${e.leader} led after reset`)
        endAwards = 0
        goes = 0
        break
      }
      case 'show_scored': {
        if (shows.length === 0 && endAwards !== 1) {
          problems.push(`hand ${hand}: last count ended with ${endAwards} awards`)
        }
        shows.push(`${e.seat}:${e.source}`)
        // Counted pone, dealer, then the crib (for the dealer).
        const order = [`${otherSeat(dealer)}:hand`, `${dealer}:hand`, `${dealer}:crib`]
        if (shows.at(-1) !== order[shows.length - 1]) problems.push(`hand ${hand}: shown ${shows}`)
        break
      }
    }
  }
  return problems
}

/** Plays one seeded game with every check on; returns its problems (and the game, if it ended). */
function checkGame(
  seed: number,
  scores?: Pair<number>,
): { problems: string[]; result?: SimResult } {
  const problems: string[] = []
  let actions = 0
  const report = (p: string) => {
    if (problems.length < MAX_PROBLEMS_PER_SEED) problems.push(p)
  }
  let result: SimResult
  try {
    result = simulateGame(seed, {
      scores,
      onStep: (step) => {
        actions++
        for (const p of checkStep(step)) report(`action ${actions}, hand ${step.after.hand}: ${p}`)
      },
    })
  } catch (err) {
    return { problems: [...problems, String(err)] }
  }
  const { finalState: s, events } = result
  if (s.phase !== 'game_over') report(`ended in ${s.phase}`)
  const winner = s.winner
  if (winner === null) report('no winner')
  else {
    if (s.scores[winner] !== WINNING_SCORE) report(`winner on ${s.scores[winner]}`)
    if (s.scores[otherSeat(winner)] >= WINNING_SCORE) report('loser reached 121 too')
    if (s.skunk !== skunkLevel(s.scores[otherSeat(winner)])) report(`skunk ${s.skunk}`)
  }
  const last = events.at(-1)
  if (events.filter((e) => e.type === 'game_over').length !== 1 || last?.type !== 'game_over') {
    report('game_over is not the single last event')
  } else if (
    last.winner !== s.winner ||
    last.skunk !== s.skunk ||
    JSON.stringify(last.scores) !== JSON.stringify(s.scores)
  ) {
    report('game_over event does not match the final state')
  }
  for (const p of checkEventLog(events)) report(p)
  return { problems, result }
}

describe(`${GAMES} seeded bot-vs-bot games`, () => {
  // To replay a failure: simulateGame(seed) plays the same game again.
  it('all end at 121 with every invariant holding at every step', () => {
    const failures: string[] = []
    for (let seed = 0; seed < GAMES && failures.length < 10; seed++) {
      for (const problem of checkGame(seed).problems) failures.push(`seed ${seed}: ${problem}`)
    }
    expect(failures).toEqual([])
  }, 120_000)

  it('hold when games start from high scores, so wins come at every stage', () => {
    const failures: string[] = []
    const winsBy = new Set<string>()
    const rng = seededRng('high scores')
    for (let seed = 0; seed < GAMES / 2 && failures.length < 10; seed++) {
      const scores: Pair<number> = [100 + rng.nextInt(21), 100 + rng.nextInt(21)]
      const { problems, result } = checkGame(seed, scores)
      for (const p of problems) failures.push(`seed ${seed} from ${scores.join('-')}: ${p}`)
      const winning = result?.events.at(-2)
      if (winning?.type === 'show_scored') winsBy.add(`show ${winning.source}`)
      if (winning?.type === 'points') for (const i of winning.items) winsBy.add(i.kind)
    }
    expect(failures).toEqual([])
    // Wins happened in the show, on go and last-card points, on heels and on a fifteen.
    for (const kind of ['show hand', 'show crib', 'go', 'last_card', 'heels', 'fifteen']) {
      expect([...winsBy], `no win by ${kind}`).toContain(kind)
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
    const visible = cardIdsInText(JSON.stringify(view))
    expect(visible.every((c) => all.has(c as CardId))).toBe(true)
    expect(visible.some((c) => dealt.hands[1].includes(c as CardId))).toBe(false)
  })
})

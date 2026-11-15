import { describe, expect, it } from 'vitest'
import { cardIds, fullDeck, isCardId, parseCard, type CardId } from './cards'
import { applyAction, createGame, skunkLevel } from './game'
import { seededRng, type Rng } from './rng'
import type { Action, EngineErrorCode, GameEvent, GameState, Pair } from './state'
import { otherSeat, type Seat } from './types'

// --- Helpers --------------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

const ids = (cards: string) => cards.split(' ').filter(Boolean) as CardId[]

/** An Rng that always answers 0: the cut takes the top card of the deck. */
const topCard: Rng = { nextInt: () => 0 }

/**
 * Applies an action that must succeed. The input state is deep-frozen first, so any mutation
 * of it throws, and every event batch is checked for shape and for hidden cards.
 */
function act(state: GameState, seat: Seat, action: Action, rng: Rng = topCard) {
  const result = applyAction(deepFreeze(state), seat, action, rng)
  if ('error' in result) throw new Error(`seat ${seat} ${JSON.stringify(action)}: ${result.error}`)
  checkEvents(result.events, result.state)
  return result
}

/** Applies an action that must fail with `code`, and checks the state is untouched. */
function expectError(state: GameState, seat: Seat, action: unknown, code: EngineErrorCode) {
  const before = JSON.stringify(state)
  const result = applyAction(deepFreeze(state), seat, action as Action, topCard)
  expect(result).toEqual({ error: code })
  expect(JSON.stringify(state)).toBe(before)
}

const playCard = (card: string): Action => ({ type: 'play', card: card as CardId })
const GO: Action = { type: 'go' }

/** Plays a script such as ['1 7S', '0 8C', '0 go'] and returns the final state and events. */
function script(state: GameState, steps: string[]) {
  const events: GameEvent[] = []
  for (const step of steps) {
    const [seat, move] = step.split(' ') as [string, string]
    const result = act(state, Number(seat) as Seat, move === 'go' ? GO : playCard(move))
    state = result.state
    events.push(...result.events)
  }
  return { state, events }
}

/**
 * The state right after both players discarded (phase `cut`). `kept` and `crib` are indexed by
 * seat. `starter` goes on top of the deck, so a cut with `topCard` turns it up.
 */
function afterDiscard(opts: {
  dealer: Seat
  kept: Pair<string>
  crib: Pair<string>
  starter: string
  scores?: Pair<number>
}): GameState {
  const kept: Pair<CardId[]> = [ids(opts.kept[0]), ids(opts.kept[1])]
  const discards: Pair<CardId[]> = [ids(opts.crib[0]), ids(opts.crib[1])]
  const used = new Set([...kept.flat(), ...discards.flat(), opts.starter])
  const rest = cardIds(fullDeck()).filter((c) => !used.has(c))
  const pone = otherSeat(opts.dealer)
  return {
    ...createGame(),
    phase: 'cut',
    hand: 1,
    dealer: opts.dealer,
    scores: opts.scores ?? [0, 0],
    previousScores: opts.scores ?? [0, 0],
    deck: [opts.starter as CardId, ...rest],
    hands: [[...kept[0]], [...kept[1]]],
    kept,
    discards,
    play: { count: 0, turn: pone, sequence: [], played: [[], []], goSaid: null },
  }
}

/** `afterDiscard`, then the pone cuts. */
function afterCut(opts: Parameters<typeof afterDiscard>[0]) {
  return act(afterDiscard(opts), otherSeat(opts.dealer), { type: 'cut' })
}

const pointsFor = (events: GameEvent[], seat: Seat) =>
  events
    .filter((e) => e.type === 'points' && e.seat === seat)
    .flatMap((e) => (e.type === 'points' ? e.items.map((i) => `${i.kind}:${i.points}`) : []))

const types = (events: GameEvent[]) => events.map((e) => e.type)

/** Cards neither player may see yet: both hands, the deck, and the crib until it is shown. */
function hiddenCards(state: GameState): Set<string> {
  const cribShown = state.show.some((r) => r.source === 'crib')
  return new Set([
    ...state.hands[0],
    ...state.hands[1],
    ...state.deck,
    ...(cribShown ? [] : [...state.discards[0], ...state.discards[1]]),
  ])
}

const EVENT_KEYS: Record<GameEvent['type'], string[]> = {
  cut_for_deal: ['cards', 'dealer'],
  hand_dealt: ['dealer', 'hand'],
  discarded: ['seat'],
  starter_cut: ['card'],
  card_played: ['card', 'count', 'seat'],
  go: ['seat'],
  points: ['from', 'items', 'seat', 'to'],
  count_reset: ['leader'],
  show_scored: ['cards', 'from', 'items', 'seat', 'source', 'starter', 'to', 'total'],
  hand_complete: ['hand'],
  game_over: ['scores', 'skunk', 'winner'],
}

/** Every event has exactly the payload of the table in issue #11 and shows no hidden card. */
function checkEvents(events: GameEvent[], after: GameState) {
  const hidden = hiddenCards(after)
  for (const event of events) {
    const { type, ...payload } = event
    expect(Object.keys(payload).sort(), type).toEqual(EVENT_KEYS[type])
    // The cut for first deal happens before the deck is reshuffled for the deal, so its two
    // cards say nothing about anyone's hand even when they end up being dealt.
    if (type === 'cut_for_deal') continue
    const shown = JSON.stringify(event).match(/"[A2-9TJQK][CDHS]"/g) ?? []
    const leaked = shown.map((s) => s.slice(1, -1)).filter((c) => hidden.has(c))
    expect(leaked, `${type} leaks hidden cards`).toEqual([])
    if (event.type === 'points' || event.type === 'show_scored') {
      const sum = event.items.reduce((t, i) => t + i.points, 0)
      expect(event.to - event.from).toBe(Math.min(sum, 121 - event.from))
    }
  }
}

// --- The worked example from cribbage_rules.md ---------------------------------------------

describe('the worked example in cribbage_rules.md', () => {
  // Dealer is seat 0, pone is seat 1. Starter 5H.
  const example = {
    dealer: 0 as Seat,
    kept: ['8C 9H QD 2S', '7S 8D KH 3C'] as Pair<string>,
    crib: ['4D 6S', 'JH AC'] as Pair<string>,
    starter: '5H',
  }
  const tenSteps = [
    '1 7S', // 1: pone leads, 7
    '0 8C', // 2: 15, dealer 2 for fifteen
    '1 8D', // 3: 23, pone 2 for the pair
    '0 2S', // 4: 25, the only card the dealer can play
    '1 3C', // 5: 28, the only card the pone can play
    '0 go', // 6: dealer can't play. Step 7 is automatic: pone can't either, pone scores the go
    '0 9H', // 8: after the reset the dealer leads
    '1 KH', // 9: 19, pone is now out of cards
    '0 QD', // 10: 29, dealer scores 1 for last card
  ]

  it('plays the ten steps of the play and counts the show', () => {
    const cut = afterCut(example)
    expect(cut.events).toEqual([{ type: 'starter_cut', card: '5H' }])
    expect(cut.state.phase).toBe('play')
    expect(cut.state.play.turn).toBe(1) // the pone leads

    const { state, events } = script(cut.state, tenSteps)

    expect(pointsFor(events, 0)).toEqual(['fifteen:2', 'last_card:1'])
    expect(pointsFor(events, 1)).toEqual(['pair:2', 'go:1'])
    expect(events.filter((e) => e.type === 'go')).toEqual([{ type: 'go', seat: 0 }])
    expect(events.filter((e) => e.type === 'count_reset')).toEqual([
      { type: 'count_reset', leader: 0 },
    ])

    // The step-7 go point is awarded straight after the dealer's go, with no action from the pone.
    const afterGo = script(cut.state, tenSteps.slice(0, 6))
    expect(types(afterGo.events).slice(-3)).toEqual(['go', 'points', 'count_reset'])

    expect(state.phase).toBe('show')
    const shows = events.filter((e) => e.type === 'show_scored')
    expect(shows.map((e) => [e.seat, e.source, e.total, e.from, e.to])).toEqual([
      [1, 'hand', 6, 3, 9],
      [0, 'hand', 4, 3, 7],
      [0, 'crib', 10, 7, 17],
    ])
    expect(shows[2]).toMatchObject({ cards: ['AC', '4D', '6S', 'JH'], starter: '5H' })
    expect(types(events).at(-1)).toBe('hand_complete')
    expect(state.scores).toEqual([17, 9])
    expect(state.previousScores).toEqual([7, 3])
  })

  it('emits the play events in order', () => {
    const { events } = script(afterCut(example).state, tenSteps)
    expect(types(events).slice(0, 17)).toEqual([
      'card_played', // 7S
      'card_played', // 8C
      'points', // fifteen
      'card_played', // 8D
      'points', // pair
      'card_played', // 2S
      'card_played', // 3C
      'go',
      'points', // go point to the pone
      'count_reset',
      'card_played', // 9H
      'card_played', // KH
      'card_played', // QD
      'points', // last card
      'show_scored',
      'show_scored',
      'show_scored',
    ])
  })
})

// --- Dealing --------------------------------------------------------------------------------

describe('start and deal', () => {
  it('cuts for deal, then deals six cards each from a reproducible shuffle', () => {
    const first = act(createGame(), 0, { type: 'start' }, seededRng('deal'))
    const again = act(createGame(), 0, { type: 'start' }, seededRng('deal'))
    expect(again).toEqual(first)

    const { state, events } = first
    expect(types(events)).toEqual(['cut_for_deal', 'hand_dealt'])
    const cutEvent = events[0] as Extract<GameEvent, { type: 'cut_for_deal' }>
    const [a, b] = cutEvent.cards.map(parseCard) as [
      ReturnType<typeof parseCard>,
      ReturnType<typeof parseCard>,
    ]
    expect(a.rank).not.toBe(b.rank)
    expect(cutEvent.dealer).toBe(a.rank < b.rank ? 0 : 1)
    expect(events[1]).toEqual({ type: 'hand_dealt', hand: 1, dealer: cutEvent.dealer })

    expect(state.phase).toBe('discard')
    expect(state.hands[0]).toHaveLength(6)
    expect(state.hands[1]).toHaveLength(6)
    expect(state.deck).toHaveLength(40)
    const all = [...state.hands[0], ...state.hands[1], ...state.deck]
    expect(new Set(all).size).toBe(52)
    expect(all.every(isCardId)).toBe(true)

    const other = act(createGame(), 0, { type: 'start' }, seededRng('another seed')).state
    expect(other.hands).not.toEqual(state.hands)
  })

  it('cuts again when both cards have the same rank', () => {
    // The deck is in fullDeck() order: clubs A-K are 0-12, diamonds 13-25. Draws 0 and 12 cut
    // AC and AD (equal: cut again), then 4 and 20 cut 5C and 9D.
    const script = [0, 12, 4, 20]
    const seeded = seededRng('recut')
    let calls = 0
    const rng: Rng = { nextInt: (n) => script[calls++] ?? seeded.nextInt(n) }
    const { events } = act(createGame(), 0, { type: 'start' }, rng)
    expect(events[0]).toEqual({ type: 'cut_for_deal', cards: ['5C', '9D'], dealer: 0 })
    expect(calls).toBeGreaterThan(4)
  })

  it('gives the deal to the lower cut, ace low', () => {
    let rngCalls = 0
    const rng: Rng = { nextInt: (n) => [12, 0][rngCalls++] ?? n - 1 }
    const { events } = act(createGame(), 0, { type: 'start' }, rng)
    // Seat 0 cuts KC, seat 1 cuts AC: the ace is lowest, so seat 1 deals.
    expect(events[0]).toEqual({ type: 'cut_for_deal', cards: ['KC', 'AC'], dealer: 1 })
  })

  it('lets the pone lead and count first, and gives the crib to the dealer', () => {
    const { state, events } = script(
      afterCut({
        dealer: 1,
        kept: ['AC 2C 3C 4C', 'KD QD JD TD'],
        crib: ['5C 6C', '7D 8D'],
        starter: '9S',
      }).state,
      ['0 AC', '1 KD', '0 2C', '1 QD', '0 3C', '1 go', '0 4C', '1 JD', '1 TD'],
    )
    expect(state.phase).toBe('show')
    const shows = events.filter((e) => e.type === 'show_scored')
    expect(shows.map((e) => [e.seat, e.source])).toEqual([
      [0, 'hand'],
      [1, 'hand'],
      [1, 'crib'],
    ])
  })

  it('alternates the deal when both players are ready, and starts the next hand clean', () => {
    const steps = ['1 7S', '0 8C', '1 8D', '0 2S', '1 3C', '0 go', '0 9H', '1 KH', '0 QD']
    const show = script(
      afterCut({
        dealer: 0,
        kept: ['8C 9H QD 2S', '7S 8D KH 3C'],
        crib: ['4D 6S', 'JH AC'],
        starter: '5H',
      }).state,
      steps,
    ).state
    expect(show.phase).toBe('show')

    const once = act(show, 0, { type: 'ready' })
    expect(once.events).toEqual([])
    expect(act(once.state, 0, { type: 'ready' }).events).toEqual([]) // repeated ready: no-op
    const next = act(once.state, 1, { type: 'ready' }, seededRng('hand 2'))
    expect(next.events).toEqual([{ type: 'hand_dealt', hand: 2, dealer: 1 }])
    const s = next.state
    expect(s.phase).toBe('discard')
    expect(s.dealer).toBe(1)
    expect(s.ready).toEqual([false, false])
    expect(s.show).toEqual([])
    expect(s.starter).toBeNull()
    expect(s.kept).toEqual([[], []])
    expect(s.discards).toEqual([[], []])
    expect(s.play).toEqual({ count: 0, turn: 0, sequence: [], played: [[], []], goSaid: null })
    expect(s.scores).toEqual(show.scores)
    expect(s.previousScores).toEqual(show.previousScores)
    expect(s.deck).toHaveLength(40)
    expect(new Set([...s.hands.flat(), ...s.deck]).size).toBe(52)
  })
})

// --- Discard and cut ------------------------------------------------------------------------

describe('discard and cut', () => {
  it('takes two cards from each player into the crib, then waits for the cut', () => {
    const dealt = act(createGame(), 0, { type: 'start' }, seededRng('discard')).state
    const pone = otherSeat(dealt.dealer)
    const ponePick = dealt.hands[pone].slice(0, 2) as [CardId, CardId]
    const first = act(dealt, pone, { type: 'discard', cards: ponePick })
    expect(first.events).toEqual([{ type: 'discarded', seat: pone }])
    expect(first.state.phase).toBe('discard')
    expect(first.state.hands[pone]).toHaveLength(4)
    expect(first.state.kept[pone]).toEqual(first.state.hands[pone])

    const dealerPick = dealt.hands[dealt.dealer].slice(-2) as [CardId, CardId]
    const second = act(first.state, dealt.dealer, { type: 'discard', cards: dealerPick })
    expect(second.state.phase).toBe('cut')
    expect([...second.state.discards[0], ...second.state.discards[1]].sort()).toEqual(
      [...ponePick, ...dealerPick].sort(),
    )
  })

  it('turns up a random card from the 40 undealt cards', () => {
    const state = afterDiscard({
      dealer: 0,
      kept: ['8C 9H QD 2S', '7S 8D KH 3C'],
      crib: ['4D 6S', 'JH AC'],
      starter: '5H',
    })
    const { state: after, events } = act(state, 1, { type: 'cut' }, seededRng('cut'))
    expect(state.deck).toContain(after.starter)
    expect(after.deck).toHaveLength(39)
    expect(after.deck).not.toContain(after.starter)
    expect(events[0]).toEqual({ type: 'starter_cut', card: after.starter })
  })

  it('cuts a different card for different random draws', () => {
    const state = afterDiscard({
      dealer: 0,
      kept: ['8C 9H QD 2S', '7S 8D KH 3C'],
      crib: ['4D 6S', 'JH AC'],
      starter: '5H',
    })
    const starters = new Set(
      Array.from(
        { length: 10 },
        (_, i) => act(state, 1, { type: 'cut' }, seededRng(i)).state.starter,
      ),
    )
    expect(starters.size).toBeGreaterThan(5)
  })

  it('gives the dealer 2 for his heels when the starter is a jack', () => {
    const { state, events } = afterCut({
      dealer: 0,
      kept: ['8C 9H QD 2S', '7S 8D KH 3C'],
      crib: ['4D 6S', 'JH AC'],
      starter: 'JS',
      scores: [10, 20],
    })
    expect(events).toEqual([
      { type: 'starter_cut', card: 'JS' },
      {
        type: 'points',
        seat: 0,
        items: [{ kind: 'heels', points: 2, cards: ['JS'] }],
        from: 10,
        to: 12,
      },
    ])
    expect(state.scores).toEqual([12, 20])
    expect(state.phase).toBe('play')
  })
})

// --- The play -------------------------------------------------------------------------------

describe('the play', () => {
  it('after an explicit go, the other player keeps playing and can pair their own card', () => {
    const { state, events } = script(
      afterCut({
        dealer: 0,
        kept: ['KD QD JD 9C', 'KC 5C 2C 2D'],
        crib: ['3S 4S', '6H 7H'],
        starter: 'AH',
      }).state,
      ['1 KC', '0 KD', '1 5C', '0 go', '1 2C', '1 2D', '0 QD', '0 JD', '0 9C'],
    )
    expect(pointsFor(events, 1)).toEqual(['pair:2', 'go:1'])
    expect(pointsFor(events, 0)).toEqual(['pair:2', 'last_card:1'])
    // The go point comes straight after the pone's last card, then the dealer leads.
    expect(events.filter((e) => e.type === 'count_reset')).toEqual([
      { type: 'count_reset', leader: 0 },
    ])
    expect(state.phase).toBe('show')
  })

  it('ends the count at once when both players are stuck: only one go is said', () => {
    const { state, events } = script(
      afterCut({
        dealer: 0,
        kept: ['KD 9C 8C 3S', 'KC QC 2C 2D'],
        crib: ['4S 5S', '6H 7H'],
        starter: 'AH',
      }).state,
      ['1 KC', '0 KD', '1 QC', '0 go'],
    )
    expect(types(events).slice(-4)).toEqual(['card_played', 'go', 'points', 'count_reset'])
    expect(pointsFor(events, 1)).toEqual(['go:1'])
    expect(events.filter((e) => e.type === 'go')).toHaveLength(1)
    expect(state.play.count).toBe(0)
    expect(state.play.turn).toBe(0) // the dealer did not play the last card, so leads
  })

  it('needs no go when the stuck player’s opponent has no cards left', () => {
    const { state, events } = script(
      afterCut({
        dealer: 0,
        kept: ['QD KD 9D 8D', 'TC JC 5C 6C'],
        crib: ['2S 3S', '2H 3H'],
        starter: 'AH',
      }).state,
      ['1 TC', '0 QD', '1 JC', '0 go', '0 KD', '1 5C', '0 9D', '1 6C', '0 8D'],
    )
    // After the pone's 6C (30) the dealer holds only 8D and the pone is out: the count just ends.
    expect(events.filter((e) => e.type === 'go')).toHaveLength(1)
    // TC QD JC is a run of three for the pone's JC.
    expect(pointsFor(events, 1)).toEqual(['run:3', 'go:1', 'fifteen:2', 'go:1'])
    expect(pointsFor(events, 0)).toEqual(['last_card:1'])
    expect(state.phase).toBe('show')
  })

  it('scores 31 as 2, not 3, and a card making 31 and a pair as 4', () => {
    const { state, events } = script(
      afterCut({
        dealer: 0,
        kept: ['8C 7D 3D 4D', '9C 7C AC 2C'],
        crib: ['5S 6S', '5H 6H'],
        starter: 'KH',
      }).state,
      ['1 9C', '0 8C', '1 7C', '0 7D'],
    )
    expect(events.slice(-3)).toEqual([
      { type: 'card_played', seat: 0, card: '7D', count: 31 },
      {
        type: 'points',
        seat: 0,
        items: [
          { kind: 'thirtyone', points: 2, cards: ['9C', '8C', '7C', '7D'] },
          { kind: 'pair', points: 2, cards: ['7C', '7D'] },
        ],
        from: 0,
        to: 4,
      },
      { type: 'count_reset', leader: 1 },
    ])
    expect(state.play.count).toBe(0)
    expect(state.play.turn).toBe(1)
  })

  it('scores 31 on the final card as 2, with no last-card point', () => {
    const { events, state } = script(
      afterCut({
        dealer: 0,
        kept: ['TD KS QS 9S', 'TC TH AC 2C'],
        crib: ['2S 3S', '2H 3H'],
        starter: '5H',
      }).state,
      ['1 TC', '0 TD', '1 TH', '0 go', '1 AC', '0 KS', '1 2C', '0 QS', '0 9S'],
    )
    expect(pointsFor(events, 0)).toEqual(['pair:2', 'thirtyone:2'])
    expect(pointsFor(events, 1)).toEqual(['pair:6', 'thirtyone:2'])
    expect(types(events).slice(-6)).toEqual([
      'card_played',
      'points',
      'show_scored',
      'show_scored',
      'show_scored',
      'hand_complete',
    ])
    expect(state.phase).toBe('show')
  })

  it('scores a last card that also makes fifteen as 2 + 1, with one last-card point', () => {
    const { events } = script(
      afterCut({
        dealer: 0,
        kept: ['TD 3D 2D 8D', 'TC 4C 2C 7C'],
        crib: ['5S 6S', '5H 6H'],
        starter: 'KH',
      }).state,
      ['1 TC', '0 TD', '1 4C', '0 3D', '1 2C', '0 2D', '1 7C', '0 8D'],
    )
    expect(pointsFor(events, 1)).toEqual(['run:3'])
    expect(pointsFor(events, 0)).toEqual([
      'pair:2',
      'thirtyone:2',
      'pair:2',
      'fifteen:2',
      'last_card:1',
    ])
    const lastPoints = events.filter((e) => e.type === 'points').slice(-2)
    expect(lastPoints.map((e) => (e.type === 'points' ? e.items.map((i) => i.kind) : []))).toEqual([
      ['fifteen'],
      ['last_card'],
    ])
  })

  it('gives the lead back to the player of the last card when the other is out of cards', () => {
    const { events } = script(
      afterCut({
        dealer: 0,
        kept: ['TD KS QS JS', 'TC TH AC 2C'],
        crib: ['2S 3S', '2H 3H'],
        starter: '5H',
      }).state,
      ['1 TC', '0 TD', '1 TH', '0 go', '1 AC', '0 KS', '1 2C', '0 QS', '0 JS'],
    )
    expect(pointsFor(events, 1)).toEqual(['pair:6', 'thirtyone:2'])
    // At 22 the dealer is stuck with JS and the pone is out: the dealer takes the go and,
    // because the pone has no cards, leads again.
    expect(pointsFor(events, 0)).toEqual(['pair:2', 'go:1', 'last_card:1'])
    expect(events.filter((e) => e.type === 'count_reset')).toEqual([
      { type: 'count_reset', leader: 0 },
      { type: 'count_reset', leader: 0 },
    ])
  })
})

// --- Winning --------------------------------------------------------------------------------

describe('winning', () => {
  const example = {
    dealer: 0 as Seat,
    kept: ['8C 9H QD 2S', '7S 8D KH 3C'] as Pair<string>,
    crib: ['4D 6S', 'JH AC'] as Pair<string>,
    starter: '5H',
  }

  it('ends the game the instant a player reaches 121 in the play', () => {
    // The dealer needs 2: the fifteen on step 2 wins, nothing else is played or scored.
    const { state, events } = script(afterCut({ ...example, scores: [119, 50] }).state, [
      '1 7S',
      '0 8C',
    ])
    expect(types(events)).toEqual(['card_played', 'card_played', 'points', 'game_over'])
    expect(events.at(-1)).toEqual({
      type: 'game_over',
      winner: 0,
      scores: [121, 50],
      skunk: 'double',
    })
    expect(state.phase).toBe('game_over')
    expect(state.winner).toBe(0)
    expect(state.skunk).toBe('double')
  })

  it('ends the game on a last-card point: the show is never counted', () => {
    // The dealer pegs the fifteen (118 -> 120), then the last card makes 121.
    const steps = ['1 7S', '0 8C', '1 8D', '0 2S', '1 3C', '0 go', '0 9H', '1 KH', '0 QD']
    const { state, events } = script(afterCut({ ...example, scores: [118, 57] }).state, steps)
    expect(types(events).slice(-3)).toEqual(['card_played', 'points', 'game_over'])
    expect(events.filter((e) => e.type === 'show_scored')).toEqual([])
    expect(state.scores).toEqual([121, 60])
    expect(state.skunk).toBe('double')
  })

  it('ends the game on a go point: no reset follows', () => {
    // The pone pegs the pair (118 -> 120), then takes the go after the dealer's go.
    const steps = ['1 7S', '0 8C', '1 8D', '0 2S', '1 3C', '0 go']
    const { state, events } = script(afterCut({ ...example, scores: [40, 118] }).state, steps)
    expect(types(events).slice(-3)).toEqual(['go', 'points', 'game_over'])
    expect(state.winner).toBe(1)
    expect(state.phase).toBe('game_over')
  })

  it('ends the game on a fifteen made by the last card: no last-card point follows', () => {
    const { state, events } = script(
      afterCut({
        dealer: 0,
        kept: ['TD 3D 2D 8D', 'TC 4C 2C 7C'],
        crib: ['5S 6S', '5H 6H'],
        starter: 'KH',
        scores: [113, 30],
      }).state,
      ['1 TC', '0 TD', '1 4C', '0 3D', '1 2C', '0 2D', '1 7C', '0 8D'],
    )
    expect(pointsFor(events, 0)).toEqual(['pair:2', 'thirtyone:2', 'pair:2', 'fifteen:2'])
    expect(types(events).slice(-2)).toEqual(['points', 'game_over'])
    expect(state.scores[0]).toBe(121)
  })

  it('caps the score at 121', () => {
    const { state, events } = script(afterCut({ ...example, scores: [120, 95] }).state, [
      '1 7S',
      '0 8C',
    ])
    expect(events.find((e) => e.type === 'points')).toMatchObject({ from: 120, to: 121 })
    expect(state.scores).toEqual([121, 95])
    expect(state.skunk).toBe('none')
  })

  it('can be won on his heels', () => {
    const { state, events } = afterCut({ ...example, starter: 'JC', scores: [119, 75] })
    expect(types(events)).toEqual(['starter_cut', 'points', 'game_over'])
    expect(state.winner).toBe(0)
    expect(state.skunk).toBe('skunk')
  })

  it('stops the show when the pone counts out: the dealer’s hand and crib are never counted', () => {
    // The pone pegs 3 (to 115) and the 6-point hand makes 121.
    const steps = ['1 7S', '0 8C', '1 8D', '0 2S', '1 3C', '0 go', '0 9H', '1 KH', '0 QD']
    const { state, events } = script(afterCut({ ...example, scores: [100, 112] }).state, steps)
    const shows = events.filter((e) => e.type === 'show_scored')
    expect(shows.map((e) => [e.seat, e.source, e.from, e.to])).toEqual([[1, 'hand', 115, 121]])
    expect(types(events).at(-1)).toBe('game_over')
    expect(state.scores).toEqual([103, 121])
    expect(state.show).toHaveLength(1)
  })

  it.each([
    [57, 60, 'double'],
    [58, 61, 'skunk'],
    [87, 90, 'skunk'],
    [88, 91, 'none'],
  ] as const)('a loser starting the hand on %i ends on %i: %s', (start, end, skunk) => {
    const steps = ['1 7S', '0 8C', '1 8D', '0 2S', '1 3C', '0 go', '0 9H', '1 KH', '0 QD']
    const { state } = script(afterCut({ ...example, scores: [start, 112] }).state, steps)
    expect(state.scores).toEqual([end, 121])
    expect(state.skunk).toBe(skunk)
  })

  it('judges skunk on the loser’s score at the boundaries', () => {
    expect([0, 60, 61, 90, 91, 120].map(skunkLevel)).toEqual([
      'double',
      'double',
      'skunk',
      'skunk',
      'none',
      'none',
    ])
  })
})

// --- Errors ---------------------------------------------------------------------------------

describe('illegal actions return an error and leave the state untouched', () => {
  const lobby = createGame()
  const dealt = act(createGame(), 0, { type: 'start' }, seededRng('errors')).state
  const pone = otherSeat(dealt.dealer)
  const [c1, c2] = dealt.hands[pone] as [CardId, CardId]
  const notMine = dealt.hands[dealt.dealer][0] as CardId
  const halfDiscarded = act(dealt, pone, { type: 'discard', cards: [c1, c2] }).state
  const cutPhase = afterDiscard({
    dealer: 0,
    kept: ['8C 9H QD 2S', '7S 8D KH 3C'],
    crib: ['4D 6S', 'JH AC'],
    starter: '5H',
  })
  const playPhase = act(cutPhase, 1, { type: 'cut' }).state
  const ponesTurn = script(playPhase, ['1 7S', '0 8C']).state
  const at28 = script(playPhase, ['1 7S', '0 8C', '1 8D', '0 2S', '1 3C']).state
  const over = script(
    act(
      afterDiscard({
        dealer: 0,
        kept: ['8C 9H QD 2S', '7S 8D KH 3C'],
        crib: ['4D 6S', 'JH AC'],
        starter: '5H',
        scores: [119, 0],
      }),
      1,
      { type: 'cut' },
    ).state,
    ['1 7S', '0 8C'],
  ).state

  it.each([
    ['discard in the lobby', lobby, 0, { type: 'discard', cards: [c1, c2] }, 'wrong_phase'],
    ['start twice', dealt, 0, { type: 'start' }, 'wrong_phase'],
    ['cut before discarding', dealt, pone, { type: 'cut' }, 'wrong_phase'],
    ['play while discarding', dealt, pone, playCard(c1), 'wrong_phase'],
    ['go while discarding', dealt, pone, GO, 'wrong_phase'],
    ['ready while discarding', dealt, pone, { type: 'ready' }, 'wrong_phase'],
    [
      'discard a card not held',
      dealt,
      pone,
      { type: 'discard', cards: [c1, notMine] },
      'card_not_in_hand',
    ],
    ['discard one card', dealt, pone, { type: 'discard', cards: [c1] }, 'invalid_action'],
    [
      'discard three cards',
      dealt,
      pone,
      { type: 'discard', cards: [c1, c2, c1] },
      'invalid_action',
    ],
    [
      'discard the same card twice',
      dealt,
      pone,
      { type: 'discard', cards: [c1, c1] },
      'invalid_action',
    ],
    ['discard garbage', dealt, pone, { type: 'discard', cards: ['ZZ', 7] }, 'invalid_action'],
    [
      'discard again',
      halfDiscarded,
      pone,
      { type: 'discard', cards: [c1, c2] },
      'already_discarded',
    ],
    ['the dealer cuts', cutPhase, 0, { type: 'cut' }, 'not_your_turn'],
    [
      'discard during the play',
      playPhase,
      1,
      { type: 'discard', cards: ['7S', '8D'] },
      'wrong_phase',
    ],
    ['play out of turn', playPhase, 0, playCard('8C'), 'not_your_turn'],
    ['play a card not held', playPhase, 1, playCard('8C'), 'card_not_in_hand'],
    ['play a card already played', ponesTurn, 1, playCard('7S'), 'card_not_in_hand'],
    ['play past 31', at28, 0, playCard('9H'), 'illegal_play'],
    ['play a malformed card', playPhase, 1, { type: 'play', card: 'seven' }, 'invalid_action'],
    ['go with a card to play', playPhase, 1, GO, 'must_play'],
    ['go out of turn', at28, 1, GO, 'not_your_turn'],
    ['an unknown action', playPhase, 1, { type: 'fold' }, 'invalid_action'],
    ['no action at all', playPhase, 1, null, 'invalid_action'],
    ['ready during the play', playPhase, 1, { type: 'ready' }, 'wrong_phase'],
    ['anything after the game is over', over, 1, { type: 'ready' }, 'game_over'],
    ['playing after the game is over', over, 1, playCard('8D'), 'game_over'],
  ] as [string, GameState, Seat, unknown, EngineErrorCode][])(
    '%s',
    (_, state, seat, action, code) => {
      expectError(state, seat, action, code)
    },
  )

  it('answers must_play to a go from a player who can play, even when no go is possible', () => {
    // The pone is out of cards and the dealer leads the new count holding JS.
    const state = script(
      afterCut({
        dealer: 0,
        kept: ['TD KS QS JS', 'TC TH AC 2C'],
        crib: ['2S 3S', '2H 3H'],
        starter: '5H',
      }).state,
      ['1 TC', '0 TD', '1 TH', '0 go', '1 AC', '0 KS', '1 2C', '0 QS'],
    ).state
    expect(state.hands[1]).toEqual([])
    expectError(state, 0, GO, 'must_play')
  })

  it('rejects a card that would take the count past 31 as illegal_play', () => {
    // At 28 the dealer is on turn holding 9H and QD and must say go; force a pone turn at 25.
    const at25 = script(playPhase, ['1 7S', '0 8C', '1 8D', '0 2S']).state
    expectError(at25, 1, playCard('KH'), 'illegal_play')
  })

  it('answers go_not_needed when the opponent has no cards or has already said go', () => {
    // These states can't arise from play (the engine resolves them itself), so build them.
    const stuck: GameState = {
      ...playPhase,
      hands: [['9H', 'QD'], []],
      play: { ...playPhase.play, count: 28, turn: 0, sequence: [{ seat: 1, card: '3C' }] },
    }
    expectError(stuck, 0, GO, 'go_not_needed')
    const afterGo: GameState = {
      ...stuck,
      hands: [['9H', 'QD'], ['KH']],
      play: { ...stuck.play, goSaid: 1 },
    }
    expectError(afterGo, 0, GO, 'go_not_needed')
  })

  it('rejects an invalid seat', () => {
    expectError(playPhase, 2 as Seat, playCard('7S'), 'invalid_action')
  })
})

// --- Whole games ----------------------------------------------------------------------------

describe('whole games with a simple bot', () => {
  /** Tries actions in a fixed order and returns the first one the engine accepts. */
  function firstLegal(state: GameState, rng: Rng) {
    for (const seat of [0, 1] as Seat[]) {
      const hand = state.hands[seat]
      const candidates: Action[] = [
        { type: 'discard', cards: [hand[0], hand[1]] as [CardId, CardId] },
        { type: 'cut' },
        ...hand.map((card) => playCard(card)),
        GO,
        ...(state.ready[seat] ? [] : [{ type: 'ready' } as Action]),
      ]
      for (const action of candidates) {
        const result = applyAction(state, seat, action, rng)
        if (!('error' in result)) return { seat, action, result }
      }
    }
    throw new Error(`No legal action in phase ${state.phase}`)
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'game %i runs to 121 with consistent scores and events',
    (seed) => {
      const rng = seededRng(`bot-${seed}`)
      let state = act(createGame(), 0, { type: 'start' }, rng).state
      for (let steps = 0; state.phase !== 'game_over'; steps++) {
        expect(steps).toBeLessThan(5000)
        const before = state
        const { result } = firstLegal(state, rng)
        checkEvents(result.events, result.state)
        // Scores never go down, and every change is explained by exactly one event.
        for (const seat of [0, 1] as Seat[]) {
          const gained = result.events
            .filter((e) => (e.type === 'points' || e.type === 'show_scored') && e.seat === seat)
            .reduce(
              (t, e) => t + ((e as { to: number; from: number }).to - (e as { from: number }).from),
              0,
            )
          expect(result.state.scores[seat] - before.scores[seat]).toBe(gained)
        }
        // No card is ever lost or duplicated.
        const s = result.state
        const cards = [
          ...s.deck,
          ...s.hands.flat(),
          ...s.discards.flat(),
          ...s.play.played.flat(),
          ...(s.starter ? [s.starter] : []),
        ]
        expect(new Set(cards).size).toBe(52)
        expect(cards).toHaveLength(52)
        state = s
      }
      expect(Math.max(...state.scores)).toBe(121)
      expect(Math.min(...state.scores)).toBeLessThan(121)
      expect(state.scores[state.winner as Seat]).toBe(121)
    },
  )
})

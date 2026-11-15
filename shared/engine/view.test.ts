import { describe, expect, it } from 'vitest'
import { cardIds, fullDeck, type CardId } from './cards'
import { applyAction, createGame } from './game'
import { seededRng, type Rng } from './rng'
import type { Action, GameState, Pair } from './state'
import { otherSeat, SEATS, type Seat } from './types'
import { legalActions, playerView } from './view'

const topCard: Rng = { nextInt: () => 0 }

function apply(state: GameState, seat: Seat, action: Action, rng: Rng = topCard): GameState {
  const result = applyAction(state, seat, action, rng)
  if ('error' in result) throw new Error(`${JSON.stringify(action)}: ${result.error}`)
  return result.state
}

/** Cards `seat` must not see: the opponent's hand, the deck, the opponent's crib cards. */
function hiddenFrom(state: GameState, seat: Seat): Set<CardId> {
  const opponent = otherSeat(seat)
  const cribShown = state.show.some((r) => r.source === 'crib')
  return new Set([
    ...state.hands[opponent],
    ...state.deck,
    ...(cribShown ? [] : state.discards[opponent]),
  ])
}

/** Every CardId that appears anywhere in the JSON of a value. */
function cardsIn(value: unknown): string[] {
  return (JSON.stringify(value).match(/"[A2-9TJQK][CDHS]"/g) ?? []).map((s) => s.slice(1, -1))
}

function expectNoLeak(state: GameState) {
  for (const seat of SEATS) {
    const hidden = hiddenFrom(state, seat)
    const leaked = cardsIn(playerView(state, seat)).filter((c) => hidden.has(c as CardId))
    expect(leaked, `seat ${seat} in ${state.phase} sees hidden cards`).toEqual([])
  }
}

// --- Fixture states for every phase ---------------------------------------------------------

const example = (scores: Pair<number> = [0, 0]): GameState => {
  // The worked example from cribbage_rules.md, after both discards. Dealer 0, starter 5H on top.
  const kept: Pair<CardId[]> = [
    ['8C', '9H', 'QD', '2S'],
    ['7S', '8D', 'KH', '3C'],
  ]
  const discards: Pair<CardId[]> = [
    ['4D', '6S'],
    ['JH', 'AC'],
  ]
  const used = new Set([...kept.flat(), ...discards.flat(), '5H'])
  return {
    ...createGame(),
    phase: 'cut',
    hand: 1,
    dealer: 0,
    scores,
    previousScores: scores,
    deck: ['5H', ...cardIds(fullDeck()).filter((c) => !used.has(c))],
    hands: [[...kept[0]], [...kept[1]]],
    kept,
    discards,
    play: { count: 0, turn: 1, sequence: [], played: [[], []], goSaid: null },
  }
}

const steps: [Seat, Action][] = [
  [1, { type: 'play', card: '7S' }],
  [0, { type: 'play', card: '8C' }],
  [1, { type: 'play', card: '8D' }],
  [0, { type: 'play', card: '2S' }],
  [1, { type: 'play', card: '3C' }],
  [0, { type: 'go' }],
  [0, { type: 'play', card: '9H' }],
  [1, { type: 'play', card: 'KH' }],
  [0, { type: 'play', card: 'QD' }],
]

/** Every state along the worked example: cut, each step of the play, then the show. */
function scriptedHand(scores?: Pair<number>): GameState[] {
  const states = [example(scores)]
  let state = apply(states[0]!, 1, { type: 'cut' })
  states.push(state)
  for (const [seat, action] of steps) {
    if (state.phase !== 'play') break
    state = apply(state, seat, action)
    states.push(state)
  }
  return states
}

function fixtures(): [string, GameState][] {
  const lobby = createGame()
  const dealt = apply(lobby, 0, { type: 'start' }, seededRng('view'))
  const pone = otherSeat(dealt.dealer)
  const oneDiscarded = apply(dealt, pone, {
    type: 'discard',
    cards: dealt.hands[pone].slice(0, 2) as [CardId, CardId],
  })
  const hand = scriptedHand()
  return [
    ['lobby', lobby],
    ['discard, just dealt', dealt],
    ['discard, one player done', oneDiscarded],
    ['cut', hand[0]!],
    ...hand.slice(1, -1).map((s, i): [string, GameState] => [`play, step ${i}`, s]),
    ['show', hand.at(-1)!],
    ['game over in the play', scriptedHand([119, 0]).at(-1)!],
    ['game over in the show, crib never counted', scriptedHand([0, 112]).at(-1)!],
  ]
}

describe('playerView', () => {
  it.each(fixtures())('never shows a hidden card: %s', (_, state) => {
    expectNoLeak(state)
  })

  it('covers the phases the leak test claims to', () => {
    expect(new Set(fixtures().map(([, s]) => s.phase))).toEqual(
      new Set(['lobby', 'discard', 'cut', 'play', 'show', 'game_over']),
    )
    const overInShow = fixtures().at(-1)![1]
    expect(overInShow.show.map((r) => r.source)).toEqual(['hand'])
  })

  it('shows your own hand and discards, and only the size of the opponent’s hand', () => {
    const state = example()
    const view = playerView(state, 1)
    expect(view.seat).toBe(1)
    expect(view.myHand).toEqual(['7S', '8D', 'KH', '3C'])
    expect(view.myDiscards).toEqual(['JH', 'AC'])
    expect(view.opponentHandCount).toBe(4)
    expect(view.cribCount).toBe(4)
    expect(view.crib).toBeNull()
    expect(view.hasDiscarded).toEqual([true, true])
    expect(view.legal).toEqual({ discard: false, cut: true, playable: [], go: false, ready: false })
    expect(playerView(state, 0).legal.cut).toBe(false)
  })

  it('shows the play to both players: count, turn, sequence and cards played', () => {
    const afterFive = scriptedHand()[6]! // pone has just played 3C, count 28
    const view = playerView(afterFive, 0)
    expect(view.count).toBe(28)
    expect(view.turn).toBe(0)
    expect(view.sequence.map((p) => p.card)).toEqual(['7S', '8C', '8D', '2S', '3C'])
    expect(view.played).toEqual([
      ['8C', '2S'],
      ['7S', '8D', '3C'],
    ])
    expect(view.legal).toEqual({ discard: false, cut: false, playable: [], go: true, ready: false })
    expect(view.saidGo).toEqual([false, false])
  })

  it('reveals the counted hands and the crib at the show, with their breakdowns', () => {
    const show = scriptedHand().at(-1)!
    const view = playerView(show, 1)
    expect(view.phase).toBe('show')
    expect(view.crib).toEqual(['AC', '4D', '6S', 'JH'])
    expect(view.show.map((r) => [r.seat, r.source, r.cards, r.breakdown.total])).toEqual([
      [1, 'hand', ['3C', '7S', '8D', 'KH'], 6],
      [0, 'hand', ['2S', '8C', '9H', 'QD'], 4],
      [0, 'crib', ['AC', '4D', '6S', 'JH'], 10],
    ])
    expect(view.legal.ready).toBe(true)
    expect(playerView(apply(show, 1, { type: 'ready' }), 1).legal.ready).toBe(false)
  })

  it('reports the winner and skunk when the game is over', () => {
    const over = scriptedHand([119, 0]).at(-1)!
    const view = playerView(over, 1)
    expect(view.phase).toBe('game_over')
    expect(view.winner).toBe(0)
    expect(view.skunk).toBe('double')
    expect(view.legal).toEqual({
      discard: false,
      cut: false,
      playable: [],
      go: false,
      ready: false,
    })
  })

  it('shows who has discarded, from both seats', () => {
    const dealt = apply(createGame(), 0, { type: 'start' }, seededRng('flags'))
    const pone = otherSeat(dealt.dealer)
    const half = apply(dealt, pone, {
      type: 'discard',
      cards: dealt.hands[pone].slice(0, 2) as [CardId, CardId],
    })
    const expected: Pair<boolean> = [pone === 0, pone === 1]
    for (const seat of SEATS) {
      const view = playerView(half, seat)
      expect(view.hasDiscarded).toEqual(expected)
      expect(view.legal.discard).toBe(seat !== pone)
      expect(view.myDiscards).toHaveLength(seat === pone ? 2 : 0)
      expect(view.myHand).toHaveLength(seat === pone ? 4 : 6)
      expect(view.cribCount).toBe(2)
    }
  })

  it('shows who said go and whose turn it is, from both seats', () => {
    // Dealer 0 says go at 25; the pone (1) plays on.
    let state: GameState = {
      ...example(),
      hands: [
        ['KD', 'QD', 'JD', '9C'],
        ['KC', '5C', '2C', '2D'],
      ],
      kept: [
        ['KD', 'QD', 'JD', '9C'],
        ['KC', '5C', '2C', '2D'],
      ],
      discards: [
        ['3S', '4S'],
        ['6H', '7H'],
      ],
      deck: [
        '5H',
        ...cardIds(fullDeck()).filter(
          (c) =>
            ![
              'KD',
              'QD',
              'JD',
              '9C',
              'KC',
              '5C',
              '2C',
              '2D',
              '3S',
              '4S',
              '6H',
              '7H',
              '5H',
            ].includes(c),
        ),
      ],
    }
    state = apply(state, 1, { type: 'cut' })
    for (const [seat, action] of [
      [1, { type: 'play', card: 'KC' }],
      [0, { type: 'play', card: 'KD' }],
      [1, { type: 'play', card: '5C' }],
      [0, { type: 'go' }],
    ] as [Seat, Action][]) {
      state = apply(state, seat, action)
    }
    for (const seat of SEATS) {
      const view = playerView(state, seat)
      expect(view.saidGo).toEqual([true, false])
      expect(view.turn).toBe(1)
      expect(view.count).toBe(25)
      expect(view.scores).toEqual([2, 0])
      expect(view.previousScores).toEqual([0, 0])
    }
    expect(playerView(state, 1).legal.playable).toEqual(['2C', '2D'])
    expect(playerView(state, 0).legal).toEqual({
      discard: false,
      cut: false,
      playable: [],
      go: false,
      ready: false,
    })
  })

  it('keeps each seat’s rear peg apart from the front peg', () => {
    const view = playerView(scriptedHand().at(-1)!, 1)
    expect(view.scores).toEqual([17, 9])
    expect(view.previousScores).toEqual([7, 3])
  })

  it('offers nothing when the server says the game can no longer be played', () => {
    const state = scriptedHand()[1]! // the pone is on turn to lead
    expect(playerView(state, 1).legal.playable).toHaveLength(4)
    expect(playerView(state, 1, { canAct: false }).legal).toEqual({
      discard: false,
      cut: false,
      playable: [],
      go: false,
      ready: false,
    })
  })

  it('is plain JSON that shares nothing with the state', () => {
    const state = scriptedHand().at(-1)!
    const view = playerView(state, 0)
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
    view.myDiscards.push('KS')
    view.show[0]!.breakdown.items[0]!.cards.push('KS')
    view.scores[0] = 99
    expect(state.discards[0]).toEqual(['4D', '6S'])
    expect(state.show[0]!.items[0]!.cards).not.toContain('KS')
    expect(state.scores[0]).not.toBe(99)
  })
})

// --- legalActions agrees with applyAction ---------------------------------------------------

/** Every action worth trying for `seat`, legal or not. */
function candidates(state: GameState, seat: Seat): Action[] {
  const mine = state.hands[seat]
  const theirs = state.hands[otherSeat(seat)]
  const pairs: Action[] = []
  for (let i = 0; i < mine.length; i++) {
    for (let j = i + 1; j < mine.length; j++) {
      pairs.push({ type: 'discard', cards: [mine[i]!, mine[j]!] })
    }
  }
  const foreign = theirs[0] ?? state.deck[0]
  return [
    { type: 'start' },
    ...pairs,
    ...(foreign && mine[0] ? [{ type: 'discard', cards: [mine[0], foreign] } as Action] : []),
    { type: 'cut' },
    ...mine.map((card): Action => ({ type: 'play', card })),
    ...(foreign ? [{ type: 'play', card: foreign } as Action] : []),
    { type: 'go' },
    { type: 'ready' },
  ]
}

function isLegal(state: GameState, seat: Seat, action: Action): boolean {
  const legal = legalActions(state, seat)
  switch (action.type) {
    case 'discard':
      return legal.discard && action.cards.every((c) => state.hands[seat].includes(c))
    case 'cut':
      return legal.cut
    case 'play':
      return legal.playable.includes(action.card)
    case 'go':
      return legal.go
    case 'ready':
      return legal.ready
    case 'start':
      return false // server only
  }
}

describe('legalActions', () => {
  it('matches applyAction exactly over 40 random games', () => {
    const disagreements: unknown[] = []
    for (let game = 0; game < 40; game++) {
      const rng = seededRng(`legal-${game}`)
      let state = apply(createGame(), 0, { type: 'start' }, rng)
      let steps = 0
      while (state.phase !== 'game_over' && steps++ < 2000) {
        const options: [Seat, Action][] = []
        for (const seat of SEATS) {
          for (const action of candidates(state, seat)) {
            const accepted = !('error' in applyAction(state, seat, action, rng))
            const legal = isLegal(state, seat, action)
            // A repeated ready is accepted as a harmless no-op but not offered.
            const repeatReady = action.type === 'ready' && state.ready[seat]
            if (accepted !== legal && !repeatReady) {
              disagreements.push({ game, phase: state.phase, seat, action, accepted, legal })
            }
            if (legal) options.push([seat, action])
          }
        }
        // Some seat can always act (no deadlock).
        expect(options.length, `no legal action in ${state.phase}`).toBeGreaterThan(0)
        const [seat, action] = options[rng.nextInt(options.length)]!
        state = apply(state, seat, action, rng)
      }
      expect(state.phase).toBe('game_over')
    }
    expect(disagreements.slice(0, 5)).toEqual([])
  })
})

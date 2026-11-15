/**
 * The game state machine: one reducer that owns the whole flow of a game and is the single
 * source of truth for what is legal. Rules: cribbage_rules.md.
 *
 * Players only ever need to act when there is a decision (discard, cut, play, an explicit go,
 * ready). Everything else - the other player playing on after a go, ending a count, the go and
 * last-card points, resets, skipping a player with no cards, the show - happens automatically
 * inside `applyAction`.
 */
import {
  cardId,
  cardIds,
  compareRanks,
  fullDeck,
  isCardId,
  JACK,
  parseCard,
  parseCards,
  sortCards,
  type Card,
  type CardId,
} from './cards'
import { legalPlays, MAX_COUNT, PEG_POINTS, pegItem, scorePlay, type PegItem } from './pegging'
import { shuffle, type Rng } from './rng'
import { scoreHand } from './show'
import {
  WINNING_SCORE,
  type Action,
  type ApplyResult,
  type EngineErrorCode,
  type GameEvent,
  type GameState,
  type Pair,
  type Skunk,
} from './state'
import { otherSeat, type Seat } from './types'

export const HAND_SIZE = 6
export const DISCARD_COUNT = 2

/** A new game waiting in the lobby for its second player. */
export function createGame(): GameState {
  return {
    phase: 'lobby',
    hand: 0,
    dealer: 0,
    scores: [0, 0],
    previousScores: [0, 0],
    firstCut: null,
    deck: [],
    hands: [[], []],
    kept: [[], []],
    discards: [[], []],
    starter: null,
    play: emptyPlay(0),
    show: [],
    ready: [false, false],
    winner: null,
    skunk: null,
  }
}

/**
 * Applies one player's action. Returns the new state and what happened, or an error code for an
 * action that isn't allowed right now. Never mutates `state` and never throws for bad input.
 */
export function applyAction(state: GameState, seat: Seat, action: Action, rng: Rng): ApplyResult {
  if (seat !== 0 && seat !== 1) return { error: 'invalid_action' }
  if (typeof action !== 'object' || action === null) return { error: 'invalid_action' }
  if (state.phase === 'game_over') return { error: 'game_over' }

  // Work on a private deep copy; the caller's state is never touched.
  const s = clone(state)
  const events: GameEvent[] = []
  const error = dispatch(s, seat, action, rng, events)
  return error ? { error } : { state: s, events }
}

function dispatch(
  s: GameState,
  seat: Seat,
  action: Action,
  rng: Rng,
  events: GameEvent[],
): EngineErrorCode | null {
  switch (action.type) {
    case 'start':
      return start(s, rng, events)
    case 'discard':
      return discard(s, seat, action.cards, events)
    case 'cut':
      return cut(s, seat, rng, events)
    case 'play':
      return play(s, seat, action.card, events)
    case 'go':
      return go(s, seat, events)
    case 'ready':
      return ready(s, seat, rng, events)
    default:
      return 'invalid_action'
  }
}

// --- Deal ---------------------------------------------------------------------------------

/** Cut for first deal (low card deals, equal ranks cut again), then deal the first hand. */
function start(s: GameState, rng: Rng, events: GameEvent[]): EngineErrorCode | null {
  if (s.phase !== 'lobby') return 'wrong_phase'
  // Each player cuts a card from the full deck; equal ranks cut again.
  const deck = fullDeck()
  let cuts: Pair<CardId>
  for (;;) {
    const a = deck[rng.nextInt(deck.length)] as Card
    const rest = deck.filter((c) => c !== a)
    const b = rest[rng.nextInt(rest.length)] as Card
    if (compareRanks(a, b) !== 0) {
      cuts = [cardId(a), cardId(b)]
      break
    }
  }
  s.firstCut = cuts
  s.dealer = compareRanks(parseCard(cuts[0]), parseCard(cuts[1])) < 0 ? 0 : 1
  events.push({ type: 'cut_for_deal', cards: cuts, dealer: s.dealer })
  deal(s, rng, events)
  return null
}

/** Shuffles the full deck and deals six cards each, one at a time, starting with the pone. */
function deal(s: GameState, rng: Rng, events: GameEvent[]): void {
  const deck = shuffle(cardIds(fullDeck()), rng)
  const pone = otherSeat(s.dealer)
  const hands: Pair<CardId[]> = [[], []]
  for (let i = 0; i < HAND_SIZE * 2; i++) {
    hands[i % 2 === 0 ? pone : s.dealer].push(deck[i] as CardId)
  }
  s.phase = 'discard'
  s.hand += 1
  s.deck = deck.slice(HAND_SIZE * 2)
  s.hands = [sortIds(hands[0]), sortIds(hands[1])]
  s.kept = [[], []]
  s.discards = [[], []]
  s.starter = null
  s.play = emptyPlay(pone)
  s.show = []
  s.ready = [false, false]
  events.push({ type: 'hand_dealt', hand: s.hand, dealer: s.dealer })
}

function emptyPlay(leader: Seat): GameState['play'] {
  return { count: 0, turn: leader, sequence: [], played: [[], []], goSaid: null }
}

// --- Discard and cut ----------------------------------------------------------------------

function discard(
  s: GameState,
  seat: Seat,
  cards: unknown,
  events: GameEvent[],
): EngineErrorCode | null {
  if (s.phase !== 'discard') return 'wrong_phase'
  if (s.discards[seat].length > 0) return 'already_discarded'
  if (
    !Array.isArray(cards) ||
    cards.length !== DISCARD_COUNT ||
    !cards.every(isCardId) ||
    new Set(cards).size !== DISCARD_COUNT
  ) {
    return 'invalid_action'
  }
  const hand = s.hands[seat]
  if (!cards.every((c) => hand.includes(c))) return 'card_not_in_hand'

  s.discards[seat] = sortIds(cards)
  s.hands[seat] = hand.filter((c) => !cards.includes(c))
  s.kept[seat] = [...s.hands[seat]]
  events.push({ type: 'discarded', seat })

  if (s.discards[0].length > 0 && s.discards[1].length > 0) s.phase = 'cut'
  return null
}

/** The pone cuts; the starter is a random card from the undealt deck. A jack is his heels. */
function cut(s: GameState, seat: Seat, rng: Rng, events: GameEvent[]): EngineErrorCode | null {
  if (s.phase !== 'cut') return 'wrong_phase'
  if (seat !== otherSeat(s.dealer)) return 'not_your_turn'

  const index = rng.nextInt(s.deck.length)
  const starter = s.deck[index] as CardId
  s.deck = s.deck.filter((_, i) => i !== index)
  s.starter = starter
  s.phase = 'play'
  events.push({ type: 'starter_cut', card: starter })

  if (parseCard(starter).rank === JACK) {
    award(s, s.dealer, [pegItem('heels', PEG_POINTS.heels, [parseCard(starter)])], events)
  }
  return null
}

// --- The play -----------------------------------------------------------------------------

function play(
  s: GameState,
  seat: Seat,
  card: unknown,
  events: GameEvent[],
): EngineErrorCode | null {
  if (s.phase !== 'play') return 'wrong_phase'
  if (seat !== s.play.turn) return 'not_your_turn'
  if (!isCardId(card)) return 'invalid_action'
  if (!s.hands[seat].includes(card)) return 'card_not_in_hand'
  if (legalPlays([parseCard(card)], s.play.count).length === 0) return 'illegal_play'

  const { count, items } = scorePlay(
    s.play.sequence.map((p) => parseCard(p.card)),
    parseCard(card),
  )
  s.hands[seat] = s.hands[seat].filter((c) => c !== card)
  s.play.played[seat].push(card)
  s.play.sequence.push({ seat, card })
  s.play.count = count
  events.push({ type: 'card_played', seat, card, count })

  if (items.length > 0 && !award(s, seat, items, events)) return null
  afterPlay(s, seat, events)
  return null
}

function go(s: GameState, seat: Seat, events: GameEvent[]): EngineErrorCode | null {
  if (s.phase !== 'play') return 'wrong_phase'
  if (seat !== s.play.turn) return 'not_your_turn'
  const opponent = otherSeat(seat)
  if (s.hands[seat].length === 0 || s.hands[opponent].length === 0 || s.play.goSaid === opponent) {
    // The engine resolves these by itself, so a go is never needed here.
    return 'go_not_needed'
  }
  if (canPlay(s, seat)) return 'must_play'

  s.play.goSaid = seat
  s.play.turn = opponent
  events.push({ type: 'go', seat })
  // The opponent now plays on for as long as they can.
  settle(s, events)
  return null
}

/** Picks who plays next after `player` laid a card (that didn't win the game). */
function afterPlay(s: GameState, player: Seat, events: GameEvent[]): void {
  // 31 ends the count; its 2 points were the thirty-one item, which replaces the go point.
  if (s.play.count === MAX_COUNT) return endCount(s, events, false)

  // Players alternate, except that after a go the other player keeps playing.
  const opponent = otherSeat(player)
  const opponentPlaysNext = s.hands[opponent].length > 0 && s.play.goSaid !== opponent
  s.play.turn = opponentPlaysNext ? opponent : player
  settle(s, events)
}

/**
 * Resolves everything that needs no decision until a player has to act. The player on turn
 * waits if they can play, or if they are stuck and owe the go (their opponent holds cards and
 * hasn't said go). Otherwise nobody can play and the count ends.
 */
function settle(s: GameState, events: GameEvent[]): void {
  let seat = s.play.turn
  // A player with no cards is skipped.
  if (s.hands[seat].length === 0) seat = otherSeat(seat)
  s.play.turn = seat
  if (s.hands[seat].length === 0) return endCount(s, events)
  if (canPlay(s, seat)) return

  const opponent = otherSeat(seat)
  const goOwed = s.hands[opponent].length > 0 && s.play.goSaid === null
  if (!goOwed) endCount(s, events)
}

/**
 * Ends the current count. Unless the count reached 31 (already scored as thirty-one), the
 * player of its last card scores 1: "go", or "last card" for the final card of the hand.
 * Then the count resets and the player who did not play the last card leads, if they can.
 */
function endCount(s: GameState, events: GameEvent[], awardPoint = true): void {
  const last = s.play.sequence.at(-1) as GameState['play']['sequence'][number]
  const handOver = s.hands[0].length === 0 && s.hands[1].length === 0

  if (awardPoint) {
    const item = handOver
      ? pegItem('last_card', PEG_POINTS.lastCard, [parseCard(last.card)])
      : pegItem('go', PEG_POINTS.go, [parseCard(last.card)])
    if (!award(s, last.seat, [item], events)) return
  }

  if (handOver) return countShow(s, events)

  const leader = s.hands[otherSeat(last.seat)].length > 0 ? otherSeat(last.seat) : last.seat
  s.play.count = 0
  s.play.sequence = []
  s.play.goSaid = null
  s.play.turn = leader
  events.push({ type: 'count_reset', leader })
}

function canPlay(s: GameState, seat: Seat): boolean {
  return legalPlays(parseCards(s.hands[seat]), s.play.count).length > 0
}

// --- The show and the next hand -------------------------------------------------------------

/** Counts the pone's hand, then the dealer's hand, then the crib, stopping at a win. */
function countShow(s: GameState, events: GameEvent[]): void {
  s.phase = 'show'
  const starter = parseCard(s.starter as CardId)
  const pone = otherSeat(s.dealer)
  const counts: [Seat, 'hand' | 'crib', CardId[]][] = [
    [pone, 'hand', s.kept[pone]],
    [s.dealer, 'hand', s.kept[s.dealer]],
    [s.dealer, 'crib', sortIds([...s.discards[0], ...s.discards[1]])],
  ]
  for (const [seat, source, cards] of counts) {
    const { items, total } = scoreHand(parseCards(cards), starter, source === 'crib')
    s.show.push({ seat, source, cards, starter: cardId(starter), items, total })
    const { from, to } = addScore(s, seat, total)
    events.push({
      type: 'show_scored',
      seat,
      source,
      cards,
      starter: cardId(starter),
      items,
      total,
      from,
      to,
    })
    if (to >= WINNING_SCORE) return endGame(s, seat, events)
  }
  events.push({ type: 'hand_complete', hand: s.hand })
}

/** Acknowledges the show. When both players are ready the deal passes and a new hand starts. */
function ready(s: GameState, seat: Seat, rng: Rng, events: GameEvent[]): EngineErrorCode | null {
  if (s.phase !== 'show') return 'wrong_phase'
  s.ready[seat] = true
  if (s.ready[0] && s.ready[1]) {
    s.dealer = otherSeat(s.dealer)
    deal(s, rng, events)
  }
  return null
}

// --- Scoring and winning ------------------------------------------------------------------

/** Pegs points outside the show. Returns false if they won the game (nothing more happens). */
function award(s: GameState, seat: Seat, items: PegItem[], events: GameEvent[]): boolean {
  const points = items.reduce((sum, item) => sum + item.points, 0)
  const { from, to } = addScore(s, seat, points)
  events.push({ type: 'points', seat, items, from, to })
  if (to < WINNING_SCORE) return true
  endGame(s, seat, events)
  return false
}

/** Moves the rear peg in front of the front peg. Scores stop at 121. */
function addScore(s: GameState, seat: Seat, points: number): { from: number; to: number } {
  const from = s.scores[seat]
  const to = Math.min(WINNING_SCORE, from + points)
  if (points > 0) {
    s.previousScores[seat] = from
    s.scores[seat] = to
  }
  return { from, to }
}

function endGame(s: GameState, winner: Seat, events: GameEvent[]): void {
  s.phase = 'game_over'
  s.winner = winner
  s.skunk = skunkLevel(s.scores[otherSeat(winner)])
  events.push({ type: 'game_over', winner, scores: [...s.scores], skunk: s.skunk })
}

/** Skunk is judged on the loser's score at the moment the game ended. */
export function skunkLevel(loserScore: number): Skunk {
  if (loserScore <= 60) return 'double'
  if (loserScore <= 90) return 'skunk'
  return 'none'
}

// --- Helpers ------------------------------------------------------------------------------

function sortIds(ids: readonly CardId[]): CardId[] {
  return cardIds(sortCards(parseCards(ids)))
}

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState
}

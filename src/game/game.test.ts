import { describe, expect, it } from 'vitest'
import { parseCards, scoreHand, type CardId, type GameEvent } from '@shared/engine'
import {
  playerView,
  playMoves,
  seats,
  viewWhen,
  WORKED_EXAMPLE_MOVES,
  workedExample,
} from '@/test/game'
import { cardFace, cardName, cardText } from './cards'
import { narrate } from './narrate'
import { promptFor, seatsToAct } from './prompt'
import { countAloud, numberWord, pointsText } from './showCount'

const TEXT = '︎'

describe('card names', () => {
  it('writes and says every rank and suit', () => {
    expect(cardText('5H')).toBe(`5♥${TEXT}`)
    expect(cardText('TD')).toBe(`10♦${TEXT}`)
    expect(cardName('AS')).toBe('ace of spades')
    expect(cardName('TC')).toBe('10 of clubs')
    expect(cardName('JD')).toBe('jack of diamonds')
    expect(cardName('QH')).toBe('queen of hearts')
    expect(cardName('KC')).toBe('king of clubs')
  })

  it('marks hearts and diamonds red', () => {
    expect((['AC', 'AD', 'AH', 'AS'] as CardId[]).map((c) => cardFace(c).red)).toEqual([
      false,
      true,
      true,
      false,
    ])
  })
})

describe('prompt line', () => {
  const prompt = (
    seat: 0 | 1,
    ...args: Parameters<typeof viewWhen> extends [unknown, ...infer R] ? R : never
  ) => promptFor(viewWhen(seat, ...args), seats(seat), 'active')

  it('asks for the crib cards and names whose crib it is', () => {
    const dealt = (s: { phase: string }) => s.phase === 'discard'
    const view0 = viewWhen(0, dealt)
    const dealer = view0.dealer
    const texts = [0, 1].map((seat) => prompt(seat as 0 | 1, dealt))
    expect(texts[dealer]).toEqual({ text: 'Choose 2 cards for your crib', mine: true })
    expect(texts[dealer === 0 ? 1 : 0]?.text).toBe(
      `Choose 2 cards for ${dealer === 0 ? 'Ada' : 'Sam'}'s crib`,
    )
  })

  it('waits for the other player to discard', () => {
    const oneIn = (s: { phase: string; discards: unknown[][] }) =>
      s.phase === 'discard' && s.discards[0]?.length === 2 && s.discards[1]?.length === 0
    expect(prompt(0, oneIn)).toEqual({ text: 'Waiting for Sam to discard', mine: false })
    expect(prompt(1, oneIn).mine).toBe(true)
  })

  it('tells the pone to cut and the dealer to wait', () => {
    const cut = (s: { phase: string }) => s.phase === 'cut'
    const pone = viewWhen(0, cut).dealer === 0 ? 1 : 0
    expect(prompt(pone, cut)).toEqual({ text: 'Cut the deck', mine: true })
    expect(prompt(pone === 0 ? 1 : 0, cut)).toEqual({
      text: `Waiting for ${pone === 0 ? 'Ada' : 'Sam'} to cut the deck`,
      mine: false,
    })
  })

  it('follows the play of the worked example', () => {
    let state = workedExample()
    const lines: string[] = []
    for (const move of WORKED_EXAMPLE_MOVES) {
      // What the pone (Ada, seat 0) reads before each move.
      lines.push(promptFor(playerView(state, 0), seats(0), 'active').text)
      state = playMoves(state, [move]).state
    }
    expect(lines).toEqual([
      'Your turn — count is 0',
      'Sam is thinking…',
      'Your turn — count is 15',
      'Sam is thinking…',
      'Your turn — count is 25',
      'Sam is thinking…', // Sam is stuck on 28 and must say Go
      'Sam is thinking…', // new count: Sam leads
      'Your turn — count is 9',
      "You're out of cards — Sam plays on",
    ])
    // The dealer's side of the go.
    const stuck = playMoves(workedExample(), WORKED_EXAMPLE_MOVES.slice(0, 5)).state
    expect(promptFor(playerView(stuck, 1), seats(1), 'active')).toEqual({
      text: "You can't play — say Go",
      mine: true,
    })
  })

  it('explains playing on after the opponent said go', () => {
    const afterGo = (s: { phase: string; play: { goSaid: number | null; turn: number } }) =>
      s.phase === 'play' && s.play.goSaid !== null
    const view = viewWhen(0, (s) => afterGo(s) && s.play.goSaid === 1)
    expect(promptFor(view, seats(0), 'active')).toEqual({
      text: `Sam said Go — keep playing. Count is ${view.count}`,
      mine: true,
    })
    const other = viewWhen(1, (s) => afterGo(s) && s.play.goSaid === 1)
    expect(promptFor(other, seats(1), 'active')).toEqual({
      text: 'You said Go — Ada plays on',
      mine: false,
    })
  })

  it('walks both players through the show', () => {
    const shown = (s: { phase: string }) => s.phase === 'show'
    expect(prompt(0, shown)).toEqual({
      text: "Hand counted — press Next hand when you're ready",
      mine: true,
    })
    const oneReady = (s: { phase: string; ready: boolean[] }) =>
      s.phase === 'show' && s.ready[0] === true && s.ready[1] === false
    expect(prompt(0, oneReady)).toEqual({ text: 'Waiting for Sam to be ready', mine: false })
    expect(prompt(1, oneReady)).toEqual({ text: 'Ada is ready — press Next hand', mine: true })
  })

  it('names the winner', () => {
    const over = (s: { phase: string }) => s.phase === 'game_over'
    const view = viewWhen(0, over, { scores: [110, 110] })
    const texts = [0, 1].map((seat) =>
      promptFor(
        viewWhen(seat as 0 | 1, over, { scores: [110, 110] }),
        seats(seat as 0 | 1),
        'finished',
      ),
    )
    expect(texts[view.winner as 0 | 1]).toEqual({ text: 'You won the game!', mine: false })
    expect(texts[view.winner === 0 ? 1 : 0]?.text).toBe(
      `${view.winner === 0 ? 'Ada' : 'Sam'} won the game.`,
    )
  })

  it('says so when the game was ended without a winner', () => {
    const view = viewWhen(0, (s) => s.phase === 'play')
    expect(promptFor(view, seats(0), 'abandoned')).toEqual({
      text: 'This game has ended.',
      mine: false,
    })
  })

  it('knows who the game is waiting for', () => {
    const discard = viewWhen(0, (s) => s.phase === 'discard')
    expect(seatsToAct(discard)).toEqual([0, 1])
    const oneIn = viewWhen(0, (s) => s.phase === 'discard' && s.discards[0].length === 2)
    expect(seatsToAct(oneIn)).toEqual([1])
    const cut = viewWhen(0, (s) => s.phase === 'cut')
    expect(seatsToAct(cut)).toEqual([cut.dealer === 0 ? 1 : 0])
    const play = viewWhen(0, (s) => s.phase === 'play')
    expect(seatsToAct(play)).toEqual([play.turn])
    expect(seatsToAct(viewWhen(0, (s) => s.phase === 'show'))).toEqual([0, 1])
    expect(seatsToAct(viewWhen(0, (s) => s.phase === 'game_over'))).toEqual([])
  })
})

describe('what just happened', () => {
  const text = (events: GameEvent[], me: 0 | 1 = 0) => narrate(events, seats(me)).map((l) => l.text)
  const c = cardText

  it('tells the play of the worked example, one line per move', () => {
    const { events } = playMoves(workedExample(), WORKED_EXAMPLE_MOVES)
    expect(text(events)).toEqual([
      `You played ${c('7S')} — count 7.`,
      `Sam played ${c('8C')} — count 15. Fifteen for 2.`,
      `You played ${c('8D')} — count 23. A pair for 2.`,
      `Sam played ${c('2S')} — count 25.`,
      `You played ${c('3C')} — count 28.`,
      'Sam said Go. You scored 1 for the go. New count — Sam leads.',
      `Sam played ${c('9H')} — count 9.`,
      `You played ${c('KH')} — count 19.`,
      `Sam played ${c('QD')} — count 29. Last card for 1.`,
    ])
    // The same hand from the dealer's chair.
    expect(text(events, 1).slice(5, 7)).toEqual([
      'You said Go. Ada scored 1 for the go. New count — you lead.',
      `You played ${c('9H')} — count 9.`,
    ])
  })

  it('keeps a line id stable as the hand goes on', () => {
    const { events } = playMoves(workedExample(), WORKED_EXAMPLE_MOVES)
    const early = narrate(events.slice(0, 4), seats(0))
    const late = narrate(events, seats(0))
    expect(late.slice(0, early.length - 1)).toEqual(early.slice(0, -1))
  })

  it('names several scores made by one card, and thirty-one', () => {
    const events: GameEvent[] = [
      { type: 'card_played', seat: 1, card: '6D', count: 15 },
      {
        type: 'points',
        seat: 1,
        from: 0,
        to: 5,
        items: [
          { kind: 'fifteen', points: 2, cards: ['4H', '5S', '6D'] },
          { kind: 'run', points: 3, cards: ['4H', '5S', '6D'] },
        ],
      },
      { type: 'card_played', seat: 0, card: '7H', count: 31 },
      {
        type: 'points',
        seat: 0,
        from: 0,
        to: 8,
        items: [
          { kind: 'thirtyone', points: 2, cards: ['7H'] },
          { kind: 'pair', points: 6, cards: ['7C', '7D', '7H'] },
        ],
      },
      { type: 'count_reset', leader: 1 },
    ]
    expect(text(events)).toEqual([
      `Sam played ${c('6D')} — count 15. Fifteen for 2, a run of 3 for 3.`,
      `You played ${c('7H')} — count 31. Thirty-one for 2, three of a kind for 6. New count — Sam leads.`,
    ])
  })

  it('announces the cut for deal, the starter, his heels and later deals', () => {
    const events: GameEvent[] = [
      { type: 'cut_for_deal', cards: ['4C', 'KD'], dealer: 0 },
      { type: 'hand_dealt', hand: 1, dealer: 0 },
      { type: 'discarded', seat: 0 },
      { type: 'discarded', seat: 1 },
      { type: 'starter_cut', card: 'JH' },
      {
        type: 'points',
        seat: 0,
        from: 0,
        to: 2,
        items: [{ kind: 'heels', points: 2, cards: ['JH'] }],
      },
    ]
    expect(text(events)).toEqual([
      `Cut for first deal: you drew ${c('4C')}, Sam drew ${c('KD')}. You deal first.`,
      `The starter is ${c('JH')}. You scored 2 for his heels.`,
    ])
    expect(text(events, 1)).toEqual([
      `Cut for first deal: you drew ${c('KD')}, Ada drew ${c('4C')}. Ada deals first.`,
      `The starter is ${c('JH')}. Ada scored 2 for his heels.`,
    ])
    expect(text([{ type: 'hand_dealt', hand: 2, dealer: 1 }])).toEqual(['Hand 2: Sam deals.'])
    expect(text([{ type: 'hand_dealt', hand: 3, dealer: 0 }])).toEqual(['Hand 3: you deal.'])
  })

  it('leaves the show and the result to their own panels', () => {
    const { events } = playMoves(workedExample(), WORKED_EXAMPLE_MOVES)
    const kinds = events.map((e) => e.type)
    expect(kinds).toContain('show_scored')
    expect(text(events).join(' ')).not.toMatch(/show|hand counted/i)
  })
})

describe('counting a hand aloud', () => {
  const count = (hand: CardId[], starter: CardId, crib = false) =>
    countAloud(scoreHand(parseCards(hand), parseCards([starter])[0]!, crib)).map((l) => l.phrase)

  it('counts the hands of the worked example the traditional way', () => {
    expect(count(['7S', '8D', 'KH', '3C'], '5H')).toEqual([
      'Fifteen two',
      'Fifteen four',
      'Fifteen six',
    ])
    expect(count(['8C', '9H', 'QD', '2S'], '5H')).toEqual(['Fifteen two', 'Fifteen four'])
    expect(count(['4D', '6S', 'JH', 'AC'], '5H', true)).toEqual([
      'Fifteen two',
      'Fifteen four',
      'Fifteen six',
      'Run of three is nine',
      'His nobs is ten',
    ])
  })

  it('counts the 29 hand up to twenty-nine', () => {
    const phrases = count(['5H', '5D', '5S', 'JC'], '5C')
    expect(phrases).toHaveLength(15)
    expect(phrases.slice(0, 8).at(-1)).toBe('Fifteen sixteen')
    expect(phrases.slice(8, 14)).toEqual([
      'Pair is eighteen',
      'Pair is twenty',
      'Pair is twenty-two',
      'Pair is twenty-four',
      'Pair is twenty-six',
      'Pair is twenty-eight',
    ])
    expect(phrases.at(-1)).toBe('His nobs is twenty-nine')
  })

  it('counts pairs, runs and flushes with their running total and cards', () => {
    expect(count(['7H', '7D', '8S', '8C'], '9D').at(-1)).toBe('Run of three is twenty-four')
    expect(count(['2H', '6H', '9H', 'KH'], '3S')).toEqual([
      'Fifteen two',
      'Fifteen four',
      'Flush of four is eight',
    ])
    expect(count(['2H', '6H', '9H', 'KH'], '3H', true).at(-1)).toBe('Flush of five is nine')
    const lines = countAloud(
      scoreHand(parseCards(['3H', '4D', '4S', '5C']), parseCards(['KD'])[0]!, false),
    )
    // K+5 is fifteen, then the pair of fours, then the two runs of three.
    expect(lines.map((l) => [l.phrase, l.points, l.running])).toEqual([
      ['Fifteen two', 2, 2],
      ['Pair is four', 2, 4],
      ['Run of three is seven', 3, 7],
      ['Run of three is ten', 3, 10],
    ])
    expect(lines[1]?.cards).toEqual(['4D', '4S'])
  })

  it('has nothing to count in a hand worth zero', () => {
    expect(count(['2C', '4D', '6H', '8S'], 'KC')).toEqual([])
    expect(pointsText(0)).toBe('No points')
    expect(pointsText(1)).toBe('1 point')
    expect(pointsText(12)).toBe('12 points')
  })

  it('writes numbers as words', () => {
    expect([0, 1, 12, 19, 20, 21, 29, 30].map(numberWord)).toEqual([
      'zero',
      'one',
      'twelve',
      'nineteen',
      'twenty',
      'twenty-one',
      'twenty-nine',
      'thirty',
    ])
  })
})

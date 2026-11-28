import { describe, expect, it } from 'vitest'
import type { CardId, PlayerView } from '@shared/protocol'
import { playerView, viewWhen, workedExample } from '@/test/game'
import { canUseCard, handCardState, tapCard } from './handInput'

const discarding = (seat: 0 | 1) => viewWhen(seat, (s) => s.phase === 'discard')

describe('hand input', () => {
  it('lets a player pick two cards for the crib, then blocks the rest', () => {
    const view = discarding(0)
    const [a, b, c] = view.myHand as [CardId, CardId, CardId]
    expect(handCardState(view, [], false, a)).toBe('usable')
    expect(tapCard(view, [], false, a)).toEqual({ select: [a] })
    expect(tapCard(view, [a], false, b)).toEqual({ select: [a, b] })
    // Two picked: the others are blocked, a picked one can be put back.
    expect(handCardState(view, [a, b], false, c)).toBe('blocked')
    expect(tapCard(view, [a, b], false, c)).toBeNull()
    expect(handCardState(view, [a, b], false, a)).toBe('selected')
    expect(tapCard(view, [a, b], false, a)).toEqual({ select: [b] })
  })

  it('offers only the playable cards on this player’s turn in the play', () => {
    const view = playerView(workedExample(), 0)
    expect(view.legal.playable).toEqual(['3C', '7S', '8D', 'KH'])
    expect(tapCard(view, [], false, '7S')).toEqual({ play: '7S' })
    // Not the other seat's turn: every card idle, nothing to tap.
    const other = playerView(workedExample(), 1)
    for (const card of other.myHand) {
      expect(handCardState(other, [], false, card)).toBe('idle')
      expect(tapCard(other, [], false, card)).toBeNull()
    }
  })

  it('blocks cards that would go past 31', () => {
    const view: PlayerView = {
      ...playerView(workedExample(), 0),
      legal: { discard: false, cut: false, playable: ['3C'], go: false, ready: false },
    }
    expect(handCardState(view, [], false, 'KH')).toBe('blocked')
    expect(tapCard(view, [], false, 'KH')).toBeNull()
    expect(handCardState(view, [], false, '3C')).toBe('usable')
  })

  it('takes nothing while busy, and keeps picked cards marked', () => {
    const view = discarding(0)
    const [a, b] = view.myHand as [CardId, CardId]
    expect(handCardState(view, [a], true, a)).toBe('selected')
    expect(handCardState(view, [a], true, b)).toBe('idle')
    expect(canUseCard('selected', true)).toBe(false)
    expect(tapCard(view, [a], true, a)).toBeNull()
    expect(tapCard(view, [a], true, b)).toBeNull()
    const playing = playerView(workedExample(), 0)
    expect(handCardState(playing, [], true, '7S')).toBe('idle')
    expect(tapCard(playing, [], true, '7S')).toBeNull()
  })

  it('ignores a card that is not in the hand', () => {
    const view = playerView(workedExample(), 0)
    expect(tapCard(view, [], false, 'AS')).toBeNull()
  })
})

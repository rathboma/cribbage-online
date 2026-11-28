/**
 * What a player can do with the cards in their hand right now, and what tapping one does. Both
 * tables use this, the simple one and the 3D one, so they offer exactly the same moves: only
 * what `view.legal` allows. Nothing here sends anything; the game screen does that.
 */
import { DISCARD_COUNT } from '@shared/engine'
import type { CardId, PlayerView } from '@shared/protocol'

/**
 * idle: nothing to do with it now. usable: can be picked or played. selected: picked for the
 * crib. blocked: it's this player's move, but not with this card.
 */
export type HandCardState = 'idle' | 'usable' | 'selected' | 'blocked'

/** It is this player's turn in the play (with a card to lay, or stuck and owing a go). */
function onTurn(view: PlayerView): boolean {
  return view.phase === 'play' && (view.legal.playable.length > 0 || view.legal.go)
}

/**
 * The state of `card` in this player's hand. While `busy` (a move is on its way, or the hand
 * has just changed) nothing can be used: that is how a tap shows it was taken.
 */
export function handCardState(
  view: PlayerView,
  selected: readonly CardId[],
  busy: boolean,
  card: CardId,
): HandCardState {
  if (view.legal.discard) {
    if (selected.includes(card)) return 'selected'
    if (busy) return 'idle'
    return selected.length >= DISCARD_COUNT ? 'blocked' : 'usable'
  }
  if (onTurn(view) && !busy) return view.legal.playable.includes(card) ? 'usable' : 'blocked'
  return 'idle'
}

/** Whether tapping a card in this state does anything. */
export function canUseCard(state: HandCardState, busy: boolean): boolean {
  return !busy && (state === 'usable' || state === 'selected')
}

/** What tapping a card asks for: lay it, or a new set of cards picked for the crib. */
export type HandTap = { play: CardId } | { select: CardId[] }

/** What tapping `card` does, or null if it can't be used now. */
export function tapCard(
  view: PlayerView,
  selected: readonly CardId[],
  busy: boolean,
  card: CardId,
): HandTap | null {
  if (!view.myHand.includes(card)) return null
  if (!canUseCard(handCardState(view, selected, busy, card), busy)) return null
  if (!view.legal.discard) return { play: card }
  return selected.includes(card)
    ? { select: selected.filter((c) => c !== card) }
    : { select: [...selected, card] }
}

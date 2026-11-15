/** Human-readable messages for the engine's error codes, sent with 422 responses. */
import type { EngineErrorCode } from '../shared/engine'

export const ENGINE_ERROR_MESSAGES: Record<EngineErrorCode, string> = {
  wrong_phase: "That move isn't possible at this stage of the hand.",
  not_your_turn: "It's not your turn.",
  card_not_in_hand: "You don't hold that card.",
  illegal_play: 'That card would take the count past 31.',
  must_play: "You have a card you can play, so you can't say go.",
  go_not_needed: "There's no need to say go.",
  already_discarded: "You've already put your cards in the crib.",
  game_over: 'The game is over.',
  invalid_action: "That isn't a valid move.",
}

import type { CardId } from '@shared/engine/cards'
import type { PlayerView } from '@shared/engine/view'
import { otherSeat, type Seat } from '@shared/engine/types'
import { DISCARD_COUNT, HAND_SIZE } from '@shared/engine/game'
import { CARD_HEIGHT, CARD_THICKNESS, CARD_WIDTH } from './CardMesh'
import { fitFrame, insetsOf, type Insets, type TableRect, type Viewport } from './camera'

/**
 * The layout engine: where every card belongs on the table for a PlayerView, at a given canvas
 * size. `computeLayout` is a pure function of the view, the viewport and the cards picked for
 * the crib; it knows nothing of meshes, renderers or the DOM. `applyLayout` (applyLayout.ts)
 * puts meshes where it says, and the animation director (P4.5) will move them there instead.
 *
 * Identity: every target has a `key`, and a card keeps its key, and so its mesh, as it moves
 * between zones. A card this player can see is keyed by hand number and card ("3:5H"), so it
 * goes from hand to play area to the show as one mesh. A card they can't see is keyed by slot
 * ("3:opp-2", "3:crib-opp-0"); when it is revealed it comes back under its card's key with the
 * slots it may have been in listed in `from`, and the mesh of whichever of those slots has just
 * gone is reused. A new hand starts with new keys: its cards are freshly dealt.
 *
 * Two arrangements, chosen by whichever gives this player's hand the most room on screen:
 * `portrait` stacks everything down a narrow table (phones held upright), `landscape` puts the
 * deck and crib to the right of the play and the board to its left. Either one widens to fill a
 * screen wider than it needs, and the hand spreads out into the extra room.
 */

export type LayoutMode = 'portrait' | 'landscape'

export type Zone =
  | 'deck'
  | 'starter'
  | 'my-hand'
  | 'opponent-hand'
  | 'crib'
  | 'my-played'
  | 'opponent-played'
  /** The hand or crib being counted, spread out next to the starter. */
  | 'show'

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Where one card goes. Position and rotation are in table space (see TableScene). */
export interface CardTarget {
  key: string
  /** The card's face, or null for a card this player hasn't seen. */
  face: CardId | null
  faceUp: boolean
  zone: Zone
  /** The centre of the card. */
  position: Vec3
  /** Euler angles in radians (XYZ order), applied to the card lying flat, art away from you. */
  rotation: Vec3
  /** Uniform size; 1 is a table card (CARD_WIDTH wide). */
  scale: number
  /**
   * How many cards this one stands for, stacked: the deck is drawn as one block this many
   * cards thick. 1 for every real card.
   */
  stack: number
  /** Slot keys this card may have been tracked under before it was revealed. */
  from?: string[]
}

export interface Layout {
  mode: LayoutMode
  /** The part of the table the camera keeps in view. */
  frame: TableRect
  /** The parts of the canvas the camera keeps the frame out of (from the viewport). */
  insets: Insets
  /** Kept clear of cards for the cribbage board (P4.6), lengthwise along its longer side. */
  board: TableRect
  cards: CardTarget[]
}

export interface LayoutOptions {
  /** Cards picked for the crib, shown raised in the hand. */
  selected?: readonly CardId[]
  /**
   * How many of the show's counts are on screen: the server counts both hands and the crib at
   * once, and the animation director presents them one at a time. The last one shown is spread
   * out; the crib is turned over only once its count is shown. All of them by default.
   */
  showStep?: number
  /**
   * The arrangement on screen now. The other one is taken only if it is clearly better, so a
   * canvas whose shape hovers near the boundary (a panel opening, say) doesn't make the whole
   * table jump back and forth.
   */
  previousMode?: LayoutMode
}

/** How much more room the other arrangement must give the hand before the table changes to it. */
const SWITCH_MARGIN = 1.12

/** A deck block is this many times as thick per card as CARD_THICKNESS (real cards are thin). */
export const DECK_THICKNESS_PER_CARD = 0.5
/** Fully dealt: 52 cards less two hands of six. */
const DECK_AFTER_DEAL = 52 - 2 * HAND_SIZE

/** Height above the card below, per card in a pile or overlapping row, as a share of its thickness. */
const STACK_GAP = 1.25

interface FanSpec {
  x: number
  z: number
  scale: number
  /** Centre to centre, at most. */
  spacing: number
  /** The whole fan is never wider than this, however much room there is. */
  maxWidth: number
}

/** Kept between a fan and the edge of the frame. */
const FAN_EDGE = 0.3

interface RowSpec {
  /** The centre of the row of four. */
  x: number
  z: number
  scale: number
  spacing: number
}

interface Arrangement {
  mode: LayoutMode
  frame: TableRect
  board: TableRect
  myHand: FanSpec
  opponentHand: FanSpec
  deck: { x: number; z: number }
  /** By whose crib it is: this player's (near) or the opponent's (far). */
  crib: { mine: { x: number; z: number }; theirs: { x: number; z: number } }
  played: { mine: RowSpec; theirs: RowSpec }
  /** In the show the hands are empty, so the laid cards move back where the hands were. */
  showRows: { mine: RowSpec; theirs: RowSpec }
  showSpread: RowSpec
}

/**
 * Portrait, top to bottom: the opponent's hand, the board across the table, the opponent's
 * laid cards, this player's laid cards, this player's hand. Deck and crib in a column on the
 * right, the crib on the dealer's side.
 */
const PORTRAIT: Arrangement = {
  mode: 'portrait',
  frame: { x: 0, z: 0, width: 6.6, depth: 10.7 },
  board: { x: 0, z: -3.2, width: 6, depth: 1.1 },
  opponentHand: { x: 0, z: -4.55, scale: 0.75, spacing: 0.42, maxWidth: 3 },
  myHand: { x: 0, z: 4.15, scale: 1.2, spacing: 1.2, maxWidth: 7.2 },
  deck: { x: 2.35, z: 0 },
  crib: { mine: { x: 2.35, z: 1.75 }, theirs: { x: 2.35, z: -1.75 } },
  played: {
    mine: { x: -0.9, z: 1.05, scale: 1, spacing: 0.55 },
    theirs: { x: -0.9, z: -1.05, scale: 1, spacing: 0.55 },
  },
  showRows: {
    mine: { x: -0.4, z: 4.15, scale: 1.1, spacing: 1.15 },
    theirs: { x: -0.4, z: -4.45, scale: 0.9, spacing: 0.95 },
  },
  showSpread: { x: -0.75, z: 0, scale: 1.15, spacing: 0.75 },
}

/**
 * Landscape: the hands along the near and far edges and the play between them, the deck and
 * crib to the right, and the board standing lengthwise on the left.
 */
const LANDSCAPE: Arrangement = {
  mode: 'landscape',
  frame: { x: 0, z: 0, width: 11.4, depth: 7.8 },
  board: { x: -4.8, z: 0, width: 1.4, depth: 6 },
  opponentHand: { x: 0, z: -3.1, scale: 0.75, spacing: 0.42, maxWidth: 3 },
  // Never wider than the gap between the board and the crib piles.
  myHand: { x: 0, z: 2.8, scale: 1.15, spacing: 1.05, maxWidth: 7.6 },
  deck: { x: 4.6, z: 0 },
  crib: { mine: { x: 4.6, z: 1.75 }, theirs: { x: 4.6, z: -1.75 } },
  played: {
    mine: { x: 0, z: 0.95, scale: 1, spacing: 0.55 },
    theirs: { x: 0, z: -0.95, scale: 1, spacing: 0.55 },
  },
  showRows: {
    mine: { x: 0, z: 2.8, scale: 1.05, spacing: 1.1 },
    theirs: { x: 0, z: -3.0, scale: 0.9, spacing: 0.95 },
  },
  showSpread: { x: 0, z: 0, scale: 1.15, spacing: 0.9 },
}

/** Fan angle between neighbouring cards in a hand, radians. */
const FAN_ANGLE = 0.045
/** How far the outer cards of a fan drop back, per (card index from the middle)². */
const FAN_ARC = 0.025
/** How far a card picked for the crib rises out of the hand, as a share of its height. */
const RAISE = 0.26
/** A slight, fixed jumble for the cards in the crib, so it reads as a pile. */
const PILE_TWIST = [0.06, -0.05, 0.035, -0.02]

const ZERO: Vec3 = { x: 0, y: 0, z: 0 }

/** An arrangement fitted to a viewport: widened to fill it, with the room the hand has. */
interface Fitted {
  arrangement: Arrangement
  frame: TableRect
  /** How wide this player's hand may fan. */
  handWidth: number
  /** Centre to centre between the cards of a full hand, as it appears on screen (any unit). */
  room: number
}

function fit(arrangement: Arrangement, viewport: Viewport): Fitted {
  const { distance, widest } = fitFrame(arrangement.frame, viewport)
  const frame = { ...arrangement.frame, width: widest }
  const spec = arrangement.myHand
  const handWidth = Math.min(spec.maxWidth, frame.width - 2 * FAN_EDGE)
  const spacing = fanSpacing(spec, handWidth, HAND_SIZE)
  // On screen, sizes on the table go as one over the distance (the field of view is fixed).
  return { arrangement, frame, handWidth, room: spacing / distance }
}

/** The arrangement that gives this player's hand the most room in `viewport`. */
export function chooseArrangement(viewport: Viewport, previousMode?: LayoutMode): Fitted {
  if (!(viewport.width > 0 && viewport.height > 0)) {
    const frame = { ...PORTRAIT.frame }
    return { arrangement: PORTRAIT, frame, handWidth: frame.width - 2 * FAN_EDGE, room: 0 }
  }
  const portrait = fit(PORTRAIT, viewport)
  const landscape = fit(LANDSCAPE, viewport)
  const bias = (mode: LayoutMode) => (mode === previousMode ? SWITCH_MARGIN : 1)
  return landscape.room * bias('landscape') > portrait.room * bias('portrait')
    ? landscape
    : portrait
}

/** Where every card in `view` goes on a table drawn at `viewport`. */
export function computeLayout(
  view: PlayerView,
  viewport: Viewport,
  options: LayoutOptions = {},
): Layout {
  const fitted = chooseArrangement(viewport, options.previousMode)
  const a = fitted.arrangement
  const me = view.seat
  const opponent = otherSeat(me)
  const hand = view.hand
  const cards: CardTarget[] = []
  const known = (card: CardId) => `${hand}:${card}`
  const opponentSlot = (i: number) => `${hand}:opp-${i}`
  const cribSlot = (i: number) => `${hand}:crib-opp-${i}`
  const selected = new Set(options.selected ?? [])

  const add = (target: Omit<CardTarget, 'stack' | 'rotation'> & Partial<CardTarget>) =>
    cards.push({ rotation: { ...ZERO }, stack: 1, ...target })

  // The deck: one block, as thick as the cards left in it.
  const deckCount = hand === 0 ? 52 : view.starter === null ? DECK_AFTER_DEAL : DECK_AFTER_DEAL - 1
  const deckHeight = deckCount * CARD_THICKNESS * DECK_THICKNESS_PER_CARD
  add({
    key: 'deck',
    face: null,
    faceUp: false,
    zone: 'deck',
    position: { x: a.deck.x, y: deckHeight / 2, z: a.deck.z },
    scale: 1,
    stack: deckCount * DECK_THICKNESS_PER_CARD,
  })

  // The counts on screen so far: all of them unless the director is stepping through.
  const step = Math.max(0, Math.min(view.show.length, options.showStep ?? view.show.length))
  const shown = view.show.slice(0, step)
  const inShow = shown.length > 0
  const counting = inShow ? shown[shown.length - 1]! : null

  // The hand or crib being counted: the starter first, then its cards, across the middle.
  const spread = new Map<CardId, number>()
  if (counting) {
    if (view.starter) spread.set(view.starter, 0)
    counting.cards.forEach((card, i) => spread.set(card, i + 1))
  }
  const spreadTarget = (card: CardId, index: number, from?: string[]): CardTarget => {
    const spec = a.showSpread
    const count = (counting?.cards.length ?? 0) + 1
    return {
      key: known(card),
      face: card,
      faceUp: true,
      zone: 'show',
      position: {
        x: spec.x + (index - (count - 1) / 2) * spec.spacing,
        y: stackY(spec.scale, index),
        z: spec.z,
      },
      rotation: { ...ZERO },
      scale: spec.scale,
      stack: 1,
      ...(from ? { from } : {}),
    }
  }

  // The starter, face up on the deck once cut (or in the spread while a hand is counted).
  if (view.starter) {
    const index = spread.get(view.starter)
    if (index !== undefined) cards.push(spreadTarget(view.starter, index))
    else {
      add({
        key: known(view.starter),
        face: view.starter,
        faceUp: true,
        zone: 'starter',
        position: { x: a.deck.x, y: deckHeight + CARD_THICKNESS / 2, z: a.deck.z },
        scale: 1,
      })
    }
  }

  // This player's hand: face up, fanned along the near edge, picked cards raised.
  fan(a.myHand, fitted.handWidth, view.myHand.length, false).forEach((place, i) => {
    const card = view.myHand[i]!
    const raised = selected.has(card)
    add({
      key: known(card),
      face: card,
      faceUp: true,
      zone: 'my-hand',
      position: {
        x: place.x,
        y: place.y,
        // Slid away from the player, still under the card to its right, as in a real hand.
        z: place.z - (raised ? RAISE * CARD_HEIGHT * a.myHand.scale : 0),
      },
      rotation: { x: 0, y: place.yaw, z: 0 },
      scale: a.myHand.scale,
    })
  })

  // The opponent's hand: face down along the far edge, by slot.
  const theirs = a.opponentHand
  fan(theirs, theirs.maxWidth, view.opponentHandCount, true).forEach((place, i) => {
    add({
      key: opponentSlot(i),
      face: null,
      faceUp: false,
      zone: 'opponent-hand',
      position: { x: place.x, y: place.y, z: place.z },
      rotation: { x: 0, y: place.yaw, z: 0 },
      scale: a.opponentHand.scale,
    })
  })
  // Any slot the opponent's hand has held this hand: where a card they reveal came from.
  const opponentSlots = Array.from({ length: HAND_SIZE }, (_, i) => opponentSlot(HAND_SIZE - 1 - i))

  // The crib, on the dealer's side: face down, until it is counted.
  const cribAt = view.dealer === me ? a.crib.mine : a.crib.theirs
  const cribSlots = [cribSlot(0), cribSlot(1)]
  // Turned over once its count is on screen (the view has its cards from when it is counted).
  const cribShown = shown.find((r) => r.source === 'crib')?.cards ?? null
  const cribCards: { key: string; face: CardId | null; from?: string[] }[] = []
  if (cribShown) {
    const mine = new Set(view.myDiscards)
    // This player's two first, as they were in the pile, then the opponent's.
    const ordered = [
      ...cribShown.filter((c) => mine.has(c)),
      ...cribShown.filter((c) => !mine.has(c)),
    ]
    for (const card of ordered) {
      cribCards.push({
        key: known(card),
        face: card,
        ...(mine.has(card) ? {} : { from: [...cribSlots, ...opponentSlots] }),
      })
    }
  } else {
    for (const card of view.myDiscards) cribCards.push({ key: known(card), face: card })
    const hidden = Math.max(0, view.cribCount - view.myDiscards.length)
    for (let i = 0; i < hidden; i++)
      cribCards.push({ key: cribSlot(i), face: null, from: opponentSlots })
  }
  cribCards.forEach((card, i) => {
    const index = card.face ? spread.get(card.face) : undefined
    if (index !== undefined && counting?.source === 'crib') {
      cards.push(spreadTarget(card.face!, index, card.from))
      return
    }
    add({
      ...card,
      faceUp: false,
      zone: 'crib',
      position: { x: cribAt.x, y: stackY(1, i), z: cribAt.z },
      rotation: { x: 0, y: PILE_TWIST[i % PILE_TWIST.length]!, z: 0 },
      scale: 1,
    })
  })

  // Laid cards, each player's on their own side, overlapping in the order they were laid.
  // In the play, cards from earlier counts lie face down; in the show every card is face up,
  // back where its owner's hand was, unless it is in the hand being counted.
  const current = new Set(view.sequence.map((p) => p.card))
  for (const seat of [opponent, me] as Seat[]) {
    const mine = seat === me
    const row = inShow
      ? mine
        ? a.showRows.mine
        : a.showRows.theirs
      : mine
        ? a.played.mine
        : a.played.theirs
    const laid = view.played[seat]
    const from = mine ? undefined : opponentSlots
    laid.forEach((card, i) => {
      const counted = counting?.source === 'hand' && counting.seat === seat
      const index = counted ? spread.get(card) : undefined
      if (index !== undefined) {
        cards.push(spreadTarget(card, index, from))
        return
      }
      add({
        key: known(card),
        face: card,
        faceUp: inShow || current.has(card),
        zone: mine ? 'my-played' : 'opponent-played',
        position: {
          // Laid left to right from the row's left end, so cards don't shift as more are laid.
          x: row.x + (i - (HAND_SIZE - DISCARD_COUNT - 1) / 2) * row.spacing,
          y: stackY(row.scale, i),
          z: row.z,
        },
        scale: row.scale,
        ...(from ? { from } : {}),
      })
    })
  }

  return {
    mode: a.mode,
    frame: fitted.frame,
    insets: insetsOf(viewport),
    board: { ...a.board },
    cards,
  }
}

/** Centre to centre between `count` cards fanned no wider than `width`. */
function fanSpacing(spec: FanSpec, width: number, count: number): number {
  if (count < 2) return 0
  return Math.max(0, Math.min(spec.spacing, (width - CARD_WIDTH * spec.scale) / (count - 1)))
}

/** The height of the centre of the `index`th card (from the bottom) in a pile or overlap. */
function stackY(scale: number, index: number): number {
  const thickness = CARD_THICKNESS * scale
  return thickness / 2 + index * thickness * STACK_GAP
}

/**
 * Places for `count` cards fanned like a held hand: centred on the spec, the outer cards
 * turned out and dropped back a little, each card on top of the one to its left. The far
 * (opponent's) fan is turned round to face them.
 */
function fan(
  spec: FanSpec,
  width: number,
  count: number,
  far: boolean,
): { x: number; y: number; z: number; yaw: number }[] {
  if (count === 0) return []
  const spacing = fanSpacing(spec, width, count)
  const middle = (count - 1) / 2
  return Array.from({ length: count }, (_, i) => {
    const offset = i - middle
    const side = far ? -1 : 1
    return {
      // The far fan runs right to left, so its first card is on the opponent's left.
      x: spec.x + side * offset * spacing,
      y: stackY(spec.scale, i),
      z: spec.z + side * FAN_ARC * offset * offset * spec.scale,
      yaw: (far ? Math.PI : 0) - offset * FAN_ANGLE,
    }
  })
}

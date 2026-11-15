/**
 * Runtime validation of request bodies and queries, for the server. Kept apart from types.ts so
 * the client can import the protocol types without bundling zod (lint enforces this).
 */
import { z } from 'zod'
import { isCardId, type CardId } from '../engine/cards'
import { parseGameCode } from './gameCode'
import { parsePlayerName, PLAYER_NAME_MAX_LENGTH } from './names'
import type {
  ActionRequest,
  ClientAction,
  CreateGameRequest,
  JoinGameRequest,
  SyncQuery,
} from './types'

/** A player name: trimmed, 1 to 20 characters. Outputs the normalized name. */
export const playerNameSchema = z.string().transform((input, ctx) => {
  const name = parsePlayerName(input)
  if (name === null) {
    ctx.addIssue({
      code: 'custom',
      message: `Names are 1 to ${PLAYER_NAME_MAX_LENGTH} characters.`,
    })
    return z.NEVER
  }
  return name
})

/** A game code, case-insensitive with optional spaces or dashes. Outputs the canonical code. */
export const gameCodeSchema = z.string().transform((input, ctx) => {
  const code = parseGameCode(input)
  if (code === null) {
    ctx.addIssue({ code: 'custom', message: 'Game codes are 5 letters, like BCDFG.' })
    return z.NEVER
  }
  return code
})

export const cardIdSchema = z.custom<CardId>((value) => isCardId(value), {
  message: 'Not a card.',
})

/** A non-negative whole number, as JSON or (with `coerce`) from a query string. */
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const queryCounter = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const createGameRequestSchema = z.strictObject({
  name: playerNameSchema,
  chatOn: z.boolean(),
  videoOn: z.boolean(),
}) satisfies z.ZodType<CreateGameRequest>

export const joinGameRequestSchema = z.strictObject({
  name: playerNameSchema,
  chatOn: z.boolean().optional(),
  videoOn: z.boolean().optional(),
}) satisfies z.ZodType<JoinGameRequest>

export const syncQuerySchema = z.strictObject({
  cursor: queryCounter.optional(),
  v: queryCounter.optional(),
}) satisfies z.ZodType<SyncQuery>

export const clientActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('discard'), cards: z.tuple([cardIdSchema, cardIdSchema]) }),
  z.strictObject({ type: z.literal('cut') }),
  z.strictObject({ type: z.literal('play'), card: cardIdSchema }),
  z.strictObject({ type: z.literal('go') }),
  z.strictObject({ type: z.literal('ready') }),
]) satisfies z.ZodType<ClientAction>

export const actionRequestSchema = z.strictObject({
  action: clientActionSchema,
  hand: counter,
  cursor: counter,
  v: counter,
}) satisfies z.ZodType<ActionRequest>

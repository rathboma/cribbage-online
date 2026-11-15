/**
 * The single entry point for the client/server contract, used by both src/ and server/.
 * It has no runtime dependencies beyond small input helpers: request validation (zod) lives in
 * ./schemas, which only the server imports.
 */
export type {
  Action,
  CardId,
  EngineErrorCode,
  GameEvent,
  GameEventType,
  Pair,
  Phase,
  PlayedCard,
  Seat,
  ShowSource,
  Skunk,
} from '../engine'
export type { PegItem, PegKind } from '../engine/pegging'
export type { ScoreBreakdown, ScoreItem, ScoreKind } from '../engine/show'
export type { LegalActions, PlayerView, ShowView } from '../engine/view'
export * from './types'
export * from './gameCode'
export * from './names'
export { PROTOCOL_VERSION } from '../version'

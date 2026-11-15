/**
 * Remembering who you are in a game: the player token handed out once by create/join, kept in
 * localStorage per game code. The token can't be recovered, so a session is only forgotten when
 * the server says the game or the seat is gone - never because it is old.
 */
import type { Seat } from '@shared/protocol'

export interface StoredSession {
  playerToken: string
  seat: Seat
  name: string
}

const sessionKey = (code: string) => `cribbage:session:${code}`
const LAST_NAME_KEY = 'cribbage:lastName'

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // e.g. storage disabled
  }
}

export function loadSession(code: string): StoredSession | null {
  try {
    const raw = storage()?.getItem(sessionKey(code))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StoredSession>
    if (
      typeof value.playerToken !== 'string' ||
      (value.seat !== 0 && value.seat !== 1) ||
      typeof value.name !== 'string'
    ) {
      return null
    }
    return { playerToken: value.playerToken, seat: value.seat, name: value.name }
  } catch {
    return null
  }
}

export function saveSession(code: string, session: StoredSession): void {
  try {
    storage()?.setItem(sessionKey(code), JSON.stringify(session))
  } catch {
    // Full or blocked storage: the game still works until the tab is closed.
  }
}

export function removeSession(code: string): void {
  try {
    storage()?.removeItem(sessionKey(code))
  } catch {
    // ignore
  }
}

/** The name used last time, to prefill the forms. */
export function loadLastName(): string {
  try {
    return storage()?.getItem(LAST_NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveLastName(name: string): void {
  try {
    storage()?.setItem(LAST_NAME_KEY, name)
  } catch {
    // ignore
  }
}

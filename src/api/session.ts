/**
 * Remembering who you are in a game: the player token handed out once by create/join, kept in
 * localStorage per game code. The token can't be recovered, so a session is only forgotten when
 * the server says the game or the seat is gone - never because it is old.
 *
 * A browser whose storage is blocked or full keeps the session in memory instead, so the game
 * can still be played until the tab is closed or reloaded (saveSession says when that happens).
 */
import type { Seat } from '@shared/protocol'

export interface StoredSession {
  playerToken: string
  seat: Seat
  name: string
}

const sessionKey = (code: string) => `cribbage:session:${code}`
const LAST_NAME_KEY = 'cribbage:lastName'

/** Sessions that could not be written to storage. They last as long as this tab does. */
const unsaved = new Map<string, StoredSession>()

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // e.g. storage disabled
  }
}

function fromStorage(code: string): StoredSession | null {
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

export function loadSession(code: string): StoredSession | null {
  const held = unsaved.get(code)
  return fromStorage(code) ?? (held ? { ...held } : null)
}

/**
 * Remembers the session. Returns false when it could only be kept in memory (storage is
 * blocked or full): the game works in this tab, but a reload or a closed tab loses the seat,
 * so tell the player.
 */
export function saveSession(code: string, session: StoredSession): boolean {
  try {
    const store = storage()
    if (store) {
      store.setItem(sessionKey(code), JSON.stringify(session))
      unsaved.delete(code)
      return true
    }
  } catch {
    // Full or blocked: fall through and keep it for this tab.
  }
  unsaved.set(code, { ...session })
  return false
}

/** What to tell a player whose seat can't be saved. */
export const SEAT_NOT_SAVED =
  "Your browser won't let this site save your seat. Keep this tab open: reloading or closing it leaves the game."

export function removeSession(code: string): void {
  unsaved.delete(code)
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

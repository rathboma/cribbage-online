/** The API client the app uses, swappable in tests. */
import { createApiClient, type ApiClient } from './client'

let client: ApiClient = createApiClient()

export function getApi(): ApiClient {
  return client
}

/** Replaces the client (tests). Returns a function that restores the previous one. */
export function useApiClient(next: ApiClient): () => void {
  const previous = client
  client = next
  return () => {
    client = previous
  }
}

/**
 * The cursor from create/join, handed to the game screen in memory only: after a reload it is
 * gone and the game snaps to the present instead of replaying history.
 */
const startCursors = new Map<string, number>()

export function setStartCursor(code: string, cursor: number): void {
  startCursors.set(code, cursor)
}

/** Takes (and forgets) the start cursor for a game, if this tab has one. */
export function takeStartCursor(code: string): number | undefined {
  const cursor = startCursors.get(code)
  startCursors.delete(code)
  return cursor
}

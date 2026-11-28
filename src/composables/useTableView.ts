/**
 * Which table the game screen shows: the 3D one, or the simple one (plain HTML, the way to play
 * with a keyboard or a screen reader). The player chooses with the switch in the game menu, or
 * with `?view=2d` / `?view=3d` in the URL, and the choice is kept in localStorage. Without
 * WebGL (or if the 3D table fails to start) the simple view is shown and no choice is offered.
 */
import { computed, ref } from 'vue'
import { webglAvailable } from '@/three/support'

export type TableViewChoice = '3d' | '2d'

export const VIEW_STORAGE_KEY = 'cribbage:view'

/** A choice from a URL or storage, or null if it isn't one. */
export function parseTableView(raw: unknown): TableViewChoice | null {
  return raw === '2d' || raw === '3d' ? raw : null
}

function load(): TableViewChoice | null {
  try {
    return parseTableView(localStorage.getItem(VIEW_STORAGE_KEY))
  } catch {
    return null // storage blocked: the default it is
  }
}

/** The choice made in this page, if any. */
const choice = ref<TableViewChoice | null>(null)
/** The stored choice, read on first use rather than at import (undefined until then). */
let stored: TableViewChoice | null | undefined
/** The 3D table could not start in this page (no context, or its code failed to load). */
const broken = ref(false)

function current(): TableViewChoice {
  if (choice.value) return choice.value
  if (stored === undefined) stored = load()
  return stored ?? '3d'
}

/** Remembers the player's choice of table (it applies everywhere at once). */
export function setTableView(next: TableViewChoice): void {
  choice.value = next
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, next)
  } catch {
    // Kept for this page only.
  }
}

export function useTableView() {
  const canUse3d = computed(() => !broken.value && webglAvailable())
  return {
    /** What the player chose (3D unless they said otherwise). */
    choice: computed(current),
    /** Whether the 3D table can be shown at all: if not, there is nothing to choose. */
    canUse3d,
    /** The table to show now. */
    view: computed<TableViewChoice>(() => (canUse3d.value && current() === '3d' ? '3d' : '2d')),
    set: setTableView,
    /** The 3D table failed to start: show the simple one for the rest of this visit. */
    markBroken: () => (broken.value = true),
  }
}

/** Forgets everything (tests only). */
export function resetTableView(): void {
  choice.value = null
  stored = undefined
  broken.value = false
}

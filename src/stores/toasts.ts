import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

/**
 * Short messages shown at the top of the screen, e.g. "Code copied". A toast stays while the
 * pointer is over it or it has focus, so it never disappears under the player.
 */
export const useToasts = defineStore('toasts', () => {
  const toasts = ref<Toast[]>([])
  let nextId = 1
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const timeouts = new Map<number, number>()

  function schedule(id: number) {
    clearTimeout(timers.get(id))
    const timeout = timeouts.get(id) ?? 0
    if (timeout > 0)
      timers.set(
        id,
        setTimeout(() => dismiss(id), timeout),
      )
  }

  function dismiss(id: number) {
    clearTimeout(timers.get(id))
    timers.delete(id)
    timeouts.delete(id)
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /** Shows a message; it disappears after `timeoutMs` (0 keeps it until dismissed). */
  function push(message: string, options: { kind?: Toast['kind']; timeoutMs?: number } = {}) {
    const id = nextId++
    toasts.value = [...toasts.value, { id, message, kind: options.kind ?? 'info' }]
    timeouts.set(id, options.timeoutMs ?? 4000)
    schedule(id)
    return id
  }

  /** Pauses a toast's timer (pointer over it, or focus inside it). */
  function hold(id: number) {
    clearTimeout(timers.get(id))
    timers.delete(id)
  }

  /** Restarts a held toast's timer. */
  function release(id: number) {
    if (timeouts.has(id)) schedule(id)
  }

  return { toasts, push, dismiss, hold, release }
})

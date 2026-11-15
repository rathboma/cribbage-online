import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  kind: 'info' | 'error'
}

/** Short messages shown at the bottom of the screen, e.g. "Code copied". */
export const useToasts = defineStore('toasts', () => {
  const toasts = ref<Toast[]>([])
  let nextId = 1

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /** Shows a message; it disappears after `timeoutMs` (0 keeps it until dismissed). */
  function push(message: string, options: { kind?: Toast['kind']; timeoutMs?: number } = {}) {
    const id = nextId++
    toasts.value = [...toasts.value, { id, message, kind: options.kind ?? 'info' }]
    const timeout = options.timeoutMs ?? 4000
    if (timeout > 0) setTimeout(() => dismiss(id), timeout)
    return id
  }

  return { toasts, push, dismiss }
})

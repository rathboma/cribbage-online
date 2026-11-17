/** Copying text, with a fallback for browsers without the async clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the old way (e.g. permission denied).
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Whether the browser can open the native share sheet for this data. */
export function canShare(data: ShareData): boolean {
  return typeof navigator.share === 'function' && (navigator.canShare?.(data) ?? true)
}

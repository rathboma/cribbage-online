/**
 * Can this browser draw the 3D table? Answered without loading three.js, so the game screen
 * can decide between the 3D table and the simple one before downloading anything.
 *
 * three.js needs WebGL 2. A browser can have the API and still refuse a context (blocked GPU,
 * software rendering turned off, too many contexts), so this asks for a real one, then hands
 * it straight back so it doesn't count against the browser's limit on live contexts.
 */

let cached: boolean | undefined

export function webglAvailable(doc: Document = document): boolean {
  if (cached !== undefined) return cached
  cached = probe(doc)
  return cached
}

function probe(doc: Document): boolean {
  try {
    if (typeof WebGL2RenderingContext === 'undefined') return false
    const canvas = doc.createElement('canvas')
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

/** Forgets the cached answer (tests only). */
export function resetWebglCheck(): void {
  cached = undefined
}

/**
 * Randomness is injected into the engine so games are reproducible in tests and simulations,
 * and unpredictable in production. Nothing in shared/engine may call Math.random().
 */

export interface Rng {
  /** A uniformly distributed integer in [0, n). `n` must be an integer from 1 to 2^32. */
  nextInt(n: number): number
}

const TWO_POW_32 = 0x1_0000_0000

/**
 * Maps a source of uniform 32-bit unsigned integers to a uniform integer in [0, n) without
 * modulo bias: draws that fall in the incomplete last block of size `2^32 mod n` are rejected
 * and redrawn.
 */
export function uniformInt(next32: () => number, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
    throw new RangeError(`nextInt(n) needs an integer from 1 to 2^32, got ${n}`)
  }
  const limit = TWO_POW_32 - (TWO_POW_32 % n)
  for (;;) {
    const x = next32()
    if (x < limit) return x % n
  }
}

/** Fisher–Yates shuffle. Returns a new array; the input is not changed. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1)
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

/**
 * Deterministic generator for tests and simulations: the same seed always gives the same
 * sequence. Not for production deals. (sfc32, seeded through a string hash; a number seed is
 * used as its string form, so `seededRng(42)` and `seededRng('42')` are the same.)
 */
export function seededRng(seed: number | string): Rng {
  let [a, b, c, d] = hashSeed(String(seed))
  const next32 = () => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
  // Discard the first outputs so similar seeds diverge.
  for (let i = 0; i < 15; i++) next32()
  return { nextInt: (n) => uniformInt(next32, n) }
}

/** cyrb128: hashes a string into four 32-bit seeds. */
function hashSeed(str: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** The subset of the Web Crypto API the engine needs (available in browsers and Workers). */
export interface RandomValuesSource {
  getRandomValues(array: Uint32Array<ArrayBuffer>): unknown
}

/**
 * Cryptographically secure generator for real games, backed by `crypto.getRandomValues`.
 * Pass `source` only to test it.
 */
export function cryptoRng(source?: RandomValuesSource): Rng {
  const crypto = source ?? (globalThis as unknown as { crypto?: RandomValuesSource }).crypto
  if (!crypto) throw new Error('crypto.getRandomValues is not available')
  const buffer = new Uint32Array(new ArrayBuffer(4))
  const next32 = () => {
    crypto.getRandomValues(buffer)
    return buffer[0] as number
  }
  return { nextInt: (n) => uniformInt(next32, n) }
}

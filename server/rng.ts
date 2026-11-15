/**
 * The randomness every endpoint hands to the engine. Production always uses crypto randomness.
 * A fixed TEST_SEED is honoured only when ENVIRONMENT is exactly `test` or `development` (an
 * allow-list, so a missing or mistyped variable can never make production predictable).
 */
import { cryptoRng, seededRng, type Rng } from '../shared/engine'
import type { Env } from './env'

const SEEDABLE_ENVIRONMENTS = new Set(['test', 'development'])

/**
 * The Rng for one engine call on game `code` at state `version`. When seeded, it is derived
 * from seed + code + version, so successive hands differ but a whole run is reproducible.
 */
export function gameRng(
  env: Pick<Env, 'ENVIRONMENT' | 'TEST_SEED'>,
  code: string,
  version: number,
): Rng {
  if (env.TEST_SEED && SEEDABLE_ENVIRONMENTS.has(env.ENVIRONMENT ?? '')) {
    return seededRng(`${env.TEST_SEED}:${code}:${version}`)
  }
  return cryptoRng()
}

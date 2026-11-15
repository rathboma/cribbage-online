/** Bindings available to every Pages Function (configured in wrangler.jsonc and .dev.vars). */
export interface Env {
  DB: D1Database
  /**
   * `production`, `preview`, `development` or `test`. Only `development` and `test` allow
   * TEST_SEED; anything else (including unset) means real randomness.
   */
  ENVIRONMENT?: string
  /** Makes deals reproducible in development and tests. Ignored in production. */
  TEST_SEED?: string
}

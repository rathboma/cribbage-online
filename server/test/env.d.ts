// Types for the server test environment (see vitest.config.ts).
declare namespace Cloudflare {
  interface GlobalProps {
    // functions/ compiles to a Worker whose default export is an ExportedHandler.
    mainModule: { default: ExportedHandler<Env> }
  }
  interface Env {
    DB: D1Database
    ASSETS: Fetcher
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}

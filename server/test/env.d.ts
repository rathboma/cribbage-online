// Types for the server test environment (see vitest.config.ts).
declare namespace Cloudflare {
  interface GlobalProps {
    // functions/ compiles to a Worker whose default export is an ExportedHandler.
    mainModule: { default: ExportedHandler<Env> }
  }
  // The app's bindings (server/env.ts), plus what only the tests have.
  interface Env extends AppEnv {
    ASSETS: Fetcher
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}

type AppEnv = import('../env').Env

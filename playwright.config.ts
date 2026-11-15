import { defineConfig, devices } from '@playwright/test'

/** The end-to-end server's port (scripts/e2e-serve.sh); not the port `yarn dev` uses. */
const PORT = Number(process.env.E2E_PORT ?? 8799)
const CI = !!process.env.CI

/**
 * End-to-end tests: real browsers against the built Worker with a local D1 database, the same
 * way Cloudflare serves the site. `yarn e2e` runs everything; `yarn e2e --grep-invert @slow`
 * skips the test that plays a whole game.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // A retry in CI records a trace of the failure; a test that needed one is reported as flaky.
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: CI ? 'on-first-retry' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'sh scripts/e2e-serve.sh',
    url: `http://127.0.0.1:${PORT}/api/health`,
    // Locally, a server you started yourself (`yarn e2e:serve`) is reused, which saves the
    // build on every run. Restart it after changing the app: it serves the build it started with.
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
})

import { defineConfig, devices } from '@playwright/test'

/** The end-to-end server's port (scripts/e2e-serve.sh); not the port `yarn dev` uses. */
const PORT = Number(process.env.E2E_PORT ?? 8799)
/** A Vite dev server for the dev-only pages (/dev/table), which production builds leave out. */
const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 5199)
const CI = !!process.env.CI

/**
 * End-to-end tests: real browsers against the built Worker with a local D1 database, the same
 * way Cloudflare serves the site. `yarn e2e` runs everything; `yarn e2e --grep-invert @slow`
 * skips the test that plays a whole game.
 *
 * The `scene` project tests the 3D table on its own at /dev/table, which only development
 * builds have, so it runs against a Vite dev server instead.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // In CI a failed test is tried once more; one that then passes is reported as flaky.
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The trace of a test's first failure is kept, also when the retry passes: a flake leaves
    // evidence. (Recording costs time, so local runs don't; add --trace on to debug.)
    trace: CI ? 'retain-on-first-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /scene\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'scene',
      testMatch: /scene\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${DEV_PORT}` },
    },
  ],
  webServer: [
    {
      command: 'sh scripts/e2e-serve.sh',
      url: `http://127.0.0.1:${PORT}/api/health`,
      // Locally, a server you started yourself (`yarn e2e:serve`) is reused, which saves the
      // build on every run. Restart it after changing the app: it serves the build it started
      // with.
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${DEV_PORT} --strictPort`,
      url: `http://127.0.0.1:${DEV_PORT}/dev/table`,
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
})

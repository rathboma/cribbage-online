import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'
import { unstable_readConfig } from 'wrangler'
import { FUNCTIONS_TEST_BUILD_DIR } from './server/test/global-setup.ts'

// Bindings and the compatibility date come from wrangler.jsonc, but the config is not handed to
// the test pool as a whole: that would also load each developer's .dev.vars into the tests.
const wrangler = unstable_readConfig({ config: './wrangler.jsonc' })

export default defineConfig(async () =>
  mergeConfig(
    viteConfig,
    defineConfig({
      test: {
        projects: [
          {
            extends: true,
            test: {
              name: 'shared',
              include: ['shared/**/*.test.ts'],
              environment: 'node',
            },
          },
          {
            extends: true,
            test: {
              name: 'client',
              include: ['src/**/*.test.ts'],
              setupFiles: ['./src/test/setup.ts'],
              environment: 'jsdom',
            },
          },
          {
            // Pages Functions running in workerd against a local D1 database.
            plugins: [
              cloudflareTest({
                main: `./${FUNCTIONS_TEST_BUILD_DIR}/index.js`,
                miniflare: {
                  compatibilityDate: wrangler.compatibility_date,
                  compatibilityFlags: wrangler.compatibility_flags,
                  d1Databases: wrangler.d1_databases.map((db: { binding: string }) => db.binding),
                  bindings: {
                    // Deals in server tests are reproducible (see server/rng.ts).
                    ENVIRONMENT: 'test',
                    TEST_SEED: 'server-tests',
                    TEST_MIGRATIONS: await readD1Migrations(
                      wrangler.d1_databases[0]?.migrations_dir ?? 'migrations',
                    ),
                  },
                  // Server tests don't serve the client: a stand-in for the static assets that
                  // has only the app's index.html, at /. (buildPagesASSETSBinding would work too,
                  // but its file watcher stops Vitest exiting when this project is filtered out
                  // with --project.)
                  serviceBindings: {
                    ASSETS: (request: Request) =>
                      new URL(request.url).pathname === '/'
                        ? new Response('<!doctype html><title>app shell</title>', {
                            headers: { 'Content-Type': 'text/html; charset=utf-8' },
                          })
                        : new Response('No such file in server tests', { status: 404 }),
                  },
                },
              }),
            ],
            test: {
              name: 'server',
              include: ['server/**/*.test.ts'],
              globalSetup: ['./server/test/global-setup.ts'],
              setupFiles: ['./server/test/apply-migrations.ts'],
            },
          },
        ],
      },
    }),
  ),
)

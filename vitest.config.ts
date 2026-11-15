import {
  buildPagesASSETSBinding,
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-plugin'
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'
import { FUNCTIONS_TEST_BUILD_DIR } from './server/test/global-setup.ts'

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
              exclude: [...configDefaults.exclude, 'e2e/**'],
              environment: 'jsdom',
            },
          },
          {
            // Pages Functions running in workerd against a local D1 database.
            plugins: [
              cloudflareTest({
                main: `./${FUNCTIONS_TEST_BUILD_DIR}/index.js`,
                wrangler: { configPath: './wrangler.jsonc' },
                miniflare: {
                  bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
                  // Requests no Function handles fall through to static assets, as on Pages.
                  serviceBindings: { ASSETS: await buildPagesASSETSBinding('./public') },
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

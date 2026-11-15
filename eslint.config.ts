import js from '@eslint/js'
import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import skipFormatting from 'eslint-config-prettier/flat'

/** Wrangler bundles functions/ and everything it imports without the Vite aliases. */
const noAliasImports = {
  regex: '^@(shared)?/',
  message: 'Use a relative import: the @/ and @shared/ aliases only work in the client build.',
}

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,vue}'],
  },

  globalIgnores(['**/dist/**', '**/coverage/**', '**/.wrangler/**']),

  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    files: ['**/*.test.ts'],
  },

  {
    // shared/ runs in the browser and on Cloudflare: keep it free of platform APIs and
    // framework code, and keep the rules engine deterministic (randomness is injected).
    name: 'app/shared-is-isomorphic',
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'process'].map(
          (name) => ({ name, message: 'shared/ must not depend on a platform API.' }),
        ),
        {
          name: 'crypto',
          message: 'Inject an Rng (cryptoRng() in production) so games stay reproducible.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Inject an Rng instead, so results are reproducible.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['vue', 'pinia', 'vue-router', 'three'].map((name) => ({
            name,
            message: 'shared/ is used by the server too: no client frameworks.',
          })),
          patterns: [
            noAliasImports,
            {
              regex: '^(node|cloudflare):',
              message: 'shared/ must not depend on a platform API.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'app/relative-imports-on-server',
    files: ['functions/**/*.ts', 'server/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noAliasImports] }],
    },
  },

  skipFormatting,
)

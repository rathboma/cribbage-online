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

const zodMessage = 'zod is for server-side validation; the client imports protocol types only.'

/** Imports shared/ must avoid: it runs in the browser and on Cloudflare. */
function sharedImports({ allowZod }: { allowZod: boolean }) {
  return {
    paths: [
      ...['vue', 'pinia', 'vue-router', 'three'].map((name) => ({
        name,
        message: 'shared/ is used by the server too: no client frameworks.',
      })),
    ],
    patterns: [
      ...(allowZod
        ? []
        : [{ regex: '^zod(/|$)', message: 'Only shared/protocol/schemas.ts uses zod.' }]),
      noAliasImports,
      { regex: '^(node|cloudflare):', message: 'shared/ must not depend on a platform API.' },
    ],
  }
}

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,vue}'],
  },

  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/.wrangler/**',
    '.claude/**',
    'test-results/**',
    'playwright-report/**',
  ]),

  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    files: ['**/*.test.ts'],
    rules: {
      ...pluginVitest.configs.recommended.rules,
      // expect(value, message) is supported by Vitest.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      // Helpers named expect* count as assertions.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect*'] }],
    },
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
      'no-restricted-imports': ['error', sharedImports({ allowZod: false })],
    },
  },

  {
    // Request validation is the one part of shared/ that uses zod; only the server imports it.
    name: 'app/protocol-schemas',
    files: ['shared/protocol/schemas.ts'],
    rules: {
      'no-restricted-imports': ['error', sharedImports({ allowZod: true })],
    },
  },

  {
    // Keep zod out of the client bundle: the client imports protocol types, never schemas.
    name: 'app/client-imports',
    files: ['src/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^zod(/|$)', message: zodMessage },
            { regex: 'protocol/schemas', message: zodMessage },
          ],
        },
      ],
    },
  },

  {
    // The HUD is shared by the simple table and the 3D table, so it must not know either;
    // and a table must work under any HUD. GameScreen is where they meet.
    name: 'app/hud-and-table-stay-apart',
    files: ['src/components/hud/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^zod(/|$)', message: zodMessage },
            { regex: 'protocol/schemas', message: zodMessage },
            {
              regex: '(^|/)(table|three)(/|$)',
              message: 'The HUD must not import from a table. Wire them together in GameScreen.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'app/table-does-not-import-hud',
    files: ['src/components/table/**/*.{ts,vue}', 'src/three/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^zod(/|$)', message: zodMessage },
            { regex: 'protocol/schemas', message: zodMessage },
            {
              regex: '(^|/)hud(/|$)',
              message: 'A table must not import from the HUD. Wire them together in GameScreen.',
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
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noAliasImports,
            {
              // Routes get randomness from server/rng.ts, which only allows a seed in test and
              // development. Importing seededRng directly would bypass that.
              regex: 'shared/engine(/rng)?$',
              importNames: ['seededRng'],
              message: 'Use gameRng from server/rng.ts.',
            },
          ],
        },
      ],
    },
  },

  {
    name: 'app/server-rng-and-tests',
    files: ['server/rng.ts', 'server/**/*.test.ts', 'server/test/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noAliasImports] }],
    },
  },

  skipFormatting,
)

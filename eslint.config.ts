import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,vue}'],
  },

  globalIgnores(['**/dist/**', '**/coverage/**', '**/.wrangler/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    files: ['**/*.test.ts'],
  },

  {
    // shared/ runs in the browser and on Cloudflare: keep it free of platform APIs,
    // and keep the rules engine deterministic (randomness is injected).
    name: 'app/shared-is-isomorphic',
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'process'].map(
          (name) => ({ name, message: 'shared/ must not depend on a platform API.' }),
        ),
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Inject an Rng instead, so results are reproducible.',
        },
      ],
    },
  },

  skipFormatting,
)

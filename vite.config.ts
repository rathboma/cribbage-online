import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Fails the client build if it would bundle server-only code: zod (request validation) or the
 * protocol schemas. The client imports protocol types from @shared/protocol instead.
 */
function forbidServerOnlyImports(): Plugin {
  return {
    name: 'forbid-server-only-imports',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      if (/^zod(\/|$)/.test(source) || /protocol\/schemas(\.ts)?$/.test(source)) {
        throw new Error(
          `${importer ?? 'The client'} imports ${source}, which is server-only. ` +
            'Import protocol types from @shared/protocol instead.',
        )
      }
      return null
    },
  }
}

/** Port of `wrangler pages dev` (the `dev:api` script), which serves /api/* during development. */
export const API_DEV_PORT = 8788

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), forbidServerOnlyImports()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Keep the browser's Host header, so Functions see the same URL and Origin as in
      // production. (Also used by `vite preview`.)
      '/api/': { target: `http://127.0.0.1:${API_DEV_PORT}`, changeOrigin: false },
    },
  },
})

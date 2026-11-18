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

/**
 * Fails the client build if three.js would load with the landing page (the entry chunk and
 * everything it imports statically: what the browser fetches before any lazy route), or if a
 * dev-only page (src/views/dev, e.g. /dev/table) made it into the production bundle.
 */
function checkClientChunks(): Plugin {
  const THREE = /[\\/]node_modules[\\/]three[\\/]/
  const DEV_PAGES = /[\\/]src[\\/]views[\\/]dev[\\/]/
  return {
    name: 'check-client-chunks',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((file) => file.type === 'chunk')
      const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      const eager = new Set<(typeof chunks)[number]>()
      const pending = chunks.filter((chunk) => chunk.isEntry)
      for (let chunk = pending.pop(); chunk; chunk = pending.pop()) {
        if (eager.has(chunk)) continue
        eager.add(chunk)
        for (const name of chunk.imports) {
          const imported = byName.get(name)
          if (imported) pending.push(imported)
        }
      }
      for (const chunk of eager) {
        const module = chunk.moduleIds.find((id) => THREE.test(id))
        if (module) {
          this.error(
            `three.js (${module}) is in ${chunk.fileName}, which the landing page loads. ` +
              'Import 3D code only from lazily loaded routes or components.',
          )
        }
      }
      for (const chunk of chunks) {
        const module = chunk.moduleIds.find((id) => DEV_PAGES.test(id))
        if (module) this.error(`The dev-only page ${module} is in the production build.`)
      }
    },
  }
}

/** Port of `wrangler pages dev` (the `dev:api` script), which serves /api/* during development. */
export const API_DEV_PORT = 8788

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), forbidServerOnlyImports(), checkClientChunks()],
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

import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/** Port of `wrangler pages dev` (the `dev:api` script), which serves /api/* during development. */
export const API_DEV_PORT = 8788

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
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

import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
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
      ],
    },
  }),
)

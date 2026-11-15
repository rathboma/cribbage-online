// Runs in Node before the server tests: compiles functions/ into a single Worker with the
// same bundler Cloudflare Pages uses, so the tests exercise real routing and real imports.
import { execFileSync, spawn } from 'node:child_process'
import type { TestProject } from 'vitest/node'

export const FUNCTIONS_TEST_BUILD_DIR = '.wrangler/functions-test'

export default function setup(project: TestProject) {
  const args = ['pages', 'functions', 'build', '--outdir', FUNCTIONS_TEST_BUILD_DIR]
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }

  execFileSync('wrangler', args, { stdio: ['ignore', 'ignore', 'inherit'], env })

  if (!project.config.watch) return

  // In watch mode keep rebuilding, so edits to functions/ re-run the tests.
  const watcher = spawn('wrangler', [...args, '--watch'], { stdio: 'ignore', env })
  return () => {
    watcher.kill()
  }
}

// Runs in Node before the server tests: compiles functions/ into a single Worker with the
// same bundler Cloudflare Pages uses, so the tests exercise real routing and real imports.
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { TestProject } from 'vitest/node'

export const FUNCTIONS_TEST_BUILD_DIR = '.wrangler/functions-test'

// Run the project's own wrangler with this Node, whether or not node_modules/.bin is on PATH.
// (The package doesn't export its bin path, so find it next to its package.json.)
const wranglerBin = join(
  dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
  'bin/wrangler.js',
)

export default function setup(project: TestProject) {
  const args = [wranglerBin, 'pages', 'functions', 'build', '--outdir', FUNCTIONS_TEST_BUILD_DIR]
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }

  execFileSync(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'], env })

  if (!project.config.watch) return

  // In watch mode keep rebuilding, so edits to functions/ re-run the tests. Build errors are
  // shown, because a failed rebuild leaves the tests running against the last good bundle.
  const watcher = spawn(process.execPath, [...args, '--watch'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env,
  })
  return () => {
    watcher.kill()
  }
}

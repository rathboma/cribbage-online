// Setup file: brings the test D1 database up to date with migrations/ before each test file.
// Safe to run repeatedly; applyD1Migrations() skips migrations already applied.
import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)

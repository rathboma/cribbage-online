// Fails the build if server-only code ended up in the client bundle (dist/assets).
// zod validates requests on the server; the client imports protocol types only.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist/assets'
const forbidden = [{ name: 'zod', marker: 'ZodError' }]

let failed = false
for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const source = readFileSync(join(dir, file), 'utf8')
  for (const { name, marker } of forbidden) {
    if (source.includes(marker)) {
      console.error(`${name} is in the client bundle (${join(dir, file)}).`)
      failed = true
    }
  }
}
if (failed) {
  console.error('Import protocol types from @shared/protocol, never @shared/protocol/schemas.')
  process.exit(1)
}

/**
 * yarn bot:play [--url http://localhost:5173] [--seed name]
 *
 * Two random bots play a whole game against a running server (start one with `yarn dev`), each
 * using only its own sync responses. A quick end-to-end smoke test of the API.
 */
import { parseArgs } from 'node:util'
import { playBotGame } from '../shared/testing/http-bot'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.BASE_URL ?? 'http://localhost:5173' },
    seed: { type: 'string', default: String(Date.now()) },
  },
})
const baseUrl = values.url.replace(/\/$/, '')

const started = Date.now()
try {
  const result = await playBotGame(
    {
      async request(method, path, init = {}) {
        const res = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        })
        const text = await res.text()
        return { status: res.status, text, body: text ? JSON.parse(text) : null }
      },
    },
    { seed: values.seed },
  )
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `Game ${result.code}: seat ${result.winner} won ${result.scores.join('-')} ` +
      `after ${result.actions} moves (${result.requests} requests, ${seconds}s, seed ${values.seed}).`,
  )
} catch (err) {
  console.error(`Bot game failed (seed ${values.seed}) against ${baseUrl}:`, err)
  process.exitCode = 1
}

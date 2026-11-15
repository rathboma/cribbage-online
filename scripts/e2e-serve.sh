#!/bin/sh
# The server the end-to-end tests run against (Playwright starts it; see playwright.config.ts):
# the production Worker - the built client as static assets plus the API - on its own port with
# an empty local D1 database, so tests never touch the data of `yarn dev`.
#
# `wrangler dev` runs `yarn build` first (the build section of wrangler.jsonc). ENVIRONMENT=test
# with a TEST_SEED keeps the tests off the production random source, as issue #25 asks. It does
# not make a run repeatable: deals also depend on the game code, which is random for every
# game, and nothing can start a game with a chosen code. The tests therefore never rely on
# particular cards.
set -e

PORT="${E2E_PORT:-8799}"
STATE=.wrangler/e2e

rm -rf "$STATE"
npx wrangler d1 migrations apply cribbage --local --persist-to "$STATE"
exec npx wrangler dev --ip 127.0.0.1 --port "$PORT" --persist-to "$STATE" \
  --show-interactive-dev-session=false --var ENVIRONMENT:test --var TEST_SEED:e2e

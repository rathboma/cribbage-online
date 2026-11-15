#!/bin/sh
# Production deploy (set Cloudflare's deploy command to `yarn deploy`): apply pending D1
# migrations, then deploy the Worker. `wrangler deploy` runs `yarn build` first (see the build
# section of wrangler.jsonc).
#
# The very first deploy has no database yet: `wrangler deploy` creates it (wrangler.jsonc names
# it but gives no id), and the migrations are applied straight after.
set -e

if npx wrangler d1 info cribbage > /dev/null 2>&1; then
  npx wrangler d1 migrations apply cribbage --remote
  npx wrangler deploy
else
  echo "No D1 database named cribbage yet: the deploy will create it, then migrations run."
  npx wrangler deploy
  npx wrangler d1 migrations apply cribbage --remote
fi

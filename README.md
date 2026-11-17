# cribbage-online for elias
Easy way for 2 people to play cribbage against each other, no signup required.


1. Visuals: built with three.js, smooth animations, clean looking
2. Flow: go to site, two options: start game, join game, start game - choose chat & video enable or disable, enter name, click start, gives you code to send to someone else, code should be 5 characters max. Video uses peer-to-peer webrtc, mark video as 'beta'. Chat can go via server.
3. If join game, asks you for code, enter code, then your name, then join the game. Each individual can disable chat/video and it tells the other they have disabled it.
4. No accounts required
5. Implemented with Vue Js, three.js, and cloudflare pages + functions + D1.



## Development

You need **Node 24** (see `.nvmrc`; `nvm use` picks it up) and **Yarn 1** (classic).

```sh
yarn install      # install dependencies
yarn dev          # app at http://localhost:5173, API at /api (local D1)
```

| Command                 | What it does                                                                     |
| ----------------------- | -------------------------------------------------------------------------------- |
| `yarn dev`              | Applies local migrations, then runs Vite (hot reload) and the API together       |
| `yarn build`            | Production build into `dist/`, and a compile check of `functions/`               |
| `yarn preview`          | Serve the built client (with `/api` still forwarded to port 8788)                |
| `yarn preview:worker`   | Build, migrate, then run the production Worker locally (assets and API)          |
| `yarn lint`             | ESLint, then a Prettier check (`yarn lint:fix` fixes what it can)                |
| `yarn typecheck`        | `vue-tsc` over the client, shared code, Functions, tests and config files        |
| `yarn test`             | All unit tests once: shared, client and server (`yarn test:watch` keeps running) |
| `yarn e2e`              | End-to-end tests: two real browsers play against the built Worker (see below)    |
| `yarn db:migrate:local` | Apply new files in `migrations/` to the local D1 database                        |
| `yarn bot:play`         | Two bots play a whole game against a running `yarn dev` (`--url`, `--seed`)      |
| `yarn cards:optimize`   | Rebuild the card faces in `src/assets/cards/` from the upstream SVGs (see below) |
| `yarn cards:compare`    | Compare two sets of card faces, pixel by pixel, at 500 px wide                   |
| `yarn deploy`           | Migrate the production D1 database and deploy the Worker (see Deployment)        |

Before pushing, run `yarn lint && yarn typecheck && yarn test && yarn build`. CI
(`.github/workflows/ci.yml`) runs the same checks, and the end-to-end tests, on every pull request
and every push to `main`.

### End-to-end tests

`yarn e2e` runs the [Playwright](https://playwright.dev/) tests in `e2e/`: one browser starts a
game, another joins with the code, and they play through the simple (DOM) table by pressing
whatever the UI offers. The first time, install the browser with
`npx playwright install chromium`.

- **What they run against.** Playwright builds the app and serves it the way Cloudflare does
  (`scripts/e2e-serve.sh`: the Worker with static assets, on port 8799, with its own empty local
  D1 in `.wrangler/e2e`), so deep links such as `/j/CODE` are covered and `yarn dev` data is
  never touched.
- **Faster runs.** `yarn e2e --grep-invert @slow` skips the test that plays a whole game to 121
  (about a minute and a half). To skip the build on every run, keep `yarn e2e:serve` running in
  another terminal; restart it after changing the app, because it serves the build it started
  with.
- **Selectors.** Tests find elements by `data-testid` only, never by wording or layout. Helpers
  for starting, joining and making moves are in `e2e/table.ts`.
- **No fixed deals.** The server runs with `ENVIRONMENT=test` and `TEST_SEED=e2e`, but deals
  also depend on the game code, which is random for every game, so two runs never play the same
  cards and a failed run cannot be replayed. Tests must not rely on particular cards: they press
  what the UI offers. (The test that needs a Go plays the highest card first until one comes up,
  which the engine's simulator puts at 93% of hands.)
- **The 3D table on its own.** `e2e/scene.spec.ts` (the `scene` project) tests the three.js
  scene at `/dev/table` with real WebGL: no frames while idle, no distortion on resize, nothing
  left behind after mounting and unmounting it 20 times, recovery from a lost context. That page
  only exists in development builds, so Playwright also starts a Vite dev server for it (port
  5199). `yarn e2e --project scene` runs just these.
- **Looking into a failure.** In CI the report is attached to the run as `playwright-report`,
  with a screenshot and a trace of the first failure of each failed test, including one that
  then passed on its retry. Locally, add `--trace on` and open the trace it prints.
- The Playwright version is pinned exactly, because each version needs its own browser build:
  after changing it, run `npx playwright install chromium` again.

### Local Cloudflare workflow

The site is one [Cloudflare Worker](https://developers.cloudflare.com/workers/): the built client
in `dist/` is served as [static assets](https://developers.cloudflare.com/workers/static-assets/),
and the API runs as the Worker, backed by a [D1](https://developers.cloudflare.com/d1/) (SQLite)
database. The API is written as [Pages Functions](https://developers.cloudflare.com/pages/functions/)
(file-based routes in `functions/`); `yarn build` compiles them into the Worker's entry point
(`.wrangler/functions-build/index.js`). Everything runs locally through `wrangler`; no Cloudflare
account is needed for development.

- **Two servers, one URL.** `yarn dev` starts `wrangler dev` on port 8788 for the API and Vite on
  port 5173 for the client. Vite forwards every `/api/*` request to wrangler, so always open
  the app at http://localhost:5173. Edits to `functions/`, `server/` and `shared/` rebuild the API
  automatically.
- **Config** is in `wrangler.jsonc`. The D1 binding is `DB` (database `cribbage`). It has no
  `database_id`: wrangler finds the database by name, and the first deploy creates it.
- **Routing.** Requests for `/api/*` go to the Worker. Anything else is served from `dist/` if
  the file exists; if not, the Worker answers (`functions/[[path]].ts`): a page of the app (a deep
  link such as `/j/BCDFG`) gets `index.html`, whose router shows its own "not found" page, and a
  path that looks like a file gets a plain 404.
- **Caching.** Files under `/assets/` have a hash of their contents in their names, so
  `public/_headers` lets browsers keep them for a year; `index.html` is checked on every visit.
  That is why a missing file must be a real 404: Cloudflare's own single-page fallback would
  answer it with `index.html`, which browsers would then keep under that URL.
- **Local data** lives in `.wrangler/state/` (git-ignored). Delete that folder to start from an empty
  database.
- **Migrations** are numbered SQL files in `migrations/` (`0001_create_games.sql`, ...). Create one
  with `npx wrangler d1 migrations create cribbage <name>`, then run `yarn db:migrate:local`.
  `yarn dev` applies pending migrations when it starts, and asks you to confirm in a terminal.
  Migrations must stay backward compatible with the code already deployed: add tables and columns,
  don't rename or drop in place.
- **Secrets and variables** for local runs go in `.dev.vars` (git-ignored); see `.dev.vars.example`.
- **Code layout.** `functions/` holds route files only (`functions/api/health.ts` serves
  `GET /api/health`). Helpers go in `server/`. Both import shared code with relative paths
  (`../../shared/...`), because wrangler bundles them without the Vite aliases. The `Env` type with
  the bindings is in `server/env.ts`.
- **Server tests** in `server/**/*.test.ts` run inside the Workers runtime with
  [`@cloudflare/vitest-plugin`](https://developers.cloudflare.com/workers/testing/vitest-integration/).
  Before they start, `functions/` is compiled into a Worker the same way `yarn build` does it, and
  all migrations are applied to a throwaway local D1. Call routes with
  `exports.default.fetch(...)` and reach the database with `env.DB`, both from `cloudflare:workers`.
  - Routes run from that pre-built bundle, so `vi.mock()` of a `server/` module does not reach
    them. Give helpers their randomness and clock as inputs, or use global stubs such as
    `vi.setSystemTime`.
  - The database is shared by all tests in one file: use unique game codes or clean up.
  - Tests don't read `.dev.vars`; bindings they need are set in `vitest.config.ts`.

### Deployment

Cloudflare builds and deploys the Worker from this repository (Workers Builds).

- **Deploy command:** `yarn deploy` (in the Cloudflare dashboard: the Worker's Settings → Build).
  It applies pending D1 migrations, then runs `wrangler deploy`, which builds first (`yarn build`,
  from the `build` section of `wrangler.jsonc`). Leave the build command empty.
- **First deploy:** there is no D1 database yet; `wrangler deploy` creates one named `cribbage` and
  the migrations run right after.
- With the default deploy command (`npx wrangler deploy`) the site still deploys, but migrations
  never run, so the API fails until they are applied (`npx wrangler d1 migrations apply cribbage
  --remote`).
- **Previews:** Cloudflare builds every other branch (each pull request) as a
  [Preview](https://developers.cloudflare.com/workers/previews/): the build command, then the
  Preview command (`npx wrangler preview` by default; Settings → Build). Previews inherit nothing
  from production: a Preview gets only what the `previews` section of `wrangler.jsonc` lists, and
  without that section the build fails. It sets `ENVIRONMENT=preview` and binds `DB` to
  `cribbage-preview`, one D1 database shared by all Previews, so a Preview never touches
  production data (but Previews see each other's games). Preview URLs are public unless you put
  Cloudflare Access in front of them.
- **Preview database migrations** are applied by GitHub Actions, not by Cloudflare: the
  "Preview database" workflow (`.github/workflows/preview-db.yml`) runs whenever a pull request
  adds or changes a migration, and applies whatever the database hasn't seen yet. It needs two
  repository secrets: `CLOUDFLARE_API_TOKEN` (a Cloudflare API token with Account → D1 → Edit)
  and `CLOUDFLARE_ACCOUNT_ID`; without them it passes with a warning and does nothing. By hand:
  `npx wrangler d1 migrations apply PREVIEW_DB --remote --config wrangler.preview-migrations.jsonc`
  (`wrangler.preview-migrations.jsonc` exists only so wrangler's D1 commands can reach the
  Preview database; [docs](https://developers.cloudflare.com/workers/previews/resources/)).
- **Node:** builds need Node 24 (`.nvmrc`).

### Folder layout

| Folder        | What lives there                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/`        | The Vue client: `views/` (one per route), `components/` (`hud/` around the table, `table/` the simple DOM table, `game/` where they meet the store), `game/` (prompts, narration and card names as plain functions), `stores/` (Pinia), `api/` (HTTP client), `three/` (3D table), `rtc/` (video) |
| `shared/`     | TypeScript used by both the client and the server: `engine/` (the rules) and `protocol/` (the API contract; import it from `shared/protocol`, and only the server may import `protocol/schemas`). No DOM, Node or Cloudflare APIs |
| `functions/`  | API routes, written as Pages Functions: route files only (a file's path is its URL)                                      |
| `server/`     | Server-only helpers imported by `functions/` (database access, auth, rate limits)                                       |
| `migrations/` | D1 SQL migrations                                                                                                       |
| `e2e/`        | Playwright end-to-end tests (`yarn e2e`)                                                                                |

Client code imports through two aliases: `@/` for `src/` and `@shared/` for `shared/`. Code in
`shared/`, `functions/` and `server/` uses relative imports instead (lint enforces this).

**Card art** is in `src/assets/cards/`: Byron Knoll's public-domain faces (credits and every
change made to them in `CREDITS.md` there) and an original back. Import URLs from
`src/game/cardArt.ts`, never by path: Vite adds a content hash to each file name. The faces are
generated, so don't edit them by hand; rebuild them from
[notpeter/Vector-Playing-Cards](https://github.com/notpeter/Vector-Playing-Cards) (commit
`861b338`) with `yarn cards:optimize <its cards-svg folder>`, which needs Playwright's Chromium.
Aces and number cards stay SVG; the court cards are too detailed for that and become 500 px wide
PNGs. A unit test holds the set to the download budget (1 MB gzipped, no file over 150 KB), and
`yarn cards:compare <old> <new>` shows whether a change is visible.

**The 3D table** (Phase 4) lives in `src/three/` as plain TypeScript classes with no Vue in them;
`components/table/GameTable.vue` owns the canvas. It only draws a frame when something has
changed or is moving, and every animation goes through `src/three/anim.ts`, whose clock moves
only when told to, so animation logic is unit-tested without a browser. While `yarn dev` runs,
http://localhost:5173/dev/table shows the table on its own (development builds only). The build
fails if three.js would load with the landing page or a dev page would ship (`vite.config.ts`).

Unit tests sit next to the code they test as `*.test.ts`. Tests under `shared/` run in Node,
tests under `src/` in jsdom, and tests under `server/` in the Workers runtime.

The rules of the game are in [`cribbage_rules.md`](cribbage_rules.md), which is the source of truth for the
rules engine and its tests.

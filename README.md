# cribbage-online
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
| `yarn preview:pages`    | Build, migrate, then serve `dist/` and the Functions exactly as Pages would      |
| `yarn lint`             | ESLint, then a Prettier check (`yarn lint:fix` fixes what it can)                |
| `yarn typecheck`        | `vue-tsc` over the client, shared code, Functions, tests and config files        |
| `yarn test`             | All unit tests once: shared, client and server (`yarn test:watch` keeps running) |
| `yarn db:migrate:local` | Apply new files in `migrations/` to the local D1 database                        |
| `yarn bot:play`         | Two bots play a whole game against a running `yarn dev` (`--url`, `--seed`)      |

Before pushing, run `yarn lint && yarn typecheck && yarn test && yarn build`. CI
(`.github/workflows/ci.yml`) runs the same checks on every pull request and every push to `main`.

### Local Cloudflare workflow

The API is made of [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
backed by a [D1](https://developers.cloudflare.com/d1/) (SQLite) database. Everything runs locally
through `wrangler`; no Cloudflare account is needed for development.

- **Two servers, one URL.** `yarn dev` starts `wrangler pages dev` on port 8788 for the Functions and
  Vite on port 5173 for the client. Vite forwards every `/api/*` request to wrangler, so always open
  the app at http://localhost:5173. Edits to `functions/`, `server/` and `shared/` rebuild the API
  automatically.
- **Config** is in `wrangler.jsonc`. The D1 binding is `DB` (database `cribbage`). Its
  `database_id` is a placeholder until the real databases exist (#6). Wrangler names the local
  database file after that id, so changing it starts you on a new, empty local database.
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
  Before they start, `functions/` is compiled into a Worker with the same bundler Pages uses, and
  all migrations are applied to a throwaway local D1. Call routes with
  `exports.default.fetch(...)` and reach the database with `env.DB`, both from `cloudflare:workers`.
  - Routes run from that pre-built bundle, so `vi.mock()` of a `server/` module does not reach
    them. Give helpers their randomness and clock as inputs, or use global stubs such as
    `vi.setSystemTime`.
  - The database is shared by all tests in one file: use unique game codes or clean up.
  - Tests don't read `.dev.vars`; bindings they need are set in `vitest.config.ts`.

### Folder layout

| Folder        | What lives there                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/`        | The Vue client: `views/` (one per route), `components/`, `stores/` (Pinia), `api/` (HTTP client), `three/` (3D table), `rtc/` (video) |
| `shared/`     | TypeScript used by both the client and the server: `engine/` (the rules) and `protocol/` (the API contract; import it from `shared/protocol`, and only the server may import `protocol/schemas`). No DOM, Node or Cloudflare APIs |
| `functions/`  | Cloudflare Pages Functions: route files only (a file's path is its URL)                                                 |
| `server/`     | Server-only helpers imported by `functions/` (database access, auth, rate limits)                                       |
| `migrations/` | D1 SQL migrations                                                                                                       |
| `e2e/`        | Playwright end-to-end tests                                                                                             |

Client code imports through two aliases: `@/` for `src/` and `@shared/` for `shared/`. Code in
`shared/`, `functions/` and `server/` uses relative imports instead (lint enforces this).

Unit tests sit next to the code they test as `*.test.ts`. Tests under `shared/` run in Node,
tests under `src/` in jsdom, and tests under `server/` in the Workers runtime.

The rules of the game are in [`cribbage_rules.md`](cribbage_rules.md), which is the source of truth for the
rules engine and its tests.

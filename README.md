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
yarn dev          # start the app with hot reload at http://localhost:5173
```

| Command          | What it does                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `yarn dev`       | Vite dev server with hot reload                                   |
| `yarn build`     | Production build into `dist/`                                     |
| `yarn preview`   | Serve the production build locally                                |
| `yarn lint`      | ESLint, then a Prettier check (`yarn lint:fix` fixes what it can) |
| `yarn typecheck` | `vue-tsc` over the client, shared code, tests and config files    |
| `yarn test`      | Vitest, once (`yarn test:watch` to keep it running)               |

Before pushing, run `yarn lint && yarn typecheck && yarn test && yarn build`.

### Folder layout

| Folder        | What lives there                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/`        | The Vue client: `views/` (one per route), `components/`, `stores/` (Pinia), `api/` (HTTP client), `three/` (3D table), `rtc/` (video) |
| `shared/`     | TypeScript used by both the client and the server: the rules engine and the protocol types. No DOM, Node or Cloudflare APIs |
| `functions/`  | Cloudflare Pages Functions: route files only                                                                            |
| `server/`     | Server-only helpers imported by `functions/` (database access, auth, rate limits)                                       |
| `migrations/` | D1 SQL migrations                                                                                                       |
| `e2e/`        | Playwright end-to-end tests                                                                                             |

Imports use two aliases: `@/` for `src/` and `@shared/` for `shared/`.

Unit tests sit next to the code they test as `*.test.ts`. Tests under `shared/` run in Node;
tests under `src/` run in jsdom.

The rules of the game are in [`cribbage_rules.md`](cribbage_rules.md), which is the source of truth for the
rules engine and its tests.

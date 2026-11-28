import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'
import { parseGameCode } from '@shared/protocol'
import { loadSession } from '@/api/session'
import { parseTableView, setTableView } from '@/composables/useTableView'
import LandingView from '@/views/LandingView.vue'

/** The game screen needs this browser's seat: without a session, offer to join instead. */
function requireSession(to: RouteLocationNormalized) {
  const code = String(to.params.code)
  return loadSession(code) ? true : { name: 'join-code', params: { code } }
}

/** Rewrites /j/bcd-fg to /j/BCDFG, so every screen sees the canonical code. */
function canonicalCode(to: RouteLocationNormalized) {
  const raw = String(to.params.code)
  const code = parseGameCode(raw)
  if (code === null || code === raw) return true
  return { ...to, params: { ...to.params, code } }
}

/**
 * `?view=2d` or `?view=3d` on any page chooses the table, as the switch in the game menu does,
 * and is then taken out of the URL: left in, a reload would undo a later change of mind.
 */
export function applyViewParam(to: RouteLocationNormalized) {
  const choice = parseTableView(to.query.view)
  if (!choice) return true
  setTableView(choice)
  const query = { ...to.query }
  delete query.view
  return { path: to.path, query, hash: to.hash, replace: true }
}

function devRoutes(): RouteRecordRaw[] {
  return [
    {
      path: '/dev/table',
      name: 'dev-table',
      component: () => import('@/views/dev/DevTableView.vue'),
      meta: { title: 'Table (dev)' },
    },
  ]
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'landing', component: LandingView },
  {
    path: '/new',
    name: 'new-game',
    component: () => import('@/views/NewGameView.vue'),
    meta: { title: 'Start a game' },
  },
  {
    path: '/join',
    name: 'join',
    component: () => import('@/views/JoinView.vue'),
    meta: { title: 'Join a game' },
  },
  // Deep link shared with the second player: /j/BCDFG
  {
    path: '/j/:code',
    name: 'join-code',
    component: () => import('@/views/JoinView.vue'),
    props: true,
    beforeEnter: canonicalCode,
    meta: { title: 'Join a game' },
  },
  {
    path: '/g/:code',
    name: 'game',
    component: () => import('@/views/GameView.vue'),
    props: true,
    beforeEnter: [canonicalCode, requireSession],
    meta: { title: (route: RouteLocationNormalized) => `Game ${String(route.params.code)}` },
  },
  // Pages for developing the 3D table against fixture data. `import.meta.env.DEV` is false in
  // a production build, so these routes and their chunks are left out of it altogether.
  ...(import.meta.env.DEV ? devRoutes() : []),
  // Client-side "not found": the Worker serves index.html for any path that is not a file
  // (not_found_handling in wrangler.jsonc), and this route shows the message.
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: 'Page not found' },
  },
]

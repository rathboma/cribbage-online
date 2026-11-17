import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'
import { parseGameCode } from '@shared/protocol'
import { loadSession } from '@/api/session'
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
  // Client-side "not found": the Worker serves index.html for any path that is not a file
  // (not_found_handling in wrangler.jsonc), and this route shows the message.
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: 'Page not found' },
  },
]

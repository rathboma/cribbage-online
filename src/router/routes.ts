import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'
import { parseGameCode } from '@shared/protocol'
import LandingView from '@/views/LandingView.vue'

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
    beforeEnter: canonicalCode,
    meta: { title: (route: RouteLocationNormalized) => `Game ${String(route.params.code)}` },
  },
  // Client-side "not found". There is deliberately no static 404.html in the build:
  // Cloudflare Pages only falls back to index.html for deep links when none exists.
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: 'Page not found' },
  },
]

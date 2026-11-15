import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import LandingView from '@/views/LandingView.vue'

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'landing', component: LandingView },
  { path: '/new', name: 'new-game', component: () => import('@/views/NewGameView.vue') },
  { path: '/join', name: 'join', component: () => import('@/views/JoinView.vue') },
  // Deep link shared with the second player: /j/BCDFG
  {
    path: '/j/:code',
    name: 'join-code',
    component: () => import('@/views/JoinView.vue'),
    props: true,
  },
  { path: '/g/:code', name: 'game', component: () => import('@/views/GameView.vue'), props: true },
  // Client-side "not found". There is deliberately no static 404.html in the build:
  // Cloudflare Pages only falls back to index.html for deep links when none exists.
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

export default router

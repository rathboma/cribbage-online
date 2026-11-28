import { createRouter, createWebHistory } from 'vue-router'
import { applyViewParam, routes } from './routes'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
router.beforeEach(applyViewParam)

export default router

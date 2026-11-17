import 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** The page's name in the tab title, or a function of the route. */
    title?: string | ((route: RouteLocationNormalized) => string)
  }
}

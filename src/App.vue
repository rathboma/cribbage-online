<script setup lang="ts">
import { nextTick, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import ToastHost from '@/components/base/ToastHost.vue'

const route = useRoute()
let firstPage = true

// After every in-app navigation, give the page a title and move focus to its heading, so
// screen readers announce the new page (a full load does this by itself).
watch(
  () => route.fullPath,
  async () => {
    const title =
      typeof route.meta.title === 'function' ? route.meta.title(route) : route.meta.title
    document.title = title ? `${title} · Cribbage` : 'Cribbage'
    if (firstPage) {
      firstPage = false
      return
    }
    await nextTick()
    const heading = document.querySelector<HTMLElement>('main h1')
    if (heading) {
      heading.setAttribute('tabindex', '-1')
      heading.focus({ preventScroll: false })
    }
  },
  { immediate: true },
)
</script>

<template>
  <RouterView />
  <ToastHost />
</template>

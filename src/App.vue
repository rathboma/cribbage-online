<script setup lang="ts">
import { RouterView } from 'vue-router'
import ToastHost from '@/components/base/ToastHost.vue'
</script>

<template>
  <div class="app">
    <RouterView />
    <ToastHost />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  min-height: 100dvh;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
}
</style>

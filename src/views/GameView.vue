<script setup lang="ts">
import AppPage from '@/components/AppPage.vue'

defineProps<{ code: string }>()
</script>

<template>
  <AppPage back="/" back-label="Home">
    <h1>Game {{ code }}</h1>
    <p>Placeholder: the game table arrives in P3.5 (#24).</p>
  </AppPage>
</template>

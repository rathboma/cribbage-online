<script setup lang="ts">
import { RouterLink } from 'vue-router'

defineProps<{ code: string }>()
</script>

<template>
  <main>
    <h1>Game {{ code }}</h1>
    <p>Placeholder: the game table arrives in P3.5 (#24).</p>
    <RouterLink to="/">Home</RouterLink>
  </main>
</template>

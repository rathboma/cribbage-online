<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { isValidGameCode, normalizeGameCode } from '@shared/protocol/gameCode'

const props = defineProps<{ code?: string }>()

const normalized = computed(() => (props.code ? normalizeGameCode(props.code) : ''))
const valid = computed(() => isValidGameCode(normalized.value))
</script>

<template>
  <main>
    <h1>Join a game</h1>
    <p v-if="!code">Placeholder: the join flow arrives in P3.4 (#23).</p>
    <p v-else-if="valid">
      Joining game <strong data-testid="game-code">{{ normalized }}</strong> (placeholder).
    </p>
    <p v-else>That doesn't look like a game code. Codes are 5 letters.</p>
    <RouterLink to="/">Back</RouterLink>
  </main>
</template>

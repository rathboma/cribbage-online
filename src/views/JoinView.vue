<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { parseGameCode } from '@shared/protocol'

const props = defineProps<{ code?: string }>()

const parsed = computed(() => (props.code ? parseGameCode(props.code) : null))
</script>

<template>
  <main>
    <h1>Join a game</h1>
    <p v-if="!code">Placeholder: the join flow arrives in P3.4 (#23).</p>
    <p v-else-if="parsed">
      Joining game <strong data-testid="game-code">{{ parsed }}</strong> (placeholder).
    </p>
    <p v-else>
      That isn't a valid game code. Check the link you were sent, or ask for the code again.
    </p>
    <RouterLink to="/">Back</RouterLink>
  </main>
</template>

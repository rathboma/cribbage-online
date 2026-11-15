<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { takeStartCursor } from '@/api'
import { friendlyError } from '@/api/messages'
import AppPage from '@/components/AppPage.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import WaitingRoom from '@/components/WaitingRoom.vue'
import { useGameStore } from '@/stores/game'

const props = defineProps<{ code: string }>()
const game = useGameStore()

watch(
  () => props.code,
  (code) => game.connect(code, { cursor: takeStartCursor(code) }),
  { immediate: true },
)
onBeforeUnmount(() => game.disconnect())

const fatalMessage = computed(() => (game.fatalError ? friendlyError(game.fatalError) : null))
</script>

<template>
  <AppPage v-if="fatalMessage" back="/" back-label="Home">
    <h1>Can't open this game</h1>
    <p role="alert">{{ fatalMessage }}</p>
    <BaseButton to="/" block>Go to the start page</BaseButton>
  </AppPage>

  <AppPage v-else-if="game.status === 'waiting' || game.status === null" back="/" back-label="Home">
    <WaitingRoom v-if="game.status === 'waiting'" :code="code" />
    <p v-else role="status">Connecting…</p>
  </AppPage>

  <AppPage v-else back="/" back-label="Home">
    <h1>Game {{ code }}</h1>
    <p data-testid="game-started">
      Your opponent is here. (The table arrives in P3.5, #24.) Phase:
      {{ game.presentedView?.phase }}
    </p>
  </AppPage>
</template>

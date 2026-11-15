<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { takeStartCursor } from '@/api'
import { friendlyError } from '@/api/messages'
import AppPage from '@/components/AppPage.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import GameScreen from '@/components/game/GameScreen.vue'
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

// A tap or a key press anywhere on this screen - the waiting room as much as the table - means
// the player is here: if polling had slowed down after a quiet spell, it picks up again.
const onActivity = () => game.nudge()
onMounted(() => {
  window.addEventListener('pointerdown', onActivity, { passive: true })
  window.addEventListener('keydown', onActivity)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onActivity)
  window.removeEventListener('keydown', onActivity)
})

const fatalMessage = computed(() => {
  const error = game.fatalError
  if (!error) return null
  // The join screen's advice ("check the code") means nothing here: there is no code to check.
  if (error.code === 'game_not_found') {
    return 'This game is no longer there. Games that nobody has played for a while are removed.'
  }
  return friendlyError(error)
})
</script>

<template>
  <AppPage v-if="fatalMessage" back="/" back-label="Home">
    <h1>Can't open this game</h1>
    <p role="alert">{{ fatalMessage }}</p>
    <BaseButton to="/" block>Go to the start page</BaseButton>
  </AppPage>

  <!-- Until the first view is on screen (and while the host waits for a second player). -->
  <AppPage
    v-else-if="game.status === 'waiting' || game.status === null || !game.presentedView"
    back="/"
    back-label="Home"
  >
    <WaitingRoom v-if="game.status === 'waiting'" :code="code" />
    <p v-else role="status">Connecting…</p>
  </AppPage>

  <GameScreen v-else :code="code" />
</template>

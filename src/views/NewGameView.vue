<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { parsePlayerName, PLAYER_NAME_MAX_LENGTH } from '@shared/protocol'
import { getApi, setStartCursor } from '@/api'
import { friendlyError } from '@/api/messages'
import { loadLastName, saveLastName, saveSession, SEAT_NOT_SAVED } from '@/api/session'
import AppPage from '@/components/AppPage.vue'
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import TextInput from '@/components/base/TextInput.vue'
import ToggleSwitch from '@/components/base/ToggleSwitch.vue'
import { useToasts } from '@/stores/toasts'

const router = useRouter()
const toasts = useToasts()

const chatOn = ref(true)
const videoOn = ref(false)
const name = ref(loadLastName())
const submitted = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

const nameError = computed(() =>
  submitted.value && parsePlayerName(name.value) === null
    ? `Enter a name of 1 to ${PLAYER_NAME_MAX_LENGTH} characters.`
    : null,
)

async function start() {
  submitted.value = true
  error.value = null
  const playerName = parsePlayerName(name.value)
  if (playerName === null || busy.value) return
  busy.value = true
  try {
    const res = await getApi().createGame({
      name: playerName,
      chatOn: chatOn.value,
      videoOn: videoOn.value,
    })
    const session = { playerToken: res.playerToken, seat: res.seat, name: playerName }
    if (!saveSession(res.code, session)) {
      toasts.push(SEAT_NOT_SAVED, { kind: 'error', timeoutMs: 15_000 })
    }
    saveLastName(playerName)
    setStartCursor(res.code, res.cursor)
    await router.push({ name: 'game', params: { code: res.code } })
  } catch (err) {
    error.value = friendlyError(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AppPage back="/">
    <h1 class="new-game__title">Start a game</h1>
    <form class="new-game" novalidate @submit.prevent="start">
      <fieldset class="new-game__options">
        <legend class="visually-hidden">Options</legend>
        <ToggleSwitch
          v-model="chatOn"
          label="Chat"
          description="Send messages during the game."
          data-testid="chat-toggle"
        />
        <ToggleSwitch
          v-model="videoOn"
          label="Video"
          description="Connects directly between the two players."
          data-testid="video-toggle"
        >
          <template #badge><BaseBadge>Beta</BaseBadge></template>
        </ToggleSwitch>
      </fieldset>
      <TextInput
        v-model="name"
        label="Your name"
        :error="nameError"
        :maxlength="PLAYER_NAME_MAX_LENGTH * 2"
        autocomplete="nickname"
        autocapitalize="words"
        enterkeyhint="go"
        data-testid="name-input"
      />
      <p v-if="error" class="new-game__error" role="alert" data-testid="start-error">
        {{ error }}
      </p>
      <BaseButton type="submit" size="lg" block :loading="busy" data-testid="start-submit">
        Start
      </BaseButton>
    </form>
  </AppPage>
</template>

<style scoped>
.new-game__title {
  margin-top: 0;
}
.new-game {
  display: grid;
  gap: var(--space-5);
}
.new-game__options {
  display: grid;
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  border: 0;
}
.new-game__error {
  margin: 0;
  color: var(--color-danger);
  font-weight: 600;
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  GAME_CODE_ALPHABET,
  GAME_CODE_LENGTH,
  parseGameCode,
  parsePlayerName,
  PLAYER_NAME_MAX_LENGTH,
  type LookupGameResponse,
} from '@shared/protocol'
import { getApi, setStartCursor } from '@/api'
import { ApiError } from '@/api/client'
import { friendlyError } from '@/api/messages'
import { loadLastName, loadSession, saveLastName, saveSession } from '@/api/session'
import AppPage from '@/components/AppPage.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import TextInput from '@/components/base/TextInput.vue'

/** `code` is set when opened from a share link (/j/CODE): then only the name is asked for. */
const props = defineProps<{ code?: string }>()
const router = useRouter()

/** `kind` names the problem for tests; players read the title and message. */
type Problem = {
  kind: 'not_found' | 'full' | 'finished' | 'bad_link' | 'error'
  title: string
  message: string
  retry?: () => void
}

const step = ref<'code' | 'name'>('code')
const codeText = ref('')
const checking = ref(false)
const game = ref<LookupGameResponse | null>(null)
const problem = ref<Problem | null>(null)

const name = ref(loadLastName())
const nameSubmitted = ref(false)
const joining = ref(false)
const joinError = ref<string | null>(null)
const codeField = ref<InstanceType<typeof TextInput> | null>(null)
const nameField = ref<InstanceType<typeof TextInput> | null>(null)

/** Upper-cases and keeps only letters a code can contain, so wrong ones never appear. */
function codeFilter(value: string): string {
  return value
    .toUpperCase()
    .split('')
    .filter((c) => GAME_CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, GAME_CODE_LENGTH)
}

const nameError = computed(() =>
  nameSubmitted.value && parsePlayerName(name.value) === null
    ? `Enter a name of 1 to ${PLAYER_NAME_MAX_LENGTH} characters.`
    : null,
)

/** Looks a code up; a game this browser already plays in opens straight away. */
async function check(code: string) {
  problem.value = null
  if (loadSession(code)) {
    await router.replace({ name: 'game', params: { code } })
    return
  }
  checking.value = true
  try {
    const found = await getApi().lookupGame(code)
    if (found.joinable) {
      game.value = found
      step.value = 'name'
      await nextTick()
      nameField.value?.focus()
    } else if (found.status === 'finished' || found.status === 'abandoned') {
      problem.value = {
        kind: 'finished',
        title: 'That game has finished',
        message: 'Ask for a new code.',
      }
    } else {
      problem.value = {
        kind: 'full',
        title: 'That game is full',
        message: 'It already has two players. Ask for a new code.',
      }
    }
  } catch (err) {
    problem.value = problemFor(err, () => check(code))
  } finally {
    checking.value = false
  }
}

function problemFor(err: unknown, retry: () => void): Problem {
  if (err instanceof ApiError) {
    if (err.code === 'game_not_found') {
      return {
        kind: 'not_found',
        title: 'No game with that code',
        message: 'Check the code (it may have expired) and try again.',
      }
    }
    if (err.code === 'game_full') {
      return { kind: 'full', title: 'That game is full', message: 'It already has two players.' }
    }
    if (err.code === 'game_ended') {
      return { kind: 'finished', title: 'That game has finished', message: 'Ask for a new code.' }
    }
  }
  return { kind: 'error', title: "Couldn't check the code", message: friendlyError(err), retry }
}

function submitCode() {
  const code = parseGameCode(codeText.value)
  if (code) void check(code)
}

// Submit as soon as the fifth letter is typed or pasted.
watch(codeText, (text) => {
  if (text.length === GAME_CODE_LENGTH && !checking.value) submitCode()
})

async function join() {
  nameSubmitted.value = true
  joinError.value = null
  const playerName = parsePlayerName(name.value)
  if (playerName === null || joining.value || !game.value) return
  const code = game.value.code
  joining.value = true
  try {
    const res = await getApi().joinGame(code, { name: playerName })
    saveSession(code, { playerToken: res.playerToken, seat: res.seat, name: playerName })
    saveLastName(playerName)
    setStartCursor(code, res.cursor)
    await router.push({ name: 'game', params: { code } })
  } catch (err) {
    const p = problemFor(err, join)
    if (p.retry) joinError.value = p.message
    else problem.value = p
  } finally {
    joining.value = false
  }
}

/** Back to typing a code. */
async function startOver() {
  problem.value = null
  game.value = null
  step.value = 'code'
  codeText.value = ''
  if (props.code) {
    await router.push({ name: 'join' })
  }
  await nextTick()
  codeField.value?.focus()
}

watch(
  () => props.code,
  (code) => {
    if (code === undefined) return
    const parsed = parseGameCode(code)
    if (parsed) {
      codeText.value = parsed
      void check(parsed)
    } else {
      problem.value = {
        kind: 'bad_link',
        title: "That link doesn't look right",
        message: 'Game codes are 5 letters. Type the code instead.',
      }
    }
  },
  { immediate: true },
)
</script>

<template>
  <AppPage back="/">
    <div
      v-if="problem"
      class="join__problem"
      data-testid="join-problem"
      :data-problem="problem.kind"
    >
      <h1>{{ problem.title }}</h1>
      <p role="alert">{{ problem.message }}</p>
      <div class="join__actions">
        <BaseButton v-if="problem.retry" block @click="problem.retry">Try again</BaseButton>
        <BaseButton
          block
          :variant="problem.retry ? 'secondary' : 'primary'"
          data-testid="other-code"
          @click="startOver"
        >
          Enter another code
        </BaseButton>
        <BaseButton to="/" block variant="ghost">Go home</BaseButton>
      </div>
    </div>

    <template v-else-if="step === 'code'">
      <h1>Join a game</h1>
      <form class="join__form" novalidate @submit.prevent="submitCode">
        <TextInput
          ref="codeField"
          v-model="codeText"
          class="join__code"
          label="Game code"
          hint="5 letters, like BCDFG. Codes have no vowels."
          :filter="codeFilter"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          enterkeyhint="go"
          :aria-busy="checking || undefined"
          data-testid="code-input"
        />
        <BaseButton
          type="submit"
          size="lg"
          block
          :loading="checking"
          :disabled="codeText.length !== 5"
          data-testid="code-submit"
        >
          Continue
        </BaseButton>
      </form>
      <p v-if="checking" class="visually-hidden" role="status">Checking the code…</p>
    </template>

    <template v-else-if="game">
      <h1>
        Join <strong data-testid="host-name">{{ game.hostName }}</strong>'s game
      </h1>
      <p
        class="join__settings"
        data-testid="host-settings"
        :data-chat="game.hostChatOn ? 'on' : 'off'"
        :data-video="game.hostVideoOn ? 'on' : 'off'"
      >
        {{ game.hostName }} chose: chat {{ game.hostChatOn ? 'on' : 'off' }} · video
        {{ game.hostVideoOn ? 'on' : 'off' }}
      </p>
      <form class="join__form" novalidate @submit.prevent="join">
        <TextInput
          ref="nameField"
          v-model="name"
          label="Your name"
          :error="nameError"
          :maxlength="PLAYER_NAME_MAX_LENGTH * 2"
          autocomplete="nickname"
          autocapitalize="words"
          enterkeyhint="go"
          data-testid="name-input"
        />
        <p v-if="joinError" class="join__error" role="alert" data-testid="join-error">
          {{ joinError }}
        </p>
        <BaseButton type="submit" size="lg" block :loading="joining" data-testid="join-submit">
          Join game
        </BaseButton>
      </form>
    </template>

    <p v-else role="status">Checking the code…</p>
  </AppPage>
</template>

<style scoped>
.join__form {
  display: grid;
  gap: var(--space-5);
}
.join__code :deep(input) {
  font-size: var(--font-size-2xl);
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
}
.join__settings {
  margin: calc(-1 * var(--space-2)) 0 var(--space-5);
  color: var(--color-ink-muted);
}
.join__error {
  margin: 0;
  color: var(--color-danger);
  font-weight: 600;
}
.join__actions {
  display: grid;
  gap: var(--space-3);
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { canShare, copyText } from '@/composables/useClipboard'
import { useToasts } from '@/stores/toasts'
import BaseButton from '@/components/base/BaseButton.vue'

/** Shown to the host until the second player joins: the code to send, and ways to send it. */
const props = defineProps<{ code: string }>()

const toasts = useToasts()
const link = computed(() => `${window.location.origin}/j/${props.code}`)
const shareData = computed(() => ({
  title: 'Cribbage',
  text: `Play cribbage with me! Join with code ${props.code}:`,
  url: link.value,
}))
const shareable = computed(() => canShare(shareData.value))

async function copy(text: string, what: string) {
  const ok = await copyText(text)
  toasts.push(ok ? `${what} copied` : `Couldn't copy. Select the ${what.toLowerCase()} instead.`, {
    kind: ok ? 'info' : 'error',
  })
}

async function share() {
  try {
    await navigator.share(shareData.value)
  } catch {
    // Cancelled, or not allowed: nothing to do.
  }
}
</script>

<template>
  <section class="waiting-room" aria-labelledby="waiting-title">
    <h1 id="waiting-title" class="waiting-room__title">Send this code to a friend</h1>
    <p
      class="waiting-room__code"
      data-testid="game-code"
      :aria-label="`Game code ${code.split('').join(' ')}`"
    >
      {{ code }}
    </p>
    <p class="waiting-room__link">
      or the link <a :href="link" data-testid="join-link">{{ link }}</a>
    </p>
    <div class="waiting-room__actions">
      <BaseButton v-if="shareable" block size="lg" @click="share">Share</BaseButton>
      <BaseButton
        block
        :variant="shareable ? 'secondary' : 'primary'"
        data-testid="copy-code"
        @click="copy(code, 'Code')"
      >
        Copy code
      </BaseButton>
      <BaseButton block variant="secondary" data-testid="copy-link" @click="copy(link, 'Link')">
        Copy link
      </BaseButton>
    </div>
    <p class="waiting-room__status" role="status" data-testid="waiting-status">
      <span class="waiting-room__dot" aria-hidden="true" /> Waiting for your opponent…
    </p>
  </section>
</template>

<style scoped>
.waiting-room {
  text-align: center;
}
.waiting-room__title {
  margin: 0;
  font-size: var(--font-size-xl);
}
.waiting-room__code {
  margin: var(--space-4) 0 var(--space-1);
  font-size: var(--font-size-display);
  font-weight: 800;
  letter-spacing: 0.2em;
  font-variant-numeric: tabular-nums;
}
.waiting-room__link {
  margin: 0 0 var(--space-5);
  overflow-wrap: anywhere;
  color: var(--color-ink-muted);
  font-size: var(--font-size-sm);
}
.waiting-room__actions {
  display: grid;
  gap: var(--space-3);
}
.waiting-room__status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin: var(--space-5) 0 0;
  color: var(--color-ink-muted);
}
.waiting-room__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-felt-light);
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .waiting-room__dot {
    animation: none;
  }
}
</style>

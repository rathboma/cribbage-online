<script setup lang="ts">
import { computed } from 'vue'
import type { LegalActions } from '@shared/protocol'
import BaseButton from '@/components/base/BaseButton.vue'

/**
 * The buttons a player presses: Send to crib, Cut, Go and Next hand. Only what the server
 * says is legal is offered; playing a card happens on the table, not here.
 */
const props = defineProps<{
  legal: LegalActions
  /** How many cards are picked for the crib. */
  selectedCount: number
  /** A move is on its way to the server. */
  busy: boolean
}>()

defineEmits<{ discard: []; cut: []; go: []; ready: [] }>()

const offered = computed(
  () => props.legal.discard || props.legal.cut || props.legal.go || props.legal.ready,
)
</script>

<template>
  <div v-if="offered" class="action-bar">
    <BaseButton
      v-if="legal.discard"
      size="lg"
      block
      :disabled="selectedCount !== 2"
      :loading="busy"
      data-testid="action-discard"
      @click="$emit('discard')"
    >
      Send to crib<span v-if="selectedCount !== 2"> ({{ selectedCount }} of 2)</span>
    </BaseButton>
    <BaseButton
      v-if="legal.cut"
      size="lg"
      block
      :loading="busy"
      data-testid="action-cut"
      @click="$emit('cut')"
    >
      Cut
    </BaseButton>
    <BaseButton
      v-if="legal.go"
      size="lg"
      block
      :loading="busy"
      data-testid="action-go"
      @click="$emit('go')"
    >
      Go
    </BaseButton>
    <BaseButton
      v-if="legal.ready"
      size="lg"
      block
      :loading="busy"
      data-testid="action-ready"
      @click="$emit('ready')"
    >
      Next hand
    </BaseButton>
  </div>
</template>

<style scoped>
.action-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
}
@media (max-height: 620px) {
  .action-bar :deep(.base-button) {
    min-height: 44px;
    padding-block: var(--space-2);
  }
}
</style>

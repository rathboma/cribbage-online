<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  /** Visible label for the switch. */
  label: string
  /** Optional line under the label. */
  description?: string
  disabled?: boolean
}>()

const model = defineModel<boolean>({ default: false })
const id = useId()
</script>

<template>
  <!-- The whole row is a <label>, so clicking the text toggles the switch too. -->
  <label class="toggle-switch">
    <div class="toggle-switch__text">
      <span :id="`${id}-label`" class="toggle-switch__label">
        {{ label }}
        <slot name="badge" />
      </span>
      <span v-if="description" :id="`${id}-desc`" class="toggle-switch__description">
        {{ description }}
      </span>
    </div>
    <button
      type="button"
      role="switch"
      class="toggle-switch__control"
      :aria-checked="model"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="description ? `${id}-desc` : undefined"
      :disabled="disabled"
      @click="model = !model"
    >
      <span class="toggle-switch__thumb" aria-hidden="true" />
    </button>
  </label>
</template>

<style scoped>
.toggle-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  min-height: 44px;
  cursor: pointer;
}
.toggle-switch__text {
  display: grid;
}
.toggle-switch__label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
}
.toggle-switch__description {
  color: var(--color-ink-muted);
  font-size: var(--font-size-sm);
}
.toggle-switch__control {
  position: relative;
  flex: none;
  width: 52px;
  height: 32px;
  padding: 0;
  border: 2px solid var(--color-ink-muted);
  border-radius: var(--radius-pill);
  background: var(--color-cream-dark);
  cursor: pointer;
  transition: background-color 0.15s;
}
.toggle-switch__control[aria-checked='true'] {
  border-color: var(--color-felt);
  background: var(--color-felt);
}
.toggle-switch__control:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.toggle-switch__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-ink-muted);
  border-radius: 50%;
  background: var(--color-white);
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s;
}
.toggle-switch__control[aria-checked='true'] .toggle-switch__thumb {
  border-color: var(--color-white);
}
@media (forced-colors: active) {
  .toggle-switch__thumb {
    background: CanvasText;
    border-color: CanvasText;
  }
  .toggle-switch__control[aria-checked='true'] {
    background: Highlight;
    border-color: Highlight;
  }
  .toggle-switch__control[aria-checked='true'] .toggle-switch__thumb {
    background: HighlightText;
    border-color: HighlightText;
  }
}
.toggle-switch__control[aria-checked='true'] .toggle-switch__thumb {
  transform: translateX(20px);
}
@media (prefers-reduced-motion: reduce) {
  .toggle-switch__thumb,
  .toggle-switch__control {
    transition: none;
  }
}
</style>

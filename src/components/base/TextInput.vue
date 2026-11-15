<script setup lang="ts">
import { computed, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** Visible label (required: every input is labelled). */
  label: string
  /** Help shown under the field. */
  hint?: string
  /** Error shown under the field; marks the input invalid. */
  error?: string | null
}>()

const model = defineModel<string>({ default: '' })

const id = useId()
const describedBy = computed(
  () =>
    [props.error ? `${id}-error` : null, props.hint ? `${id}-hint` : null]
      .filter(Boolean)
      .join(' ') || undefined,
)
</script>

<template>
  <div class="text-input" :class="{ 'text-input--invalid': error }">
    <label :for="id" class="text-input__label">{{ label }}</label>
    <input
      :id="id"
      v-model="model"
      class="text-input__field"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="describedBy"
      v-bind="$attrs"
    />
    <p v-if="hint" :id="`${id}-hint`" class="text-input__hint">{{ hint }}</p>
    <p v-if="error" :id="`${id}-error`" class="text-input__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.text-input {
  display: grid;
  gap: var(--space-1);
}
.text-input__label {
  font-weight: 600;
}
.text-input__field {
  min-height: 48px;
  padding: var(--space-2) var(--space-3);
  border: 2px solid var(--color-ink-muted);
  border-radius: var(--radius-md);
  background: var(--color-white);
  color: var(--color-ink);
  font: inherit;
  font-size: var(--font-size-lg);
}
.text-input--invalid .text-input__field {
  border-color: var(--color-danger);
}
.text-input__hint {
  margin: 0;
  color: var(--color-ink-muted);
  font-size: var(--font-size-sm);
}
.text-input__error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-sm);
  font-weight: 600;
}
</style>

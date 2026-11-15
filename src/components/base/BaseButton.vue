<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

const props = withDefaults(
  defineProps<{
    /** primary: the main action; secondary: an alternative; ghost: low emphasis. */
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'md' | 'lg'
    /** Render as a link to this route instead of a button. */
    to?: RouteLocationRaw
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    /** Shows a busy state and blocks clicks. */
    loading?: boolean
    /** Stretch to the full width of the container. */
    block?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button', disabled: false, loading: false, block: false },
)

function ignoreWhileLoading(event: MouseEvent) {
  if (props.loading) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}

const classes = computed(() => [
  'base-button',
  `base-button--${props.variant}`,
  `base-button--${props.size}`,
  { 'base-button--block': props.block, 'base-button--loading': props.loading },
])
</script>

<template>
  <RouterLink v-if="to && !disabled" :to="to" :class="classes"><slot /></RouterLink>
  <!-- While loading the button stays focusable (so focus isn't lost) but ignores clicks. -->
  <button
    v-else
    :type="type"
    :class="classes"
    :disabled="disabled"
    :aria-disabled="loading || undefined"
    :aria-busy="loading || undefined"
    @click.capture="ignoreWhileLoading"
  >
    <span v-if="loading" class="base-button__spinner" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-2) var(--space-5);
  border: 2px solid transparent;
  border-radius: var(--radius-pill);
  font: inherit;
  font-weight: 600;
  line-height: 1.2;
  text-decoration: none;
  cursor: pointer;
  transition:
    background-color 0.15s,
    transform 0.05s;
}
.base-button:active:not(:disabled):not([aria-disabled='true']) {
  transform: translateY(1px);
}
.base-button:disabled,
.base-button[aria-disabled='true'] {
  cursor: not-allowed;
  opacity: 0.55;
}
.base-button--loading[aria-disabled='true'] {
  cursor: progress;
  opacity: 0.8;
}
.base-button--lg {
  min-height: 52px;
  padding: var(--space-3) var(--space-6);
  font-size: var(--font-size-lg);
}
.base-button--block {
  display: flex;
  width: 100%;
}
.base-button--primary {
  background: var(--color-felt);
  color: var(--color-cream);
}
.base-button--primary:hover:not(:disabled) {
  background: var(--color-felt-light);
}
.base-button--secondary {
  background: transparent;
  border-color: var(--color-felt);
  color: var(--color-felt);
}
.base-button--secondary:hover:not(:disabled) {
  background: var(--color-cream-dark);
}
.base-button--ghost {
  background: transparent;
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.base-button--danger {
  background: var(--color-danger);
  color: var(--color-white);
}
.base-button--danger:hover:not(:disabled) {
  filter: brightness(1.1);
}
.base-button--ghost:hover:not(:disabled) {
  text-decoration-thickness: 2px;
}
.base-button__spinner {
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .base-button__spinner {
    animation: none;
  }
}
</style>

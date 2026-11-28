<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue'
import ToggleSwitch from '@/components/base/ToggleSwitch.vue'
import { useTableView } from '@/composables/useTableView'

/**
 * The game menu: a button in the game screen's top bar that opens a small panel of settings
 * for this game. For now it holds the choice of table: the 3D one, or the simple one that
 * works with a keyboard and a screen reader. The game screen leaves it out when there is
 * nothing to choose (no WebGL).
 */
const table = useTableView()
const threeD = computed({
  get: () => table.view.value === '3d',
  set: (on: boolean) => table.set(on ? '3d' : '2d'),
})

const open = ref(false)
const panelId = useId()
const root = useTemplateRef<HTMLElement>('root')
const button = useTemplateRef<HTMLButtonElement>('button')

function close({ focus = false } = {}) {
  open.value = false
  if (focus) button.value?.focus()
}

// A press anywhere else closes it, as a menu should.
function onPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) close()
}
watch(open, (now) => {
  if (now) document.addEventListener('pointerdown', onPointerDown, true)
  else document.removeEventListener('pointerdown', onPointerDown, true)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
</script>

<template>
  <div ref="root" class="game-menu" @keydown.esc="close({ focus: true })">
    <button
      ref="button"
      type="button"
      class="game-menu__button"
      :aria-expanded="open"
      :aria-controls="panelId"
      data-testid="game-menu"
      @click="open = !open"
    >
      Menu <span aria-hidden="true" class="game-menu__caret">▾</span>
    </button>
    <div
      v-show="open"
      :id="panelId"
      class="game-menu__panel"
      role="group"
      aria-label="Game menu"
      data-testid="game-menu-panel"
    >
      <ToggleSwitch
        v-model="threeD"
        label="3D table"
        description="Off: the simple table, which also works with a keyboard and a screen reader."
        data-testid="view-switch"
      />
    </div>
  </div>
</template>

<style scoped>
.game-menu {
  position: relative;
}
.game-menu__button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 2.25rem;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-cream);
  border-radius: var(--radius-pill);
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.game-menu__button:hover {
  background: var(--color-felt-dark);
}
.game-menu__caret {
  font-size: 0.8em;
}
/* A card of settings under the button, over everything else on the screen. */
.game-menu__panel {
  --color-focus: var(--color-focus-light);
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  z-index: 20;
  width: min(20rem, calc(100vw - 2 * var(--space-3)));
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-cream);
  color: var(--color-ink);
  box-shadow: var(--shadow-md);
  font-size: var(--font-size-sm);
}
</style>

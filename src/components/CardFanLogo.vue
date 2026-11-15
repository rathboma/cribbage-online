<script setup lang="ts">
/** Two fanned playing cards: the 5 of hearts over the jack of clubs. Decorative. */
</script>

<template>
  <svg class="card-fan" viewBox="0 0 120 90" aria-hidden="true" focusable="false">
    <g transform="rotate(-12 60 80)">
      <rect
        x="30"
        y="8"
        width="44"
        height="64"
        rx="5"
        fill="var(--color-white)"
        stroke="var(--color-cream-dark)"
      />
      <text x="36" y="24" font-size="13" font-weight="700" fill="var(--color-ink)">J</text>
      <text x="36" y="37" font-size="12" fill="var(--color-ink)">♣</text>
    </g>
    <g transform="rotate(10 60 80)">
      <rect
        x="46"
        y="8"
        width="44"
        height="64"
        rx="5"
        fill="var(--color-white)"
        stroke="var(--color-cream-dark)"
      />
      <text x="52" y="24" font-size="13" font-weight="700" fill="var(--color-card-red)">5</text>
      <text x="52" y="37" font-size="12" fill="var(--color-card-red)">♥</text>
      <text x="68" y="56" font-size="22" fill="var(--color-card-red)" text-anchor="middle">♥</text>
    </g>
  </svg>
</template>

<style scoped>
.card-fan {
  display: block;
  width: 120px;
  height: 90px;
  margin: 0 auto var(--space-2);
}
</style>

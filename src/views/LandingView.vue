<script setup lang="ts">
import AppPage from '@/components/AppPage.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import CardFanLogo from '@/components/CardFanLogo.vue'
</script>

<template>
  <AppPage>
    <div class="landing">
      <CardFanLogo />
      <h1 class="landing__title">Cribbage</h1>
      <p class="landing__pitch">Play cribbage with a friend. No signup.</p>
      <nav class="landing__actions" aria-label="Get started">
        <BaseButton to="/new" size="lg" block>Start game</BaseButton>
        <BaseButton to="/join" size="lg" variant="secondary" block>Join game</BaseButton>
      </nav>
    </div>
  </AppPage>
</template>

<style scoped>
.landing {
  text-align: center;
}
.landing__title {
  margin: 0;
  font-size: var(--font-size-display);
  letter-spacing: -0.02em;
}
.landing__pitch {
  margin: var(--space-2) 0 var(--space-6);
  color: var(--color-ink-muted);
  font-size: var(--font-size-lg);
}
.landing__actions {
  display: grid;
  gap: var(--space-3);
}
</style>

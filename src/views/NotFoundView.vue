<script setup lang="ts">
import AppPage from '@/components/AppPage.vue'
import BaseButton from '@/components/base/BaseButton.vue'
</script>

<template>
  <AppPage>
    <h1>Page not found</h1>
    <p>
      There's nothing at this address. If someone sent you a game link, check it was copied in full.
    </p>
    <BaseButton to="/" block>Go to the start page</BaseButton>
  </AppPage>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <main>
    <h1>Cribbage Online</h1>
    <p>Play cribbage with a friend in your browser. No signup.</p>
    <nav aria-label="Get started">
      <ul>
        <li><RouterLink to="/new">Start a game</RouterLink></li>
        <li><RouterLink to="/join">Join a game</RouterLink></li>
      </ul>
    </nav>
  </main>
</template>

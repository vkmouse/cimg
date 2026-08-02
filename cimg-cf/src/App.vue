<script setup lang="ts">
import { RouterView } from 'vue-router'
import AccessGate from './components/AccessGate.vue'
import './styles/variables.css'
import './styles/base.css'
import './styles/animations.css'
</script>

<template>
  <AccessGate>
    <RouterView />
  </AccessGate>
</template>

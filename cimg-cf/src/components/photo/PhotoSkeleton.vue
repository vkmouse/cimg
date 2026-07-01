<template>
  <div class="photo-skeleton-grid" aria-hidden="true">
    <div v-for="n in count" :key="n" class="photo-skeleton-grid__cell" />
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    count?: number;
  }>(),
  {
    count: 24,
  },
);
</script>

<style scoped>
.photo-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--grid-gap);
}

.photo-skeleton-grid__cell {
  aspect-ratio: 1 / 1;
  background: linear-gradient(
    100deg,
    var(--bg-elevated) 40%,
    var(--bg-elevated-2) 50%,
    var(--bg-elevated) 60%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}
</style>

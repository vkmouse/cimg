<template>
  <div class="photo-grid">
    <PhotoCell
      v-for="(url, index) in urls"
      :key="url"
      :src="url"
      :alt="`照片 ${index + 1}`"
    />
  </div>
</template>

<script setup lang="ts">
import PhotoCell from "./PhotoCell.vue";

defineProps<{
  urls: string[];
}>();
</script>

<style scoped>
.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--grid-gap);
}
</style>

<template>
  <div class="photo-grid">
    <PhotoCell
      v-for="(photo, index) in photos"
      :key="photo.imageId"
      :src="photo.imageUrl"
      :alt="`照片 ${index + 1}`"
      :image-id="photo.imageId"
    />
  </div>
</template>

<script setup lang="ts">
import PhotoCell from "./PhotoCell.vue";
import type { PhotoThumbnail } from "../../composables/usePhotoLibrary";

defineProps<{
  photos: PhotoThumbnail[];
}>();
</script>

<style scoped>
.photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--grid-gap);
}
</style>

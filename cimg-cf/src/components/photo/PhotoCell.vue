<template>
  <div class="photo-cell" :class="{ 'photo-cell--pressed': pressed }">
    <!-- 骨架屏：圖片載入完成前顯示 -->
    <div v-if="!loaded" class="photo-cell__skeleton" aria-hidden="true" />

    <img
      :src="src"
      :alt="alt"
      class="photo-cell__img"
      :class="{ 'photo-cell__img--loaded': loaded }"
      loading="lazy"
      @load="loaded = true"
      @pointerdown="pressed = true"
      @pointerup="pressed = false"
      @pointerleave="pressed = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  src: string;
  alt: string;
}>();

const loaded = ref(false);
const pressed = ref(false);
</script>

<style scoped>
.photo-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background-color: var(--bg-elevated);
}

.photo-cell__skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    var(--bg-elevated) 40%,
    var(--bg-elevated-2) 50%,
    var(--bg-elevated) 60%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}

.photo-cell__img {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transform: scale(1);
  transition:
    opacity var(--duration-medium) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

.photo-cell__img--loaded {
  opacity: 1;
  animation: photo-fade-in var(--duration-medium) var(--ease-standard);
}

/* 按壓回饋：貼近 iOS 相簿點按縮圖時的輕微縮放 + 變暗 */
.photo-cell--pressed .photo-cell__img {
  transform: scale(0.96);
  filter: brightness(0.85);
}
</style>

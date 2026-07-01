<template>
  <section class="library-page">
    <header class="library-header">
      <h1 class="library-title">圖庫</h1>
    </header>

    <div class="library-content">
      <!-- 首次載入：整頁骨架網格 -->
      <PhotoSkeleton v-if="loading && photoUrls.length === 0" />

      <!-- 錯誤狀態 -->
      <PhotoEmptyState
        v-else-if="error"
        variant="error"
        :message="`無法載入照片，請檢查網路連線後重試。（${error}）`"
      />

      <!-- 空狀態 -->
      <PhotoEmptyState
        v-else-if="photoUrls.length === 0"
        variant="empty"
        message="這裡還沒有照片。拍下第一張照片後，它會顯示在這裡。"
      />

      <!-- 照片網格 -->
      <PhotoGrid v-else :urls="photoUrls" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { usePhotoLibrary } from "../composables/usePhotoLibrary";
import PhotoGrid from "../components/photo/PhotoGrid.vue";
import PhotoSkeleton from "../components/photo/PhotoSkeleton.vue";
import PhotoEmptyState from "../components/photo/PhotoEmptyState.vue";

const { photoUrls, loading, error, load } = usePhotoLibrary();

onMounted(() => {
  load();
});
</script>

<style scoped>
.library-page {
  min-height: 100dvh;
  background-color: var(--bg-base);
  color: var(--label-primary);
}

.library-header {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: var(--header-padding-top) var(--header-padding-x) var(--header-padding-bottom);
  background-color: var(--bg-base);
}

.library-title {
  font-size: var(--font-title);
  font-weight: 700;
  letter-spacing: 0.4px;
}

.library-content {
  padding-bottom: 24px;
}
</style>

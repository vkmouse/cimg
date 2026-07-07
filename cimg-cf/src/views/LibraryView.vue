<template>
  <section class="library-page">
    <header class="library-header">
      <h1 class="library-title">圖庫</h1>
    </header>

    <div class="library-content">
      <!-- 首次載入：整頁骨架網格 -->
      <PhotoSkeleton v-if="loading && photos.length === 0" />

      <!-- 錯誤狀態 -->
      <PhotoEmptyState
        v-else-if="error"
        variant="error"
        :message="`無法載入照片，請檢查網路連線後重試。（${error}）`"
      />

      <!-- 空狀態 -->
      <PhotoEmptyState
        v-else-if="photos.length === 0"
        variant="empty"
        message="這裡還沒有照片。拍下第一張照片後，它會顯示在這裡。"
      />

      <!-- 照片網格 -->
      <template v-else>
        <PhotoGrid :photos="photos" />

        <!-- 無限捲動觸發點：捲到底時透過 IntersectionObserver 載入下一批；沒有下一頁時不渲染，watch 會自動 unobserve -->
        <div v-if="hasMore" ref="sentinel" class="load-more-sentinel">
          <span v-if="loadingMore" class="load-more-hint">載入更多照片中…</span>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { usePhotoLibrary } from "../composables/usePhotoLibrary";
import PhotoGrid from "../components/photo/PhotoGrid.vue";
import PhotoSkeleton from "../components/photo/PhotoSkeleton.vue";
import PhotoEmptyState from "../components/photo/PhotoEmptyState.vue";

const { photos, loading, loadingMore, error, hasMore, loadMore } = usePhotoLibrary();

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

function setupObserver() {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        loadMore();
      }
    },
    { rootMargin: "200px" },
  );
}

// sentinel 只在網格渲染出來後才存在（v-else 分支），所以要 watch 它的掛載時機再 observe。
watch(sentinel, (el, prevEl) => {
  if (prevEl && observer) {
    observer.unobserve(prevEl);
  }
  if (el && observer) {
    observer.observe(el);
  }
});

onMounted(() => {
  setupObserver();
});

onBeforeUnmount(() => {
  observer?.disconnect();
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

.load-more-sentinel {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 48px;
  padding-top: 16px;
}

.load-more-hint {
  font-size: var(--font-caption, 13px);
  color: var(--label-secondary, #888);
}
</style>

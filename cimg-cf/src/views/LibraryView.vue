<template>
  <section class="library-page">
    <header class="library-header">
      <h1 class="library-title">圖庫</h1>
      <button
        type="button"
        class="library-filter-btn"
        :class="{ 'library-filter-btn--active': isFilterActive }"
        aria-label="篩選日期"
        @click="filterModalOpen = true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m9 12h3.75M16.5 18a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 18H13.5m-9-6h5.25m5.25 0h9M13.5 12a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0"
          />
        </svg>
      </button>
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

    <FilterModal
      v-model:open="filterModalOpen"
      :applied-start="appliedStart"
      :applied-end="appliedEnd"
      @apply="applyFilter"
      @clear="clearFilter"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePhotoLibrary } from "../composables/usePhotoLibrary";
import PhotoGrid from "../components/photo/PhotoGrid.vue";
import PhotoSkeleton from "../components/photo/PhotoSkeleton.vue";
import PhotoEmptyState from "../components/photo/PhotoEmptyState.vue";
import FilterModal from "../components/photo/FilterModal.vue";
import { dateKeysToFilter, isValidDateKey, type DateKey } from "../utils/dateRange";
import type { PhotoDateFilter } from "../types";

const route = useRoute();
const router = useRouter();

// 篩選狀態的唯一來源是網址 query（?start=&end=），重新整理頁面時才能還原上次篩選的區間。
const queryStart = route.query.start;
const queryEnd = route.query.end;
const initialStart = typeof queryStart === "string" ? queryStart : null;
const initialEnd = typeof queryEnd === "string" ? queryEnd : null;
const hasValidInitialRange =
  isValidDateKey(initialStart) && isValidDateKey(initialEnd) && initialStart <= initialEnd;

const filterModalOpen = ref(false);
const appliedStart = ref<DateKey | null>(hasValidInitialRange ? initialStart : null);
const appliedEnd = ref<DateKey | null>(hasValidInitialRange ? initialEnd : null);

const isFilterActive = computed(() => !!(appliedStart.value && appliedEnd.value));

const activeDateFilter = computed<PhotoDateFilter | null>(() =>
  appliedStart.value && appliedEnd.value
    ? dateKeysToFilter(appliedStart.value, appliedEnd.value)
    : null,
);

function applyFilter(start: DateKey, end: DateKey) {
  appliedStart.value = start;
  appliedEnd.value = end;
  router.replace({ query: { ...route.query, start, end } });
}

function clearFilter() {
  appliedStart.value = null;
  appliedEnd.value = null;
  const nextQuery = { ...route.query };
  delete nextQuery.start;
  delete nextQuery.end;
  router.replace({ query: nextQuery });
}

const { photos, loading, loadingMore, error, hasMore, loadMore } = usePhotoLibrary(activeDateFilter);

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
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--header-padding-top) var(--header-padding-x) var(--header-padding-bottom);
  background-color: var(--bg-base);
}

.library-title {
  font-size: var(--font-title);
  font-weight: 700;
  letter-spacing: 0.4px;
}

.library-filter-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--label-primary);
  cursor: pointer;
  flex-shrink: 0;
}

.library-filter-btn svg {
  width: 22px;
  height: 22px;
}

.library-filter-btn--active {
  color: var(--accent);
}

.library-filter-btn:active {
  background-color: var(--bg-elevated);
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

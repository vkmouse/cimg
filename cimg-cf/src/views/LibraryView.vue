<template>
  <section class="library-page">
    <header class="library-header">
      <h1 class="library-title">圖庫</h1>
      <div class="library-header-actions">
        <button
          type="button"
          class="library-sort-btn"
          :aria-label="sortOrder === 'asc' ? '目前為最舊在上，點擊改為最新在上' : '目前為最新在上，點擊改為最舊在上'"
          @click="toggleSort"
        >
          <!-- desc（新到舊）：↓；asc（舊到新）：↑ -->
          <svg
            v-if="sortOrder === 'desc'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m0 0-5.25-5.25M12 19.5l5.25-5.25" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 19.5v-15m0 0 5.25 5.25M12 4.5 6.75 9.75" />
          </svg>
        </button>
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
      </div>
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
import type { PhotoDateFilter, PhotoSortOrder } from "../types";

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

// 排序狀態的唯一來源也是網址 query（?sort=）：只有 `asc` 才代表「舊到新」，
// 其他情況（沒帶 / 帶了不合法的值）一律視為預設的 `desc`（新到舊），且預設值不寫回網址。
const querySort = route.query.sort;
const sortOrder = ref<PhotoSortOrder>(querySort === "asc" ? "asc" : "desc");

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
  // 清除篩選時，排序也一併重設回預設（新到舊），網址上的 start/end/sort 全部拿掉。
  sortOrder.value = "desc";
  const nextQuery = { ...route.query };
  delete nextQuery.start;
  delete nextQuery.end;
  delete nextQuery.sort;
  router.replace({ query: nextQuery });
}

function toggleSort() {
  sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  const nextQuery = { ...route.query };
  if (sortOrder.value === "asc") {
    nextQuery.sort = "asc";
  } else {
    delete nextQuery.sort;
  }
  router.replace({ query: nextQuery });
}

const { photos, loading, loadingMore, error, hasMore, loadMore } = usePhotoLibrary(
  activeDateFilter,
  sortOrder,
);

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

.library-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.library-filter-btn,
.library-sort-btn {
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

.library-filter-btn svg,
.library-sort-btn svg {
  width: 22px;
  height: 22px;
}

.library-filter-btn--active {
  color: var(--accent);
}

.library-filter-btn:active,
.library-sort-btn:active {
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

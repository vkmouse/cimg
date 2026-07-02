import { ref } from "vue";
import { fetchMe, fetchAppConfig, fetchPhotoItems } from "../services/api";
import { resolvePhotoThumbnailUrls } from "../services/s3";
import type { AppConfig, PhotoCursor } from "../types";

/**
 * 管理圖庫的載入狀態、分頁游標與照片網址清單。
 * View 呼叫 `load()` 取得第一頁，捲到底時呼叫 `loadMore()` 取得下一頁。
 */
export function usePhotoLibrary() {
  const photoUrls = ref<string[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  const hasMore = ref(true);

  let config: AppConfig | null = null;
  let nextCursor: PhotoCursor | null = null;

  async function load() {
    loading.value = true;
    error.value = null;
    photoUrls.value = [];
    nextCursor = null;
    hasMore.value = true;

    try {
      await fetchMe();
      const [fetchedConfig, page] = await Promise.all([fetchAppConfig(), fetchPhotoItems()]);
      config = fetchedConfig;
      photoUrls.value = await resolvePhotoThumbnailUrls(config, page.items);
      nextCursor = page.nextCursor;
      hasMore.value = page.hasMore;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function loadMore() {
    // 防重入：載入中、還沒完成首次載入、或已經沒有下一頁時直接略過。
    if (loadingMore.value || loading.value || !hasMore.value || !config) {
      return;
    }

    loadingMore.value = true;

    try {
      const page = await fetchPhotoItems(nextCursor ?? undefined);
      const urls = await resolvePhotoThumbnailUrls(config, page.items);
      photoUrls.value = [...photoUrls.value, ...urls];
      nextCursor = page.nextCursor;
      hasMore.value = page.hasMore;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loadingMore.value = false;
    }
  }

  return {
    photoUrls,
    loading,
    loadingMore,
    error,
    hasMore,
    load,
    loadMore,
  };
}

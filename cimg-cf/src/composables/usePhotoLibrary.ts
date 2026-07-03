import { ref } from "vue";
import { fetchMe, fetchPhotoItems } from "../services/api";
import type { PhotoCursor } from "../types";

/** 列表頁一格縮圖需要的最小資料：imageId 用來點擊導頁到 detail 頁，imageUrl 是縮圖網址。 */
export interface PhotoThumbnail {
  imageId: string;
  imageUrl: string;
}

/**
 * 管理圖庫的載入狀態、分頁游標與照片清單。
 * View 呼叫 `load()` 取得第一頁，捲到底時呼叫 `loadMore()` 取得下一頁。
 *
 * 後端 presign 改版後，`/api/photos` 回傳的每個 item 已經直接帶
 * `imageUrl`（`/api/img?...`），前端不需要再另外呼叫 `/api/config`
 * 或自己用 AWS SDK 組 presigned URL。
 */
export function usePhotoLibrary() {
  const photos = ref<PhotoThumbnail[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref<string | null>(null);
  const hasMore = ref(true);

  let hasLoadedOnce = false;
  let nextCursor: PhotoCursor | null = null;

  function thumbnailsOf(items: { imageId: string; imageUrl: string | null }[]): PhotoThumbnail[] {
    return items
      .filter((i): i is { imageId: string; imageUrl: string } => i.imageUrl !== null)
      .map((i) => ({ imageId: i.imageId, imageUrl: i.imageUrl }));
  }

  async function load() {
    loading.value = true;
    error.value = null;
    photos.value = [];
    nextCursor = null;
    hasMore.value = true;
    hasLoadedOnce = false;

    try {
      await fetchMe();
      const page = await fetchPhotoItems();
      photos.value = thumbnailsOf(page.items);
      nextCursor = page.nextCursor;
      hasMore.value = page.hasMore;
      hasLoadedOnce = true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  async function loadMore() {
    // 防重入：載入中、還沒完成首次載入、或已經沒有下一頁時直接略過。
    if (loadingMore.value || loading.value || !hasMore.value || !hasLoadedOnce) {
      return;
    }

    loadingMore.value = true;

    try {
      const page = await fetchPhotoItems(nextCursor ?? undefined);
      photos.value = [...photos.value, ...thumbnailsOf(page.items)];
      nextCursor = page.nextCursor;
      hasMore.value = page.hasMore;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loadingMore.value = false;
    }
  }

  return {
    photos,
    loading,
    loadingMore,
    error,
    hasMore,
    load,
    loadMore,
  };
}

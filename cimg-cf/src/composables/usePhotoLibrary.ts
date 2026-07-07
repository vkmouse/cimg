import { computed } from "vue";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/vue-query";
import { fetchMe, fetchPhotoItems } from "../services/api";
import type { PhotoCursor, PhotoListResponse } from "../types";

/** 列表頁一格縮圖需要的最小資料：imageId 用來點擊導頁到 detail 頁，imageUrl 是縮圖網址。 */
export interface PhotoThumbnail {
  imageId: string;
  imageUrl: string;
}

function thumbnailsOf(items: { imageId: string; imageUrl: string | null }[]): PhotoThumbnail[] {
  return items
    .filter((i): i is { imageId: string; imageUrl: string } => i.imageUrl !== null)
    .map((i) => ({ imageId: i.imageId, imageUrl: i.imageUrl }));
}

/**
 * 管理圖庫的載入狀態、分頁游標與照片清單。
 * View 掛載時會自動載入第一頁，捲到底時呼叫 `loadMore()` 取得下一頁；
 * `load()` 保留給未來「下拉重新整理」之類的手動重新載入情境使用。
 *
 * 後端 presign 改版後，`/api/photos` 回傳的每個 item 已經直接帶
 * `imageUrl`（`/api/img?...`），前端不需要再另外呼叫 `/api/config`
 * 或自己用 AWS SDK 組 presigned URL。
 */
export function usePhotoLibrary() {
  const queryClient = useQueryClient();

  // 先確認使用者身份（回傳值本身不需要用到，只是要讓使用者資訊還沒確認好之前，
  // 不要提早打 /api/photos）。同一個 session 內不會變，staleTime 設 Infinity 不重打。
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: 1,
  });

  const photosQuery = useInfiniteQuery({
    queryKey: ["photos"],
    queryFn: ({ pageParam }) => fetchPhotoItems(pageParam as PhotoCursor | undefined),
    initialPageParam: undefined as PhotoCursor | undefined,
    getNextPageParam: (lastPage: PhotoListResponse) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: computed(() => meQuery.isSuccess.value),
  });

  const photos = computed<PhotoThumbnail[]>(() => {
    const pages = photosQuery.data.value?.pages ?? [];
    return pages.flatMap((page) => thumbnailsOf(page.items));
  });

  // 首次載入中：me 還沒確認，或 me 成功後 photos 第一頁還在抓
  const loading = computed(
    () => meQuery.isPending.value || (meQuery.isSuccess.value && photosQuery.isPending.value),
  );
  const loadingMore = computed(() => photosQuery.isFetchingNextPage.value);
  const hasMore = computed(() => photosQuery.hasNextPage.value ?? false);

  const error = computed(() => {
    const err = meQuery.error.value ?? photosQuery.error.value;
    if (!err) return null;
    return err instanceof Error ? err.message : String(err);
  });

  function load() {
    // 重新整理：把 me / photos 都標成過期並重新打（photos 的第一頁到目前已載入的頁數都會重抓）
    queryClient.invalidateQueries({ queryKey: ["me"] });
    queryClient.invalidateQueries({ queryKey: ["photos"] });
  }

  function loadMore() {
    // 防重入：載入中、還沒完成首次載入、或已經沒有下一頁時直接略過。
    if (photosQuery.isFetchingNextPage.value || photosQuery.isPending.value || !hasMore.value) {
      return;
    }
    photosQuery.fetchNextPage();
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

import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { fetchMe, fetchPhotoBursts } from "../services/api";
import type { PhotoBurstItem } from "../types";

/**
 * 管理「密集拍照期間」清單的載入狀態，供 `BurstCarousel` 使用。
 * 跟 `usePhotoLibrary` 一樣先確認 `me` 成功後才打 `/api/photo-bursts`，
 * 資料量小、不分頁，`staleTime: Infinity` 同一個 session 內不重打。
 */
export function usePhotoBursts() {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: Infinity,
    retry: 1,
  });

  const burstsQuery = useQuery({
    queryKey: ["photoBursts"],
    queryFn: fetchPhotoBursts,
    staleTime: Infinity,
    enabled: computed(() => meQuery.isSuccess.value),
  });

  const bursts = computed<PhotoBurstItem[]>(() => burstsQuery.data.value?.items ?? []);
  const loading = computed(
    () => meQuery.isPending.value || (meQuery.isSuccess.value && burstsQuery.isPending.value),
  );

  return {
    bursts,
    loading,
  };
}

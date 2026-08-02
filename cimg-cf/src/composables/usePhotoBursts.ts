import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { fetchPhotoBursts } from "../services/api";
import type { PhotoBurstItem } from "../types";

/**
 * 管理「密集拍照期間」清單的載入狀態，供 `BurstCarousel` 使用。
 * 資料量小、不分頁，`staleTime: Infinity` 同一個 session 內不重打。
 *
 * 身份確認已經由 `AccessGate.vue` 統一在外層做完（`<RouterView />` 整個包在
 * `AccessGate` 裡，只有 `state === 'authenticated'` 才會 render 到這裡），
 * 這裡不需要再另外呼叫一次「確認身份」的 API 才能開始打 `/api/photo-bursts`。
 */
export function usePhotoBursts() {
  const burstsQuery = useQuery({
    queryKey: ["photoBursts"],
    queryFn: fetchPhotoBursts,
    staleTime: Infinity,
  });

  const bursts = computed<PhotoBurstItem[]>(() => burstsQuery.data.value?.items ?? []);
  const loading = computed(() => burstsQuery.isPending.value);

  return {
    bursts,
    loading,
  };
}

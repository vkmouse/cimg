import { ref } from "vue";
import { fetchMe, fetchAppConfig, fetchPhotoItems } from "../services/api";
import { resolvePhotoThumbnailUrls } from "../services/s3";

/**
 * 管理圖庫的載入狀態與照片網址清單。
 * View 只需呼叫 `load()` 並渲染回傳的 reactive state。
 */
export function usePhotoLibrary() {
  const photoUrls = ref<string[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;

    try {
      await fetchMe();
      const [config, photos] = await Promise.all([fetchAppConfig(), fetchPhotoItems()])
      photoUrls.value = await resolvePhotoThumbnailUrls(config, photos);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      loading.value = false;
    }
  }

  return {
    photoUrls,
    loading,
    error,
    load,
  };
}

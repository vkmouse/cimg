<template>
  <section class="photo-detail-page">
    <header class="photo-detail-header">
      <button type="button" class="back-button" aria-label="返回" @click="goBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>
    </header>

    <div class="photo-detail-content">
      <!-- 錯誤狀態：網路壞掉 / 伺服器錯誤 -->
      <PhotoEmptyState
        v-if="error"
        variant="error"
        :message="`無法載入照片，請檢查網路連線後重試。（${error}）`"
      />

      <!-- 空狀態：查無此照片 / 不屬於自己 / 沒有可用的圖片網址 -->
      <PhotoEmptyState v-else-if="notFound" variant="empty" message="找不到這張照片" />

      <!-- 正常顯示：三格軌道（prev / current / next），支援左右滑切換 -->
      <PhotoSwipeTrack
        v-else-if="currentPhoto"
        :current-photo="currentPhoto"
        :prev-photo="prevPhoto"
        :next-photo="nextPhoto"
        @switch-prev="onSwitchPrev"
        @switch-next="onSwitchNext"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchPhotoDetail } from "../services/api";
import PhotoEmptyState from "../components/photo/PhotoEmptyState.vue";
import PhotoSwipeTrack from "../components/photo/PhotoSwipeTrack.vue";
import type { PhotoNeighbor } from "../types";

const props = defineProps<{
  id: string;
}>();

const router = useRouter();

interface CurrentPhoto {
  imageId: string;
  imageUrl: string;
}

const currentPhoto = ref<CurrentPhoto | null>(null);
const prevPhoto = ref<PhotoNeighbor | null>(null); // 時間上更新的那張（往右滑看到）
const nextPhoto = ref<PhotoNeighbor | null>(null); // 時間上更舊的那張（往左滑看到）
const notFound = ref(false);
const error = ref<string | null>(null);

function goBack() {
  router.back();
}

/**
 * 用指定 imageId 完整重新載入三格視窗（current + prev + next）。
 * 依規格 1.3，不做前端快取，來回滑動一律重新呼叫 API。
 */
async function loadWindow(imageId: string) {
  try {
    const detail = await fetchPhotoDetail(imageId);
    if (!detail || !detail.imageUrl) {
      notFound.value = true;
      currentPhoto.value = null;
      prevPhoto.value = null;
      nextPhoto.value = null;
      return;
    }
    currentPhoto.value = { imageId: detail.imageId, imageUrl: detail.imageUrl };
    prevPhoto.value = detail.prev;
    nextPhoto.value = detail.next;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

/**
 * 往右滑成功（切到 prev）：先用已知資料同步挪動三格，讓畫面立刻接上手勢動畫，
 * 再重新呼叫 API 補齊新的窗口（新的 prev 在挪動當下是未知的，暫時為 null）。
 */
function onSwitchPrev() {
  const newCurrentUrl = prevPhoto.value?.imageUrl;
  if (!newCurrentUrl || !currentPhoto.value) return;
  const newCurrentId = prevPhoto.value!.imageId;
  nextPhoto.value = currentPhoto.value;
  currentPhoto.value = { imageId: newCurrentId, imageUrl: newCurrentUrl };
  prevPhoto.value = null;
  void loadWindow(newCurrentId);
}

/** 往左滑成功（切到 next），邏輯對稱於 onSwitchPrev。 */
function onSwitchNext() {
  const newCurrentUrl = nextPhoto.value?.imageUrl;
  if (!newCurrentUrl || !currentPhoto.value) return;
  const newCurrentId = nextPhoto.value!.imageId;
  prevPhoto.value = currentPhoto.value;
  currentPhoto.value = { imageId: newCurrentId, imageUrl: newCurrentUrl };
  nextPhoto.value = null;
  void loadWindow(newCurrentId);
}

onMounted(() => {
  void loadWindow(props.id);
});
</script>

<style scoped>
.photo-detail-page {
  /* 改用 flex column + 100dvh，讓 header 和 content 自動分配高度，
     不再靠 calc() 手動猜 header 實際渲染高度（原本的寫法會因為
     .back-button 的負 margin 而算錯，導致 content 高度跟 header
     真實佔用的高度對不上）。 */
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background-color: var(--bg-base);
  color: var(--label-primary);
}

.photo-detail-header {
  position: sticky;
  top: 0;
  z-index: 10;
  flex-shrink: 0;
  padding: var(--header-padding-top) var(--header-padding-x) var(--header-padding-bottom);
  background-color: var(--bg-base);
}

.back-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin: -8px;
  padding: 0;
  background: none;
  border: none;
  color: var(--label-primary);
  cursor: pointer;
}

.back-button svg {
  width: 24px;
  height: 24px;
}

.photo-detail-content {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  /* flex 子項預設 min-height:auto，內容（例如超大圖片）可能撐開超出可視範圍，
     導致底下的照片被推出視窗、觸控區域跟著跑掉。明確設 0 讓它老實依照
     flex:1 分配到的空間顯示，而不是被內容撐大。 */
  min-height: 0;
}
</style>
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

      <!-- 正常顯示 -->
      <img v-else-if="imageUrl" :src="imageUrl" alt="照片" class="photo-detail-img" />

      <!-- 上一張（往右） -->
      <button
        type="button"
        class="nav-button nav-button--prev"
        aria-label="上一張"
        :disabled="!prev || isNavigating"
        @click="goPrev"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>

      <!-- 下一張（往左） -->
      <button
        type="button"
        class="nav-button nav-button--next"
        aria-label="下一張"
        :disabled="!next || isNavigating"
        @click="goNext"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { fetchPhotoDetail } from "../services/api";
import PhotoEmptyState from "../components/photo/PhotoEmptyState.vue";
import type { PhotoNeighbor } from "../types";

const props = defineProps<{
  id: string;
}>();

const router = useRouter();

const imageUrl = ref<string | null>(null);
const notFound = ref(false);
const error = ref<string | null>(null);
const prev = ref<PhotoNeighbor | null>(null);
const next = ref<PhotoNeighbor | null>(null);
// 背景補資料中：true 時代表新照片的 prev/next 還沒確定，先擋住按鈕避免連點
const isNavigating = ref(false);

// 用 goPrev/goNext 切換時，route 的 props.id 也會跟著變、觸發下面的 watch。
// 但這種情況我們已經自己處理過畫面狀態了，不需要 watch 再跑一次 loadDetail（會清空畫面造成閃爍），
// 所以用這個非 reactive 旗標讓 watch 跳過那一次。
let skipWatch = false;

function goBack() {
  router.back();
}

function goPrev() {
  navigateTo(prev.value);
}

function goNext() {
  navigateTo(next.value);
}

function navigateTo(target: PhotoNeighbor | null) {
  if (!target || isNavigating.value) return;

  isNavigating.value = true;

  // 立刻用手上已有的資料顯示新照片，不清空畫面
  if (target.imageUrl) {
    imageUrl.value = target.imageUrl;
    notFound.value = false;
  } else {
    imageUrl.value = null;
    notFound.value = true;
  }
  error.value = null;
  // 新照片自己的 prev/next 還不知道，先清空 -> 按鈕會因為 !prev / !next 自然呈現 disabled
  prev.value = null;
  next.value = null;

  // 立刻換網址
  skipWatch = true;
  router.replace({ name: "photo-detail", params: { id: target.imageId } });

  // 背景打 API 補齊真正的 prev/next（並校正 imageUrl/notFound，以防手上的資料跟最新狀態不一致）
  fetchDetailInBackground(target.imageId);
}

async function fetchDetailInBackground(id: string) {
  try {
    const detail = await fetchPhotoDetail(id);
    if (!detail || !detail.imageUrl) {
      notFound.value = true;
      imageUrl.value = null;
      prev.value = detail?.prev ?? null;
      next.value = detail?.next ?? null;
      return;
    }
    imageUrl.value = detail.imageUrl;
    notFound.value = false;
    prev.value = detail.prev;
    next.value = detail.next;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    isNavigating.value = false;
  }
}

// 初次進入 detail 頁（例如從列表點縮圖、或直接用網址打開）走完整載入流程
async function loadDetail(id: string) {
  imageUrl.value = null;
  notFound.value = false;
  error.value = null;
  prev.value = null;
  next.value = null;

  try {
    const detail = await fetchPhotoDetail(id);
    if (!detail || !detail.imageUrl) {
      notFound.value = true;
      return;
    }
    imageUrl.value = detail.imageUrl;
    prev.value = detail.prev;
    next.value = detail.next;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

watch(
  () => props.id,
  (id) => {
    if (skipWatch) {
      skipWatch = false;
      return;
    }
    loadDetail(id);
  },
  { immediate: true },
);
</script>

<style scoped>
.photo-detail-page {
  min-height: 100dvh;
  background-color: var(--bg-base);
  color: var(--label-primary);
}

.photo-detail-header {
  position: sticky;
  top: 0;
  z-index: 10;
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
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100dvh - var(--header-padding-top) - var(--header-padding-bottom) - 40px);
}

.photo-detail-img {
  max-width: 100%;
  max-height: calc(100dvh - var(--header-padding-top) - var(--header-padding-bottom) - 40px);
  object-fit: contain;
}

.nav-button {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background-color: rgb(0 0 0 / 35%);
  color: var(--label-primary);
  cursor: pointer;
}

.nav-button svg {
  width: 24px;
  height: 24px;
}

.nav-button:disabled {
  opacity: 0.3;
  cursor: default;
}

.nav-button--prev {
  left: 12px;
}

.nav-button--next {
  right: 12px;
}
</style>

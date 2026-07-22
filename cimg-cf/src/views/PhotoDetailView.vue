<template>
  <section class="photo-detail-page">
    <header class="photo-detail-header">
      <button type="button" class="back-button" aria-label="返回" @click="goBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
        </svg>
      </button>

      <!-- 拍攝時間藥丸：置中顯示，第一行日期、第二行時間 -->
      <div v-if="capturedAt" class="captured-pill">
        <span class="captured-pill__date">{{ capturedAt.date }}</span>
        <span class="captured-pill__time">{{ capturedAt.time }}</span>
      </div>
    </header>

    <div class="photo-detail-content">
      <!-- 錯誤狀態：網路壞掉 / 伺服器錯誤 -->
      <PhotoEmptyState
        v-if="error"
        variant="error"
        :message="`無法載入照片，請檢查網路連線後重試。（${error}）`"
      />

      <!-- 空狀態：查無此照片 / 不屬於自己 -->
      <PhotoEmptyState v-else-if="notFound" variant="empty" message="找不到這張照片" />

      <!-- 載入中（換頁後新照片自己的 JSON 還沒回來）：骨架佔位，不顯示上一張的殘影 -->
      <div v-else-if="isLoading" class="photo-detail-skeleton" aria-hidden="true" />

      <!-- 正常顯示：先是縮圖（thumbnailUrl），原圖（imageUrl）背景下載成功後會自動換成原圖 -->
      <img v-else-if="displaySrc" :src="displaySrc" alt="照片" class="photo-detail-img" />

      <!-- 上一張（往右） -->
      <button
        type="button"
        class="nav-button nav-button--prev"
        aria-label="上一張"
        :disabled="!prev"
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
        :disabled="!next"
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
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { fetchPhotoDetail } from "../services/api";
import PhotoEmptyState from "../components/photo/PhotoEmptyState.vue";
import type { PhotoDetailResponse } from "../types";

const props = defineProps<{
  id: string;
}>();

const router = useRouter();
const queryClient = useQueryClient();

function detailQueryKey(id: string) {
  return ["photo-detail", id] as const;
}

// fetchPhotoDetail 對 404 回傳 null（代表「找不到這張照片」），這不是查詢層面的錯誤，
// 讓它成為 query 的正常成功結果（data === null），跟真正的網路/伺服器錯誤（會被 throw、進 query 的 error 狀態）分開。
function queryPhotoDetail(id: string) {
  return fetchPhotoDetail(id);
}

// query key 跟著 route 上的 id 走：無論是用 goPrev/goNext 切換、直接用網址打開、或瀏覽器上一頁/下一頁，
// 都是統一走這一條 query，不用再自己管「這次要不要重新 loadDetail」。
const { data, error: queryError, status } = useQuery({
  queryKey: computed(() => detailQueryKey(props.id)),
  queryFn: () => queryPhotoDetail(props.id),
});

// 拿到目前照片的資料後，順手把 prev/next 的完整 detail（只是 JSON，不含圖片本體）背景 prefetch 起來，
// 這樣使用者真的按上一頁/下一頁時，新照片自己的這段 API 通常已經在 cache 裡，不用再等。
// 圖片本體（thumbnailUrl/imageUrl）刻意不在這裡預先下載，等使用者真的切換過去那一頁、看到那張照片時才開始下載。
watch(
  data,
  (detail) => {
    prefetchNeighbor(detail?.prev ?? null);
    prefetchNeighbor(detail?.next ?? null);
  },
  { immediate: true },
);

function prefetchNeighbor(neighborId: string | null) {
  if (!neighborId) return;
  queryClient.prefetchQuery({
    queryKey: detailQueryKey(neighborId),
    queryFn: () => queryPhotoDetail(neighborId),
  });
}

const error = computed(() => {
  if (status.value !== "error") return null;
  return queryError.value instanceof Error ? queryError.value.message : String(queryError.value);
});

// 查無此照片：只在 query 真的 success 之後才能判斷，pending 期間（換頁過渡）先不算，避免誤判成 not found。
const notFound = computed(() => status.value === "success" && data.value === null);

// pending 狀態就是「新照片的 JSON 還沒回來」，畫面顯示骨架（不沿用上一張的殘影）。
const isLoading = computed(() => status.value === "pending");

// --- 顯示中的圖片網址：縮圖先秒開，原圖背景下載成功後自動升級替換 ---
// 每次 data 換成新照片時，先把 displaySrc 設成 thumbnailUrl（縮圖不用 preload，直接顯示），
// 再背景用 new Image() 下載 imageUrl（原圖畫質）；下載成功才把 displaySrc 換成 imageUrl，
// 下載失敗（或這張根本沒有 imageUrl）就維持顯示 thumbnailUrl，不會卡住使用者。
const displaySrc = ref<string | null>(null);

// 記錄「已經確認下載成功」的原圖網址：同一張圖之後只要再顯示到，直接沿用不用重新走一次 onload
// （瀏覽器 HTTP cache 本身也會讓重複下載幾乎瞬間完成，這裡單純避免重複建立 Image() 物件）。
const loadedFullUrls = new Set<string>();

watch(
  data,
  (detail) => {
    if (!detail) {
      displaySrc.value = null;
      return;
    }
    displaySrc.value = detail.thumbnailUrl ?? detail.imageUrl ?? null;
    upgradeToFullImage(detail);
  },
  { immediate: true },
);

function upgradeToFullImage(detail: PhotoDetailResponse) {
  const fullUrl = detail.imageUrl;
  if (!fullUrl || fullUrl === detail.thumbnailUrl) return;

  if (loadedFullUrls.has(fullUrl)) {
    displaySrc.value = fullUrl;
    return;
  }

  const img = new Image();
  img.onload = () => {
    loadedFullUrls.add(fullUrl);
    // 下載期間使用者可能已經切到別的照片，只有目前仍在看這張時才切換顯示，避免蓋掉新照片的畫面
    if (data.value?.imageId === detail.imageId) {
      displaySrc.value = fullUrl;
    }
  };
  // 下載失敗（onerror）不特別處理，維持顯示 thumbnailUrl 即可
  img.src = fullUrl;
}

// shootingDate 是秒為單位的 unix timestamp，轉成毫秒給 Date 用。
function formatCapturedAt(shootingDate: number): { date: string; time: string } {
  const d = new Date(shootingDate * 1000);

  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const period = hours < 12 ? "上午" : "下午";
  hours = hours % 12;
  if (hours === 0) hours = 12;

  return {
    date: `${yyyy}年${MM}月${dd}日`,
    time: `${period}${hours}:${minutes}`,
  };
}

// 只在拿到目前這張照片的真實資料時顯示，切換上一張/下一張的過渡期間（query 還在 pending）先不顯示，
// 避免顯示到舊照片的拍攝時間。
const capturedAt = computed(() => {
  if (status.value !== "success") return null;
  const detail = data.value as PhotoDetailResponse | null;
  if (!detail) return null;
  return formatCapturedAt(detail.shootingDate);
});

// prev/next 只在 query 真的 success 之後才有值：query 還在 pending 時自然是 null，
// 按鈕就會因為 template 上的 :disabled="!prev" / "!next" 自動擋住。畫面上一顯示出縮圖（success 當下）
// 就能馬上再按下一頁，不需要等原圖 preload 完成。
const prev = computed<string | null>(() => (status.value === "success" ? (data.value?.prev ?? null) : null));
const next = computed<string | null>(() => (status.value === "success" ? (data.value?.next ?? null) : null));

function goBack() {
  router.back();
}

function goPrev() {
  navigateTo(prev.value);
}

function goNext() {
  navigateTo(next.value);
}

function navigateTo(targetId: string | null) {
  if (!targetId) return;
  router.replace({ name: "photo-detail", params: { id: targetId } });
}
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
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: var(--header-padding-top) var(--header-padding-x) var(--header-padding-bottom);
  background-color: var(--bg-base);
}

.back-button {
  display: flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
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

.captured-pill {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 4px 16px;
  border-radius: 999px;
  background-color: rgb(255 255 255 / 12%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  line-height: 1.2;
  white-space: nowrap;
}

.captured-pill__date {
  font-size: var(--font-caption);
  font-weight: 600;
  color: var(--label-primary);
}

.captured-pill__time {
  font-size: 11px;
  color: var(--label-secondary);
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

.photo-detail-skeleton {
  width: 100%;
  height: calc(100dvh - var(--header-padding-top) - var(--header-padding-bottom) - 40px);
  background: linear-gradient(100deg, var(--bg-elevated) 40%, var(--bg-elevated-2) 50%, var(--bg-elevated) 60%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
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

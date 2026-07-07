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

      <!-- 空狀態：查無此照片 / 不屬於自己 / 沒有可用的圖片網址 -->
      <PhotoEmptyState v-else-if="notFound" variant="empty" message="找不到這張照片" />

      <!-- 正常顯示 -->
      <img v-else-if="imageUrl" ref="imgEl" :src="imageUrl" alt="照片" class="photo-detail-img" />

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
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { fetchPhotoDetail } from "../services/api";
import PhotoEmptyState from "../components/photo/PhotoEmptyState.vue";
import type { PhotoDetailResponse, PhotoNeighbor } from "../types";

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

// 拿到目前照片的資料後，順手把 prev/next 的 detail 也背景 prefetch 起來（不等結果、不影響畫面），
// 這樣使用者真的按下一頁時，新照片自己的 prev/next 通常已經在 cache 裡，不用再等 fetch。
// 同時也把 prev/next 的「圖片本身」背景預先下載好（見 preloadImage），讓瀏覽器提早把圖存進 HTTP cache。
watch(
  data,
  (detail) => {
    prefetchNeighbor(detail?.prev ?? null);
    prefetchNeighbor(detail?.next ?? null);
    preloadImage(detail?.prev?.imageUrl ?? null);
    preloadImage(detail?.next?.imageUrl ?? null);
  },
  { immediate: true },
);

function prefetchNeighbor(neighbor: PhotoNeighbor | null) {
  if (!neighbor) return;
  queryClient.prefetchQuery({
    queryKey: detailQueryKey(neighbor.imageId),
    queryFn: () => queryPhotoDetail(neighbor.imageId),
  });
}

// 記錄已經觸發過預下載的網址，避免同一張圖被重複建立 Image() 物件、重複打一次請求
// （瀏覽器本身雖然也會依 HTTP cache 規則 dedupe，但沒必要每次都重新觸發）
const preloadedUrls = new Set<string>();

function preloadImage(url: string | null) {
  if (!url || preloadedUrls.has(url)) return;
  preloadedUrls.add(url);

  // 不掛到畫面上，純粹讓瀏覽器背景下載並放進 HTTP cache；
  // 之後真正切換過去、<img> 用同一個網址時，會直接吃 cache，decode() 幾乎是秒開
  const img = new Image();
  img.src = url;
}

// 按下上/下一頁那一刻，手上已經知道目標照片的 imageUrl（來自目前這張的 prev/next），
// 在新照片自己的 query 還沒 resolve（沒 cache 可用）之前，先拿這個頂著顯示，避免畫面被清空閃爍。
// 一旦新照片的 query 進入 success 狀態，畫面就會改用 query 的真實資料，這個值就不再被參考。
const optimisticImageUrl = ref<string | null>(null);
const optimisticNotFound = ref(false);

const imageUrl = computed<string | null>(() => {
  if (status.value === "success") return (data.value as PhotoDetailResponse | null)?.imageUrl ?? null;
  if (status.value === "pending") return optimisticImageUrl.value;
  return null;
});

const notFound = computed(() => {
  if (status.value === "success") return data.value === null;
  if (status.value === "pending") return optimisticNotFound.value;
  return false;
});

const error = computed(() => {
  if (status.value !== "error") return null;
  return queryError.value instanceof Error ? queryError.value.message : String(queryError.value);
});

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
// 按鈕就會因為 template 上的 :disabled="!prev" / "!next" 自動擋住，不用另外管「fetch 還沒完成」這件事。
const prev = computed<PhotoNeighbor | null>(() =>
  status.value === "success" ? (data.value?.prev ?? null) : null,
);
const next = computed<PhotoNeighbor | null>(() =>
  status.value === "success" ? (data.value?.next ?? null) : null,
);

// 圖片是否已經下載完成（成功或失敗皆算「已解決」，避免使用者被一張壞圖卡住、按了跳不過去）。
// 用實際渲染出來的 <img> 呼叫原生 decode()，不用另外接 @load/@error，也不用額外套件。
const imgEl = ref<HTMLImageElement | null>(null);
const imageSettled = ref(true);

watch(
  imageUrl,
  async (url) => {
    if (!url) {
      imageSettled.value = true;
      return;
    }
    imageSettled.value = false;

    // <img> 的 :src 是綁著這個 computed 值，要等 DOM 真的更新完才能拿到對應的 element
    await nextTick();
    const el = imgEl.value;
    if (!el) {
      // 拿不到 element 就不要卡住使用者
      imageSettled.value = true;
      return;
    }

    try {
      await el.decode();
    } catch {
      // 下載失敗或圖片本身損毀，也視為「已解決」
    } finally {
      // 如果這段 await 期間 imageUrl 又換成別的值了（使用者連續切換），
      // 這次 decode() 的結果就跟目前畫面對不上了，不要回頭誤設 imageSettled
      if (imageUrl.value === url) {
        imageSettled.value = true;
      }
    }
  },
  { immediate: true },
);

// 兩個條件都滿足才能再按下一頁：新照片自己的 prev/next 已經確定（query success），
// 而且目前顯示的這張圖片已經下載完成
const isNavigating = computed(() => !imageSettled.value);

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

  optimisticImageUrl.value = target.imageUrl;
  optimisticNotFound.value = !target.imageUrl;

  router.replace({ name: "photo-detail", params: { id: target.imageId } });
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

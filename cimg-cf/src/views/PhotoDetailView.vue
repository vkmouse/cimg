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

function goBack() {
  router.back();
}

function goPrev() {
  if (!prev.value) return;
  router.replace({ name: "photo-detail", params: { id: prev.value.imageId } });
}

function goNext() {
  if (!next.value) return;
  router.replace({ name: "photo-detail", params: { id: next.value.imageId } });
}

async function loadDetail(id: string) {
  // 切換照片時重置狀態，避免殘留上一張的錯誤/空狀態或箭頭
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
  (id) => loadDetail(id),
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

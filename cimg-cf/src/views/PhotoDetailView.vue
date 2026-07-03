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
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { fetchPhotoDetail } from "../services/api";
import PhotoEmptyState from "../components/photo/PhotoEmptyState.vue";

const props = defineProps<{
  id: string;
}>();

const router = useRouter();

const imageUrl = ref<string | null>(null);
const notFound = ref(false);
const error = ref<string | null>(null);

function goBack() {
  router.back();
}

onMounted(async () => {
  try {
    const detail = await fetchPhotoDetail(props.id);
    if (!detail || !detail.imageUrl) {
      notFound.value = true;
      return;
    }
    imageUrl.value = detail.imageUrl;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});
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
</style>

<template>
  <div ref="containerRef" class="swipe-track-viewport">
    <div
      class="swipe-track"
      :style="trackStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="swipe-slide">
        <img
          v-if="prevPhoto?.imageUrl"
          :src="prevPhoto.imageUrl"
          alt="上一張"
          class="swipe-slide-img"
          draggable="false"
        />
      </div>
      <div class="swipe-slide">
        <img :src="currentPhoto.imageUrl" alt="照片" class="swipe-slide-img" draggable="false" />
      </div>
      <div class="swipe-slide">
        <img
          v-if="nextPhoto?.imageUrl"
          :src="nextPhoto.imageUrl"
          alt="下一張"
          class="swipe-slide-img"
          draggable="false"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

interface SwipePhoto {
  imageId: string;
  imageUrl: string | null;
}

const props = defineProps<{
  currentPhoto: { imageId: string; imageUrl: string };
  prevPhoto: SwipePhoto | null;
  nextPhoto: SwipePhoto | null;
}>();

const emit = defineEmits<{
  (e: "switch-prev"): void;
  (e: "switch-next"): void;
}>();

// ── 手勢參數（沿用 Donut 的方向鎖定 / 動畫時間與緩動，門檻與邊界阻力依規格調整） ──
const LOCK_THRESHOLD = 8; // px，判斷水平/垂直手勢前的容許誤差
const SWITCH_THRESHOLD_RATIO = 0.2; // 放開手指時，超過容器寬度 20% 才切換
const RESISTANCE_MAX_RATIO = 0.15; // 邊界阻力的最大位移（容器寬度的 15%）
const RESISTANCE_COEFFICIENT = 0.55; // 阻力係數，越小越黏手
const TRANSITION = "transform 0.3s cubic-bezier(0.3, 0, 0.2, 1)";

const containerRef = ref<HTMLElement>();
const containerWidth = ref(0);
const dragOffsetX = ref(0);
const isTransitioning = ref(false);
const isSwitching = ref(false); // 切換動畫進行中，鎖住新的手勢輸入

let startX = 0;
let startY = 0;
let lockDir: "h" | "v" | null = null;
let activePointerId: number | null = null; // 同時只追蹤一根手指 / 一個滑鼠指標

const hasPrev = computed(() => !!props.prevPhoto?.imageUrl);
const hasNext = computed(() => !!props.nextPhoto?.imageUrl);

const trackStyle = computed(() => ({
  transform: `translateX(${-containerWidth.value + dragOffsetX.value}px)`,
  transition: isTransitioning.value ? TRANSITION : "none",
}));

let resizeObserver: ResizeObserver | null = null;

function measure() {
  containerWidth.value = containerRef.value?.getBoundingClientRect().width ?? 0;
}

onMounted(() => {
  // 用 rAF 延後到排版穩定後再量，避免拿到掛載瞬間還沒定案的暫時尺寸
  requestAnimationFrame(measure);
  resizeObserver = new ResizeObserver(() => measure());
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

/** 邊界阻力：拖越多阻力越大，漸進逼近但不會超過 maxOffset。 */
function applyResistance(dx: number, maxOffset: number): number {
  const sign = dx < 0 ? -1 : 1;
  const absDx = Math.abs(dx);
  const damped = (absDx * RESISTANCE_COEFFICIENT * maxOffset) / (maxOffset + absDx * RESISTANCE_COEFFICIENT);
  return sign * damped;
}

/**
 * 統一用 Pointer Events 處理滑鼠 / 觸控 / 手寫筆，取代原本只認 Touch Events 的寫法。
 * 原因：
 * 1) 桌面滑鼠完全不會觸發 touch 系列事件，之前的版本在桌面上一定滑不動。
 * 2) 用 setPointerCapture 把手勢「鎖」在起手的元素上，即使手指/滑鼠移出元素邊界
 *    也能持續收到 move/up，避免真機上因為快速滑動而漏接事件。
 */
function onPointerDown(e: PointerEvent) {
  if (isSwitching.value) return;
  if (e.pointerType === "mouse" && e.button !== 0) return; // 只認滑鼠左鍵
  if (activePointerId !== null) return; // 已有手勢在進行中（多指觸控時忽略其他手指）

  activePointerId = e.pointerId;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

  measure(); // 手勢開始時重新量一次，避免用到過期的寬度
  startX = e.clientX;
  startY = e.clientY;
  lockDir = null;
  isTransitioning.value = false;
}

function onPointerMove(e: PointerEvent) {
  if (isSwitching.value) return;
  if (e.pointerId !== activePointerId) return;
  if (lockDir === "v") return;

  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (lockDir === null) {
    if (absDx > LOCK_THRESHOLD && absDx >= absDy) {
      lockDir = "h";
    } else if (absDy > LOCK_THRESHOLD) {
      lockDir = "v";
      return;
    } else {
      return;
    }
  }

  // lockDir === 'h'
  e.preventDefault();

  const resistanceMax = containerWidth.value * RESISTANCE_MAX_RATIO;
  if (dx > 0 && !hasPrev.value) {
    dragOffsetX.value = applyResistance(dx, resistanceMax);
  } else if (dx < 0 && !hasNext.value) {
    dragOffsetX.value = applyResistance(dx, resistanceMax);
  } else {
    dragOffsetX.value = dx;
  }
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== activePointerId) return;
  activePointerId = null;

  if (isSwitching.value) return;
  if (lockDir !== "h") {
    dragOffsetX.value = 0;
    lockDir = null;
    return;
  }

  const threshold = containerWidth.value * SWITCH_THRESHOLD_RATIO;
  const direction: "prev" | "next" | null =
    dragOffsetX.value > 0 ? "prev" : dragOffsetX.value < 0 ? "next" : null;
  const canSwitch = direction === "prev" ? hasPrev.value : direction === "next" ? hasNext.value : false;

  if (direction && canSwitch && Math.abs(dragOffsetX.value) >= threshold) {
    triggerSwitch(direction);
  } else {
    // 未達門檻，或邊界阻力情況 → 一律彈回
    isTransitioning.value = true;
    dragOffsetX.value = 0;
  }

  lockDir = null;
}

function triggerSwitch(direction: "prev" | "next") {
  isSwitching.value = true;
  isTransitioning.value = true;
  dragOffsetX.value = direction === "prev" ? containerWidth.value : -containerWidth.value;

  setTimeout(() => {
    // 通知外層切換資料（外層會同步把 prev/current/next 往前/後挪一格，
    // 並非同步觸發重新呼叫 API 補齊窗口——見 PhotoDetailView）。
    if (direction === "prev") {
      emit("switch-prev");
    } else {
      emit("switch-next");
    }

    // 外層的 props 更新與這裡的位置重設在同一個 tick 內完成，
    // 瀏覽器只會畫出「資料已更新 + 位置已置中」的最終畫面，不會看到中間閃爍。
    isTransitioning.value = false;
    dragOffsetX.value = 0;
    isSwitching.value = false;
  }, 300);
}
</script>

<style scoped>
.swipe-track-viewport {
  overflow: hidden;
  width: 100%;
  height: 100%;
  align-self: stretch;
  /* 降低被 Safari「邊緣滑動返回上一頁」系統手勢搶走的機率
     （水平滑動照片跟系統返回手勢方向完全一樣，容易衝突）。 */
  overscroll-behavior-x: contain;
}

.swipe-track {
  display: flex;
  width: 100%;
  height: 100%;
  will-change: transform;
  /* 只交給瀏覽器原生處理垂直方向，水平方向交給 JS（Pointer Events）自己判斷 */
  touch-action: pan-y;
  cursor: grab;
  user-select: none;
}

.swipe-track:active {
  cursor: grabbing;
}

.swipe-slide {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 防止 iOS Safari 在圖片上長按觸發「預覽 / 儲存影像」的原生手勢，
     搶走本該屬於左右滑動的觸控序列。 */
  -webkit-touch-callout: none;
}

.swipe-slide-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  -webkit-user-drag: none;
  user-select: none;
  /* 讓 pointerdown 一律落在外層 .swipe-track 上，不要讓 <img> 自己接手手勢，
     避免真機上 img 的原生拖曳/長按行為吃掉事件。 */
  pointer-events: none;
}
</style>

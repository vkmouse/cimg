<template>
  <div v-if="items.length > 0" class="burst-carousel">
    <button
      v-for="item in items"
      :key="item.startDate"
      type="button"
      class="burst-card"
      :class="{ 'burst-card--active': isActive(item) }"
      @click="$emit('select', item.startDate, item.endDate)"
    >
      <span class="burst-card__year">{{ formatYear(item.startDate) }}</span>
      <span class="burst-card__range">{{ formatRange(item.startDate, item.endDate) }}</span>
      <span class="burst-card__count">{{ item.totalCount }} 張</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { PhotoBurstItem } from "../../types";
import { unixToDateKey, type DateKey } from "../../utils/dateRange";

const props = defineProps<{
  items: PhotoBurstItem[];
  /** 目前套用中的篩選區間（DateKey，與網址 query 同格式）；沒有篩選時為 null。 */
  appliedStart?: DateKey | null;
  appliedEnd?: DateKey | null;
}>();

defineEmits<{
  select: [startDate: number, endDate: number];
}>();

/** 判斷這張卡片代表的區間是否就是目前套用中的篩選區間，是的話要高亮。 */
function isActive(item: PhotoBurstItem): boolean {
  if (!props.appliedStart || !props.appliedEnd) return false;
  return unixToDateKey(item.startDate) === props.appliedStart && unixToDateKey(item.endDate) === props.appliedEnd;
}

/** 年份（以 startDate 為準；burst 區間短，理論上不會跨年）。 */
function formatYear(startUnix: number): string {
  return String(new Date(startUnix * 1000).getFullYear());
}

/** 顯示用的日期區間格式，例如「04/26 ~ 04/28」（本地時區，僅月/日，補零）。 */
function formatRange(startUnix: number, endUnix: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (unix: number) => {
    const d = new Date(unix * 1000);
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  };
  return `${fmt(startUnix)} ~ ${fmt(endUnix)}`;
}
</script>

<style scoped>
.burst-carousel {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 var(--header-padding-x) 12px;
  scrollbar-width: none;
}

.burst-carousel::-webkit-scrollbar {
  display: none;
}

.burst-card {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border: none;
  border-radius: var(--radius-sm);
  background-color: var(--bg-elevated);
  color: var(--label-primary);
  cursor: pointer;
  text-align: left;
}

.burst-card:active {
  background-color: var(--bg-elevated-2);
}

.burst-card--active {
  background-color: var(--accent);
}

.burst-card--active .burst-card__year,
.burst-card--active .burst-card__range,
.burst-card--active .burst-card__count {
  color: #fff;
}

.burst-card--active:active {
  background-color: var(--accent);
  opacity: 0.85;
}

.burst-card__year {
  font-size: var(--font-caption);
  color: var(--label-secondary);
}

.burst-card__range {
  font-size: var(--font-body);
  font-weight: 600;
}

.burst-card__count {
  font-size: var(--font-caption);
  color: var(--label-secondary);
}
</style>

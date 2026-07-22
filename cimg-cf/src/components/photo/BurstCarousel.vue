<template>
  <div v-if="items.length > 0" class="burst-carousel">
    <button
      v-for="item in items"
      :key="item.startDate"
      type="button"
      class="burst-card"
      @click="$emit('select', item.startDate, item.endDate)"
    >
      <span class="burst-card__range">{{ formatRange(item.startDate, item.endDate) }}</span>
      <span class="burst-card__count">{{ item.totalCount }} 張</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { PhotoBurstItem } from "../../types";

defineProps<{
  items: PhotoBurstItem[];
}>();

defineEmits<{
  select: [startDate: number, endDate: number];
}>();

/** 顯示用的日期區間格式，例如「3/12 – 3/18」（本地時區，僅月/日）。 */
function formatRange(startUnix: number, endUnix: number): string {
  const fmt = (unix: number) => {
    const d = new Date(unix * 1000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return `${fmt(startUnix)} – ${fmt(endUnix)}`;
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

.burst-card__range {
  font-size: var(--font-body);
  font-weight: 600;
}

.burst-card__count {
  font-size: var(--font-caption);
  color: var(--label-secondary);
}
</style>

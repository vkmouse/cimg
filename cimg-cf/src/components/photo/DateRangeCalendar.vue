<template>
  <div class="date-range-calendar">
    <div class="date-range-calendar__nav">
      <button
        type="button"
        class="date-range-calendar__nav-btn"
        aria-label="上一個月"
        @click="prevMonth"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span class="date-range-calendar__title">{{ viewLabel }}</span>
      <button
        type="button"
        class="date-range-calendar__nav-btn"
        aria-label="下一個月"
        :disabled="isViewingCurrentMonth"
        @click="nextMonth"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <div class="date-range-calendar__weekdays">
      <span v-for="w in weekdayLabels" :key="w" class="date-range-calendar__weekday">{{ w }}</span>
    </div>

    <div class="date-range-calendar__grid">
      <div
        v-for="(cell, idx) in cells"
        :key="idx"
        class="date-range-calendar__cell"
        :class="{
          'date-range-calendar__cell--start': cell && cell.key === start,
          'date-range-calendar__cell--end': cell && cell.key === end,
          'date-range-calendar__cell--in-range': cell && isInRange(cell.key),
        }"
      >
        <button
          v-if="cell"
          type="button"
          class="date-range-calendar__day"
          :class="{
            'date-range-calendar__day--start': cell.key === start,
            'date-range-calendar__day--end': cell.key === end,
            'date-range-calendar__day--today': cell.key === todayKey,
            'date-range-calendar__day--disabled': cell.disabled,
          }"
          :disabled="cell.disabled"
          @click="selectDay(cell.key)"
        >
          {{ cell.day }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { parseDateKey, toDateKey, type DateKey } from "../../utils/dateRange";

/**
 * 開始/結束日期用 `v-model:start` 與 `v-model:end` 雙向綁定（皆為 `YYYY-MM-DD` 或 null）。
 * 選取邏輯（父層 FilterModal 不需要關心）：
 * - 尚未選取，或已經有完整的開始+結束 → 這次點擊視為重新選取，成為新的開始日期
 * - 已有開始、尚無結束 → 依兩者先後排出開始/結束
 */
const start = defineModel<DateKey | null>("start", { required: true });
const end = defineModel<DateKey | null>("end", { required: true });

const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];

const today = new Date();
const todayKey = toDateKey(today);

// 目前檢視的月份（每月固定用該月第 1 天代表）。
// 掛載時若已經有帶入 start（代表這次開啟 Modal 時已經套用過篩選），
// 預設顯示「篩選開始日期」所在的月份；否則（尚未篩選過）才顯示當月。
const initialViewDate = start.value ? parseDateKey(start.value) : today;
const viewMonth = ref(new Date(initialViewDate.getFullYear(), initialViewDate.getMonth(), 1));

const viewLabel = computed(() => `${viewMonth.value.getFullYear()} 年 ${viewMonth.value.getMonth() + 1} 月`);

const isViewingCurrentMonth = computed(
  () =>
    viewMonth.value.getFullYear() === today.getFullYear() &&
    viewMonth.value.getMonth() === today.getMonth(),
);

function prevMonth() {
  const d = viewMonth.value;
  viewMonth.value = new Date(d.getFullYear(), d.getMonth() - 1, 1);
}

function nextMonth() {
  if (isViewingCurrentMonth.value) return;
  const d = viewMonth.value;
  viewMonth.value = new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

interface DayCell {
  key: DateKey;
  day: number;
  disabled: boolean;
}

// 補齊當月第 1 天前的空格數（週日為一週開頭），以及湊滿整週的尾端空格，維持 7 欄格線對齊
const cells = computed<(DayCell | null)[]>(() => {
  const year = viewMonth.value.getFullYear();
  const month = viewMonth.value.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const result: (DayCell | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) result.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const key = toDateKey(date);
    result.push({ key, day, disabled: key > todayKey });
  }
  while (result.length % 7 !== 0) result.push(null);
  return result;
});

function isInRange(key: DateKey): boolean {
  if (!start.value || !end.value) return false;
  return key > start.value && key < end.value;
}

function selectDay(key: DateKey) {
  if (!start.value || (start.value && end.value)) {
    // 尚未選取 / 已經有完整區間 → 重新開始選取
    start.value = key;
    end.value = null;
    return;
  }
  // 已有開始日期、尚無結束日期 → 依先後排出開始/結束
  if (key < start.value) {
    end.value = start.value;
    start.value = key;
  } else {
    end.value = key;
  }
}
</script>

<style scoped>
.date-range-calendar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.date-range-calendar__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.date-range-calendar__nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  color: var(--label-primary);
  border-radius: 50%;
  cursor: pointer;
}

.date-range-calendar__nav-btn svg {
  width: 18px;
  height: 18px;
}

.date-range-calendar__nav-btn:active {
  background-color: var(--bg-elevated);
}

.date-range-calendar__nav-btn:disabled {
  color: var(--label-tertiary);
  cursor: default;
}

.date-range-calendar__title {
  font-size: var(--font-body);
  font-weight: 600;
}

.date-range-calendar__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.date-range-calendar__weekday {
  text-align: center;
  font-size: var(--font-caption);
  color: var(--label-secondary);
  padding-bottom: 4px;
}

.date-range-calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  row-gap: 4px;
}

/* cell 負責畫「區間連續底色」，day 負責畫單顆日期圓形，兩者分開才能讓區間中段左右相連 */
.date-range-calendar__cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
}

.date-range-calendar__cell--in-range {
  background-color: color-mix(in srgb, var(--accent) 18%, transparent);
}

.date-range-calendar__cell--start {
  background-color: color-mix(in srgb, var(--accent) 18%, transparent);
  border-top-left-radius: 18px;
  border-bottom-left-radius: 18px;
}

.date-range-calendar__cell--end {
  background-color: color-mix(in srgb, var(--accent) 18%, transparent);
  border-top-right-radius: 18px;
  border-bottom-right-radius: 18px;
}

/* 開始=結束同一天時，兩個 modifier 同時套用，四角都要是圓的 */
.date-range-calendar__cell--start.date-range-calendar__cell--end {
  border-radius: 18px;
}

.date-range-calendar__day {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--label-primary);
  font-size: var(--font-body);
  cursor: pointer;
}

.date-range-calendar__day--today:not(.date-range-calendar__day--start):not(.date-range-calendar__day--end) {
  box-shadow: inset 0 0 0 1px var(--accent);
}

.date-range-calendar__day--start,
.date-range-calendar__day--end {
  background-color: var(--accent);
  color: #ffffff;
  font-weight: 600;
}

.date-range-calendar__day--disabled {
  color: var(--label-tertiary);
  cursor: default;
}
</style>

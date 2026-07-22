<template>
  <Teleport to="body">
    <Transition name="filter-modal-fade">
      <div v-if="open" class="filter-modal">
        <div class="filter-modal__backdrop" @click="cancel"></div>

        <Transition name="filter-modal-sheet" appear>
          <div class="filter-modal__sheet" role="dialog" aria-modal="true" aria-label="篩選日期">
            <header class="filter-modal__header">
              <h2 class="filter-modal__title">篩選日期</h2>
            </header>

            <div class="filter-modal__range">
              <div class="filter-modal__range-field">
                <span class="filter-modal__range-label">開始日期</span>
                <span class="filter-modal__range-value">{{ formatDisplay(draftStart) }}</span>
              </div>
              <div class="filter-modal__range-divider">—</div>
              <div class="filter-modal__range-field">
                <span class="filter-modal__range-label">結束日期</span>
                <span class="filter-modal__range-value">{{ formatDisplay(draftEnd) }}</span>
              </div>
            </div>

            <DateRangeCalendar v-model:start="draftStart" v-model:end="draftEnd" />

            <footer class="filter-modal__actions">
              <button type="button" class="filter-modal__btn filter-modal__btn--ghost" @click="clear">
                清除
              </button>
              <button type="button" class="filter-modal__btn filter-modal__btn--ghost" @click="cancel">
                取消
              </button>
              <button
                type="button"
                class="filter-modal__btn filter-modal__btn--primary"
                :disabled="!(draftStart && draftEnd)"
                @click="confirm"
              >
                確定
              </button>
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import DateRangeCalendar from "./DateRangeCalendar.vue";
import { parseDateKey, type DateKey } from "../../utils/dateRange";

const open = defineModel<boolean>("open", { required: true });

const props = defineProps<{
  /** 目前「已套用」的篩選區間，Modal 開啟時會用這組值初始化草稿。 */
  appliedStart: DateKey | null;
  appliedEnd: DateKey | null;
}>();

const emit = defineEmits<{
  /** 使用者按下確定，帶出完整的開始/結束日期。 */
  apply: [start: DateKey, end: DateKey];
  /** 使用者按下清除：清空區間並取消篩選。 */
  clear: [];
}>();

const draftStart = ref<DateKey | null>(props.appliedStart);
const draftEnd = ref<DateKey | null>(props.appliedEnd);

// 每次開啟 Modal 時，用目前已套用的篩選狀態重新初始化草稿，
// 避免上次點一半、按取消離開後，殘留的草稿被誤帶進下一次開啟。
watch(open, (isOpen) => {
  if (isOpen) {
    draftStart.value = props.appliedStart;
    draftEnd.value = props.appliedEnd;
  }
});

function formatDisplay(key: DateKey | null): string {
  if (!key) return "請選擇";
  const d = parseDateKey(key);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function confirm() {
  if (!draftStart.value || !draftEnd.value) return;
  emit("apply", draftStart.value, draftEnd.value);
  open.value = false;
}

function cancel() {
  open.value = false;
}

function clear() {
  draftStart.value = null;
  draftEnd.value = null;
  emit("clear");
  open.value = false;
}
</script>

<style scoped>
.filter-modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
}

.filter-modal__backdrop {
  position: absolute;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
}

.filter-modal__sheet {
  position: relative;
  width: 100%;
  max-height: 88dvh;
  overflow-y: auto;
  background-color: var(--bg-elevated);
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  padding: 12px 20px calc(20px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.filter-modal__header {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

.filter-modal__title {
  font-size: var(--font-body);
  font-weight: 700;
  color: var(--label-primary);
}

.filter-modal__range {
  display: flex;
  align-items: center;
  gap: 12px;
}

.filter-modal__range-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  background-color: var(--bg-base);
  border-radius: var(--radius-sm);
}

.filter-modal__range-label {
  font-size: var(--font-caption);
  color: var(--label-secondary);
}

.filter-modal__range-value {
  font-size: var(--font-body);
  color: var(--label-primary);
  font-weight: 600;
}

.filter-modal__range-divider {
  color: var(--label-tertiary);
}

.filter-modal__actions {
  display: flex;
  gap: 8px;
  padding-top: 4px;
}

.filter-modal__btn {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-body);
  font-weight: 600;
  cursor: pointer;
}

.filter-modal__btn--ghost {
  background-color: var(--bg-elevated-2);
  color: var(--label-primary);
}

.filter-modal__btn--primary {
  background-color: var(--accent);
  color: #ffffff;
}

.filter-modal__btn--primary:disabled {
  background-color: var(--bg-elevated-2);
  color: var(--label-tertiary);
  cursor: default;
}

.filter-modal-fade-enter-active,
.filter-modal-fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-standard);
}

.filter-modal-fade-enter-from,
.filter-modal-fade-leave-to {
  opacity: 0;
}

.filter-modal-sheet-enter-active,
.filter-modal-sheet-leave-active {
  transition: transform var(--duration-medium) var(--ease-standard);
}

.filter-modal-sheet-enter-from,
.filter-modal-sheet-leave-to {
  transform: translateY(100%);
}
</style>

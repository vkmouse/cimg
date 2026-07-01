<template>
  <div class="empty-state">
    <div class="empty-state__icon" :class="{ 'empty-state__icon--error': variant === 'error' }">
      <svg
        v-if="variant === 'error'"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 9v3.75m0 3.75h.008M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M2.25 15.75 8.69 9.3a2.25 2.25 0 0 1 3.182 0l5.378 5.378M16.5 13.5l1.319-1.32a2.25 2.25 0 0 1 3.182 0l2.69 2.69M6.75 19.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z"
        />
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 10.5h.008v.008H8.25V10.5Z" />
      </svg>
    </div>
    <p class="empty-state__message">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    message: string;
    variant?: "empty" | "error";
  }>(),
  {
    variant: "empty",
  },
);
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 32px;
  text-align: center;
}

.empty-state__icon {
  width: 40px;
  height: 40px;
  color: var(--label-tertiary);
}

.empty-state__icon--error {
  color: var(--danger);
}

.empty-state__icon svg {
  width: 100%;
  height: 100%;
}

.empty-state__message {
  color: var(--label-secondary);
  font-size: var(--font-body);
  line-height: 1.4;
  max-width: 240px;
}
</style>

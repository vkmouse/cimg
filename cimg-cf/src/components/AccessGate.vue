<!--
  Self-contained 的 Cloudflare Access（Service Token）驗證閘門。

  用法：把要保護的內容放進預設 slot，掛載時會自動檢查
  localStorage 裡有沒有存憑證、帶著憑證打一次 /api/auth/login：
    - 沒存值 或 收到 403 → 顯示輸入頁面，讓使用者重新輸入
    - 收到非 200/403（網路錯誤、逾時、500 等）→ 顯示「請聯絡管理者」
    - 200 → 顯示 slot 內容

  刻意不引入專案的 styles/variables.css 等共用樣式，所有樣式都寫在
  這個檔案的 <style scoped> 裡，方便未來其他網站需要同樣的驗證流程
  時可以直接複製這個檔案（連同 ../services/auth.ts）過去用，不用
  額外處理樣式相依。
-->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getStoredCredentials, storeCredentials, clearCredentials, login } from '../services/auth'

type GateState = 'checking' | 'unauthenticated' | 'error' | 'authenticated'

const state = ref<GateState>('checking')
const clientIdInput = ref('')
const clientSecretInput = ref('')
const submitting = ref(false)

async function check() {
  const stored = getStoredCredentials()
  if (!stored) {
    clearCredentials()
    state.value = 'unauthenticated'
    return
  }

  const result = await login()
  if (result === 'ok') {
    state.value = 'authenticated'
  } else if (result === 'invalid') {
    clearCredentials()
    state.value = 'unauthenticated'
  } else {
    state.value = 'error'
  }
}

async function handleSubmit() {
  const clientId = clientIdInput.value.trim()
  const clientSecret = clientSecretInput.value.trim()
  if (!clientId || !clientSecret) {
    return
  }

  submitting.value = true
  // 先不寫 localStorage，直接拿使用者剛輸入的值去試登入；
  // 確認 200（成功）才真的存進 localStorage，避免把還沒驗證過、
  // 可能是打錯的憑證提早留在瀏覽器裡。
  const credentials = { clientId, clientSecret }
  const result = await login(credentials)

  if (result === 'ok') {
    storeCredentials(credentials)
    state.value = 'authenticated'
  } else if (result === 'invalid') {
    state.value = 'unauthenticated'
  } else {
    state.value = 'error'
  }
  submitting.value = false
}

onMounted(() => {
  state.value = 'checking'
  check()
})
</script>

<template>
  <slot v-if="state === 'authenticated'" />

  <div v-else class="access-gate">
    <div class="access-gate__box">
      <template v-if="state === 'checking'">
        <p class="access-gate__text">驗證中…</p>
      </template>

      <template v-else-if="state === 'unauthenticated'">
        <h1 class="access-gate__title">請輸入存取憑證</h1>
        <label class="access-gate__field">
          <span>Client ID</span>
          <input
            v-model="clientIdInput"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :disabled="submitting"
            @keyup.enter="handleSubmit"
          />
        </label>
        <label class="access-gate__field">
          <span>Client Secret</span>
          <input
            v-model="clientSecretInput"
            type="password"
            autocomplete="off"
            spellcheck="false"
            :disabled="submitting"
            @keyup.enter="handleSubmit"
          />
        </label>
        <button
          class="access-gate__button"
          type="button"
          :disabled="submitting || !clientIdInput.trim() || !clientSecretInput.trim()"
          @click="handleSubmit"
        >
          {{ submitting ? '驗證中…' : '送出' }}
        </button>
      </template>

      <template v-else>
        <h1 class="access-gate__title">無法驗證</h1>
        <p class="access-gate__text">請聯絡管理者</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.access-gate {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111827;
  color: #f3f4f6;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  box-sizing: border-box;
  padding: 24px;
}

.access-gate__box {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.access-gate__title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.access-gate__text {
  font-size: 14px;
  color: #9ca3af;
  margin: 0;
}

.access-gate__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #d1d5db;
}

.access-gate__field input {
  padding: 9px 10px;
  border-radius: 6px;
  border: 1px solid #374151;
  background: #1f2937;
  color: #f3f4f6;
  font-size: 14px;
  box-sizing: border-box;
}

.access-gate__field input:focus {
  outline: none;
  border-color: #2563eb;
}

.access-gate__field input:disabled {
  opacity: 0.6;
}

.access-gate__button {
  margin-top: 4px;
  padding: 10px;
  border-radius: 6px;
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.access-gate__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

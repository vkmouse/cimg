/**
 * Cloudflare Access（Service Token）前端驗證流程。
 *
 * 這個模組刻意保持獨立（不依賴 src/types.ts、不依賴其他 service），
 * 方便未來其他網站需要同一套「輸入 Client ID / Secret 換取存取」的
 * 流程時，可以直接把這個檔案跟 AccessGate.vue 一起複製過去用。
 */

const CLIENT_ID_KEY = 'CF_ACCESS_CLIENT_ID'
const CLIENT_SECRET_KEY = 'CF_ACCESS_CLIENT_SECRET'

export interface AccessCredentials {
  clientId: string
  clientSecret: string
}

/** 從 localStorage 讀取憑證，兩個值都存在才視為有效，任一缺漏視為未設定。 */
export function getStoredCredentials(): AccessCredentials | null {
  const clientId = localStorage.getItem(CLIENT_ID_KEY)
  const clientSecret = localStorage.getItem(CLIENT_SECRET_KEY)
  if (!clientId || !clientSecret) {
    return null
  }
  return { clientId, clientSecret }
}

export function storeCredentials(credentials: AccessCredentials): void {
  localStorage.setItem(CLIENT_ID_KEY, credentials.clientId)
  localStorage.setItem(CLIENT_SECRET_KEY, credentials.clientSecret)
}

export function clearCredentials(): void {
  localStorage.removeItem(CLIENT_ID_KEY)
  localStorage.removeItem(CLIENT_SECRET_KEY)
}

/** 供其他 fetch() 呼叫組 header 用；沒有存值時回傳空物件，讓請求照樣送出（會被 Access 擋下）。 */
export function getAccessHeaders(): HeadersInit {
  const credentials = getStoredCredentials()
  if (!credentials) {
    return {}
  }
  return {
    'CF-Access-Client-Id': credentials.clientId,
    'CF-Access-Client-Secret': credentials.clientSecret,
  }
}

export type VerifyResult = 'ok' | 'invalid' | 'error'

/**
 * 帶著 localStorage 裡的憑證打 /api/ping：
 * - 200 → 'ok'
 * - 403（或沒有存值）→ 'invalid'，代表憑證錯誤，呼叫端應該清空 localStorage
 * - 其他情況（網路錯誤、逾時、非 200/403 狀態碼）→ 'error'，呼叫端不應清空 localStorage
 */
export async function verifyAccess(): Promise<VerifyResult> {
  const credentials = getStoredCredentials()
  if (!credentials) {
    return 'invalid'
  }

  let response: Response
  try {
    response = await fetch('/api/ping', {
      headers: {
        'CF-Access-Client-Id': credentials.clientId,
        'CF-Access-Client-Secret': credentials.clientSecret,
      },
    })
  } catch {
    return 'error'
  }

  if (response.status === 200) {
    return 'ok'
  }
  if (response.status === 403) {
    return 'invalid'
  }
  return 'error'
}

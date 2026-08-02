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

export type LoginResult = 'ok' | 'invalid' | 'error'

/**
 * 帶著 localStorage 裡的憑證打 `/api/auth/login`：
 * - 200 → 'ok'（同時代表 access_token / refresh_token 這兩個 httpOnly Cookie
 *   已經由伺服器透過 Set-Cookie 寫入瀏覽器，之後打其他 `/api/*` 不需要再帶
 *   Client Id / Secret 以外的東西，靠 `credentials: 'include'` 讓 Cookie 自動帶上）
 * - 403（Access edge 直接擋下，代表 Service Token 本身無效）→ 'invalid'，
 *   呼叫端應該清空 localStorage，讓使用者重新輸入
 * - 其他情況（網路錯誤、逾時、401 等應用層拒絕、其他非 200/403 狀態碼）→ 'error'，
 *   呼叫端不應清空 localStorage（Service Token 本身可能還是對的，只是應用層
 *   查不到對應身分或伺服器暫時出狀況）
 *
 * 這支端點同時取代了原本 `/api/ping` 的健康檢查角色，不需要再另外呼叫 ping。
 */
export async function login(): Promise<LoginResult> {
  const credentials = getStoredCredentials()
  if (!credentials) {
    return 'invalid'
  }

  let response: Response
  try {
    response = await fetch('/api/auth/login', {
      headers: {
        'CF-Access-Client-Id': credentials.clientId,
        'CF-Access-Client-Secret': credentials.clientSecret,
      },
      credentials: 'include',
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

/**
 * access token 過期（收到 401）時，用 refresh_token Cookie 換一份新的
 * access token；成功回傳 true（新的 access_token Cookie 已經由 Set-Cookie 寫入），
 * 失敗（refresh token 也過期/不存在、網路錯誤等）回傳 false，呼叫端應該視為
 * 整個 session 已失效，導回登入流程（重新呼叫 `login()`）。
 *
 * 依然要帶 Client Id / Secret header，因為 `/api/auth/refresh` 本身也在
 * Access edge 的一般保護範圍內（不在 Bypass 清單），Access 每次都要驗證一次
 * Service Token；這跟「不用 refresh Client Id / Secret」不衝突——Client Id /
 * Secret 是長效憑證，本來就每次直接帶，不需要換發新的。
 */
export async function refreshAccessToken(): Promise<boolean> {
  const credentials = getStoredCredentials()
  if (!credentials) {
    return false
  }

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'CF-Access-Client-Id': credentials.clientId,
        'CF-Access-Client-Secret': credentials.clientSecret,
      },
      credentials: 'include',
    })
    return response.status === 200
  } catch {
    return false
  }
}

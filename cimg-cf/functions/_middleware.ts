/**
 * 全站唯一的 _middleware.ts。
 *
 * 只保護 `/api/*` 路徑；根目錄 `/`、靜態資源（`*.js`、`*.css` 等 SPA 打包出來的
 * 檔案）一律直接放行，不做任何驗證——這些是 SPA 的殼（`index.html` + JS/CSS），
 * 一定要能在「使用者還沒登入」的狀態下先載入，瀏覽器裡的 `AccessGate.vue` 才有
 * 機會執行、顯示輸入畫面、呼叫 `/api/auth/login`。如果連這個殼都要求先有
 * `access_token` Cookie，會變成「要先登入才能載入讓你登入的畫面」的死結。
 *
 * `/api/auth/login`、`/api/auth/refresh` 這兩條路徑各自處理自己的驗證邏輯
 * （login 驗 Cf-Access-Jwt-Assertion，refresh 驗 refresh_token Cookie），
 * 這裡直接放行、不重複驗證。
 *
 * 其餘所有 `/api/*` 路徑（含 `/api/img`，因為 Cookie 現在涵蓋整個 `/api/*`，
 * 不再只限縮給 `/api/img`）一律只驗 `access_token` Cookie 裡的 App JWT
 * 簽章 / 效期，直接從 payload 拿 email / userId 塞進 context.data，
 * **不再查 DB**（DB 查詢只發生在 functions/api/auth/login.ts 簽發 token 的當下）。
 *
 * `/api/img` 在 Access edge 仍設定 Bypass（瀏覽器 `<img src="...">` 無法帶
 * 自訂 header），但瀏覽器對同源請求會自動帶上 Cookie，所以一樣能被
 * access_token 保護到，不再是「完全沒驗證」的洞。
 */
import type { AuthContext, Env } from './types'
import { verifyAppToken } from './utils/jwt'
import { ACCESS_TOKEN_COOKIE_NAME, getCookie } from './utils/cookie'

const SKIP_AUTH_PATHS = new Set(['/api/auth/login', '/api/auth/refresh'])

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { env, request } = context
  const { pathname } = new URL(request.url)

  // 只管 /api/*，其餘一律放行（SPA 殼、靜態資源，讓瀏覽器一定載得到）。
  if (!pathname.startsWith('/api/')) {
    return await context.next()
  }

  if (SKIP_AUTH_PATHS.has(pathname)) {
    return await context.next()
  }

  if (!env.APP_JWT_SECRET) {
    console.error('[auth] 缺少環境變數 APP_JWT_SECRET')
    return new Response('Unauthorized', { status: 401 })
  }

  const token = getCookie(request.headers.get('Cookie'), ACCESS_TOKEN_COOKIE_NAME)
  if (!token) {
    return new Response('Unauthorized', { status: 401 })
  }

  const identity = await verifyAppToken(env.APP_JWT_SECRET, token, 'access')
  if (!identity) {
    return new Response('Unauthorized', { status: 401 })
  }

  context.data.email = identity.email
  context.data.userId = identity.userId

  return await context.next()
}

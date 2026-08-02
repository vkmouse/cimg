/**
 * `/api/*` 專屬的 _middleware.ts（放在 functions/api/ 底下，Cloudflare Pages
 * Functions 會依檔案所在目錄自動限縮套用範圍，只套用在 `/api/*`，不會影響
 * 根目錄 `/`、`*.js`/`*.css` 等靜態資源——SPA 的殼因此永遠能直接載入，瀏覽器
 * 裡的 `AccessGate.vue` 才有機會執行、顯示輸入畫面、呼叫 `/api/auth/login`；
 * 如果放在 functions/ 根目錄，會連靜態檔案都套用到，變成「要先登入才能載入
 * 讓你登入的畫面」的死結（第 26、27 輪那次事故就是這樣來的，這次直接把檔案
 * 搬到這裡從結構上避免同樣的錯誤再發生，不再靠程式碼判斷 pathname 手動模擬）。
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
import type { AuthContext, Env } from '../types'
import { verifyAppToken } from '../utils/jwt'
import { ACCESS_TOKEN_COOKIE_NAME, getCookie } from '../utils/cookie'

const SKIP_AUTH_PATHS = new Set(['/api/auth/login', '/api/auth/refresh'])

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { env, request } = context
  const { pathname } = new URL(request.url)

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

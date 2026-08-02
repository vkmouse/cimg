/**
 * 全站唯一的 _middleware.ts。
 *
 * 身份驗證交給 Cloudflare Access（Service Token）在 edge 層處理：
 * - Bypass：`/`、`/*.js`、`/*.css`（靜態資源）、`/api/img`（見下方說明）
 * - Include：其餘所有路徑，需帶 `CF-Access-Client-Id` / `CF-Access-Client-Secret`
 *   才能通過 Access，通過之後才會打到這支 middleware。
 *
 * 因此這裡不再解析/驗證任何 JWT，單純把「全站唯一使用者」的身份注入
 * context.data：email 直接讀環境變數 OWNER_EMAIL，userId 用這個 email
 * 查 users 表取得。
 *
 * 注意：`/api/img` 因為是給 <img src="..."> 直接載入（瀏覽器無法帶自訂
 * header），所以被排進 Access 的 Bypass，不會經過這支 middleware 的驗證，
 * 也不需要（imageService 內部另有自己的 credential 查找邏輯）。
 */
import type { AuthContext, Env } from './types'
import { getByEmail } from './repositories/userRepository'

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { env } = context

  if (!env.OWNER_EMAIL) {
    console.error('[auth] 缺少環境變數 OWNER_EMAIL')
    return new Response('Unauthorized', { status: 401 })
  }

  const user = await getByEmail(env.DB, env.OWNER_EMAIL)
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  context.data.email = env.OWNER_EMAIL
  context.data.userId = user.id

  return await context.next()
}

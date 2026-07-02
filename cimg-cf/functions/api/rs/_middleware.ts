/**
 * `/api/rs/*` 專用的驗證 middleware。
 *
 * 跟根目錄 `functions/_middleware.ts`（以使用者 email 為主，給前台用）
 * 完全獨立：這裡驗證的是純粹的 server-to-server 身份（cimg-rs 這支背景程式
 * 打過來的請求），不是某個使用者的登入身份，所以驗證通過後**不**塞任何
 * userId 進 context.data —— sync.ts 跟各 Service 該用誰的 user_id，
 * 完全交給 request body 裡的 payload 自己決定（跟原本的行為一致）。
 *
 * - 驗證的是 Cloudflare Access **Service Token** 簽發的 JWT，而不是使用者登入的 JWT。
 * - Service Token 的 JWT 沒有 email claim，所以不查 `users` 表，也沒有 DEMO_EMAIL fallback。
 * - 對應的 Cloudflare Access Application 是另一個只掛 Service Auth policy、
 *   只保護 `/api/rs/*` 這個路徑的獨立 Application（AUD 跟前台不同）。
 */
import type { Env } from '../../types'
import { jwtVerify, createRemoteJWKSet } from 'jose'

/** JWKS 建立成本較高，跨請求快取一份即可（Workers 執行環境允許 module-scope 變數重複使用）。 */
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null
let cachedTeamDomain: string | null = null

function getJwks(teamDomain: string) {
  if (!cachedJwks || cachedTeamDomain !== teamDomain) {
    cachedJwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
    cachedTeamDomain = teamDomain
  }
  return cachedJwks
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { env, request } = context

  if (!env.TEAM_DOMAIN || !env.RS_POLICY_AUD) {
    console.error('[rs-auth] 缺少 TEAM_DOMAIN / RS_POLICY_AUD 其中之一')
    return new Response('Unauthorized', { status: 401 })
  }

  const jwtHeader = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!jwtHeader) {
    // 代表這個請求沒有被 Cloudflare Access 攔到（Access 沒有附上這個 header），
    // 通常表示 Access Application 的路徑設定沒有精確比對到這個 URL
    // （例如少了結尾的 `*`），跟我們自己的 JWT 驗證邏輯無關。
    console.error('[rs-auth] 沒有 Cf-Access-Jwt-Assertion header，代表這個請求沒有被 Cloudflare Access 攔到，請檢查 Access Application 的路徑設定')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const JWKS = getJwks(env.TEAM_DOMAIN)
    const { payload } = await jwtVerify(jwtHeader, JWKS, {
      issuer: env.TEAM_DOMAIN,
      audience: env.RS_POLICY_AUD,
    })

    // Service Token 簽發的 JWT 沒有 email，識別身份用的是 client_id claim。
    // 若有設定 RS_SERVICE_CLIENT_ID，多驗一層，避免這個 Access Application
    // 底下未來不小心多掛了別的 Service Token 也能通過。
    if (env.RS_SERVICE_CLIENT_ID) {
      const clientId = payload.client_id
      if (clientId !== env.RS_SERVICE_CLIENT_ID) {
        // 除錯用：把兩邊的值都印出來方便比對是不是複製貼上時漏字/多空白。
        // 這兩個值都是 client_id（公開識別碼，不是 secret），印出來沒有洩漏風險。
        console.error(
          `[rs-auth] client_id 不符合預期，JWT 裡的是 "${String(clientId)}"，env.RS_SERVICE_CLIENT_ID 是 "${env.RS_SERVICE_CLIENT_ID}"`
        )
        return new Response('Unauthorized', { status: 401 })
      }
    }
  } catch (err) {
    console.error('[rs-auth] JWT 驗證失敗', err)
    return new Response('Unauthorized', { status: 401 })
  }

  return await context.next()
}

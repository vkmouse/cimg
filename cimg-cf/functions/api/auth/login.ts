/**
 * 登入端點：取代原本的 functions/api/ping.ts + functions/api/me.ts。
 *
 * 這條路徑在 Access edge 是「一般受保護路徑」（不在 Bypass 清單內），所以
 * Cloudflare Access 會先驗證呼叫端的 Service Token，通過後才會把請求連同
 * `Cf-Access-Jwt-Assertion` header 一起放行到這裡。
 *
 * 流程：
 *   ① 驗證 Cf-Access-Jwt-Assertion 簽章（JWKS），取得已驗證的 common_name
 *   ② common_name 查 SERVICE_IDENTITY_MAP 對照表 → email
 *   ③ email 查 users 表 → userId
 *   ④ 簽發 access token（8hr）+ refresh token（10 年），各自用 httpOnly
 *      Cookie（Path=/api）回傳，並回應 { email, userId }（沿用原本 /api/me 的形狀）
 *
 * 前端會在 AccessGate 每次「檢查是否已通過驗證」時呼叫這支端點，所以它同時
 * 也扮演原本 /api/ping 的健康檢查角色，不需要再另外留一支 ping.ts。
 */
import type { AuthContext, Env } from '../../types'
import { getByEmail } from '../../repositories/userRepository'
import { resolveEmailByCommonNameDebug, verifyAccessAssertionDebug } from '../../utils/access'
// TEMP DEBUG：原本是 import { resolveEmailByCommonName, verifyAccessAssertion }，
// 找到問題後記得改回來（同時可以把 access.ts 裡的 resolveEmailByCommonNameDebug、
// verifyAccessAssertionDebug 這兩個函式刪掉）。
import { signAccessToken, signRefreshToken, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../../utils/jwt'
import { ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME, buildAppCookie } from '../../utils/cookie'

// TEMP DEBUG：統一組出「401 + 除錯原因」的 Response，找到問題後這個函式可以整個刪掉。
function unauthorizedDebug(reason: string): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized', debug: reason }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { env, request } = context

  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!env.APP_JWT_SECRET) {
    // TEMP DEBUG：原本是 console.error(...) + return new Response('Unauthorized', { status: 401 })
    return unauthorizedDebug('缺少環境變數 APP_JWT_SECRET')
  }

  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!assertion) {
    // TEMP DEBUG：原本是 return new Response('Unauthorized', { status: 401 })
    return unauthorizedDebug('請求沒有帶 Cf-Access-Jwt-Assertion header（代表沒有經過 Cloudflare Access edge，或 Access Application 設定成 Bypass 了這條路徑）')
  }

  // TEMP DEBUG：原本是
  //   const commonName = await verifyAccessAssertion(env, assertion)
  //   if (!commonName) {
  //     return new Response('Unauthorized', { status: 401 })
  //   }
  const { commonName, reason: commonNameFailReason } = await verifyAccessAssertionDebug(env, assertion)
  if (!commonName) {
    return unauthorizedDebug(commonNameFailReason ?? '未知原因')
  }

  // TEMP DEBUG：暫時把失敗原因回傳到前端方便除錯，找到問題後記得改回：
  //   const email = resolveEmailByCommonName(env.SERVICE_IDENTITY_MAP, commonName)
  //   if (!email) {
  //     return new Response('Unauthorized', { status: 401 })
  //   }
  const { email, reason } = resolveEmailByCommonNameDebug(env.SERVICE_IDENTITY_MAP, commonName)
  if (!email) {
    return unauthorizedDebug(reason ?? '未知原因')
  }

  const user = await getByEmail(env.DB, email)
  if (!user) {
    // TEMP DEBUG：原本是 return new Response('Unauthorized', { status: 401 })
    return unauthorizedDebug(`email "${email}" 沒有在 users 表裡找到對應的使用者`)
  }

  const identity = { email, userId: user.id }
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(env.APP_JWT_SECRET, identity),
    signRefreshToken(env.APP_JWT_SECRET, identity),
  ])

  const response = Response.json({ email, userId: user.id })
  response.headers.append(
    'Set-Cookie',
    buildAppCookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, ACCESS_TOKEN_TTL_SECONDS),
  )
  response.headers.append(
    'Set-Cookie',
    buildAppCookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, REFRESH_TOKEN_TTL_SECONDS),
  )
  return response
}

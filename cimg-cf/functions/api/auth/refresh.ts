/**
 * Refresh 端點：access token（8hr）快過期或已過期時，前端用這支端點
 * 拿新的 access token，不需要重新走一次 Access + common_name 查表流程。
 *
 * 只驗證 refresh_token Cookie 本身（10 年效期，不會每次都失效），不查 DB
 * ——email / userId 直接沿用 refresh token payload 裡的值（簽發當下就是從
 * DB 查出來的，refresh 階段不需要再查一次）。
 *
 * 不 rotate refresh token：只換發新的 access token，refresh_token Cookie 維持原樣。
 */
import type { AuthContext, Env } from '../../types'
import { verifyAppToken, signAccessToken, ACCESS_TOKEN_TTL_SECONDS } from '../../utils/jwt'
import { ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME, buildAppCookie, getCookie } from '../../utils/cookie'

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { env, request } = context

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!env.APP_JWT_SECRET) {
    console.error('[auth] 缺少環境變數 APP_JWT_SECRET')
    return new Response('Unauthorized', { status: 401 })
  }

  const refreshToken = getCookie(request.headers.get('Cookie'), REFRESH_TOKEN_COOKIE_NAME)
  if (!refreshToken) {
    return new Response('Unauthorized', { status: 401 })
  }

  const identity = await verifyAppToken(env.APP_JWT_SECRET, refreshToken, 'refresh')
  if (!identity) {
    return new Response('Unauthorized', { status: 401 })
  }

  const newAccessToken = await signAccessToken(env.APP_JWT_SECRET, identity)

  const response = Response.json({ email: identity.email, userId: identity.userId })
  response.headers.append(
    'Set-Cookie',
    buildAppCookie(ACCESS_TOKEN_COOKIE_NAME, newAccessToken, ACCESS_TOKEN_TTL_SECONDS),
  )
  return response
}

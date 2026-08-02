import type { AuthContext, Env } from '../types'

/**
 * 給前端驗證流程用的探測端點。
 * 能打到這裡代表 Cloudflare Access（Service Token）跟 _middleware.ts 的
 * 身份注入都已經通過，不需要額外檢查，直接回 200 空 body 即可。
 */
export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  if (context.request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  return new Response(null, { status: 200 })
}

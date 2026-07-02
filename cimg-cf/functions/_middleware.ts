/**
 * 全站唯一的 _middleware.ts，依 pathname 分成兩條完全獨立的驗證邏輯：
 *
 * - `/api/rs/*`：cimg-rs 發起的 server-to-server 同步請求。驗證的是
 *   Cloudflare Access **Service Token** 簽發的 JWT（對應另一個只掛
 *   Service Auth policy、只保護 `/api/rs/*` 的獨立 Access Application，
 *   AUD 是 RS_POLICY_AUD，跟前台的 POLICY_AUD 不同）。
 *   Service Token 的 JWT 沒有 email claim，所以不查 `users` 表，
 *   也沒有 DEMO_EMAIL fallback，也不會把任何 userId 塞進 context.data
 *   —— 這是純粹的身份驗證，跟使用者是誰無關（見上一輪討論）。
 *
 * - 其他所有路徑：前台使用者的請求，維持原本以「Cloudflare Access
 *   使用者登入 JWT 拿到的 email」查 `users` 表的邏輯，查不到就 401，
 *   沒有 JWT header 或驗證失敗則 fallback 成 DEMO_EMAIL。
 */
import type { AuthContext, Env } from './types'
import { getByEmail } from './repositories/userRepository'
import { jwtVerify, createRemoteJWKSet } from 'jose'

const DEMO_EMAIL = 'demo@example.com'

/** JWKS 建立成本較高，跨請求快取一份即可（Workers 執行環境允許 module-scope 變數重複使用）。 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
    jwksCache.set(teamDomain, jwks)
  }
  return jwks
}

async function verifyCloudflareAccessToken(
  token: string,
  env: Env,
): Promise<string | null> {
  if (!env.POLICY_AUD || !env.TEAM_DOMAIN) {
    return null
  }

  try {
    const JWKS = getJwks(env.TEAM_DOMAIN)

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    })

    return (payload.email as string) || null
  } catch {
    return null
  }
}

/** `/api/rs/*` 專用：只驗證 Service Token 簽發的 JWT，通過就放行，不解析/查任何使用者身份。 */
async function handleRsRequest(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
  const { env, request } = context

  if (!env.TEAM_DOMAIN || !env.RS_POLICY_AUD) {
    console.error('[rs-auth] 缺少 TEAM_DOMAIN / RS_POLICY_AUD 其中之一')
    return new Response('Unauthorized', { status: 401 })
  }

  const jwtHeader = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!jwtHeader) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const JWKS = getJwks(env.TEAM_DOMAIN)
    await jwtVerify(jwtHeader, JWKS, {
      issuer: env.TEAM_DOMAIN,
      audience: env.RS_POLICY_AUD,
    })
  } catch (err) {
    console.error('[rs-auth] JWT 驗證失敗', err)
    return new Response('Unauthorized', { status: 401 })
  }

  return await context.next()
}

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { pathname } = new URL(context.request.url)

  if (pathname.startsWith('/api/rs/')) {
    return await handleRsRequest(context)
  }

  let email = DEMO_EMAIL

  const jwtHeader = context.request.headers.get('Cf-Access-Jwt-Assertion')
  if (jwtHeader) {
    const verifiedEmail = await verifyCloudflareAccessToken(jwtHeader, context.env)
    if (verifiedEmail) {
      email = verifiedEmail
    }
  }

  const user = await getByEmail(context.env.DB, email)
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  context.data.email = email
  context.data.userId = user.id

  return await context.next()
}

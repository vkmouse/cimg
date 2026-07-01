import type { AuthContext, Env } from './types'
import { getByEmail } from './repositories/userRepository'
import { jwtVerify, createRemoteJWKSet } from 'jose'

const DEMO_EMAIL = 'demo@example.com'

async function verifyCloudflareAccessToken(
  token: string,
  env: Env,
): Promise<string | null> {
  if (!env.POLICY_AUD || !env.TEAM_DOMAIN) {
    return null
  }

  try {
    const JWKS = createRemoteJWKSet(
      new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`),
    )

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    })

    return (payload.email as string) || null
  } catch {
    return null
  }
}

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { pathname } = new URL(context.request.url)

  // /api/rs/* 是給 cimg-rs 發起同步請求用的，走獨立的驗證機制
  // （Cloudflare Access Service Token，見 functions/api/rs/_middleware.ts），
  // 不使用這裡以「使用者 email」為主的驗證邏輯，也不 fallback 成 DEMO_EMAIL。
  if (pathname.startsWith('/api/rs/')) {
    return await context.next()
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

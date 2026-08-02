/**
 * 驗證 Cloudflare Access（Zero Trust）簽發的 Cf-Access-Jwt-Assertion，
 * 並把驗證過的 common_name 對應到應用程式自己的 email 身分。
 *
 * 只有 functions/api/auth/login.ts 會用到這個模組——一般 /api/* 路徑的身份
 * 驗證已經改成只驗 functions/utils/jwt.ts 簽發的 App JWT（見 _middleware.ts），
 * 不再每次都重新驗證 Cloudflare Access 的 assertion。
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Env } from '../types'

/**
 * 驗證 Cf-Access-Jwt-Assertion 的簽章（JWKS）/ aud / iss / exp。
 * 成功回傳「已驗證 payload」裡的 common_name（Service Token 名稱，不可偽造）；
 * 缺少環境變數、驗證失敗、或 payload 沒有 common_name 一律回傳 null。
 */
export async function verifyAccessAssertion(
  env: Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>,
  assertion: string,
): Promise<string | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    console.error('[auth] 缺少環境變數 ACCESS_TEAM_DOMAIN 或 ACCESS_AUD')
    return null
  }

  try {
    const jwks = createRemoteJWKSet(
      new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`),
    )
    const { payload } = await jwtVerify(assertion, jwks, {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
    })
    if (typeof payload.common_name !== 'string' || !payload.common_name) {
      return null
    }
    return payload.common_name
  } catch {
    return null
  }
}

/**
 * 用 common_name 查 SERVICE_IDENTITY_MAP 對照表（JSON 字串，common_name → email），
 * 找出對應 email；查不到、對照表沒設定、或不是合法 JSON 一律回傳 null。
 */
export function resolveEmailByCommonName(
  serviceIdentityMap: string | undefined,
  commonName: string,
): string | null {
  if (!serviceIdentityMap) {
    console.error('[auth] 缺少環境變數 SERVICE_IDENTITY_MAP')
    return null
  }
  let identityMap: Record<string, unknown>
  try {
    identityMap = JSON.parse(serviceIdentityMap)
  } catch {
    console.error('[auth] SERVICE_IDENTITY_MAP 不是合法 JSON')
    return null
  }
  const email = identityMap[commonName]
  return typeof email === 'string' && email ? email : null
}

/**
 * 應用程式自己簽發/驗證的兩種 JWT（access token / refresh token）共用邏輯。
 *
 * 用 `jose`（Web Crypto，Workers 相容）做 HS256 簽章，兩種 token 共用同一把
 * APP_JWT_SECRET，靠 payload 裡的 `type` 欄位互相區分，避免 refresh token
 * 被拿去當 access token 用（反之亦然）。
 */
import { jwtVerify, SignJWT } from 'jose'

export type AppTokenType = 'access' | 'refresh'

export interface AppTokenIdentity {
  email: string
  userId: string
}

/** access token 效期：8 小時。 */
export const ACCESS_TOKEN_TTL_SECONDS = 8 * 60 * 60
/** refresh token 效期：10 年，模擬「無限期」（JWT/Cookie 機制上都需要一個實際的到期時間）。 */
export const REFRESH_TOKEN_TTL_SECONDS = 10 * 365 * 24 * 60 * 60

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

async function signAppToken(
  secret: string,
  identity: AppTokenIdentity,
  type: AppTokenType,
  ttlSeconds: number,
): Promise<string> {
  return await new SignJWT({ email: identity.email, userId: identity.userId, type })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encodeSecret(secret))
}

/** 簽發 access token（8 小時）。 */
export async function signAccessToken(secret: string, identity: AppTokenIdentity): Promise<string> {
  return signAppToken(secret, identity, 'access', ACCESS_TOKEN_TTL_SECONDS)
}

/** 簽發 refresh token（10 年）。 */
export async function signRefreshToken(secret: string, identity: AppTokenIdentity): Promise<string> {
  return signAppToken(secret, identity, 'refresh', REFRESH_TOKEN_TTL_SECONDS)
}

/**
 * 驗證 App JWT 簽章 / 效期，並確認 payload 的 `type` 跟預期的一致
 *（例如驗證 access_token cookie 時傳入 `expectedType: 'access'`，避免有人把
 * refresh token 塞進 access_token cookie 蒙混過關）。成功回傳 identity，失敗回傳 null。
 */
export async function verifyAppToken(
  secret: string,
  token: string,
  expectedType: AppTokenType,
): Promise<AppTokenIdentity | null> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret))
    if (
      typeof payload.email !== 'string' ||
      typeof payload.userId !== 'string' ||
      payload.type !== expectedType
    ) {
      return null
    }
    return { email: payload.email, userId: payload.userId }
  } catch {
    return null
  }
}

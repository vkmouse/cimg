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
 * TEMP DEBUG（除錯用，找到問題後整個刪掉）：
 * 不驗證簽章，單純把 JWT 的 payload 解出來，只給除錯訊息用，
 * **絕對不能**拿這裡解出來的值做任何授權判斷（因為沒驗證過，可以偽造）。
 */
function decodeJwtPayloadUnsafeForDebug(token: string): Record<string, unknown> | null {
  try {
    const payloadB64Url = token.split('.')[1]
    if (!payloadB64Url) return null
    const base64 = payloadB64Url.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64)
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * TEMP DEBUG（除錯用，找到問題後記得刪除這個函式，login.ts 改回呼叫
 * 上面的 verifyAccessAssertion）：
 * 邏輯跟 verifyAccessAssertion 完全一樣，差別是失敗時會多回傳具體原因，
 * 而且會**逐項列出「預期值 vs 實際值」**（iss / aud / exp / common_name），
 * 不只是一句錯誤訊息，方便直接在 Response body 裡肉眼比對。
 */
export async function verifyAccessAssertionDebug(
  env: Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>,
  assertion: string,
): Promise<{ commonName: string | null; reason?: string; compare?: Record<string, { expected: unknown; actual: unknown; match: boolean }> }> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return { commonName: null, reason: '缺少環境變數 ACCESS_TEAM_DOMAIN 或 ACCESS_AUD' }
  }

  const expectedIss = `https://${env.ACCESS_TEAM_DOMAIN}`
  const expectedAud = env.ACCESS_AUD

  try {
    const jwks = createRemoteJWKSet(
      new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`),
    )
    const { payload } = await jwtVerify(assertion, jwks, {
      issuer: expectedIss,
      audience: expectedAud,
    })
    if (typeof payload.common_name !== 'string' || !payload.common_name) {
      return {
        commonName: null,
        reason: `Cf-Access-Jwt-Assertion 驗證通過，但 payload 沒有 common_name 欄位（payload keys: ${Object.keys(payload).join(', ')}）`,
      }
    }
    return { commonName: payload.common_name }
  } catch (err) {
    // 簽章驗證失敗了，但為了讓你知道「到底是哪個值對不起來」，
    // 這裡額外把 token 沒驗證過的 payload 解出來，跟預期值逐項比對列出。
    const unverifiedPayload = decodeJwtPayloadUnsafeForDebug(assertion)
    const actualAud = unverifiedPayload?.aud
    const actualIss = unverifiedPayload?.iss
    const actualExp = unverifiedPayload?.exp
    const nowSeconds = Math.floor(Date.now() / 1000)

    const compare = {
      iss: {
        expected: expectedIss,
        actual: actualIss ?? '(無法解出 / token 格式有問題)',
        match: actualIss === expectedIss,
      },
      aud: {
        expected: expectedAud,
        actual: actualAud ?? '(無法解出 / token 格式有問題)',
        match: Array.isArray(actualAud) ? actualAud.includes(expectedAud) : actualAud === expectedAud,
      },
      exp: {
        expected: `> ${nowSeconds}（現在時間）`,
        actual: actualExp ?? '(無法解出)',
        match: typeof actualExp === 'number' ? actualExp > nowSeconds : false,
      },
    }

    return {
      commonName: null,
      reason: `Cf-Access-Jwt-Assertion 驗證失敗：${err instanceof Error ? err.message : String(err)}`,
      compare,
    }
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

/**
 * TEMP DEBUG（除錯用，找到問題後記得刪除這個函式，login.ts 改回呼叫
 * 上面的 resolveEmailByCommonName）：
 * 邏輯跟 resolveEmailByCommonName 完全一樣，差別是失敗時會多回傳「實際值 vs
 * 對照表 keys」的逐項比對，方便暫時把除錯資訊回傳到前端。
 */
export function resolveEmailByCommonNameDebug(
  serviceIdentityMap: string | undefined,
  commonName: string,
): { email: string | null; reason?: string; compare?: Record<string, { expected: unknown; actual: unknown; match: boolean }> } {
  if (!serviceIdentityMap) {
    return { email: null, reason: 'SERVICE_IDENTITY_MAP 環境變數未設定' }
  }
  let identityMap: Record<string, unknown>
  try {
    identityMap = JSON.parse(serviceIdentityMap)
  } catch (err) {
    // TEMP DEBUG：把 JSON.parse 失敗的原始字串內容跟頭尾字元編碼一起印出來，
    // 因為「看起來一樣」的字串，常常是打字軟體自動把直引號 " 換成
    // 彎引號 “ ” 造成的，肉眼在聊天室或 README 裡完全看不出差異。
    const trimmed = serviceIdentityMap.trim()
    const firstChar = serviceIdentityMap.charAt(0)
    const lastChar = serviceIdentityMap.charAt(serviceIdentityMap.length - 1)
    return {
      email: null,
      reason: `SERVICE_IDENTITY_MAP 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`,
      compare: {
        raw_value: {
          expected: '一段合法 JSON 字串，例如 {"key.access":"email@example.com"}（雙引號必須是半形直引號 U+0022）',
          actual: serviceIdentityMap,
          match: false,
        },
        first_char: {
          expected: `{ (U+007B)`,
          actual: `"${firstChar}" (U+${firstChar.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`,
          match: firstChar === '{',
        },
        last_char: {
          expected: `} (U+007D)`,
          actual: `"${lastChar}" (U+${lastChar.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`,
          match: lastChar === '}',
        },
        has_leading_or_trailing_whitespace: {
          expected: false,
          actual: trimmed !== serviceIdentityMap,
          match: trimmed === serviceIdentityMap,
        },
        contains_smart_quotes: {
          expected: false,
          actual: /[\u201C\u201D\u2018\u2019]/.test(serviceIdentityMap),
          match: !/[\u201C\u201D\u2018\u2019]/.test(serviceIdentityMap),
        },
      },
    }
  }
  const email = identityMap[commonName]
  if (typeof email === 'string' && email) {
    return { email }
  }
  const keys = Object.keys(identityMap)
  return {
    email: null,
    reason: `commonName 沒有在 SERVICE_IDENTITY_MAP 對照表裡找到對應的 email`,
    compare: {
      common_name: {
        expected: `SERVICE_IDENTITY_MAP 的其中一個 key（目前有: ${keys.join(', ') || '(空物件)'}）`,
        actual: commonName,
        match: keys.includes(commonName),
      },
    },
  }
}

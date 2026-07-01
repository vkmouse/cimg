/**
 * Cloudflare Pages Functions 共用的環境變數型別。
 * 所有 functions/api/*.ts 都透過 PagesFunction<Env> 取得 context.env。
 */
export interface Env {
  DB: D1Database
  POLICY_AUD?: string
  TEAM_DOMAIN?: string
  /**
   * `/api/rs/*` 專用的獨立驗證設定（見 functions/api/rs/_middleware.ts）。
   * 與上面 POLICY_AUD（前台 email 登入用）完全分開，對應 Cloudflare Access
   * 另一個只掛 Service Auth policy 的 Application。這是單純的 server-to-server
   * 驗證（cimg-rs → cimg-cf），不綁定任何使用者身份。
   */
  RS_POLICY_AUD?: string
  /** 選填：額外比對 JWT 的 client_id claim，確保用的是預期的那組 Service Token。 */
  RS_SERVICE_CLIENT_ID?: string
}

/**
 * _middleware.ts 驗證後注入 context.data 的型別。
 * email：來自 Cloudflare Access JWT 或 fallback demo email。
 * userId：由 middleware 以 email 查詢 DB 後取得的 users.id。
 */
export interface AuthContext extends Record<string, unknown> {
  email: string
  userId: string
}

/**
 * 4 個 entity Service 的 putXxx() 共用的參數形狀。
 * payloadJson 維持字串，交給各 Service 自己 JSON.parse + 驗證欄位
 * （payload 的形狀是 entity-specific 的，不適合在這裡先解開）。
 * userId 不在此處，各 Service 自行從 payloadJson 取得。
 */
export interface PutEntityParams {
  entityId: string
  baseVersion: number
  mutationId: string
  payloadJson: string
}

/**
 * sync.ts 用來依 entityType 找對應 Service 方法的 Map 型別
 *（action 目前只有 PUT 一種，已從 dispatch key 中省略）。
 * 回傳 null 代表這次寫入視為 ERROR（版本衝突／資料沒變化／INSERT 已存在）；
 * 回傳非 null 代表寫入成功（status OK，且 Service 內部已經寫好 sync_events）。
 */
export type PutEntityHandler = (db: D1Database, params: PutEntityParams) => Promise<unknown | null>

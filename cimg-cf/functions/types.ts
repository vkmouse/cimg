/**
 * Cloudflare Pages Functions 共用的環境變數型別。
 * 所有 functions/api/*.ts 都透過 PagesFunction<Env> 取得 context.env。
 */
export interface Env {
  DB: D1Database
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

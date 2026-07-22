/**
 * Cloudflare Pages Functions 共用的環境變數型別。
 * 所有 functions/api/*.ts 都透過 PagesFunction<Env> 取得 context.env。
 */
export interface Env {
  DB: D1Database
  POLICY_AUD?: string
  TEAM_DOMAIN?: string
  /**
   * `/api/rs/*` 專用的獨立驗證設定（見 functions/_middleware.ts 的 handleRsRequest）。
   * 與上面 POLICY_AUD（前台 email 登入用）完全分開，對應 Cloudflare Access
   * 另一個只掛 Service Auth policy 的 Application。這是單純的 server-to-server
   * 驗證（cimg-rs → cimg-cf），不綁定任何使用者身份。
   */
  RS_POLICY_AUD?: string
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

/* -------------------------------------------------------------------------- */
/* Sync API (POST /api/rs/sync) 契約型別                                       */
/*                                                                            */
/* 前端 `src/types.ts` 裡也有一份形狀相同的定義：這兩份型別故意各自獨立維護、  */
/* 不共用同一個檔案。後端不依賴前端的資料夾結構（反之亦然），兩邊各自是      */
/* 自己這一份 API 契約的定義來源，改動任一邊的內部結構都不會連動打斷另一邊； */
/* 對外的實際契約由 sync.ts 的 request/response 行為決定，型別只是各自對它  */
/* 的描述。                                                                  */
/* -------------------------------------------------------------------------- */

/** 對應 sync_events.entity_type。 */
export type EntityType = 'BKT' | 'USR' | 'PHT' | 'CRD' | 'PBT'

export interface PushCommand {
  mutationId: string
  entityType: EntityType
  entityId: string
  baseVersion: number
  /** JSON 字串，內容為 snake_case 欄位（與 sync_queue.payload 格式一致）。 */
  payload: string
}

export type PushResultStatus = 'OK' | 'ERROR' | 'SKIPPED'

export interface PushResult {
  mutationId: string
  status: PushResultStatus
}

export interface SyncRequestBody {
  pushCommands: PushCommand[]
  /** client 上次同步記下的 sync_events.id 游標；用來計算這次 pull 的範圍（id > lastCursor）。 */
  lastCursor: number
}

/** Pull 流程回傳的單一筆伺服器端新事件，欄位皆為 camelCase（payload 內容仍是 JSON 字串）。 */
export interface PullEvent {
  id: number
  mutationId: string
  entityType: EntityType
  entityId: string
  version: number
  payload: string | null
}

export interface SyncResponseBody {
  pushResults: PushResult[]
  /** 目前 sync_events 表格的最大 id，client 收到後應存起來，下次同步當作 lastCursor 帶回來。 */
  newCursor: number
  /** lastCursor 之後、且排除本次請求自己 push 上來的 mutationId 的所有新事件。 */
  pullEvents: PullEvent[]
}

/**
 * Cloudflare Pages Functions 共用的環境變數型別。
 * 所有 functions/api/*.ts 都透過 PagesFunction<Env> 取得 context.env。
 */
export interface Env {
  DB: D1Database
  /**
   * Cloudflare Access（Zero Trust）簽發 Cf-Access-Jwt-Assertion 時使用的
   * team domain（例如 `your-team.cloudflareaccess.com`），用來組出驗證簽章
   * 用的 JWKS 網址：`https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`。
   * 只有 functions/api/auth/login.ts 會用到。一般環境變數（非 secret）。
   */
  ACCESS_TEAM_DOMAIN?: string
  /**
   * 這個 Access Application 的 Audience (AUD) Tag，驗證 Cf-Access-Jwt-Assertion
   * 時要比對的 `aud`，確保 token 是發給這個 Application 的。
   * 只有 functions/api/auth/login.ts 會用到。一般環境變數（非 secret）。
   */
  ACCESS_AUD?: string
  /**
   * `common_name`（Service Token 名稱，如 `partner-alice`）→ email 的對照表，
   * JSON 字串形式，例如 `{"partner-alice.access": "alice@example.com"}`。
   * 只有 functions/api/auth/login.ts 會用到。Client Id 本身不是敏感資訊，
   * 所以是一般環境變數（非 secret）。
   */
  SERVICE_IDENTITY_MAP?: string
  /**
   * 用來簽發 / 驗證 access token 與 refresh token（見下方 AuthContext 說明）
   * 的共用密鑰，兩種 token 靠 payload 裡的 `type` 欄位互相區分。
   * 是 secret，務必透過 `wrangler secret put APP_JWT_SECRET` 設定，不要寫進版控。
   */
  APP_JWT_SECRET?: string
}

/**
 * _middleware.ts 驗證後注入 context.data 的型別。
 *
 * 身份解析分成三個端點/路徑（詳見 functions/api/_middleware.ts）：
 * - `functions/api/auth/login.ts`：受 Cloudflare Access（Service Token）保護，
 *   驗證 Cf-Access-Jwt-Assertion 簽章後，用 payload 裡的 common_name 查
 *   SERVICE_IDENTITY_MAP 對照表取得 email，查 users 表拿 userId，簽發
 *   access token（8hr）+ refresh token（10 年），皆用 httpOnly Cookie
 *  （Path=`/api`，涵蓋整個 `/api/*`）回傳。
 * - `functions/api/auth/refresh.ts`：只驗證 refresh_token Cookie，不查 DB，
 *   直接沿用 token payload 裡的 email/userId，換發新的 access token。
 * - 其餘所有 `/api/*`（含 `/api/img`，因為 Cookie 現在涵蓋整個 `/api/*`，
 *   瀏覽器對 `<img>` 標籤發出的同源請求也會自動帶上）：只驗證 access_token
 *   Cookie 裡的 App JWT 簽章 / 效期，不查 DB，直接從 payload 拿 email / userId。
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

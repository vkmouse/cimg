export interface Photo {
  id: string
  url: string
}

export interface PhotoItem {
  imageId: string
  sourceDevice: string
  datePath: string
  shootingDate: number
  /** `/api/img` 的相對網址，可直接當 <img src> 使用。使用者尚未設定 bucket 時可能為 null。 */
  imageUrl: string | null
}

/** keyset 分頁游標：對應上一頁最後一筆的 shootingDate + imageId。 */
export interface PhotoCursor {
  shootingDate: number
  imageId: string
}

/** GET /api/photos 的回應形狀。 */
export interface PhotoListResponse {
  items: PhotoItem[]
  nextCursor: PhotoCursor | null
  hasMore: boolean
}

/**
 * 日期區間篩選條件，皆為 unix seconds（含端點）。
 * `startDate` 為開始日期當天 00:00:00，`endDate` 為結束日期當天 23:59:59。
 */
export interface PhotoDateFilter {
  startDate: number
  endDate: number
}

/** 清單排序方向：`desc` = shooting_date 新到舊（預設，不會出現在網址上），`asc` = 舊到新。 */
export type PhotoSortOrder = 'asc' | 'desc'

/**
 * `BurstCarousel` 一張卡片需要的最小資料：日期區間（unix seconds，含端點）+ 張數。
 * 不含 `spanDays`（目前 UI 用不到）。
 */
export interface PhotoBurstItem {
  startDate: number
  endDate: number
  totalCount: number
}

/** GET /api/photo-bursts 的回應形狀。依 startDate 新到舊排序，不分頁。 */
export interface PhotoBurstListResponse {
  items: PhotoBurstItem[]
}

/**
 * GET /api/photos/:id 的回應形狀。
 * `imageUrl` 是原圖畫質（extraLarge）；`thumbnailUrl` 跟列表縮圖同一份（middle），
 * 用來讓 detail 頁先秒開，`imageUrl` 之後再背景升級替換。兩者在使用者尚未設定 bucket 時皆可能為 null。
 * `prev`/`next` 只給 imageId（時間上更新/更舊的那張，往右/左滑看到），找不到（已在時間軸邊界）時為 null；
 * 換頁時前端會用這個 id 另外打 `/api/photos/:id` 拿那張自己的 imageUrl/thumbnailUrl。
 */
export interface PhotoDetailResponse {
  imageId: string
  sourceDevice: string
  datePath: string
  shootingDate: number
  imageUrl: string | null
  thumbnailUrl: string | null
  prev: string | null
  next: string | null
}

/* -------------------------------------------------------------------------- */
/* Sync API (POST /api/rs/sync)                                               */
/* -------------------------------------------------------------------------- */

/** 對應 sync_events.entity_type，以及 entityType 的 Service 派送 Map（action 目前只有 PUT 一種，已省略不傳）。 */
export type EntityType = 'BKT' | 'USR' | 'PHT' | 'CRD'

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

/** Pull 流程回傳的單一筆伺服器端新事件，欄位皆為 camelCase（payload 內容仍是 JSON 字串，格式與 PushCommand.payload 相同）。 */
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

/**
 * 各 entityType 對應的 payload 內容（JSON.parse(PushCommand.payload) 後的形狀）。
 * 欄位名稱為 snake_case，與 sync_queue.payload 及 DB 欄位名稱一致。
 *
 * 注意：
 * - id / image_id 等 PK 由 PushCommand.entityId 提供，payload 裡的同名欄位
 *   僅供參考，各 Service 使用 entityId。
 * - version 由 server 依 baseVersion 計算。
 * - user_id 視為普通業務欄位，不特殊處理（USR 的 entityId 本身就是 user id）。
 */
export interface UserPayload {
  email: string
  is_deleted: number | boolean
  /** USR 的 user_id 即為 id 本身，存在 payload 裡供一致性參考。 */
  id?: string
}

export interface CredentialPayload {
  user_id: string
  access_key_id: string
  expiration: number
  secret_access_key: string
  session_token: string
  is_deleted: number | boolean
}

export interface BucketPayload {
  user_id: string
  region: string
  exif_bucket: string
  exif_keybase: string
  expand_exif_bucket: string
  expand_exif_keybase: string
  expand_original_bucket: string
  expand_original_keybase: string
  extra_large_bucket: string
  extra_large_keybase: string
  middle_bucket: string
  middle_keybase: string
  original_bucket: string
  original_keybase: string
  is_deleted: number | boolean
}

export interface PhotoPayload {
  user_id: string
  source_device: string
  date_path: string
  shooting_date: number
  uploaded_date: number
  shooting_camera: string | null
  image_size: string | null
  file_size: string | null
  file_format: string | null
  shutter_speed: string | null
  aperture_value: string | null
  iso_speed: string | null
  lens_focal_length: string | null
  white_balance_mode: string | null
  exposure_compensation: string | null
  flash_firing: string | null
  lens: string | null
  subject_category: string | null
  blur_judgement: string | null
  exposure_judgement: string | null
  is_deleted: number | boolean
}

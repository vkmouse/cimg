import {
  insertIfNotExists,
  updateIfVersionMatchesAndChanged,
  type SyncableColumn,
} from './syncableTable'

export interface PhotoRow {
  image_id: string
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
  version: number
  is_deleted: number
}

/** keyset 分頁游標：上一頁最後一筆的 shooting_date + image_id。 */
export interface PhotoCursor {
  shootingDate: number
  imageId: string
}

/** 日期區間篩選條件，皆為 unix seconds（含端點）。 */
export interface PhotoDateRange {
  startDate: number
  endDate: number
}

/**
 * read 路徑（清單頁、詳情頁、詳情頁左右鄰居）共用的精簡欄位。
 * 只包含「顯示一張照片卡片 + 排序」所需的最小欄位組合：
 * - image_id / source_device / date_path：組出 `/api/img` 網址、辨識照片
 * - shooting_date：排序 / keyset 分頁 / 詳情頁查鄰居用
 *
 * 跟 `PhotoRow`（write 路徑，`insert`/`update` 用）區分開來，
 * 避免 read 查詢撈出用不到的 EXIF 等 17 個欄位。
 */
export interface PhotoListRow {
  image_id: string
  source_device: string
  date_path: string
  shooting_date: number
}

/**
 * 依 shooting_date DESC, image_id DESC 排序，用 keyset (cursor) 分頁撈取。
 * 不帶 cursor 代表撈第一頁。呼叫端負責多撈 1 筆來判斷 hasMore（本函式單純依 limit 撈取）。
 *
 * 註：帶 cursor 時故意不寫成單一個
 * `(shooting_date < ? OR (shooting_date = ? AND image_id < ?))` 的 WHERE 條件。
 * 雖然這裡的 ORDER BY 方向跟索引儲存方向一致（不用反向掃描），但這種橫跨兩個分支的 OR
 * 一樣會讓 SQLite 沒辦法轉成一次索引 seek，只能從索引最前端逐筆掃描 + 套用殘餘條件，
 * 使用者往舊照片翻頁翻得越深，每一頁就越慢（實測：30 萬筆資料時，翻到最後幾頁耗時
 * 可從 <0.02ms 惡化到近 20ms）。拆成兩段各自能被索引直接 seek 的查詢、各自撈滿 limit 筆
 * 後用 UNION ALL 合併再排序取前 limit 筆，翻到第幾頁耗時都能維持穩定。
 */
/**
 * `dateRange` 帶入時，額外要求 `shooting_date BETWEEN ? AND ?`（含端點）。
 * 這個條件需要同時加在下方 UNION ALL 的兩段子查詢裡，理由跟上方註解一致：
 * 兩段各自仍要能被索引直接 seek，不能只加在外層合併後的查詢上（那樣等於先掃全部再過濾）。
 */
export async function getListByUserId(
  db: D1Database,
  userId: string,
  cursor: PhotoCursor | null,
  limit: number,
  dateRange: PhotoDateRange | null = null,
): Promise<PhotoListRow[]> {
  const dateClause = dateRange ? 'AND shooting_date BETWEEN ? AND ?' : ''
  const dateBinds = dateRange ? [dateRange.startDate, dateRange.endDate] : []

  if (!cursor) {
    const rows = await db
      .prepare(
        `SELECT image_id, source_device, date_path, shooting_date FROM photos
         WHERE user_id = ? AND is_deleted = 0 ${dateClause}
         ORDER BY shooting_date DESC, image_id DESC
         LIMIT ?`,
      )
      .bind(userId, ...dateBinds, limit)
      .all<PhotoListRow>()
    return rows.results
  }

  const rows = await db
    .prepare(
      `SELECT image_id, source_device, date_path, shooting_date FROM (
         SELECT image_id, source_device, date_path, shooting_date FROM (
           SELECT image_id, source_device, date_path, shooting_date FROM photos
           WHERE user_id = ? AND is_deleted = 0 AND shooting_date < ? ${dateClause}
           ORDER BY shooting_date DESC, image_id DESC
           LIMIT ?
         )
         UNION ALL
         SELECT image_id, source_device, date_path, shooting_date FROM (
           SELECT image_id, source_device, date_path, shooting_date FROM photos
           WHERE user_id = ? AND is_deleted = 0 AND shooting_date = ? AND image_id < ? ${dateClause}
           ORDER BY image_id DESC
           LIMIT ?
         )
       )
       ORDER BY shooting_date DESC, image_id DESC
       LIMIT ?`,
    )
    .bind(
      userId,
      cursor.shootingDate,
      ...dateBinds,
      limit,
      userId,
      cursor.shootingDate,
      cursor.imageId,
      ...dateBinds,
      limit,
      limit,
    )
    .all<PhotoListRow>()
  return rows.results
}

/**
 * 依 image_id 查單筆，並用 user_id 限制擁有權（避免查到別人的照片）。
 * 查無資料（不存在 / 不屬於這個使用者 / 已刪除）一律回傳 null。
 */
export async function getByImageId(
  db: D1Database,
  userId: string,
  imageId: string,
): Promise<PhotoListRow | null> {
  const row = await db
    .prepare(
      `SELECT image_id, source_device, date_path, shooting_date FROM photos WHERE user_id = ? AND image_id = ? AND is_deleted = 0`,
    )
    .bind(userId, imageId)
    .first<PhotoListRow>()
  return row ?? null
}

/**
 * 找「更新的鄰居」（prev，方向定義見規格 1.1）：
 * shooting_date DESC, image_id DESC 排序下，排在目前這筆「前面」的下一筆。
 *
 * 註：這裡故意不寫成單一個 `(shooting_date > ? OR (shooting_date = ? AND image_id > ?))`
 * 的 WHERE 條件。雖然邏輯上等價、也有對應的索引，但這種橫跨兩個分支的 OR 會讓 SQLite
 * 沒辦法把它轉成一次索引 seek，只能從頭逐筆掃描 + 套用殘餘條件，查詢耗時會隨照片數量線性
 * 增加（實測：30 萬筆資料時，依 threshold 位置耗時可從 <0.01ms 惡化到 18ms+）。
 * 拆成兩段各自能被索引直接 seek 的查詢、取各自前 1 筆後用 UNION ALL 合併再排序取第一筆，
 * 不管資料量多大、鄰居距離多遠，耗時都能維持在 O(log n)。
 */
export async function getNewerNeighbor(
  db: D1Database,
  userId: string,
  shootingDate: number,
  imageId: string,
): Promise<PhotoListRow | null> {
  const row = await db
    .prepare(
      `SELECT image_id, source_device, date_path, shooting_date FROM (
         SELECT image_id, source_device, date_path, shooting_date FROM photos
         WHERE user_id = ? AND is_deleted = 0 AND shooting_date > ?
         ORDER BY shooting_date ASC, image_id ASC
         LIMIT 1
       )
       UNION ALL
       SELECT image_id, source_device, date_path, shooting_date FROM (
         SELECT image_id, source_device, date_path, shooting_date FROM photos
         WHERE user_id = ? AND is_deleted = 0 AND shooting_date = ? AND image_id > ?
         ORDER BY image_id ASC
         LIMIT 1
       )
       ORDER BY shooting_date ASC, image_id ASC
       LIMIT 1`,
    )
    .bind(userId, shootingDate, userId, shootingDate, imageId)
    .first<PhotoListRow>()
  return row ?? null
}

/**
 * 找「更舊的鄰居」（next，方向定義見規格 1.1）：
 * shooting_date DESC, image_id DESC 排序下，排在目前這筆「後面」的下一筆。
 * 拆成 UNION ALL 兩段的原因同 `getNewerNeighbor`。
 */
export async function getOlderNeighbor(
  db: D1Database,
  userId: string,
  shootingDate: number,
  imageId: string,
): Promise<PhotoListRow | null> {
  const row = await db
    .prepare(
      `SELECT image_id, source_device, date_path, shooting_date FROM (
         SELECT image_id, source_device, date_path, shooting_date FROM photos
         WHERE user_id = ? AND is_deleted = 0 AND shooting_date < ?
         ORDER BY shooting_date DESC, image_id DESC
         LIMIT 1
       )
       UNION ALL
       SELECT image_id, source_device, date_path, shooting_date FROM (
         SELECT image_id, source_device, date_path, shooting_date FROM photos
         WHERE user_id = ? AND is_deleted = 0 AND shooting_date = ? AND image_id < ?
         ORDER BY image_id DESC
         LIMIT 1
       )
       ORDER BY shooting_date DESC, image_id DESC
       LIMIT 1`,
    )
    .bind(userId, shootingDate, userId, shootingDate, imageId)
    .first<PhotoListRow>()
  return row ?? null
}

export async function insert(
  db: D1Database,
  imageId: string,
  columns: SyncableColumn[],
): Promise<PhotoRow | null> {
  return insertIfNotExists<PhotoRow>(db, 'photos', 'image_id', imageId, columns)
}

export async function update(
  db: D1Database,
  imageId: string,
  baseVersion: number,
  columns: SyncableColumn[],
): Promise<PhotoRow | null> {
  return updateIfVersionMatchesAndChanged<PhotoRow>(
    db,
    'photos',
    'image_id',
    imageId,
    baseVersion,
    columns,
  )
}

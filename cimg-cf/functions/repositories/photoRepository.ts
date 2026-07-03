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

/**
 * 依 shooting_date DESC, image_id DESC 排序，用 keyset (cursor) 分頁撈取。
 * 不帶 cursor 代表撈第一頁。呼叫端負責多撈 1 筆來判斷 hasMore（本函式單純依 limit 撈取）。
 */
export async function getListByUserId(
  db: D1Database,
  userId: string,
  cursor: PhotoCursor | null,
  limit: number,
): Promise<PhotoRow[]> {
  const sql = cursor
    ? `
      SELECT * FROM photos
      WHERE user_id = ? AND is_deleted = 0
        AND (shooting_date < ? OR (shooting_date = ? AND image_id < ?))
      ORDER BY shooting_date DESC, image_id DESC
      LIMIT ?
    `
    : `
      SELECT * FROM photos
      WHERE user_id = ? AND is_deleted = 0
      ORDER BY shooting_date DESC, image_id DESC
      LIMIT ?
    `

  const bindings = cursor
    ? [userId, cursor.shootingDate, cursor.shootingDate, cursor.imageId, limit]
    : [userId, limit]

  const rows = await db
    .prepare(sql)
    .bind(...bindings)
    .all<PhotoRow>()
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
): Promise<PhotoRow | null> {
  const row = await db
    .prepare(`SELECT * FROM photos WHERE user_id = ? AND image_id = ? AND is_deleted = 0`)
    .bind(userId, imageId)
    .first<PhotoRow>()
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

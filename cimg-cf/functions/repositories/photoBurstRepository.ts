import {
  insertIfNotExists,
  updateIfVersionMatchesAndChanged,
  type SyncableColumn,
} from './syncableTable'

/**
 * `photo_bursts` 的天然鍵是 `(user_id, start_date)` 兩個欄位,沒有單一字串
 * 可以直接當 `syncableTable` 的 pkColumn 用,所以額外加了 `id` 欄位存
 * `"{user_id}:{start_date}"` 這個組合字串當 PK(詳見 `photoBurstService`）。
 * `user_id`/`start_date` 仍保留成獨立欄位,方便之後有需要時查詢。
 *
 * read 路徑（見下方 `getListByUserId`）另外只需要精簡欄位，見 `PhotoBurstListRow`。
 */
export interface PhotoBurstRow {
  id: string
  user_id: string
  start_date: number
  end_date: number
  total_count: number
  span_days: number
  version: number
  is_deleted: number
}

/**
 * read 路徑（`BurstCarousel` 用）共用的精簡欄位，只包含「顯示一張卡片」所需的最小組合：
 * 不含 `span_days`（前端目前用不到），也不含 `id`/`version` 等 write 路徑才需要的欄位。
 * 跟 `photoRepository.PhotoListRow` 的分法一致。
 */
export interface PhotoBurstListRow {
  start_date: number
  end_date: number
  total_count: number
}

/**
 * 依 `start_date` 新到舊排序（假設最近的密集拍照期間比較有回顧價值）。
 * 資料量小（每個使用者的 burst 數量遠小於照片數），不做分頁。
 */
export async function getListByUserId(
  db: D1Database,
  userId: string,
): Promise<PhotoBurstListRow[]> {
  const rows = await db
    .prepare(
      `SELECT start_date, end_date, total_count FROM photo_bursts
       WHERE user_id = ? AND is_deleted = 0
       ORDER BY start_date DESC`,
    )
    .bind(userId)
    .all<PhotoBurstListRow>()
  return rows.results
}

export async function insert(
  db: D1Database,
  id: string,
  columns: SyncableColumn[],
): Promise<PhotoBurstRow | null> {
  return insertIfNotExists<PhotoBurstRow>(db, 'photo_bursts', 'id', id, columns)
}

export async function update(
  db: D1Database,
  id: string,
  baseVersion: number,
  columns: SyncableColumn[],
): Promise<PhotoBurstRow | null> {
  return updateIfVersionMatchesAndChanged<PhotoBurstRow>(
    db,
    'photo_bursts',
    'id',
    id,
    baseVersion,
    columns,
  )
}

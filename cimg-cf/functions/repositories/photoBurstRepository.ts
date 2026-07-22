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
 * 目前沒有對外的 read API 需求,只提供 insert/update(供 `photoBurstService.put`
 * 使用),沒有像 `photoRepository` 那樣的 `getListByUserId` 等查詢函式。
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

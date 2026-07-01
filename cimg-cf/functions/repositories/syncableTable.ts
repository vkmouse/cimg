/**
 * 給「可被 sync 的業務表」(users / credentials / buckets / photos) 共用的
 * 通用 SQL helper。這個檔案只處理 SQL 拼接與執行，不包含任何商業邏輯
 * （欄位驗證、payload 解析等都應該留在對應的 *Service 裡）。
 */

export interface SyncableColumn {
  /** DB 欄位名稱（snake_case） */
  name: string
  value: unknown
}

/**
 * INSERT 一筆新資料，PK 衝突時忽略（ON CONFLICT DO NOTHING）。
 * version 固定寫 1。
 *
 * @param pkColumn PK 欄位名稱（例如 `id` / `user_id` / `image_id`，依各表的自然鍵而定）。
 * @param pkValue PK 欄位的值。
 * @returns RETURNING 出來的新資料；若 PK 已存在（衝突被忽略）則為 null。
 */
export async function insertIfNotExists<T = Record<string, unknown>>(
  db: D1Database,
  table: string,
  pkColumn: string,
  pkValue: string,
  columns: SyncableColumn[],
): Promise<T | null> {
  const columnNames = [pkColumn, ...columns.map((c) => c.name), 'version']
  const placeholders = columnNames.map(() => '?').join(', ')
  const values: unknown[] = [pkValue, ...columns.map((c) => c.value), 1]

  const sql = `
    INSERT INTO ${table} (${columnNames.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (${pkColumn}) DO NOTHING
    RETURNING *
  `

  const row = await db
    .prepare(sql)
    .bind(...values)
    .first<T>()

  return row ?? null
}

/**
 * 在 version 吻合，且至少一個業務欄位真的有變化的情況下，更新一筆資料，
 * 並把 version 寫成 baseVersion + 1。
 *
 * 只要其中一個欄位用 IS NOT 比對為「不同」，就視為有變化（IS NOT 對 NULL 安全，
 * 不會像 != 一樣在 NULL 比對時失效）。
 *
 * @param pkColumn PK 欄位名稱（例如 `id` / `user_id` / `image_id`，依各表的自然鍵而定）。
 * @param pkValue PK 欄位的值。
 * @returns RETURNING 出來的新資料；若 version 不吻合或所有欄位都沒有變化（更新 0 rows）則為 null。
 */
export async function updateIfVersionMatchesAndChanged<T = Record<string, unknown>>(
  db: D1Database,
  table: string,
  pkColumn: string,
  pkValue: string,
  baseVersion: number,
  columns: SyncableColumn[],
): Promise<T | null> {
  const newVersion = baseVersion + 1

  const setClause = [...columns.map((c) => `${c.name} = ?`), 'version = ?'].join(', ')
  const diffClause = columns.map((c) => `${c.name} IS NOT ?`).join(' OR ')

  const setValues = [...columns.map((c) => c.value), newVersion]
  const diffValues = columns.map((c) => c.value)

  const sql = `
    UPDATE ${table}
    SET ${setClause}
    WHERE ${pkColumn} = ?
      AND version = ?
      AND (${diffClause})
    RETURNING *
  `

  const row = await db
    .prepare(sql)
    .bind(...setValues, pkValue, baseVersion, ...diffValues)
    .first<T>()

  return row ?? null
}

import {
  insertIfNotExists,
  updateIfVersionMatchesAndChanged,
  type SyncableColumn,
} from './syncableTable'

export interface UserRow {
  id: string
  email: string
  version: number
  is_deleted: number
}

/** 取得第一筆未刪除的使用者（目前系統還沒有登入機制，先沿用「取第一筆」的行為）。 */
export async function getFirst(db: D1Database): Promise<UserRow | null> {
  const row = await db
    .prepare(`SELECT * FROM users WHERE is_deleted = 0 LIMIT 1`)
    .first<UserRow>()
  return row ?? null
}

/** 依 email 取得未刪除的使用者。 */
export async function getByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  const row = await db
    .prepare(`SELECT * FROM users WHERE email = ? AND is_deleted = 0 LIMIT 1`)
    .bind(email)
    .first<UserRow>()
  return row ?? null
}

export async function insert(
  db: D1Database,
  id: string,
  columns: SyncableColumn[],
): Promise<UserRow | null> {
  return insertIfNotExists<UserRow>(db, 'users', 'id', id, columns)
}

export async function update(
  db: D1Database,
  id: string,
  baseVersion: number,
  columns: SyncableColumn[],
): Promise<UserRow | null> {
  return updateIfVersionMatchesAndChanged<UserRow>(db, 'users', 'id', id, baseVersion, columns)
}

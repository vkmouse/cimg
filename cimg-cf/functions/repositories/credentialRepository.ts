import {
  insertIfNotExists,
  updateIfVersionMatchesAndChanged,
  type SyncableColumn,
} from './syncableTable'

export interface CredentialRow {
  user_id: string
  access_key_id: string
  expiration: number
  secret_access_key: string
  session_token: string
  version: number
  is_deleted: number
}

export async function getByUserId(
  db: D1Database,
  userId: string,
): Promise<CredentialRow | null> {
  const row = await db
    .prepare(`SELECT * FROM credentials WHERE user_id = ? AND is_deleted = 0`)
    .bind(userId)
    .first<CredentialRow>()
  return row ?? null
}

export async function insert(
  db: D1Database,
  userId: string,
  columns: SyncableColumn[],
): Promise<CredentialRow | null> {
  return insertIfNotExists<CredentialRow>(db, 'credentials', 'user_id', userId, columns)
}

export async function update(
  db: D1Database,
  userId: string,
  baseVersion: number,
  columns: SyncableColumn[],
): Promise<CredentialRow | null> {
  return updateIfVersionMatchesAndChanged<CredentialRow>(
    db,
    'credentials',
    'user_id',
    userId,
    baseVersion,
    columns,
  )
}

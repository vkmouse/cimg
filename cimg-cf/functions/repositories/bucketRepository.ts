import {
  insertIfNotExists,
  updateIfVersionMatchesAndChanged,
  type SyncableColumn,
} from './syncableTable'

export interface BucketRow {
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
  version: number
  is_deleted: number
}

export async function getByUserId(
  db: D1Database,
  userId: string,
): Promise<BucketRow | null> {
  const row = await db
    .prepare(`SELECT * FROM buckets WHERE user_id = ? AND is_deleted = 0`)
    .bind(userId)
    .first<BucketRow>()
  return row ?? null
}

export async function insert(
  db: D1Database,
  userId: string,
  columns: SyncableColumn[],
): Promise<BucketRow | null> {
  return insertIfNotExists<BucketRow>(db, 'buckets', 'user_id', userId, columns)
}

export async function update(
  db: D1Database,
  userId: string,
  baseVersion: number,
  columns: SyncableColumn[],
): Promise<BucketRow | null> {
  return updateIfVersionMatchesAndChanged<BucketRow>(
    db,
    'buckets',
    'user_id',
    userId,
    baseVersion,
    columns,
  )
}

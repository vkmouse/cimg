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

export async function getListByUserId(
  db: D1Database,
  userId: string,
  limit = 10,
): Promise<PhotoRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM photos WHERE user_id = ? AND is_deleted = 0 LIMIT ?`)
    .bind(userId, limit)
    .all<PhotoRow>()
  return rows.results
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

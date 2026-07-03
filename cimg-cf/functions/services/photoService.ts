import type { PutEntityParams } from '../types'
import * as photoRepository from '../repositories/photoRepository'
import type { PhotoCursor, PhotoRow } from '../repositories/photoRepository'
import type { SyncableColumn } from '../repositories/syncableTable'
import * as syncEventService from './syncEventService'
import {
  isFiniteNumber,
  isNonEmptyString,
  isStringOrNull,
  parsePayloadJson,
  PayloadValidationError,
} from './validation'

export interface PhotoDto {
  imageId: string
  userId: string
  sourceDevice: string
  datePath: string
  shootingDate: number
  uploadedDate: number
  shootingCamera: string | null
  imageSize: string | null
  fileSize: string | null
  fileFormat: string | null
  shutterSpeed: string | null
  apertureValue: string | null
  isoSpeed: string | null
  lensFocalLength: string | null
  whiteBalanceMode: string | null
  exposureCompensation: string | null
  flashFiring: string | null
  lens: string | null
  subjectCategory: string | null
  blurJudgement: string | null
  exposureJudgement: string | null
  version: number
  isDeleted: boolean
}

function toDto(row: PhotoRow): PhotoDto {
  return {
    imageId: row.image_id,
    userId: row.user_id,
    sourceDevice: row.source_device,
    datePath: row.date_path,
    shootingDate: row.shooting_date,
    uploadedDate: row.uploaded_date,
    shootingCamera: row.shooting_camera,
    imageSize: row.image_size,
    fileSize: row.file_size,
    fileFormat: row.file_format,
    shutterSpeed: row.shutter_speed,
    apertureValue: row.aperture_value,
    isoSpeed: row.iso_speed,
    lensFocalLength: row.lens_focal_length,
    whiteBalanceMode: row.white_balance_mode,
    exposureCompensation: row.exposure_compensation,
    flashFiring: row.flash_firing,
    lens: row.lens,
    subjectCategory: row.subject_category,
    blurJudgement: row.blur_judgement,
    exposureJudgement: row.exposure_judgement,
    version: row.version,
    isDeleted: row.is_deleted === 1,
  }
}

/** payload 欄位為 snake_case（與 sync_queue.payload 一致）。 */
interface PhotoSnakePayload {
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
  is_deleted: boolean
}

/** photos 表裡允許 NULL 的欄位（snake_case）。 */
const NULLABLE_SNAKE_FIELDS: (keyof PhotoSnakePayload)[] = [
  'shooting_camera',
  'image_size',
  'file_size',
  'file_format',
  'shutter_speed',
  'aperture_value',
  'iso_speed',
  'lens_focal_length',
  'white_balance_mode',
  'exposure_compensation',
  'flash_firing',
  'lens',
  'subject_category',
  'blur_judgement',
  'exposure_judgement',
]

function parsePhotoPayload(payloadJson: string): PhotoSnakePayload {
  const raw = parsePayloadJson(payloadJson)

  if (!isNonEmptyString(raw.user_id)) {
    throw new PayloadValidationError('payload.user_id 必須是非空字串')
  }
  if (!isNonEmptyString(raw.source_device)) {
    throw new PayloadValidationError('payload.source_device 必須是非空字串')
  }
  if (!isNonEmptyString(raw.date_path)) {
    throw new PayloadValidationError('payload.date_path 必須是非空字串')
  }
  if (!isFiniteNumber(raw.shooting_date)) {
    throw new PayloadValidationError('payload.shooting_date 必須是數字')
  }
  if (!isFiniteNumber(raw.uploaded_date)) {
    throw new PayloadValidationError('payload.uploaded_date 必須是數字')
  }
  const isDeleted = raw.is_deleted === 1 || raw.is_deleted === true
  if (typeof raw.is_deleted !== 'number' && typeof raw.is_deleted !== 'boolean') {
    throw new PayloadValidationError('payload.is_deleted 必須是數字或 boolean')
  }

  const nullableFields: Record<string, string | null> = {}
  for (const field of NULLABLE_SNAKE_FIELDS) {
    const value = raw[field]
    if (!isStringOrNull(value)) {
      throw new PayloadValidationError(`payload.${field} 必須是字串或 null`)
    }
    nullableFields[field] = value ?? null
  }

  return {
    user_id: raw.user_id as string,
    source_device: raw.source_device as string,
    date_path: raw.date_path as string,
    shooting_date: raw.shooting_date as number,
    uploaded_date: raw.uploaded_date as number,
    is_deleted: isDeleted,
    ...nullableFields,
  } as PhotoSnakePayload
}

export const DEFAULT_PAGE_SIZE = 50

export interface PhotoListResult {
  items: PhotoDto[]
  nextCursor: PhotoCursor | null
  hasMore: boolean
}

/**
 * 依 shooting_date DESC, image_id DESC 排序，用 keyset (cursor) 分頁撈取一頁照片。
 * 內部多撈 1 筆來判斷是否還有下一頁；回傳時會把多撈的那筆砍掉。
 */
export async function getListByUserId(
  db: D1Database,
  userId: string,
  cursor: PhotoCursor | null,
  limit: number = DEFAULT_PAGE_SIZE,
): Promise<PhotoListResult> {
  const rows = await photoRepository.getListByUserId(db, userId, cursor, limit + 1)

  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const items = pageRows.map(toDto)

  const lastItem = items[items.length - 1]
  const nextCursor: PhotoCursor | null =
    hasMore && lastItem ? { shootingDate: lastItem.shootingDate, imageId: lastItem.imageId } : null

  return { items, nextCursor, hasMore }
}

/**
 * 依 imageId 查單筆照片，並用 userId 限制擁有權。
 * 查無資料（不存在 / 不屬於這個使用者 / 已刪除）一律回傳 null，交由呼叫端統一回 404。
 */
export async function getByImageId(
  db: D1Database,
  userId: string,
  imageId: string,
): Promise<PhotoDto | null> {
  const row = await photoRepository.getByImageId(db, userId, imageId)
  return row ? toDto(row) : null
}

/**
 * 處理 entityType=PHT 的寫入：entityId 即為 photos.image_id（PK 為自然鍵 image_id）。
 * user_id 從 payload.user_id 取得（普通業務欄位，不特殊處理）。
 */
export async function put(db: D1Database, params: PutEntityParams): Promise<PhotoDto | null> {
  const payload = parsePhotoPayload(params.payloadJson)

  const columns: SyncableColumn[] = [
    { name: 'user_id', value: payload.user_id },
    { name: 'source_device', value: payload.source_device },
    { name: 'date_path', value: payload.date_path },
    { name: 'shooting_date', value: payload.shooting_date },
    { name: 'uploaded_date', value: payload.uploaded_date },
    { name: 'shooting_camera', value: payload.shooting_camera },
    { name: 'image_size', value: payload.image_size },
    { name: 'file_size', value: payload.file_size },
    { name: 'file_format', value: payload.file_format },
    { name: 'shutter_speed', value: payload.shutter_speed },
    { name: 'aperture_value', value: payload.aperture_value },
    { name: 'iso_speed', value: payload.iso_speed },
    { name: 'lens_focal_length', value: payload.lens_focal_length },
    { name: 'white_balance_mode', value: payload.white_balance_mode },
    { name: 'exposure_compensation', value: payload.exposure_compensation },
    { name: 'flash_firing', value: payload.flash_firing },
    { name: 'lens', value: payload.lens },
    { name: 'subject_category', value: payload.subject_category },
    { name: 'blur_judgement', value: payload.blur_judgement },
    { name: 'exposure_judgement', value: payload.exposure_judgement },
    { name: 'is_deleted', value: payload.is_deleted ? 1 : 0 },
  ]

  const row =
    params.baseVersion === 0
      ? await photoRepository.insert(db, params.entityId, columns)
      : await photoRepository.update(db, params.entityId, params.baseVersion, columns)

  if (!row) {
    return null
  }

  const dto = toDto(row)

  await syncEventService.insert(db, {
    userId: payload.user_id,
    mutationId: params.mutationId,
    entityType: 'PHT',
    entityId: params.entityId,
    version: dto.version,
    payload: row,
  })

  return dto
}

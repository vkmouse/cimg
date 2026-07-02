import type { PutEntityParams } from '../types'
import * as bucketRepository from '../repositories/bucketRepository'
import type { BucketRow } from '../repositories/bucketRepository'
import type { SyncableColumn } from '../repositories/syncableTable'
import * as syncEventService from './syncEventService'
import { isNonEmptyString, parsePayloadJson, PayloadValidationError } from './validation'

export interface BucketDto {
  userId: string
  region: string
  exifBucket: string
  exifKeybase: string
  expandExifBucket: string
  expandExifKeybase: string
  expandOriginalBucket: string
  expandOriginalKeybase: string
  extraLargeBucket: string
  extraLargeKeybase: string
  middleBucket: string
  middleKeybase: string
  originalBucket: string
  originalKeybase: string
  version: number
  isDeleted: boolean
}

function toDto(row: BucketRow): BucketDto {
  return {
    userId: row.user_id,
    region: row.region,
    exifBucket: row.exif_bucket,
    exifKeybase: row.exif_keybase,
    expandExifBucket: row.expand_exif_bucket,
    expandExifKeybase: row.expand_exif_keybase,
    expandOriginalBucket: row.expand_original_bucket,
    expandOriginalKeybase: row.expand_original_keybase,
    extraLargeBucket: row.extra_large_bucket,
    extraLargeKeybase: row.extra_large_keybase,
    middleBucket: row.middle_bucket,
    middleKeybase: row.middle_keybase,
    originalBucket: row.original_bucket,
    originalKeybase: row.original_keybase,
    version: row.version,
    isDeleted: row.is_deleted === 1,
  }
}

/** payload 欄位為 snake_case（與 sync_queue.payload 一致）。 */
interface BucketSnakePayload {
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
  is_deleted: boolean
}

const REQUIRED_SNAKE_FIELDS: (keyof BucketSnakePayload)[] = [
  'user_id',
  'region',
  'exif_bucket',
  'exif_keybase',
  'expand_exif_bucket',
  'expand_exif_keybase',
  'expand_original_bucket',
  'expand_original_keybase',
  'extra_large_bucket',
  'extra_large_keybase',
  'middle_bucket',
  'middle_keybase',
  'original_bucket',
  'original_keybase',
]

function parseBucketPayload(payloadJson: string): BucketSnakePayload {
  const raw = parsePayloadJson(payloadJson)

  for (const field of REQUIRED_SNAKE_FIELDS) {
    if (!isNonEmptyString(raw[field])) {
      throw new PayloadValidationError(`payload.${field} 必須是非空字串`)
    }
  }
  const isDeleted = raw.is_deleted === 1 || raw.is_deleted === true
  if (typeof raw.is_deleted !== 'number' && typeof raw.is_deleted !== 'boolean') {
    throw new PayloadValidationError('payload.is_deleted 必須是數字或 boolean')
  }

  return {
    user_id: raw.user_id as string,
    region: raw.region as string,
    exif_bucket: raw.exif_bucket as string,
    exif_keybase: raw.exif_keybase as string,
    expand_exif_bucket: raw.expand_exif_bucket as string,
    expand_exif_keybase: raw.expand_exif_keybase as string,
    expand_original_bucket: raw.expand_original_bucket as string,
    expand_original_keybase: raw.expand_original_keybase as string,
    extra_large_bucket: raw.extra_large_bucket as string,
    extra_large_keybase: raw.extra_large_keybase as string,
    middle_bucket: raw.middle_bucket as string,
    middle_keybase: raw.middle_keybase as string,
    original_bucket: raw.original_bucket as string,
    original_keybase: raw.original_keybase as string,
    is_deleted: isDeleted,
  }
}

export async function getByUserId(
  db: D1Database,
  userId: string,
): Promise<BucketDto | null> {
  const row = await bucketRepository.getByUserId(db, userId)
  return row ? toDto(row) : null
}

/**
 * 處理 entityType=BKT 的寫入：entityId 即為 buckets.user_id（PK 為自然鍵 user_id）
 * user_id 從 payload.user_id 取得（與 entityId 一致，不特殊處理）
 */
export async function put(
  db: D1Database,
  params: PutEntityParams,
): Promise<BucketDto | null> {
  const payload = parseBucketPayload(params.payloadJson)

  const columns: SyncableColumn[] = [
    { name: 'region', value: payload.region },
    { name: 'exif_bucket', value: payload.exif_bucket },
    { name: 'exif_keybase', value: payload.exif_keybase },
    { name: 'expand_exif_bucket', value: payload.expand_exif_bucket },
    { name: 'expand_exif_keybase', value: payload.expand_exif_keybase },
    { name: 'expand_original_bucket', value: payload.expand_original_bucket },
    { name: 'expand_original_keybase', value: payload.expand_original_keybase },
    { name: 'extra_large_bucket', value: payload.extra_large_bucket },
    { name: 'extra_large_keybase', value: payload.extra_large_keybase },
    { name: 'middle_bucket', value: payload.middle_bucket },
    { name: 'middle_keybase', value: payload.middle_keybase },
    { name: 'original_bucket', value: payload.original_bucket },
    { name: 'original_keybase', value: payload.original_keybase },
    { name: 'is_deleted', value: payload.is_deleted ? 1 : 0 },
  ]

  const row =
    params.baseVersion === 0
      ? await bucketRepository.insert(db, params.entityId, columns)
      : await bucketRepository.update(db, params.entityId, params.baseVersion, columns)

  if (!row) {
    return null
  }

  const dto = toDto(row)

  await syncEventService.insert(db, {
    userId: payload.user_id,
    mutationId: params.mutationId,
    entityType: 'BKT',
    entityId: params.entityId,
    version: dto.version,
    payload: row,
  })

  return dto
}

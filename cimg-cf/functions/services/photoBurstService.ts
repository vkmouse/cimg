import type { PutEntityParams } from '../types'
import * as photoBurstRepository from '../repositories/photoBurstRepository'
import type { PhotoBurstListRow, PhotoBurstRow } from '../repositories/photoBurstRepository'
import type { SyncableColumn } from '../repositories/syncableTable'
import * as syncEventService from './syncEventService'
import { isFiniteNumber, isNonEmptyString, parsePayloadJson, PayloadValidationError } from '../utils/validation'

export interface PhotoBurstDto {
  userId: string
  startDate: number
  endDate: number
  totalCount: number
  spanDays: number
  version: number
  isDeleted: boolean
}

function toDto(row: PhotoBurstRow): PhotoBurstDto {
  return {
    userId: row.user_id,
    startDate: row.start_date,
    endDate: row.end_date,
    totalCount: row.total_count,
    spanDays: row.span_days,
    version: row.version,
    isDeleted: row.is_deleted === 1,
  }
}

/**
 * read 路徑（`BurstCarousel` 用）共用的精簡 DTO，對應 `photoBurstRepository.PhotoBurstListRow`。
 * 跟 `PhotoBurstDto`（write 路徑，`put()` 組 sync payload 用）區分開來，理由同 `photoService.ts`
 * 裡 `PhotoListDto` vs `PhotoDto` 的分法。
 */
export interface PhotoBurstListDto {
  startDate: number
  endDate: number
  totalCount: number
}

function toListDto(row: PhotoBurstListRow): PhotoBurstListDto {
  return {
    startDate: row.start_date,
    endDate: row.end_date,
    totalCount: row.total_count,
  }
}

/** 依 startDate 新到舊排序，回傳目前使用者所有 burst（不分頁，資料量小）。 */
export async function getListByUserId(db: D1Database, userId: string): Promise<PhotoBurstListDto[]> {
  const rows = await photoBurstRepository.getListByUserId(db, userId)
  return rows.map(toListDto)
}

/** payload 欄位為 snake_case（與 sync_queue.payload 一致）。 */
interface PhotoBurstSnakePayload {
  user_id: string
  start_date: number
  end_date: number
  total_count: number
  span_days: number
  is_deleted: boolean
}

function parsePhotoBurstPayload(payloadJson: string): PhotoBurstSnakePayload {
  const raw = parsePayloadJson(payloadJson)

  if (!isNonEmptyString(raw.user_id)) {
    throw new PayloadValidationError('payload.user_id 必須是非空字串')
  }
  if (!isFiniteNumber(raw.start_date)) {
    throw new PayloadValidationError('payload.start_date 必須是數字')
  }
  if (!isFiniteNumber(raw.end_date)) {
    throw new PayloadValidationError('payload.end_date 必須是數字')
  }
  if (!isFiniteNumber(raw.total_count)) {
    throw new PayloadValidationError('payload.total_count 必須是數字')
  }
  if (!isFiniteNumber(raw.span_days)) {
    throw new PayloadValidationError('payload.span_days 必須是數字')
  }
  if (typeof raw.is_deleted !== 'number' && typeof raw.is_deleted !== 'boolean') {
    throw new PayloadValidationError('payload.is_deleted 必須是數字或 boolean')
  }
  const isDeleted = raw.is_deleted === 1 || raw.is_deleted === true

  return {
    user_id: raw.user_id as string,
    start_date: raw.start_date as number,
    end_date: raw.end_date as number,
    total_count: raw.total_count as number,
    span_days: raw.span_days as number,
    is_deleted: isDeleted,
  }
}

/**
 * 從 entityId（`"{user_id}:{start_date}"`）拆出 user_id / start_date。
 * 用 `lastIndexOf(':')` 從最右邊切一刀（理由同 rs 端 `split_entity_id`：
 * user_id 目前是 UUID 不含冒號，但語意上明確表達「最後一段冒號後面是
 * start_date」，比逐段 split 更不怕未來格式變動時默默切錯）。
 * 拆不出來（entityId 不含冒號，或冒號後面不是合法數字）視為驗證失敗。
 */
function splitEntityId(entityId: string): { userId: string; startDate: number } {
  const idx = entityId.lastIndexOf(':')
  if (idx <= 0) {
    throw new PayloadValidationError('entityId 格式錯誤：必須是 "{user_id}:{start_date}"')
  }
  const userId = entityId.slice(0, idx)
  const startDate = Number(entityId.slice(idx + 1))
  if (!Number.isFinite(startDate)) {
    throw new PayloadValidationError('entityId 格式錯誤：必須是 "{user_id}:{start_date}"')
  }
  return { userId, startDate }
}

/**
 * 處理 entityType=PBT 的寫入：entityId 是 `"{user_id}:{start_date}"` 組合
 * 字串（photo_bursts 的天然鍵是 (user_id, start_date) 兩個欄位，沒有單一
 * 字串可以直接當 entityId 用，見討論記錄）。CF 端額外加一個
 * `id TEXT PRIMARY KEY` 欄位存這個組合字串，沿用 `syncableTable` 的通用
 * insert/update，user_id/start_date 仍保留成獨立欄位方便查詢。
 *
 * entityId 拆出來的 user_id/start_date 視為 authoritative；payload 裡也帶
 * 了 user_id/start_date（純粹為了讓 photo_bursts 表能存成獨立欄位），
 * 兩者不一致（理論上不該發生）一律視為驗證失敗，不採信 payload 的值。
 */
export async function put(db: D1Database, params: PutEntityParams): Promise<PhotoBurstDto | null> {
  const { userId, startDate } = splitEntityId(params.entityId)
  const payload = parsePhotoBurstPayload(params.payloadJson)

  if (payload.user_id !== userId || payload.start_date !== startDate) {
    throw new PayloadValidationError('payload.user_id/start_date 與 entityId 拆出來的值不一致')
  }

  const columns: SyncableColumn[] = [
    { name: 'user_id', value: userId },
    { name: 'start_date', value: startDate },
    { name: 'end_date', value: payload.end_date },
    { name: 'total_count', value: payload.total_count },
    { name: 'span_days', value: payload.span_days },
    { name: 'is_deleted', value: payload.is_deleted ? 1 : 0 },
  ]

  const row =
    params.baseVersion === 0
      ? await photoBurstRepository.insert(db, params.entityId, columns)
      : await photoBurstRepository.update(db, params.entityId, params.baseVersion, columns)

  if (!row) {
    return null
  }

  const dto = toDto(row)

  await syncEventService.insert(db, {
    userId,
    mutationId: params.mutationId,
    entityType: 'PBT',
    entityId: params.entityId,
    version: dto.version,
    payload: row,
  })

  return dto
}

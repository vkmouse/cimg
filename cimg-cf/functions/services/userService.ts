import type { PutEntityParams } from '../types'
import * as userRepository from '../repositories/userRepository'
import type { UserRow } from '../repositories/userRepository'
import type { SyncableColumn } from '../repositories/syncableTable'
import * as syncEventService from './syncEventService'
import { isBoolean, isNonEmptyString, parsePayloadJson, PayloadValidationError } from '../utils/validation'

export interface UserDto {
  id: string
  email: string
  version: number
  isDeleted: boolean
}

function toDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    version: row.version,
    isDeleted: row.is_deleted === 1,
  }
}

/** payload 欄位為 snake_case（與 sync_queue.payload 一致）。 */
interface UserSnakePayload {
  email: string
  is_deleted: boolean
  user_id?: string
}

function parseUserPayload(payloadJson: string): UserSnakePayload {
  const raw = parsePayloadJson(payloadJson)

  if (!isNonEmptyString(raw.email)) {
    throw new PayloadValidationError('payload.email 必須是非空字串')
  }
  // is_deleted 在 DB 存 0/1，但 sync_queue payload 裡也可能是 boolean。
  const isDeleted = raw.is_deleted === 1 || raw.is_deleted === true
  if (typeof raw.is_deleted !== 'number' && typeof raw.is_deleted !== 'boolean') {
    throw new PayloadValidationError('payload.is_deleted 必須是數字或 boolean')
  }

  return {
    email: raw.email as string,
    is_deleted: isDeleted,
  }
}

/** 取得第一筆未刪除的使用者（目前系統還沒有登入機制，先沿用「取第一筆」的行為）。 */
export async function getFirst(db: D1Database): Promise<UserDto | null> {
  const row = await userRepository.getFirst(db)
  return row ? toDto(row) : null
}

/** 依 email 取得未刪除的使用者。 */
export async function getByEmail(db: D1Database, email: string): Promise<UserDto | null> {
  const row = await userRepository.getByEmail(db, email)
  return row ? toDto(row) : null
}

/**
 * 處理 entityType=USR 的寫入：entityId 即為 users.id（也就是這個使用者自己的 id）。
 * baseVersion === 0 視為新建；否則視為更新，必須版本吻合且欄位真的有變化。
 * 回傳 null 代表 ERROR；非 null 代表 OK，且已經寫入一筆 sync_events。
 *
 * userId 從 payload.user_id 或 entityId 取得（USR 的 entityId 本身就是 user id）。
 */
export async function put(db: D1Database, params: PutEntityParams): Promise<UserDto | null> {
  const payload = parseUserPayload(params.payloadJson)

  const columns: SyncableColumn[] = [
    { name: 'email', value: payload.email },
    { name: 'is_deleted', value: payload.is_deleted ? 1 : 0 },
  ]

  const row =
    params.baseVersion === 0
      ? await userRepository.insert(db, params.entityId, columns)
      : await userRepository.update(db, params.entityId, params.baseVersion, columns)

  if (!row) {
    return null
  }

  const dto = toDto(row)

  await syncEventService.insert(db, {
    userId: params.entityId,
    mutationId: params.mutationId,
    entityType: 'USR',
    entityId: params.entityId,
    version: dto.version,
    payload: row,
  })

  return dto
}

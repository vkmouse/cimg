import type { PutEntityParams } from '../types'
import * as credentialRepository from '../repositories/credentialRepository'
import type { CredentialRow } from '../repositories/credentialRepository'
import type { SyncableColumn } from '../repositories/syncableTable'
import * as syncEventService from './syncEventService'
import {
  isBoolean,
  isFiniteNumber,
  isNonEmptyString,
  parsePayloadJson,
  PayloadValidationError,
} from '../utils/validation'

export interface CredentialDto {
  userId: string
  accessKeyId: string
  expiration: number
  secretAccessKey: string
  sessionToken: string
  version: number
  isDeleted: boolean
}

function toDto(row: CredentialRow): CredentialDto {
  return {
    userId: row.user_id,
    accessKeyId: row.access_key_id,
    expiration: row.expiration,
    secretAccessKey: row.secret_access_key,
    sessionToken: row.session_token,
    version: row.version,
    isDeleted: row.is_deleted === 1,
  }
}

/** payload 欄位為 snake_case（與 sync_queue.payload 一致）。 */
interface CredentialSnakePayload {
  user_id: string
  access_key_id: string
  expiration: number
  secret_access_key: string
  session_token: string
  is_deleted: boolean
}

function parseCredentialPayload(payloadJson: string): CredentialSnakePayload {
  const raw = parsePayloadJson(payloadJson)

  if (!isNonEmptyString(raw.user_id)) {
    throw new PayloadValidationError('payload.user_id 必須是非空字串')
  }
  if (!isNonEmptyString(raw.access_key_id)) {
    throw new PayloadValidationError('payload.access_key_id 必須是非空字串')
  }
  if (!isFiniteNumber(raw.expiration)) {
    throw new PayloadValidationError('payload.expiration 必須是數字')
  }
  if (!isNonEmptyString(raw.secret_access_key)) {
    throw new PayloadValidationError('payload.secret_access_key 必須是非空字串')
  }
  if (!isNonEmptyString(raw.session_token)) {
    throw new PayloadValidationError('payload.session_token 必須是非空字串')
  }
  const isDeleted = raw.is_deleted === 1 || raw.is_deleted === true
  if (typeof raw.is_deleted !== 'number' && typeof raw.is_deleted !== 'boolean') {
    throw new PayloadValidationError('payload.is_deleted 必須是數字或 boolean')
  }

  return {
    user_id: raw.user_id as string,
    access_key_id: raw.access_key_id as string,
    expiration: raw.expiration as number,
    secret_access_key: raw.secret_access_key as string,
    session_token: raw.session_token as string,
    is_deleted: isDeleted,
  }
}

export async function getByUserId(
  db: D1Database,
  userId: string,
): Promise<CredentialDto | null> {
  const row = await credentialRepository.getByUserId(db, userId)
  return row ? toDto(row) : null
}

/**
 * 處理 entityType=CRD 的寫入：entityId 即為 credentials.user_id（PK 為自然鍵 user_id）。
 * user_id 從 payload.user_id 取得（與 entityId 一致，不特殊處理）。
 */
export async function put(
  db: D1Database,
  params: PutEntityParams,
): Promise<CredentialDto | null> {
  const payload = parseCredentialPayload(params.payloadJson)

  const columns: SyncableColumn[] = [
    { name: 'access_key_id', value: payload.access_key_id },
    { name: 'expiration', value: payload.expiration },
    { name: 'secret_access_key', value: payload.secret_access_key },
    { name: 'session_token', value: payload.session_token },
    { name: 'is_deleted', value: payload.is_deleted ? 1 : 0 },
  ]

  const row =
    params.baseVersion === 0
      ? await credentialRepository.insert(db, params.entityId, columns)
      : await credentialRepository.update(
          db,
          params.entityId,
          params.baseVersion,
          columns,
        )

  if (!row) {
    return null
  }

  const dto = toDto(row)

  await syncEventService.insert(db, {
    userId: payload.user_id,
    mutationId: params.mutationId,
    entityType: 'CRD',
    entityId: params.entityId,
    version: dto.version,
    payload: row,
  })

  return dto
}

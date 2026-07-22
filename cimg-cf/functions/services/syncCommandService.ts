import type { EntityType, PushCommand } from '../types'
import { isFiniteNumber, isNonEmptyString } from '../utils/validation'

const ENTITY_TYPES: EntityType[] = ['BKT', 'USR', 'PHT', 'CRD', 'PBT']

export class CommandValidationError extends Error {}

/** 驗證 PushCommand 本身的形狀（payload 內容的驗證留給對應的 Service）。 */
export function validateCommand(command: unknown): PushCommand {
  if (typeof command !== 'object' || command === null) {
    throw new CommandValidationError('command 必須是一個物件')
  }
  const c = command as Record<string, unknown>

  if (!isNonEmptyString(c.mutationId)) {
    throw new CommandValidationError('mutationId 必須是非空字串')
  }
  if (typeof c.entityType !== 'string' || !ENTITY_TYPES.includes(c.entityType as EntityType)) {
    throw new CommandValidationError('entityType 必須是 BKT｜USR｜PHT｜CRD｜PBT 其中之一')
  }
  if (!isNonEmptyString(c.entityId)) {
    throw new CommandValidationError('entityId 必須是非空字串')
  }
  if (!isFiniteNumber(c.baseVersion) || !Number.isInteger(c.baseVersion) || c.baseVersion < 0) {
    throw new CommandValidationError('baseVersion 必須是 >= 0 的整數')
  }
  if (!isNonEmptyString(c.payload)) {
    throw new CommandValidationError('payload 必須是非空字串')
  }

  return {
    mutationId: c.mutationId,
    entityType: c.entityType as EntityType,
    entityId: c.entityId,
    baseVersion: c.baseVersion,
    payload: c.payload,
  }
}

/** 即使驗證失敗，也盡量把 mutationId 從原始輸入裡撈出來，讓 pushResults 對得上。 */
export function extractMutationId(rawCommand: unknown): string {
  if (
    typeof rawCommand === 'object' &&
    rawCommand !== null &&
    isNonEmptyString((rawCommand as Record<string, unknown>).mutationId)
  ) {
    return (rawCommand as Record<string, unknown>).mutationId as string
  }
  return 'unknown'
}

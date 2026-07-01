/**
 * 給各 *Service 在驗證 payload 欄位時共用的型別 guard。
 * 純粹的型別檢查工具，不含商業邏輯。
 */

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isStringOrNull(value: unknown): value is string | null {
  return value === null || value === undefined || typeof value === 'string'
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/** payload 是否為一個物件（非 null、非陣列）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class PayloadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayloadValidationError'
  }
}

/**
 * 將 PushCommand.payload(JSON 字串)解析成物件，解析失敗時拋出 PayloadValidationError。
 */
export function parsePayloadJson(payloadJson: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    throw new PayloadValidationError('payload 不是合法的 JSON 字串')
  }

  if (!isPlainObject(parsed)) {
    throw new PayloadValidationError('payload 必須是一個 JSON 物件')
  }

  return parsed
}

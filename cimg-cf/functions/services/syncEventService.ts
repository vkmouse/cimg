import type { EntityType, PullEvent } from '../../src/types'
import * as syncEventRepository from '../repositories/syncEventRepository'

/**
 * 批次冪等性檢查：一次查出這批 mutationId 裡，哪些已經處理過了。
 * 回傳的 Set 供呼叫端在迴圈內用同步的 `set.has(mutationId)` 判斷，
 * 取代逐筆 SELECT，減少 DB round-trip。
 */
export async function getDuplicateMutationIds(
  db: D1Database,
  mutationIds: string[],
): Promise<Set<string>> {
  return syncEventRepository.getDuplicateMutationIds(db, mutationIds)
}

/** 回傳給 client 當作下次同步要帶的 lastCursor（即目前 sync_events 最大的 id）。 */
export async function getMaxId(db: D1Database): Promise<number> {
  return syncEventRepository.getMaxId(db)
}

/**
 * Pull 流程：找出 lastCursor 之後的所有新事件，並排除 excludeMutationIds
 * （本次請求剛剛 push 上來、已經寫進 sync_events 的那些 mutationId），
 * 避免把發起者自己剛推上去的資料原封不動地回傳給它自己。
 */
export async function getPullEvents(
  db: D1Database,
  lastCursor: number,
  excludeMutationIds: string[],
): Promise<PullEvent[]> {
  const rows = await syncEventRepository.getPullEvents(db, lastCursor, excludeMutationIds)
  return rows.map((row) => ({
    id: row.id,
    mutationId: row.mutation_id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    version: row.version,
    payload: row.payload,
  }))
}

export interface RecordEventInput {
  userId: string
  mutationId: string
  entityType: EntityType
  entityId: string
  /** 業務表寫入成功後的新版本號（INSERT 為 1，UPDATE 為 baseVersion + 1）。 */
  version: number
  /** 業務表 RETURNING 出來的最終資料（DB row，欄位為 snake_case；會被 JSON.stringify 存進 sync_events.payload）。 */
  payload: unknown
}

/** 只有在業務表真的寫入成功（status === OK）時才會呼叫，記錄一筆 sync_events。 */
export async function insert(db: D1Database, input: RecordEventInput): Promise<void> {
  await syncEventRepository.insert(db, {
    userId: input.userId,
    mutationId: input.mutationId,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: JSON.stringify(input.payload),
    version: input.version,
  })
}

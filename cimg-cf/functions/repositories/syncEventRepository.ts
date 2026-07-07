export interface SyncEventRow {
  id: number
  user_id: string
  mutation_id: string
  entity_type: string
  entity_id: string
  payload: string | null
  version: number
  created_at: string
}

/**
 * 批次冪等性查詢：一次查出這批 mutationId 裡，哪些已經存在於 sync_events。
 * 用 `IN (...)` 取代逐筆查詢，減少 DB round-trip。
 * mutationIds 為空陣列時直接回傳空 Set，不發送 SQL（避免 `IN ()` 語法錯誤）。
 */
export async function getDuplicateMutationIds(
  db: D1Database,
  mutationIds: string[],
): Promise<Set<string>> {
  if (mutationIds.length === 0) {
    return new Set()
  }

  const placeholders = mutationIds.map(() => '?').join(', ')
  const result = await db
    .prepare(`SELECT mutation_id FROM sync_events WHERE mutation_id IN (${placeholders})`)
    .bind(...mutationIds)
    .all<{ mutation_id: string }>()

  return new Set(result.results.map((row) => row.mutation_id))
}

/** 查詢整張表目前的最大 id，供 client 下次同步時當作 lastCursor 帶回來；表格還沒有任何資料就回傳 0。 */
export async function getMaxId(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT MAX(id) AS maxId FROM sync_events`).first<{
    maxId: number | null
  }>()
  return row?.maxId ?? 0
}

/**
 * 查詢 id > afterId 的所有事件（依 id 升序），供 pull 流程使用。
 * excludeMutationIds 用來排除「本次請求剛剛產生」的事件，避免回傳給發起者自己剛推上去的資料。
 */
export async function getPullEvents(
  db: D1Database,
  afterId: number,
  excludeMutationIds: string[],
): Promise<SyncEventRow[]> {
  if (excludeMutationIds.length === 0) {
    const result = await db
      .prepare(`SELECT * FROM sync_events WHERE id > ? ORDER BY id ASC`)
      .bind(afterId)
      .all<SyncEventRow>()
    return result.results
  }

  const placeholders = excludeMutationIds.map(() => '?').join(', ')
  const result = await db
    .prepare(
      `SELECT * FROM sync_events WHERE id > ? AND mutation_id NOT IN (${placeholders}) ORDER BY id ASC`,
    )
    .bind(afterId, ...excludeMutationIds)
    .all<SyncEventRow>()
  return result.results
}

export interface InsertSyncEventInput {
  userId: string
  mutationId: string
  entityType: string
  entityId: string
  payload: string | null
  version: number
}

export async function insert(db: D1Database, input: InsertSyncEventInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_events (user_id, mutation_id, entity_type, entity_id, payload, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.userId,
      input.mutationId,
      input.entityType,
      input.entityId,
      input.payload,
      input.version,
    )
    .run()
}

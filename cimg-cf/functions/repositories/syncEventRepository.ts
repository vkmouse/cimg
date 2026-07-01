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

export async function getByMutationId(
  db: D1Database,
  mutationId: string,
): Promise<SyncEventRow | null> {
  const row = await db
    .prepare(`SELECT * FROM sync_events WHERE mutation_id = ?`)
    .bind(mutationId)
    .first<SyncEventRow>()
  return row ?? null
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

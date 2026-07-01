//! `sync_queue` 表的共用寫入邏輯。
//!
//! 每一個 entity 動作 (users::ensure_exists、credentials::upsert、
//! buckets::ensure_exists、photos::ensure_exists、photos::update_detail)
//! 完成後,只要產生了「真正的變更」(新增成功 / 值有變動的更新),
//! 就要把這次變更寫進 sync_queue,供之後上傳同步使用。
//!
//! 「沒有變更」的情況 (例如 INSERT OR IGNORE 命中既有資料、
//! UPSERT 的 WHERE 條件判斷值未變、UPDATE 找不到對應的列) 都不寫入
//! sync_queue —— 這個判斷由各個 entity 模組自行決定,本模組只負責
//! 寫入這一筆 sync_queue 記錄。
//!
//! 主表的寫入與 sync_queue 的寫入是兩個獨立的 `execute`,不包在同一個
//! transaction 裡 (本應用程式是單機、單連線、事件驅動,不會有並發寫入)。

use rusqlite::{params, Connection, Result, ToSql};
use uuid::Uuid;

/// entity 類型代碼,對應文件裡的 USR / CRD / BKT / PHT。
#[derive(Debug, Clone, Copy)]
pub enum EntityType {
    User,
    Credential,
    Bucket,
    Photo,
}

impl EntityType {
    fn code(self) -> &'static str {
        match self {
            EntityType::User => "USR",
            EntityType::Credential => "CRD",
            EntityType::Bucket => "BKT",
            EntityType::Photo => "PHT",
        }
    }
}

/// 寫入一筆 sync_queue 記錄。
///
/// - `entity_id`:固定使用 `new` 那一筆的 id (新增時是新 UUID,更新時是原本不變的 id)。
/// - `new_payload`:`new` 物件,序列化後存入 `payload` (去除 `new_` 前綴的欄位名稱)。
/// - `old_snapshot`:`old` 物件,序列化後存入 `snapshot_before` (去除 `old_` 前綴的欄位名稱);
///   若沒有舊資料 (例如第一次新增),傳 `None`。
/// - `base_version`:`old` 的 version;若沒有舊資料,固定傳 `0`。
/// - `created_at` 由資料庫欄位 `DEFAULT CURRENT_TIMESTAMP` 自動填入,這裡不處理。
pub fn enqueue(
    conn: &Connection,
    entity_type: EntityType,
    entity_id: &str,
    new_payload: &serde_json::Value,
    old_snapshot: Option<&serde_json::Value>,
    base_version: i64,
) -> Result<()> {
    let mutation_id = Uuid::new_v4().to_string();
    let payload = serde_json::to_string(new_payload)
        .expect("new_payload 序列化失敗:輸入應為內部已知結構,不應該發生");
    let snapshot_before = match old_snapshot {
        Some(v) => Some(
            serde_json::to_string(v)
                .expect("old_snapshot 序列化失敗:輸入應為內部已知結構,不應該發生"),
        ),
        None => None,
    };

    conn.execute(
        "INSERT INTO sync_queue (
            mutation_id, entity_type, entity_id,
            payload, base_version, snapshot_before
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            mutation_id,
            entity_type.code(),
            entity_id,
            payload,
            base_version,
            snapshot_before,
        ],
    )?;

    println!(
        "[sync_queue] enqueue mutation_id={mutation_id} entity_type={} entity_id={entity_id} base_version={base_version} kind={}",
        entity_type.code(),
        if old_snapshot.is_some() { "update" } else { "insert" },
    );

    Ok(())
}

/// `sync_queue` 裡的一筆待推送記錄 (「推送到 CF」會用到的欄位，
/// 加上 rollback 用的 `snapshot_before` / `created_at`)。
#[derive(Debug, Clone)]
pub struct PendingMutation {
    pub mutation_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub payload: Option<String>,
    pub base_version: i64,
    /// 推送前的舊狀態快照 (JSON)；第一次新增 (base_version = 0) 時為 `None`。
    /// ERROR 時用來把本地資料還原回推送前的樣子。
    pub snapshot_before: Option<String>,
    /// SQLite `DATETIME DEFAULT CURRENT_TIMESTAMP` 的原始字串，格式可字串排序。
    /// 用來判斷同一個 entity 的多筆 mutation 誰先誰後。
    pub created_at: String,
}

/// 撈出 `sync_queue` 裡所有待推送的記錄,依 `created_at` 升序排列
/// (越早 enqueue 的越先推送)。供 `--sync` 模式使用。
pub fn load_pending(conn: &Connection) -> Result<Vec<PendingMutation>> {
    let mut stmt = conn.prepare(
        "SELECT mutation_id, entity_type, entity_id, payload, base_version,
                snapshot_before, created_at
         FROM sync_queue
         ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(PendingMutation {
            mutation_id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            payload: row.get(3)?,
            base_version: row.get(4)?,
            snapshot_before: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

/// 從 `sync_queue` 移除已經處理完成的記錄 (推播結果為 `OK` 或 `SKIPPED`)。
///
/// 一次用 `IN (...)` 刪除多筆,避免逐筆 `execute`。`mutation_ids` 為空時
/// 直接回傳,不送出任何 SQL (避免組出 `IN ()` 這種不合法語法)。
///
/// 狀態為 `ERROR` 的記錄不會被傳進來 (由呼叫端篩選),會繼續留在
/// `sync_queue` 裡,下次 `--sync` 執行時原封不動地重新推送一次。
pub fn remove_by_mutation_ids(conn: &Connection, mutation_ids: &[String]) -> Result<()> {
    if mutation_ids.is_empty() {
        return Ok(());
    }

    let placeholders = mutation_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("DELETE FROM sync_queue WHERE mutation_id IN ({placeholders})");

    let bind_values: Vec<&dyn ToSql> = mutation_ids.iter().map(|id| id as &dyn ToSql).collect();
    conn.execute(&sql, bind_values.as_slice())?;
    Ok(())
}

/// 移除指定 entity (entity_type + entity_id) 在 `sync_queue` 裡所有殘留的記錄。
///
/// 兩種情況會用到：
/// - ERROR rollback 完成後：這個 entity 在本批次的所有 mutation 都已經處理過
///   (不管成功與否)，不需要再留著等下次重試。
/// - 這個 entity 被本次 `pullEvents` 覆蓋過：伺服器端的狀態已經比本地任何
///   排隊中的變更都新，本地排隊的變更失去意義，直接清空。
pub fn remove_by_entity_id(conn: &Connection, entity_type: &str, entity_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM sync_queue WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id],
    )?;
    Ok(())
}

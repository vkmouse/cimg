//! `users` 表的存取邏輯。
//!
//! 每位使用者以 userProfile cookie(名稱由 `CIMG_USER_PROFILE_COOKIE` 指定)的
//! `sub` 欄位作為主鍵 (UUID)。
//! `id` 由呼叫端傳入 (不是內部生成),這點跟 credentials/buckets/photos 不同。
//! 使用 `INSERT OR IGNORE` 保持冪等:同一個 user 不論被觸發幾次,只會建立一筆記錄。
//!
//! 只有「真的新增成功」才會寫入 sync_queue;已存在 (IGNORE 命中) 則不寫入。

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde_json::json;

use super::sync_queue::{self, EntityType};

/// 確保 users 表裡有這位使用者的記錄;若已存在則不做任何事,也不寫入 sync_queue。
pub fn ensure_exists(conn: &Connection, id: &str, email: &str) -> Result<()> {
    let row = conn
        .query_row(
            "INSERT OR IGNORE INTO users (id, email) VALUES (?1, ?2)
             RETURNING id, email, version, is_deleted",
            params![id, email],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;

    let (new_id, new_email, new_version, new_is_deleted) = match row {
        Some(r) => r,
        None => return Ok(()),
    };

    let new_payload = json!({
        "id": new_id,
        "email": new_email,
        "version": new_version,
        "is_deleted": new_is_deleted,
    });

    sync_queue::enqueue(conn, EntityType::User, &new_id, &new_payload, None, 0)?;
    Ok(())
}

/// CF 回傳的 `PullEvent.payload` (entity_type = USR) 解析後的形狀,
/// 對應 CF 端的 `UserPayload`。`id`/`version` 由 entity_id/event.version
/// 提供,這裡只負責業務欄位。欄位都帶預設值,萬一伺服器送來的資料缺欄位
/// 也不會讓整筆解析失敗。
///
/// `version` 額外保留一份:`apply_remote` 不會用到 (version 由呼叫端的
/// pull event 另外提供),但 `restore_snapshot` 會用到 (snapshot_before
/// 的 JSON 本身就帶有 version,沒有額外的權威來源)。
#[derive(Debug, Default, serde::Deserialize)]
struct RemotePayload {
    #[serde(default)]
    email: String,
    #[serde(default)]
    is_deleted: i64,
    #[serde(default)]
    version: i64,
}

/// 套用一筆來自 CF 的 pull event:寫入 (或覆蓋) 指定 user 的記錄。
///
/// 直接相信伺服器版本,不比較本地 version,無條件覆蓋本地資料 (呼叫端
/// 已經評估過接受「本地未推送的編輯有機會被遠端覆蓋」這個風險)。這個
/// 寫入「不」會觸發 sync_queue (資料本來就是從伺服器來的,不需要再
/// 推回去)。
pub fn apply_remote(
    conn: &Connection,
    id: &str,
    payload_json: Option<&str>,
    version: i64,
) -> Result<()> {
    let payload: RemotePayload = match payload_json {
        Some(raw) => serde_json::from_str(raw).unwrap_or_default(),
        None => RemotePayload::default(),
    };

    conn.execute(
        "INSERT INTO users (id, email, version, is_deleted)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
            email      = excluded.email,
            version    = excluded.version,
            is_deleted = excluded.is_deleted",
        params![id, payload.email, version, payload.is_deleted],
    )?;
    Ok(())
}

/// Rollback 用:把 `snapshot_before` 的 JSON 強制寫回本地。呼叫端已經
/// 確認過這就是「自己推送前的舊狀態」,所以這裡是蓄意覆蓋。這個寫入
/// 「不」會觸發 sync_queue。
pub fn restore_snapshot(conn: &Connection, id: &str, snapshot_json: &str) -> Result<()> {
    let payload: RemotePayload = serde_json::from_str(snapshot_json).unwrap_or_default();

    conn.execute(
        "INSERT INTO users (id, email, version, is_deleted)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
            email      = excluded.email,
            version    = excluded.version,
            is_deleted = excluded.is_deleted",
        params![id, payload.email, payload.version, payload.is_deleted],
    )?;
    Ok(())
}

/// Rollback 用:這筆 user 是第一次新增就被伺服器拒絕 (沒有
/// `snapshot_before` 可以還原,代表這筆資料從未被伺服器承認過),
/// 直接從本地表移除,不留痕跡。
pub fn delete_local(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM users WHERE id = ?1", params![id])?;
    Ok(())
}

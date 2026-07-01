//! `credentials` 表的存取邏輯。
//!
//! 存放從 userInfo cookie(名稱由 `CIMG_USER_INFO_COOKIE` 指定)解析出來的
//! AWS 暫時憑證。
//! PK 直接採用自然鍵 `user_id`，不另外生成 UUID。
//! 用 `INSERT ... ON CONFLICT(user_id) DO UPDATE` 達成 upsert 效果:
//!   - 該 user_id 第一次出現 → 走 INSERT 分支,version 固定為 1。
//!   - 該 user_id 已存在,且任一憑證欄位有變 → 走 UPDATE 分支,
//!     version = 原本的 version + 1。
//!   - 該 user_id 已存在,但所有憑證欄位都沒變 → ON CONFLICT 的 WHERE 條件
//!     不成立,UPDATE 不會發生,RETURNING 也不會有任何列,本次不寫 sync_queue。
//!
//! SQLite 的 `RETURNING` 子句只能看到「執行後」的最終列,不論是裸欄位名稱
//! 還是 `excluded.*` 都無法在 RETURNING 裡取得「更新前」的舊值;因此要拿到
//! 真正的 `old`,必須在 UPSERT 之前先做一次 `SELECT`。這兩個步驟 (SELECT
//! 與 UPSERT) 是兩個獨立的 `execute`/`query_row`,不包在同一個 transaction
//! 裡 (本應用程式是單機、單連線、事件驅動,不會有並發寫入)。

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde_json::json;

use super::sync_queue::{self, EntityType};

/// 從 userInfo cookie 解析出的 AWS 暫時憑證。
pub struct UserCredentials {
    pub access_key_id: String,
    pub expiration: i64,
    pub secret_access_key: String,
    pub session_token: String,
}

/// 既有一筆 credentials 列的快照,用於組出 sync_queue 的 `old`。
struct CredentialsRow {
    user_id: String,
    access_key_id: String,
    expiration: i64,
    secret_access_key: String,
    session_token: String,
    version: i64,
    is_deleted: i64,
}

fn to_json(row: &CredentialsRow) -> serde_json::Value {
    json!({
        "user_id": row.user_id,
        "access_key_id": row.access_key_id,
        "expiration": row.expiration,
        "secret_access_key": row.secret_access_key,
        "session_token": row.session_token,
        "version": row.version,
        "is_deleted": row.is_deleted,
    })
}

fn select_existing(conn: &Connection, user_id: &str) -> Result<Option<CredentialsRow>> {
    conn.query_row(
        "SELECT user_id, access_key_id, expiration, secret_access_key, session_token, version, is_deleted
         FROM credentials WHERE user_id = ?1",
        params![user_id],
        |row| {
            Ok(CredentialsRow {
                user_id: row.get(0)?,
                access_key_id: row.get(1)?,
                expiration: row.get(2)?,
                secret_access_key: row.get(3)?,
                session_token: row.get(4)?,
                version: row.get(5)?,
                is_deleted: row.get(6)?,
            })
        },
    )
    .optional()
}

/// 寫入或更新指定使用者的憑證。
///
/// 新增成功,或更新且憑證欄位確實有變動時,才會寫入 sync_queue。
/// 若該 user_id 已存在且所有欄位都沒變,則什麼都不做。
pub fn upsert(conn: &Connection, user_id: &str, creds: &UserCredentials) -> Result<()> {
    // Step 1: 先讀出目前的狀態,作為 sync_queue 的 `old`。
    let old = select_existing(conn, user_id)?;

    // Step 2: 執行 upsert。PK (user_id) 不論新增或更新都不變。
    let row = conn.query_row(
        r#"
        INSERT INTO credentials (user_id, access_key_id, expiration, secret_access_key, session_token, version)
        VALUES (?1, ?2, ?3, ?4, ?5, 1)
        ON CONFLICT(user_id) DO UPDATE SET
            access_key_id     = excluded.access_key_id,
            expiration        = excluded.expiration,
            secret_access_key = excluded.secret_access_key,
            session_token     = excluded.session_token,
            version           = credentials.version + 1
        WHERE
            credentials.access_key_id     IS NOT excluded.access_key_id     OR
            credentials.expiration        IS NOT excluded.expiration        OR
            credentials.secret_access_key IS NOT excluded.secret_access_key OR
            credentials.session_token     IS NOT excluded.session_token
        RETURNING user_id, access_key_id, expiration, secret_access_key, session_token, version, is_deleted
        "#,
        params![
            user_id,
            creds.access_key_id,
            creds.expiration,
            creds.secret_access_key,
            creds.session_token,
        ],
        |row| {
            Ok(CredentialsRow {
                user_id: row.get(0)?,
                access_key_id: row.get(1)?,
                expiration: row.get(2)?,
                secret_access_key: row.get(3)?,
                session_token: row.get(4)?,
                version: row.get(5)?,
                is_deleted: row.get(6)?,
            })
        },
    )
    .optional()?;

    // 沒有任何列被回傳 (值完全沒變) → 不寫 sync_queue。
    let new_row = match row {
        Some(r) => r,
        None => return Ok(()),
    };

    let new_payload = to_json(&new_row);
    let (old_snapshot, base_version) = match &old {
        Some(o) => (Some(to_json(o)), o.version),
        None => (None, 0),
    };

    sync_queue::enqueue(
        conn,
        EntityType::Credential,
        &new_row.user_id,
        &new_payload,
        old_snapshot.as_ref(),
        base_version,
    )?;
    Ok(())
}

/// CF 回傳的 `PullEvent.payload` (entity_type = CRD) 解析後的形狀,
/// 對應 CF 端的 `CredentialPayload`。`user_id`/`version` 由
/// entity_id/event.version 提供,這裡只負責業務欄位。
///
/// `version` 額外保留一份:`apply_remote` 不會用到,但 `restore_snapshot`
/// 會用到 (snapshot_before 的 JSON 本身就帶有 version)。
#[derive(Debug, Default, serde::Deserialize)]
struct RemotePayload {
    #[serde(default)]
    access_key_id: String,
    #[serde(default)]
    expiration: i64,
    #[serde(default)]
    secret_access_key: String,
    #[serde(default)]
    session_token: String,
    #[serde(default)]
    is_deleted: i64,
    #[serde(default)]
    version: i64,
}

/// 套用一筆來自 CF 的 pull event:寫入 (或覆蓋) 指定 user 的憑證。
///
/// 直接相信伺服器版本,不比較本地 version,無條件覆蓋本地資料 (呼叫端
/// 已經評估過接受「本地未推送的編輯有機會被遠端覆蓋」這個風險)。這個
/// 寫入「不」會觸發 sync_queue (資料本來就是從伺服器來的,不需要再
/// 推回去)。
pub fn apply_remote(
    conn: &Connection,
    user_id: &str,
    payload_json: Option<&str>,
    version: i64,
) -> Result<()> {
    let payload: RemotePayload = match payload_json {
        Some(raw) => serde_json::from_str(raw).unwrap_or_default(),
        None => RemotePayload::default(),
    };

    conn.execute(
        "INSERT INTO credentials (user_id, access_key_id, expiration, secret_access_key, session_token, version, is_deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id) DO UPDATE SET
            access_key_id     = excluded.access_key_id,
            expiration        = excluded.expiration,
            secret_access_key = excluded.secret_access_key,
            session_token     = excluded.session_token,
            version           = excluded.version,
            is_deleted        = excluded.is_deleted",
        params![
            user_id,
            payload.access_key_id,
            payload.expiration,
            payload.secret_access_key,
            payload.session_token,
            version,
            payload.is_deleted,
        ],
    )?;
    Ok(())
}

/// Rollback 用:把 `snapshot_before` 的 JSON 強制寫回本地。蓄意覆蓋。
/// 這個寫入「不」會觸發 sync_queue。
pub fn restore_snapshot(conn: &Connection, user_id: &str, snapshot_json: &str) -> Result<()> {
    let payload: RemotePayload = serde_json::from_str(snapshot_json).unwrap_or_default();

    conn.execute(
        "INSERT INTO credentials (user_id, access_key_id, expiration, secret_access_key, session_token, version, is_deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id) DO UPDATE SET
            access_key_id     = excluded.access_key_id,
            expiration        = excluded.expiration,
            secret_access_key = excluded.secret_access_key,
            session_token     = excluded.session_token,
            version           = excluded.version,
            is_deleted        = excluded.is_deleted",
        params![
            user_id,
            payload.access_key_id,
            payload.expiration,
            payload.secret_access_key,
            payload.session_token,
            payload.version,
            payload.is_deleted,
        ],
    )?;
    Ok(())
}

/// Rollback 用:這筆憑證是第一次新增就被伺服器拒絕 (沒有
/// `snapshot_before` 可以還原),直接從本地表移除,不留痕跡。
pub fn delete_local(conn: &Connection, user_id: &str) -> Result<()> {
    conn.execute("DELETE FROM credentials WHERE user_id = ?1", params![user_id])?;
    Ok(())
}

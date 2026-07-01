//! `buckets` 表的存取邏輯。
//!
//! 存放從 `getBucketInfo` API 的 response_data 解析出來的各類 S3 bucket 設定。
//! PK 直接採用自然鍵 `user_id`,不另外生成 UUID。重複出現就用
//! `INSERT OR IGNORE` 忽略,不做任何更新 (bucket 設定一旦寫入就視為固定)。
//!
//! schema 裡這些欄位都是 `NOT NULL`,但解析結果可能缺失
//! (`Option<String>` 為 `None`);缺失時用空字串 `""` 寫入。
//!
//! 只有「真的新增成功」才會寫入 sync_queue;已存在 (IGNORE 命中) 則不寫入。

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde_json::json;

use super::sync_queue::{self, EntityType};

/// 從 `getBucketInfo` API response_data 解析出的 bucket 設定。
#[derive(Debug, Default)]
pub struct UserBuckets {
    pub region: Option<String>,
    pub exif_bucket: Option<String>,
    pub exif_keybase: Option<String>,
    pub expand_exif_bucket: Option<String>,
    pub expand_exif_keybase: Option<String>,
    pub expand_original_bucket: Option<String>,
    pub expand_original_keybase: Option<String>,
    pub extra_large_bucket: Option<String>,
    pub extra_large_keybase: Option<String>,
    pub middle_bucket: Option<String>,
    pub middle_keybase: Option<String>,
    pub original_bucket: Option<String>,
    pub original_keybase: Option<String>,
}

fn s(v: &Option<String>) -> &str {
    v.as_deref().unwrap_or("")
}

/// 確保 buckets 表裡有這位使用者的設定;若已存在則不做任何事,也不寫入 sync_queue。
pub fn ensure_exists(conn: &Connection, user_id: &str, buckets: &UserBuckets) -> Result<()> {
    let row = conn
        .query_row(
            r#"
        INSERT OR IGNORE INTO buckets (
            user_id,
            region,
            exif_bucket, exif_keybase,
            expand_exif_bucket, expand_exif_keybase,
            expand_original_bucket, expand_original_keybase,
            extra_large_bucket, extra_large_keybase,
            middle_bucket, middle_keybase,
            original_bucket, original_keybase
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        RETURNING
            user_id, region,
            exif_bucket, exif_keybase,
            expand_exif_bucket, expand_exif_keybase,
            expand_original_bucket, expand_original_keybase,
            extra_large_bucket, extra_large_keybase,
            middle_bucket, middle_keybase,
            original_bucket, original_keybase,
            version, is_deleted
        "#,
            params![
                user_id,
                s(&buckets.region),
                s(&buckets.exif_bucket),
                s(&buckets.exif_keybase),
                s(&buckets.expand_exif_bucket),
                s(&buckets.expand_exif_keybase),
                s(&buckets.expand_original_bucket),
                s(&buckets.expand_original_keybase),
                s(&buckets.extra_large_bucket),
                s(&buckets.extra_large_keybase),
                s(&buckets.middle_bucket),
                s(&buckets.middle_keybase),
                s(&buckets.original_bucket),
                s(&buckets.original_keybase),
            ],
            |row| {
                Ok(json!({
                    "user_id": row.get::<_, String>(0)?,
                    "region": row.get::<_, String>(1)?,
                    "exif_bucket": row.get::<_, String>(2)?,
                    "exif_keybase": row.get::<_, String>(3)?,
                    "expand_exif_bucket": row.get::<_, String>(4)?,
                    "expand_exif_keybase": row.get::<_, String>(5)?,
                    "expand_original_bucket": row.get::<_, String>(6)?,
                    "expand_original_keybase": row.get::<_, String>(7)?,
                    "extra_large_bucket": row.get::<_, String>(8)?,
                    "extra_large_keybase": row.get::<_, String>(9)?,
                    "middle_bucket": row.get::<_, String>(10)?,
                    "middle_keybase": row.get::<_, String>(11)?,
                    "original_bucket": row.get::<_, String>(12)?,
                    "original_keybase": row.get::<_, String>(13)?,
                    "version": row.get::<_, i64>(14)?,
                    "is_deleted": row.get::<_, i64>(15)?,
                }))
            },
        )
        .optional()?;

    let new_payload = match row {
        Some(v) => v,
        None => return Ok(()),
    };

    sync_queue::enqueue(conn, EntityType::Bucket, user_id, &new_payload, None, 0)?;
    Ok(())
}

/// CF 回傳的 `PullEvent.payload` (entity_type = BKT) 解析後的形狀,
/// 對應 CF 端的 `BucketPayload`。`user_id`/`version` 由
/// entity_id/event.version 提供,這裡只負責業務欄位。
#[derive(Debug, Default, serde::Deserialize)]
struct RemotePayload {
    #[serde(default)]
    region: String,
    #[serde(default)]
    exif_bucket: String,
    #[serde(default)]
    exif_keybase: String,
    #[serde(default)]
    expand_exif_bucket: String,
    #[serde(default)]
    expand_exif_keybase: String,
    #[serde(default)]
    expand_original_bucket: String,
    #[serde(default)]
    expand_original_keybase: String,
    #[serde(default)]
    extra_large_bucket: String,
    #[serde(default)]
    extra_large_keybase: String,
    #[serde(default)]
    middle_bucket: String,
    #[serde(default)]
    middle_keybase: String,
    #[serde(default)]
    original_bucket: String,
    #[serde(default)]
    original_keybase: String,
    #[serde(default)]
    is_deleted: i64,
    #[serde(default)]
    version: i64,
}

/// 套用一筆來自 CF 的 pull event:寫入 (或覆蓋) 指定 user 的 bucket 設定。
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
        r#"
        INSERT INTO buckets (
            user_id, region,
            exif_bucket, exif_keybase,
            expand_exif_bucket, expand_exif_keybase,
            expand_original_bucket, expand_original_keybase,
            extra_large_bucket, extra_large_keybase,
            middle_bucket, middle_keybase,
            original_bucket, original_keybase,
            version, is_deleted
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        ON CONFLICT(user_id) DO UPDATE SET
            region                  = excluded.region,
            exif_bucket             = excluded.exif_bucket,
            exif_keybase            = excluded.exif_keybase,
            expand_exif_bucket      = excluded.expand_exif_bucket,
            expand_exif_keybase     = excluded.expand_exif_keybase,
            expand_original_bucket  = excluded.expand_original_bucket,
            expand_original_keybase = excluded.expand_original_keybase,
            extra_large_bucket      = excluded.extra_large_bucket,
            extra_large_keybase     = excluded.extra_large_keybase,
            middle_bucket           = excluded.middle_bucket,
            middle_keybase          = excluded.middle_keybase,
            original_bucket         = excluded.original_bucket,
            original_keybase        = excluded.original_keybase,
            version                 = excluded.version,
            is_deleted              = excluded.is_deleted
        "#,
        params![
            user_id,
            payload.region,
            payload.exif_bucket,
            payload.exif_keybase,
            payload.expand_exif_bucket,
            payload.expand_exif_keybase,
            payload.expand_original_bucket,
            payload.expand_original_keybase,
            payload.extra_large_bucket,
            payload.extra_large_keybase,
            payload.middle_bucket,
            payload.middle_keybase,
            payload.original_bucket,
            payload.original_keybase,
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
        r#"
        INSERT INTO buckets (
            user_id, region,
            exif_bucket, exif_keybase,
            expand_exif_bucket, expand_exif_keybase,
            expand_original_bucket, expand_original_keybase,
            extra_large_bucket, extra_large_keybase,
            middle_bucket, middle_keybase,
            original_bucket, original_keybase,
            version, is_deleted
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        ON CONFLICT(user_id) DO UPDATE SET
            region                  = excluded.region,
            exif_bucket             = excluded.exif_bucket,
            exif_keybase            = excluded.exif_keybase,
            expand_exif_bucket      = excluded.expand_exif_bucket,
            expand_exif_keybase     = excluded.expand_exif_keybase,
            expand_original_bucket  = excluded.expand_original_bucket,
            expand_original_keybase = excluded.expand_original_keybase,
            extra_large_bucket      = excluded.extra_large_bucket,
            extra_large_keybase     = excluded.extra_large_keybase,
            middle_bucket           = excluded.middle_bucket,
            middle_keybase          = excluded.middle_keybase,
            original_bucket         = excluded.original_bucket,
            original_keybase        = excluded.original_keybase,
            version                 = excluded.version,
            is_deleted              = excluded.is_deleted
        "#,
        params![
            user_id,
            payload.region,
            payload.exif_bucket,
            payload.exif_keybase,
            payload.expand_exif_bucket,
            payload.expand_exif_keybase,
            payload.expand_original_bucket,
            payload.expand_original_keybase,
            payload.extra_large_bucket,
            payload.extra_large_keybase,
            payload.middle_bucket,
            payload.middle_keybase,
            payload.original_bucket,
            payload.original_keybase,
            payload.version,
            payload.is_deleted,
        ],
    )?;
    Ok(())
}

/// Rollback 用:這筆 bucket 設定是第一次新增就被伺服器拒絕 (沒有
/// `snapshot_before` 可以還原),直接從本地表移除,不留痕跡。
pub fn delete_local(conn: &Connection, user_id: &str) -> Result<()> {
    conn.execute("DELETE FROM buckets WHERE user_id = ?1", params![user_id])?;
    Ok(())
}

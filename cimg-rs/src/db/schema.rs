//! 資料庫 schema 定義。
//!
//! 只放「啟動時要確保存在」的 DDL。日後新增表格或欄位,
//! 都建議寫在這個檔案,並用 `CREATE TABLE IF NOT EXISTS` /
//! 未來如果要做欄位異動,可以在這裡加上簡單的 migration 邏輯
//! (例如檢查 `PRAGMA user_version` 再決定要不要跑 ALTER TABLE)。
//!
//! 注意:這個版本的 schema 為每張表加上了 `version` / `is_deleted`,
//! 用於配合 `sync_queue` 做增量同步。本專案不處理舊資料庫的欄位
//! migration,若本地已有舊版 `.db` 檔案,請刪除後重新建立。

use rusqlite::{Connection, Result};

const CREATE_USERS: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    id         TEXT NOT NULL PRIMARY KEY,
    email      TEXT NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    is_deleted INTEGER NOT NULL DEFAULT 0
);
"#;

const CREATE_CREDENTIALS: &str = r#"
CREATE TABLE IF NOT EXISTS credentials (
    user_id           TEXT NOT NULL PRIMARY KEY,
    access_key_id     TEXT NOT NULL,
    expiration        INTEGER NOT NULL,
    secret_access_key TEXT NOT NULL,
    session_token     TEXT NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1,
    is_deleted        INTEGER NOT NULL DEFAULT 0
);
"#;

const CREATE_BUCKETS: &str = r#"
CREATE TABLE IF NOT EXISTS buckets (
    user_id                 TEXT NOT NULL PRIMARY KEY,
    region                  TEXT NOT NULL,
    exif_bucket             TEXT NOT NULL,
    exif_keybase            TEXT NOT NULL,
    expand_exif_bucket      TEXT NOT NULL,
    expand_exif_keybase     TEXT NOT NULL,
    expand_original_bucket  TEXT NOT NULL,
    expand_original_keybase TEXT NOT NULL,
    extra_large_bucket      TEXT NOT NULL,
    extra_large_keybase     TEXT NOT NULL,
    middle_bucket           TEXT NOT NULL,
    middle_keybase          TEXT NOT NULL,
    original_bucket         TEXT NOT NULL,
    original_keybase        TEXT NOT NULL,
    version                 INTEGER NOT NULL DEFAULT 1,
    is_deleted              INTEGER NOT NULL DEFAULT 0
);
"#;

const CREATE_PHOTOS: &str = r#"
CREATE TABLE IF NOT EXISTS photos (
    image_id              TEXT NOT NULL PRIMARY KEY,
    user_id               TEXT NOT NULL,
    source_device         TEXT NOT NULL,
    date_path             TEXT NOT NULL,
    shooting_date         INTEGER NOT NULL,
    uploaded_date         INTEGER NOT NULL,
    shooting_camera       TEXT,
    image_size            TEXT,
    file_size             TEXT,
    file_format           TEXT,
    shutter_speed         TEXT,
    aperture_value        TEXT,
    iso_speed             TEXT,
    lens_focal_length     TEXT,
    white_balance_mode    TEXT,
    exposure_compensation TEXT,
    flash_firing          TEXT,
    lens                  TEXT,
    subject_category      TEXT,
    blur_judgement        TEXT,
    exposure_judgement    TEXT,
    version               INTEGER NOT NULL DEFAULT 1,
    is_deleted            INTEGER NOT NULL DEFAULT 0
);
"#;

const CREATE_SYNC_QUEUE: &str = r#"
CREATE TABLE IF NOT EXISTS sync_queue (
    mutation_id     TEXT NOT NULL PRIMARY KEY,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    payload         TEXT,
    base_version    INTEGER NOT NULL,
    snapshot_before TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
"#;

const CREATE_SYNC_META: &str = r#"
CREATE TABLE IF NOT EXISTS sync_meta (
    key   TEXT,
    value TEXT
);
"#;

/// 程式啟動時呼叫一次,確保所有表格都存在。
pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(CREATE_USERS)?;
    conn.execute_batch(CREATE_CREDENTIALS)?;
    conn.execute_batch(CREATE_BUCKETS)?;
    conn.execute_batch(CREATE_PHOTOS)?;
    conn.execute_batch(CREATE_SYNC_QUEUE)?;
    conn.execute_batch(CREATE_SYNC_META)?;
    Ok(())
}

//! `sync_meta` 表的存取邏輯。
//!
//! 只用來放零散的 key/value 狀態,目前唯一用到的 key 是 `last_cursor`
//! (CF 端 sync_events 表目前最大的 id,用於下次同步時的差異查詢游標)。
//! 表格本身的建立交給 `schema::init`,這裡只負責讀寫。

use rusqlite::{params, Connection, Result};

const LAST_CURSOR_KEY: &str = "last_cursor";

/// 讀取 `last_cursor` 的值;沒有這筆資料 (第一次同步) 就視為 0。
pub fn read_last_cursor(conn: &Connection) -> Result<i64> {
    let mut stmt = conn.prepare("SELECT value FROM sync_meta WHERE key = ?1")?;
    let mut rows = stmt.query(params![LAST_CURSOR_KEY])?;
    let value: Option<String> = match rows.next()? {
        Some(row) => row.get(0)?,
        None => None,
    };
    Ok(value.and_then(|v| v.parse::<i64>().ok()).unwrap_or(0))
}

/// 把 `last_cursor` 的值寫成 `new_cursor`;該筆 key 還不存在 (第一次同步)
/// 就新增一筆,否則就地更新。
pub fn write_last_cursor(conn: &Connection, new_cursor: i64) -> Result<()> {
    let value = new_cursor.to_string();
    let updated = conn.execute(
        "UPDATE sync_meta SET value = ?1 WHERE key = ?2",
        params![value, LAST_CURSOR_KEY],
    )?;
    if updated == 0 {
        conn.execute(
            "INSERT INTO sync_meta (key, value) VALUES (?1, ?2)",
            params![LAST_CURSOR_KEY, value],
        )?;
    }
    Ok(())
}

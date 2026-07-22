//! `photo_bursts` 表的存取邏輯。
//!
//! 這張表存的是 `--update-photo-bursts` 模式算出來的「密集拍照區間」,PK
//! 採用天然鍵 `(user_id, start_date)`(理由見討論記錄:同一個 user 的分群
//! 結果依時間排序、彼此不重疊,不會有兩個 cluster 的 `start_date` 相同)。
//!
//! 這張表目前不接 `sync_queue`(之後要同步時再加),`sync_bursts` 只負責
//! 把「這次算出來的最新結果」跟「表裡既有的資料」對齊:
//!   - 新的 key(既有資料沒有) -> INSERT
//!   - 既有 key 這次也有算出來,但內容不同 -> UPDATE(version + 1)
//!   - 既有 key 這次也有算出來,內容完全相同 -> 不動(避免無意義的 version 跳號)
//!   - 既有 key 這次沒有算出來,且目前 is_deleted = 0 -> 標記 is_deleted = 1(軟刪除)
//!
//! 呼叫端(`crate::photo_bursts::run`)保證每次都是「這個 user 這次全量重算出的
//! 完整結果」,不是增量結果,所以上述「沒出現 = 已經不存在了」的假設才成立。

use rusqlite::{params, Connection, Result};

/// 依「本地曆日」聚合出的單日統計。
///
/// `day_index` 是 `julianday()` 取整數的結果,單純用來讓 Rust 端方便計算
/// 「兩個曆日之間差幾天」(直接整數相減即可),本身不對外儲存。
/// `min_ts` / `max_ts` 則是當天實際拍攝時間戳記裡最早/最晚的一筆,用來
/// 組出這段密集區間的 `start_date` / `end_date`,單位與 `photos.shooting_date`
/// 一致,不需要另外處理「本地午夜對應的 UTC epoch」這種換算問題。
#[derive(Debug, Clone, Copy)]
pub struct DayCount {
    pub day_index: i64,
    pub count: i64,
    pub min_ts: i64,
    pub max_ts: i64,
}

/// 這次演算法算出來、準備寫回 `photo_bursts` 表的一段密集拍照區間。
#[derive(Debug, Clone, Copy)]
pub struct ComputedBurst {
    pub start_date: i64,
    pub end_date: i64,
    pub total_count: i64,
    pub span_days: i64,
}

/// 表裡既有的一筆密集區間(含 version / is_deleted,供比對用)。
struct ExistingBurst {
    end_date: i64,
    total_count: i64,
    span_days: i64,
    version: i64,
    is_deleted: i64,
}

/// 查出目前 `photos` 表裡所有出現過的 `user_id`(排除已刪除的照片),
/// 供 `--update-photo-bursts` 模式 foreach 使用。
pub fn list_user_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT user_id FROM photos WHERE is_deleted = 0 ORDER BY user_id",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// 依本地曆日聚合指定使用者的照片張數,依 `day_index` 由小到大排序。
///
/// `date(shooting_date, 'unixepoch', 'localtime')` 把 unix seconds 轉成
/// 本地時區的曆日字串(`YYYY-MM-DD`),`julianday()` 再把該字串轉成可以直接
/// 相減的整數天序號。
pub fn daily_counts(conn: &Connection, user_id: &str) -> Result<Vec<DayCount>> {
    let mut stmt = conn.prepare(
        "SELECT
            CAST(julianday(date(shooting_date, 'unixepoch', 'localtime')) AS INTEGER) AS day_index,
            COUNT(*) AS cnt,
            MIN(shooting_date) AS min_ts,
            MAX(shooting_date) AS max_ts
         FROM photos
         WHERE user_id = ?1 AND is_deleted = 0
         GROUP BY day_index
         ORDER BY day_index",
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok(DayCount {
            day_index: row.get(0)?,
            count: row.get(1)?,
            min_ts: row.get(2)?,
            max_ts: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// 讀出表裡這個 user 目前所有既有的 photo_bursts 列(不論 is_deleted),
/// 以 `start_date` 當 key,供 `sync_bursts` 比對用。
fn load_existing(
    conn: &Connection,
    user_id: &str,
) -> Result<std::collections::HashMap<i64, ExistingBurst>> {
    let mut stmt = conn.prepare(
        "SELECT start_date, end_date, total_count, span_days, version, is_deleted
         FROM photo_bursts
         WHERE user_id = ?1",
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            ExistingBurst {
                end_date: row.get(1)?,
                total_count: row.get(2)?,
                span_days: row.get(3)?,
                version: row.get(4)?,
                is_deleted: row.get(5)?,
            },
        ))
    })?;
    rows.collect()
}

/// 把這個 user「這次全量重算出來的結果」同步進 `photo_bursts` 表:
/// 新 key 新增、變動的 key 更新(version + 1)、沒再出現的既有 key 軟刪除。
/// 完全相同、或已經是軟刪除狀態且這次也沒出現的列則不動。
pub fn sync_bursts(conn: &Connection, user_id: &str, computed: &[ComputedBurst]) -> Result<()> {
    let mut existing = load_existing(conn, user_id)?;

    for burst in computed {
        match existing.remove(&burst.start_date) {
            None => {
                conn.execute(
                    "INSERT INTO photo_bursts (user_id, start_date, end_date, total_count, span_days, version, is_deleted)
                     VALUES (?1, ?2, ?3, ?4, ?5, 1, 0)",
                    params![user_id, burst.start_date, burst.end_date, burst.total_count, burst.span_days],
                )?;
            }
            Some(old) => {
                let unchanged = old.is_deleted == 0
                    && old.end_date == burst.end_date
                    && old.total_count == burst.total_count
                    && old.span_days == burst.span_days;
                if !unchanged {
                    conn.execute(
                        "UPDATE photo_bursts
                         SET end_date = ?1, total_count = ?2, span_days = ?3,
                             is_deleted = 0, version = ?4
                         WHERE user_id = ?5 AND start_date = ?6",
                        params![
                            burst.end_date,
                            burst.total_count,
                            burst.span_days,
                            old.version + 1,
                            user_id,
                            burst.start_date
                        ],
                    )?;
                }
            }
        }
    }

    // 剩在 `existing` 裡的,都是這次沒有再算出來的既有 key。
    // 已經是軟刪除狀態的不用再動,避免無意義的 version 跳號。
    for (start_date, old) in existing {
        if old.is_deleted == 0 {
            conn.execute(
                "UPDATE photo_bursts SET is_deleted = 1, version = ?1 WHERE user_id = ?2 AND start_date = ?3",
                params![old.version + 1, user_id, start_date],
            )?;
        }
    }

    Ok(())
}

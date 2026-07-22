//! `photo_bursts` 表的存取邏輯。
//!
//! 這張表存的是 `--update-photo-bursts` 模式算出來的「密集拍照區間」,PK
//! 採用天然鍵 `(user_id, start_date)`(理由見討論記錄:同一個 user 的分群
//! 結果依時間排序、彼此不重疊,不會有兩個 cluster 的 `start_date` 相同)。
//!
//! `sync_bursts` 負責把「這次算出來的最新結果」跟「表裡既有的資料」對齊:
//!   - 新的 key(既有資料沒有) -> INSERT
//!   - 既有 key 這次也有算出來,但內容不同 -> UPDATE(version + 1)
//!   - 既有 key 這次也有算出來,內容完全相同 -> 不動(避免無意義的 version 跳號)
//!   - 既有 key 這次沒有算出來,且目前 is_deleted = 0 -> 標記 is_deleted = 1(軟刪除)
//! 上述三種「真的造成變更」的分支都會連帶寫入 `sync_queue`,供之後
//! `--sync` 推送到 CF。
//!
//! 呼叫端(`crate::photo_bursts::run`)保證每次都是「這個 user 這次全量重算出的
//! 完整結果」,不是增量結果,所以上述「沒出現 = 已經不存在了」的假設才成立。
//!
//! ## entity_id:複合鍵組合字串
//!
//! `photo_bursts` 的天然鍵是 `(user_id, start_date)` 兩個欄位,是目前唯一一個
//! 複合鍵 entity——`sync_queue.entity_id` / CF 端 `syncableTable.ts` 的
//! `pkColumn`/`pkValue` 都設計成「一個 entity 對應一個字串 id」。這裡用
//! `"{user_id}:{start_date}"` 頂替單一欄位的自然鍵(`compose_entity_id` /
//! `split_entity_id`),CF 端額外加一個 `id TEXT PRIMARY KEY` 欄位存這個組合
//! 字串,`user_id`/`start_date` 仍保留成獨立欄位方便查詢。本機這張表本來就是
//! `PRIMARY KEY (user_id, start_date)`,所以 `apply_remote`/`restore_snapshot`
//! 一樣可以用 `ON CONFLICT(user_id, start_date) DO UPDATE`。
//!
//! ## 多裝置各自重算的取捨
//!
//! 這張表是每台裝置各自根據「本機當下的 `photos` 資料」全量重算出來的衍生
//! 資料,不是伺服器算好再發下來的。如果多台裝置的本機 `photos` 還沒同步到
//! 一致的狀態,各自跑 `--update-photo-bursts` 算出來的結果可能不同,導致同一個
//! `start_date` 在不同裝置間反覆推送、版本互相打架(version 對不上時對方會回
//! `ERROR`,要等下一次 pull 到新版本、下次重算後才會收斂)。這是「衍生資料 +
//! 多裝置各自重算」天生的結果,不是 bug。

use rusqlite::{params, Connection, Result};
use serde_json::json;

use super::sync_queue::{self, EntityType};

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

/// 組出 `sync_queue.entity_id` 用的複合字串:`"{user_id}:{start_date}"`。
fn compose_entity_id(user_id: &str, start_date: i64) -> String {
    format!("{user_id}:{start_date}")
}

/// 把 `compose_entity_id` 組出來的字串拆回 `(user_id, start_date)`。
/// 用 `rsplit_once` 從「最右邊」切一刀,不是逐段 `split(':').collect()`——
/// `user_id` 目前是 UUID 不含冒號,兩種寫法結果一樣,但這樣寫語意上明確
/// 表達「最後一段冒號後面是 start_date」,比較不怕以後 user_id 格式改變時
/// 默默切錯。拆不出來(格式不符預期,理論上不應該發生)回傳 `None`,由呼叫端
/// 決定怎麼跳過。
fn split_entity_id(entity_id: &str) -> Option<(String, i64)> {
    let (user_id, start_date_str) = entity_id.rsplit_once(':')?;
    let start_date = start_date_str.parse::<i64>().ok()?;
    Some((user_id.to_string(), start_date))
}

/// 組出 sync_queue payload / snapshot 用的 JSON,欄位與 CF 端
/// `photoBurstService` 解析的 payload 一致(含 `user_id`/`start_date`,
/// 純粹方便 CF 端存成獨立欄位查詢用,entity_id 才是同步管線真正信任的 key)。
fn to_json(
    user_id: &str,
    start_date: i64,
    end_date: i64,
    total_count: i64,
    span_days: i64,
    version: i64,
    is_deleted: i64,
) -> serde_json::Value {
    json!({
        "user_id": user_id,
        "start_date": start_date,
        "end_date": end_date,
        "total_count": total_count,
        "span_days": span_days,
        "version": version,
        "is_deleted": is_deleted,
    })
}

/// 把這個 user「這次全量重算出來的結果」同步進 `photo_bursts` 表:
/// 新 key 新增、變動的 key 更新(version + 1)、沒再出現的既有 key 軟刪除。
/// 完全相同、或已經是軟刪除狀態且這次也沒出現的列則不動。
/// 上述三種「真的造成變更」的分支都會連帶寫入 `sync_queue`。
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

                let entity_id = compose_entity_id(user_id, burst.start_date);
                let new_payload = to_json(
                    user_id,
                    burst.start_date,
                    burst.end_date,
                    burst.total_count,
                    burst.span_days,
                    1,
                    0,
                );
                sync_queue::enqueue(conn, EntityType::PhotoBurst, &entity_id, &new_payload, None, 0)?;
            }
            Some(old) => {
                let unchanged = old.is_deleted == 0
                    && old.end_date == burst.end_date
                    && old.total_count == burst.total_count
                    && old.span_days == burst.span_days;
                if !unchanged {
                    let new_version = old.version + 1;
                    conn.execute(
                        "UPDATE photo_bursts
                         SET end_date = ?1, total_count = ?2, span_days = ?3,
                             is_deleted = 0, version = ?4
                         WHERE user_id = ?5 AND start_date = ?6",
                        params![
                            burst.end_date,
                            burst.total_count,
                            burst.span_days,
                            new_version,
                            user_id,
                            burst.start_date
                        ],
                    )?;

                    let entity_id = compose_entity_id(user_id, burst.start_date);
                    let old_snapshot = to_json(
                        user_id,
                        burst.start_date,
                        old.end_date,
                        old.total_count,
                        old.span_days,
                        old.version,
                        old.is_deleted,
                    );
                    let new_payload = to_json(
                        user_id,
                        burst.start_date,
                        burst.end_date,
                        burst.total_count,
                        burst.span_days,
                        new_version,
                        0,
                    );
                    sync_queue::enqueue(
                        conn,
                        EntityType::PhotoBurst,
                        &entity_id,
                        &new_payload,
                        Some(&old_snapshot),
                        old.version,
                    )?;
                }
            }
        }
    }

    // 剩在 `existing` 裡的,都是這次沒有再算出來的既有 key。
    // 已經是軟刪除狀態的不用再動,避免無意義的 version 跳號。
    for (start_date, old) in existing {
        if old.is_deleted == 0 {
            let new_version = old.version + 1;
            conn.execute(
                "UPDATE photo_bursts SET is_deleted = 1, version = ?1 WHERE user_id = ?2 AND start_date = ?3",
                params![new_version, user_id, start_date],
            )?;

            let entity_id = compose_entity_id(user_id, start_date);
            let old_snapshot = to_json(
                user_id,
                start_date,
                old.end_date,
                old.total_count,
                old.span_days,
                old.version,
                old.is_deleted,
            );
            let new_payload = to_json(
                user_id,
                start_date,
                old.end_date,
                old.total_count,
                old.span_days,
                new_version,
                1,
            );
            sync_queue::enqueue(
                conn,
                EntityType::PhotoBurst,
                &entity_id,
                &new_payload,
                Some(&old_snapshot),
                old.version,
            )?;
        }
    }

    Ok(())
}

/// CF 回傳的 `PullEvent.payload`(entity_type = PBT)解析後的形狀,對應 CF 端
/// 的 `PhotoBurstPayload`。`user_id`/`start_date` 由 entity_id 拆出來提供
/// (視為 authoritative),這裡只解析剩下的業務欄位。
#[derive(Debug, Default, serde::Deserialize)]
struct RemotePayload {
    #[serde(default)]
    end_date: i64,
    #[serde(default)]
    total_count: i64,
    #[serde(default)]
    span_days: i64,
    #[serde(default)]
    is_deleted: i64,
    #[serde(default)]
    version: i64,
}

/// 套用一筆來自 CF 的 pull event:寫入(或覆蓋)指定 `(user_id, start_date)`
/// 的記錄。直接相信伺服器版本,不比較本地 version,無條件覆蓋本地資料。
/// 這個寫入「不」會觸發 sync_queue。
///
/// `entity_id` 拆不出 `user_id`/`start_date`(格式不符預期,理論上不應該
/// 發生)時,記錄錯誤並跳過,不中斷整個 pull 流程。
pub fn apply_remote(conn: &Connection, entity_id: &str, payload_json: Option<&str>, version: i64) -> Result<()> {
    let (user_id, start_date) = match split_entity_id(entity_id) {
        Some(v) => v,
        None => {
            eprintln!(
                "[photo_bursts] apply_remote: entity_id={entity_id} 無法拆出 user_id/start_date,跳過"
            );
            return Ok(());
        }
    };

    let payload: RemotePayload = match payload_json {
        Some(raw) => serde_json::from_str(raw).unwrap_or_default(),
        None => RemotePayload::default(),
    };

    conn.execute(
        "INSERT INTO photo_bursts (user_id, start_date, end_date, total_count, span_days, version, is_deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, start_date) DO UPDATE SET
             end_date    = excluded.end_date,
             total_count = excluded.total_count,
             span_days   = excluded.span_days,
             version     = excluded.version,
             is_deleted  = excluded.is_deleted",
        params![
            user_id,
            start_date,
            payload.end_date,
            payload.total_count,
            payload.span_days,
            version,
            payload.is_deleted,
        ],
    )?;
    Ok(())
}

/// Rollback 用:把 `snapshot_before` 的 JSON 強制寫回本地。蓄意覆蓋。
/// 這個寫入「不」會觸發 sync_queue。
///
/// `entity_id` 拆不出 `user_id`/`start_date` 時,記錄錯誤並跳過。
pub fn restore_snapshot(conn: &Connection, entity_id: &str, snapshot_json: &str) -> Result<()> {
    let (user_id, start_date) = match split_entity_id(entity_id) {
        Some(v) => v,
        None => {
            eprintln!(
                "[photo_bursts] restore_snapshot: entity_id={entity_id} 無法拆出 user_id/start_date,跳過"
            );
            return Ok(());
        }
    };

    let payload: RemotePayload = serde_json::from_str(snapshot_json).unwrap_or_default();

    conn.execute(
        "INSERT INTO photo_bursts (user_id, start_date, end_date, total_count, span_days, version, is_deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id, start_date) DO UPDATE SET
             end_date    = excluded.end_date,
             total_count = excluded.total_count,
             span_days   = excluded.span_days,
             version     = excluded.version,
             is_deleted  = excluded.is_deleted",
        params![
            user_id,
            start_date,
            payload.end_date,
            payload.total_count,
            payload.span_days,
            payload.version,
            payload.is_deleted,
        ],
    )?;
    Ok(())
}

/// Rollback 用:這筆 photo_burst 是第一次新增就被伺服器拒絕(沒有
/// `snapshot_before` 可以還原),直接從本地表移除,不留痕跡。
///
/// `entity_id` 拆不出 `user_id`/`start_date` 時,記錄錯誤並跳過。
pub fn delete_local(conn: &Connection, entity_id: &str) -> Result<()> {
    let (user_id, start_date) = match split_entity_id(entity_id) {
        Some(v) => v,
        None => {
            eprintln!(
                "[photo_bursts] delete_local: entity_id={entity_id} 無法拆出 user_id/start_date,跳過"
            );
            return Ok(());
        }
    };

    conn.execute(
        "DELETE FROM photo_bursts WHERE user_id = ?1 AND start_date = ?2",
        params![user_id, start_date],
    )?;
    Ok(())
}

//! 資料庫存取層的對外入口。
//!
//! 其他模組 (例如 `cookie`) 只需要拿到 `Database`,
//! 呼叫上面的高階方法即可,不需要知道底下用的是 SQLite、
//! 連線怎麼開、SQL 長什麼樣子。未來如果要換成其他資料庫
//! (或是加連線池),只需要改這個檔案內部實作。
//!
//! 每個高階方法內部都會視情況自動寫入 `sync_queue` (新增成功 / 值有
//! 變動的更新才寫入;沒有變更則不寫入),呼叫端完全不需要關心
//! old/new 或 sync_queue 的細節。

mod schema;
mod sync_meta;
pub mod photos;
pub mod buckets;
pub mod credentials;
pub mod sync_queue;
pub mod users;

use std::path::Path;

use rusqlite::{Connection, Result};

pub struct Database {
    conn: Connection,
}

impl Database {
    /// 開啟 (或建立) 指定路徑的 SQLite 檔案,並確保所有表格存在。
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        schema::init(&conn)?;
        Ok(Self { conn })
    }

    /// 確保 users 表裡有這位使用者的記錄;已存在則不做任何事。
    pub fn ensure_user_exists(&self, id: &str, email: &str) -> Result<()> {
        users::ensure_exists(&self.conn, id, email)
    }

    /// 寫入或更新指定使用者的 AWS 暫時憑證。
    pub fn upsert_credential(&self, user_id: &str, creds: &credentials::UserCredentials) -> Result<()> {
        credentials::upsert(&self.conn, user_id, creds)
    }

    /// 確保指定使用者的 bucket 設定存在 (一旦寫入就視為固定,不會被覆蓋)。
    pub fn ensure_bucket_exists(&self, user_id: &str, bkts: &buckets::UserBuckets) -> Result<()> {
        buckets::ensure_exists(&self.conn, user_id, bkts)
    }

    /// 確保 photos 裡有 image_id 的資料;若沒有,
    /// 就新增一筆帶有 id (內部生成)、image_id、user_id、source_device、date_path、
    /// shooting_date、uploaded_date 的資料。
    /// 回傳值代表這次是否真的新增了一筆。
    pub fn ensure_photo_exists(
        &self,
        image_id: &str,
        user_id: Option<&str>,
        source_device: &str,
        date_path: &str,
        shooting_date: i64,
        uploaded_date: i64,
    ) -> Result<bool> {
        photos::ensure_exists(
            &self.conn,
            image_id,
            user_id,
            source_device,
            date_path,
            shooting_date,
            uploaded_date,
        )
    }

    /// 用 `getDetailInfo` 解析結果更新對應 image_id 的欄位。
    /// 回傳 `true` 代表確實更新到一筆 (且資料有變動);`false` 代表找不到該
    /// image_id,或欄位值都沒有變動。
    pub fn update_photo_detail(&self, image_id: &str, detail: &photos::PhotoDetail) -> Result<bool> {
        photos::update_detail(&self.conn, image_id, detail)
    }

    /// 讀取目前的同步游標 (`sync_meta.last_cursor`);尚未同步過則為 0。
    pub fn read_last_cursor(&self) -> Result<i64> {
        sync_meta::read_last_cursor(&self.conn)
    }

    /// 寫入最新的同步游標 (CF 端 `sync_events` 表回傳的 `newCursor`)。
    pub fn write_last_cursor(&self, new_cursor: i64) -> Result<()> {
        sync_meta::write_last_cursor(&self.conn, new_cursor)
    }

    /// 撈出 `sync_queue` 裡所有待推送的記錄,依 enqueue 順序排列。
    pub fn load_pending_mutations(&self) -> Result<Vec<sync_queue::PendingMutation>> {
        sync_queue::load_pending(&self.conn)
    }

    /// 從 `sync_queue` 移除已經處理完成的記錄 (推播結果為 `OK` 或
    /// `SKIPPED`)。`ERROR` 的記錄不應該傳進來,讓它繼續留在 queue 裡
    /// 等下次 `--sync` 執行時重新推送。
    pub fn remove_pending_mutations(&self, mutation_ids: &[String]) -> Result<()> {
        sync_queue::remove_by_mutation_ids(&self.conn, mutation_ids)
    }

    /// 移除指定 entity 在 `sync_queue` 裡所有殘留的記錄。
    /// 用於 ERROR rollback 完成後,以及這個 entity 被本次 pullEvents
    /// 覆蓋過 (本地排隊中的變更已經沒有意義) 的情況。
    pub fn remove_pending_mutations_by_entity(
        &self,
        entity_type: &str,
        entity_id: &str,
    ) -> Result<()> {
        sync_queue::remove_by_entity_id(&self.conn, entity_type, entity_id)
    }

    /// Rollback 用:把 entity 強制還原成 `snapshot_before` 的狀態 (不比較
    /// version,呼叫端已經確認過這是「自己推送前的舊狀態」)。
    /// `entity_type` 對應不到任何已知類型時,記錄錯誤並跳過。
    pub fn restore_snapshot(
        &self,
        entity_type: &str,
        entity_id: &str,
        snapshot_json: &str,
    ) -> Result<()> {
        match entity_type {
            "USR" => users::restore_snapshot(&self.conn, entity_id, snapshot_json),
            "CRD" => credentials::restore_snapshot(&self.conn, entity_id, snapshot_json),
            "BKT" => buckets::restore_snapshot(&self.conn, entity_id, snapshot_json),
            "PHT" => photos::restore_snapshot(&self.conn, entity_id, snapshot_json),
            other => {
                eprintln!(
                    "[db] restore_snapshot: 未知的 entity_type={other},跳過 entity_id={entity_id}"
                );
                Ok(())
            }
        }
    }

    /// Rollback 用:這筆 entity 是第一次新增就被伺服器拒絕,沒有
    /// `snapshot_before` 可以還原 (代表這筆資料從未被伺服器承認過),
    /// 直接從本地表移除,不留痕跡。
    /// `entity_type` 對應不到任何已知類型時,記錄錯誤並跳過。
    pub fn delete_local_entity(&self, entity_type: &str, entity_id: &str) -> Result<()> {
        match entity_type {
            "USR" => users::delete_local(&self.conn, entity_id),
            "CRD" => credentials::delete_local(&self.conn, entity_id),
            "BKT" => buckets::delete_local(&self.conn, entity_id),
            "PHT" => photos::delete_local(&self.conn, entity_id),
            other => {
                eprintln!(
                    "[db] delete_local_entity: 未知的 entity_type={other},跳過 entity_id={entity_id}"
                );
                Ok(())
            }
        }
    }

    /// 套用一筆從 CF 拉回來的 pull event,寫入 (或覆蓋) 對應的本地記錄。
    ///
    /// - 不會寫入 `sync_queue` (這筆資料本來就是從伺服器來的,不需要再
    ///   推回去)。
    /// - 各 entity 模組內部直接相信伺服器版本,無條件覆蓋本地資料,不比較
    ///   本地 version (本地未推送的編輯有機會被遠端覆蓋,這是已知且接受
    ///   的取捨)。
    /// - `entity_type` 對應不到任何已知類型 (USR/CRD/BKT/PHT) 時,記錄
    ///   錯誤並跳過,不中斷整個 pull 流程。
    pub fn apply_pull_event(
        &self,
        entity_type: &str,
        entity_id: &str,
        version: i64,
        payload_json: Option<&str>,
    ) -> Result<()> {
        match entity_type {
            "USR" => users::apply_remote(&self.conn, entity_id, payload_json, version),
            "CRD" => credentials::apply_remote(&self.conn, entity_id, payload_json, version),
            "BKT" => buckets::apply_remote(&self.conn, entity_id, payload_json, version),
            "PHT" => photos::apply_remote(&self.conn, entity_id, payload_json, version),
            other => {
                eprintln!(
                    "[db] apply_pull_event: 未知的 entity_type={other},跳過 entity_id={entity_id}"
                );
                Ok(())
            }
        }
    }
}

//! `--sync` 模式：從本機 sync_queue 讀取待推送的記錄，
//! 依序 POST 到 Cloudflare Pages Functions，並將結果寫入 LOG。
//!
//! 這個模式完全不開 window / WebView，執行完畢後直接結束。
//!
//! 所有資料庫存取都透過 `crate::db::Database` 的高階方法進行，這個檔案
//! 只負責「組 request → POST → 解析 response → 印 LOG」這些跟同步流程
//! 本身相關的邏輯，不直接碰 SQL / `Connection`。

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::db::sync_queue::PendingMutation;
use crate::db::Database;

/// 每一批最多推送的 mutation 筆數。`sync_queue` 已依 `created_at ASC`
/// 排序（見 `load_pending`），所以每批固定拿到的是「目前最舊的
/// `SYNC_BATCH_SIZE` 筆」，天然符合「超過上限時從舊的開始同步」。
const SYNC_BATCH_SIZE: i64 = 50;

/// 單一批次（一次 POST /api/rs/sync）的處理結果統計。
struct BatchStats {
    ok_count: usize,
    skipped_count: usize,
    error_count: usize,
}

/// 對應 CF POST /api/rs/sync 的請求 body。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequestBody {
    push_commands: Vec<PushCommand>,
    /// 上次同步時 CF 回傳的 `newCursor`（存在 sync_meta 的 last_cursor），
    /// 還沒同步過就是 0。目前 CF 端尚未用它做差異查詢，先把欄位帶上。
    last_cursor: i64,
}

/// 單一 mutation 的推送指令（camelCase，對應 CF 的 TypeScript 介面）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushCommand {
    mutation_id: String,
    entity_type: String,
    entity_id: String,
    base_version: i64,
    /// payload 維持原始字串（sync_queue 存的就是 JSON 字串）。
    payload: String,
}

/// 把 DB 撈出來的 `PendingMutation` 轉成要 POST 出去的 `PushCommand`。
impl From<PendingMutation> for PushCommand {
    fn from(row: PendingMutation) -> Self {
        PushCommand {
            mutation_id: row.mutation_id,
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            base_version: row.base_version,
            payload: row.payload.unwrap_or_default(),
        }
    }
}

/// 對應 CF 回傳的 { pushResults: [...], newCursor, pullEvents: [...] }。
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SyncResponseBody {
    push_results: Vec<PushResult>,
    /// CF 端 sync_events 表目前最大的 id，收到後要寫回 sync_meta 的 last_cursor。
    new_cursor: i64,
    /// lastCursor 之後的伺服器端新事件（已排除本次請求自己 push 上去的 mutationId）。
    pull_events: Vec<PullEvent>,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct PushResult {
    mutation_id: String,
    status: String,
}

/// 對應 CF 回傳的單一筆 pull 事件（CF sync_events 的一列，camelCase）。
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct PullEvent {
    /// CF `sync_events.id`；目前只用來推進 cursor (透過外層的 `new_cursor`)，
    /// 這個欄位本身不會被讀取，留著只是為了讓 JSON 形狀完整。
    #[allow(dead_code)]
    id: i64,
    mutation_id: String,
    entity_type: String,
    entity_id: String,
    version: i64,
    payload: Option<String>,
}

/// 對應 CF `POST /api/rs/initdb` 的回應。
#[derive(serde::Deserialize, Debug)]
struct InitDbResponse {
    success: bool,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

/// push 之前先確保 CF 端的 D1 schema 已經建立(冪等的
/// `CREATE TABLE IF NOT EXISTS`)。失敗就直接回傳 `Err`,呼叫端 (`run`) 會
/// 中止整個 sync,不繼續 push——schema 都不確定存在的情況下繼續 push
/// 沒有意義,一定會全部失敗。
fn call_initdb(config: &crate::config::Config) -> Result<(), Box<dyn std::error::Error>> {
    let initdb_url = config.initdb_url();
    println!("[sync] 呼叫 initdb 確保 CF 端 schema 已建立: {initdb_url}");

    let response = ureq::post(&initdb_url)
        .set("CF-Access-Client-Id", &config.cf_access_client_id)
        .set("CF-Access-Client-Secret", &config.cf_access_client_secret)
        .call()?;

    let body: InitDbResponse = response.into_json()?;
    if !body.success {
        return Err(format!(
            "[initdb] CF 回應 success=false: {}",
            body.error.unwrap_or_default()
        )
        .into());
    }

    println!(
        "[sync] initdb 完成: {}",
        body.message.unwrap_or_default()
    );
    Ok(())
}

/// `--sync` 的主入口：initdb → 迴圈 (讀取一批 queue → POST → LOG) 直到清空。
///
/// `config` 除了 `cf_base_url` 之外，也提供 `cf_access_client_id` /
/// `cf_access_client_secret`，用來通過 `/api/rs/*` 獨立的 Cloudflare Access
/// Service Auth 驗證（跟前台 webview 登入用的 email 驗證完全無關，見
/// cimg-cf 的 `functions/_middleware.ts`）。
///
/// 每次呼叫 CF `/api/rs/sync` 最多帶 `SYNC_BATCH_SIZE` (50) 筆 push_commands，
/// 且固定是 `sync_queue` 裡最舊的那些（`load_pending` 依 `created_at ASC`
/// 排序）。若 `sync_queue` 裡累積超過一批，會在同一次 `run()` 呼叫內連續
/// 送出多個批次，直到 queue 清空（某一批撈到的筆數 < `SYNC_BATCH_SIZE`，
/// 代表已經是最後一批）；若某一批送出時發生錯誤（網路失敗 / CF 回應無法
/// 解析等，透過 `?` 往外傳播），整個 `run()` 會立刻中止，不再嘗試後續批次
/// ——已經成功處理的批次不受影響（各批次的 push/pull/queue 清理都是各自
/// 獨立且已經 commit 的，不需要 rollback）。
pub fn run(
    config: &crate::config::Config,
    db_path: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    // Step 0: 先確保 CF 端 D1 schema 已建立,失敗就直接中止,不繼續 push。
    call_initdb(config)?;

    let sync_url = config.sync_url();
    let sync_url = sync_url.as_str();

    let db = Database::open(db_path)?;

    let mut batch_no = 0usize;
    let mut total_ok = 0usize;
    let mut total_skipped = 0usize;
    let mut total_error = 0usize;

    loop {
        batch_no += 1;

        let pending = db.load_pending_mutations(SYNC_BATCH_SIZE)?;
        let fetched = pending.len();

        if pending.is_empty() {
            println!("[sync] sync_queue 是空的，沒有待推送的資料，仍會送出請求以確認是否有新的 pullEvents。");
        } else {
            println!(
                "[sync] 第 {batch_no} 批，共 {fetched} 筆待推送（單批上限 {SYNC_BATCH_SIZE}），目標: {sync_url}"
            );
        }

        let stats = push_one_batch(config, &db, sync_url, pending)?;
        total_ok += stats.ok_count;
        total_skipped += stats.skipped_count;
        total_error += stats.error_count;

        // 這一批撈到的筆數不滿一批上限，代表 sync_queue 已經清空（或本來就是空的），
        // 沒有必要再送下一批請求。撈滿一批則代表 queue 裡可能還有更多，繼續下一批。
        if (fetched as i64) < SYNC_BATCH_SIZE {
            break;
        }
    }

    println!(
        "[sync] 全部完成 — 共 {batch_no} 批 — OK: {total_ok}, SKIPPED: {total_skipped}, ERROR: {total_error}"
    );

    Ok(())
}

/// 處理單一批次：組 request → POST → 套用 pullEvents → 處理 pushResults →
/// 清理 sync_queue。回傳這一批的 OK / SKIPPED / ERROR 統計。
///
/// 這個函式不負責決定「還有沒有下一批」，那是 `run()` 外層迴圈的責任；
/// 這裡拿到什麼 `pending` 就處理什麼（可能是一批 50 筆，也可能是空的）。
fn push_one_batch(
    config: &crate::config::Config,
    db: &Database,
    sync_url: &str,
    pending: Vec<PendingMutation>,
) -> Result<BatchStats, Box<dyn std::error::Error>> {
    // 在 `pending` 被消耗成 `commands` 之前,先存一份 mutation_id -> 完整
    // PendingMutation (含 entity_id / snapshot_before / created_at) 的對照表。
    // 步驟 2 處理 ERROR 時要靠這份表回頭找出對應的 entity 與 rollback 用的快照。
    let mutation_map: HashMap<String, PendingMutation> = pending
        .iter()
        .map(|row| (row.mutation_id.clone(), row.clone()))
        .collect();

    // 過濾掉 payload 為 NULL 的異常記錄（正常情況不應發生）。
    let commands: Vec<PushCommand> = pending
        .into_iter()
        .filter_map(|row| {
            if row.payload.is_none() {
                eprintln!(
                    "[sync] 跳過 mutation_id={} (payload 為 NULL)",
                    row.mutation_id
                );
                return None;
            }
            Some(row.into())
        })
        .collect();

    let last_cursor = db.read_last_cursor()?;

    let body = SyncRequestBody {
        push_commands: commands,
        last_cursor,
    };

    // CF-Access-Client-Id / CF-Access-Client-Secret：Cloudflare Access 邊緣層
    // 會先驗證這兩個 header 對應到 /api/rs/* 那個 Application 底下的 Service
    // Token，驗證通過才會放行並附上 Cf-Access-Jwt-Assertion 給後端。
    // 這一步是機器對機器的獨立驗證，跟前台 webview 用 email 登入無關。
    let response = ureq::post(sync_url)
        .set("Content-Type", "application/json")
        .set("CF-Access-Client-Id", &config.cf_access_client_id)
        .set("CF-Access-Client-Secret", &config.cf_access_client_secret)
        .send_json(serde_json::to_value(&body)?)?;

    let resp_body: SyncResponseBody = response.into_json()?;

    // 步驟 1：先套用伺服器傳來的新資料。
    // 不論成功或失敗都繼續處理下一筆，單筆失敗只記錄錯誤，不中斷整個流程
    // (跟現有 push 結果的「best effort，記錄後繼續」風格一致)。
    //
    // 順便蒐集本次 pullEvents 涉及到的 (entity_type, entity_id)：
    // - 步驟 2 rollback 時用來判斷「這個 entity 是不是已經被本次 pull 蓋過」，
    //   蓋過的話本地狀態已經比任何排隊中的本地變更都新，不需要再 rollback。
    // - 步驟 3 用來清空這些 entity 在 sync_queue 裡所有殘留的記錄。
    let mut pull_entity_ids: HashSet<(String, String)> = HashSet::new();
    if resp_body.pull_events.is_empty() {
        println!("[sync] pullEvents 是空的，沒有新的伺服器端事件。");
    } else {
        println!("[sync] 收到 {} 筆 pullEvents，套用中...", resp_body.pull_events.len());
        for event in &resp_body.pull_events {
            pull_entity_ids.insert((event.entity_type.clone(), event.entity_id.clone()));
            match db.apply_pull_event(
                &event.entity_type,
                &event.entity_id,
                event.version,
                event.payload.as_deref(),
            ) {
                Ok(()) => println!(
                    "[sync] pull 套用完成 entity_type={} entity_id={} version={}",
                    event.entity_type, event.entity_id, event.version
                ),
                Err(e) => eprintln!(
                    "[sync] pull 套用失敗 mutation_id={} entity_type={} entity_id={} error={e}",
                    event.mutation_id, event.entity_type, event.entity_id
                ),
            }
        }
    }

    db.write_last_cursor(resp_body.new_cursor)?;

    // 步驟 2：處理推播結果。
    //
    // 跟「步驟 1」的 best-effort 風格一致：單筆失敗只記錄錯誤，不中斷整個流程。
    // - OK / SKIPPED：伺服器端已經確定處理完成 (寫入成功 / 重複請求被擋下)，
    //   這筆 mutation 從 sync_queue 移除即可。
    // - ERROR：交給 handle_error 判斷該怎麼收尾 (詳見該函式註解)。
    //
    // 本地 `version` 欄位不需要在這裡額外更新：cimg-rs 是 local-first
    // 樂觀更新，本地寫入 (ensure_exists / update_detail / upsert) 當下就已經
    // 把 version +1，跟 CF 端 `baseVersion + 1` 的算法完全對齊，收到 OK 的
    // 當下本地 version 早就是對的。CF 的 PushResult 目前也沒有回傳 version
    // 欄位，所以這裡也沒有額外的值可以拿來覆蓋。
    let mut ok_count = 0usize;
    let mut error_count = 0usize;
    let mut skipped_count = 0usize;
    let mut done_mutation_ids: Vec<String> = Vec::new();

    for result in &resp_body.push_results {
        match result.status.as_str() {
            "OK" => {
                ok_count += 1;
                println!("[sync] OK       mutation_id={}", result.mutation_id);
                done_mutation_ids.push(result.mutation_id.clone());
            }
            "SKIPPED" => {
                skipped_count += 1;
                println!("[sync] SKIPPED  mutation_id={}", result.mutation_id);
                done_mutation_ids.push(result.mutation_id.clone());
            }
            _ => {
                error_count += 1;
                eprintln!("[sync] ERROR    mutation_id={} status={}", result.mutation_id, result.status);

                match mutation_map.get(&result.mutation_id) {
                    Some(entry) => {
                        if let Err(e) = handle_error(
                            db,
                            entry,
                            &resp_body.push_results,
                            &mutation_map,
                            &pull_entity_ids,
                        ) {
                            eprintln!(
                                "[sync] rollback 失敗 mutation_id={} entity_type={} entity_id={} error={e}",
                                result.mutation_id, entry.entity_type, entry.entity_id
                            );
                        }
                    }
                    None => eprintln!(
                        "[sync] ERROR mutation_id={} 在本地 mutation_map 找不到對應記錄，略過 rollback",
                        result.mutation_id
                    ),
                }
            }
        }
    }

    if !done_mutation_ids.is_empty() {
        let removed = done_mutation_ids.len();
        if let Err(e) = db.remove_pending_mutations(&done_mutation_ids) {
            eprintln!("[sync] 從 sync_queue 移除已處理的 mutation 失敗: {e}");
        } else {
            println!("[sync] 已從 sync_queue 移除 {removed} 筆已處理完成的 mutation (OK/SKIPPED)");
        }
    }

    // 步驟 3：清理被 pullEvents 覆蓋的佇列項目。
    //
    // 這裡是個防呆：理論上本次 `pending` 已經包含這個 entity 當下所有排隊中
    // 的 mutation，步驟 2 應該已經處理乾淨。但 `--sync` 是獨立進程，跟
    // 開著 WebView 的主程式各開一條 SQLite 連線，讀完 `pending` 到收到回應
    // 這段網路往返期間，主程式仍可能寫入新的 sync_queue 記錄；如果剛好寫在
    // 一個本次被 pull 覆蓋掉的 entity 上，這裡會把它一併清掉，避免下次又拿
    // 一筆基於舊 base_version 的 mutation 去打架。
    for (entity_type, entity_id) in &pull_entity_ids {
        if let Err(e) = db.remove_pending_mutations_by_entity(entity_type, entity_id) {
            eprintln!(
                "[sync] 清除被 pull 覆蓋的 sync_queue 失敗 entity_type={entity_type} entity_id={entity_id} error={e}"
            );
        }
    }

    println!(
        "[sync] 這一批完成 — OK: {ok_count}, SKIPPED: {skipped_count}, ERROR: {error_count}, newCursor={}",
        resp_body.new_cursor
    );

    Ok(BatchStats {
        ok_count,
        skipped_count,
        error_count,
    })
}

/// 處理單筆 ERROR 的推播結果。依序檢查：
///
/// 1. 同一個 entity 在這個批次裡，是否有「更晚 enqueue」的 mutation 已經
///    成功 (`OK`/`SKIPPED`)？有的話代表這筆失敗的舊變更已經被後面更新的
///    變更蓋過去了，本地狀態其實是對的，不需要 rollback，只要把這個 entity
///    在 queue 裡的殘留記錄清掉即可。
/// 2. 這個 entity 是否被本次 pullEvents 套用過？有的話伺服器端的狀態已經
///    寫回本地 (見 `apply_pull_event`)，比任何本地排隊中的變更都新，同樣
///    不需要 rollback，直接清空 queue。
/// 3. 以上都不是，才是真的需要 rollback：
///    - 有 `snapshot_before`：強制覆寫回那個舊狀態 (`restore_snapshot`)。
///    - 沒有 `snapshot_before` (第一次新增就失敗)：代表這筆本地資料從未被
///      伺服器承認過，直接從本地表刪除 (`delete_local_entity`)。
///
/// 不論走哪一條路徑，最後都會把這個 entity 在 sync_queue 裡所有殘留的
/// mutation 清空 (含這筆 ERROR 本身)，避免下次拿著過期的 base_version
/// 再打一次一定會失敗的請求。
fn handle_error(
    db: &Database,
    entry: &PendingMutation,
    all_results: &[PushResult],
    mutation_map: &HashMap<String, PendingMutation>,
    pull_entity_ids: &HashSet<(String, String)>,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(later) = find_later_result(all_results, mutation_map, entry) {
        if later.status == "OK" || later.status == "SKIPPED" {
            db.remove_pending_mutations_by_entity(&entry.entity_type, &entry.entity_id)?;
            println!(
                "[sync] entity_type={} entity_id={} 已有更晚的 mutation 成功 (mutation_id={})，略過 rollback，直接清空 queue",
                entry.entity_type, entry.entity_id, later.mutation_id
            );
            return Ok(());
        }
    }

    if pull_entity_ids.contains(&(entry.entity_type.clone(), entry.entity_id.clone())) {
        db.remove_pending_mutations_by_entity(&entry.entity_type, &entry.entity_id)?;
        println!(
            "[sync] entity_type={} entity_id={} 已被本次 pullEvents 覆蓋，略過 rollback，直接清空 queue",
            entry.entity_type, entry.entity_id
        );
        return Ok(());
    }

    match &entry.snapshot_before {
        Some(snapshot) => {
            db.restore_snapshot(&entry.entity_type, &entry.entity_id, snapshot)?;
            println!(
                "[sync] rollback: entity_type={} entity_id={} 已還原成推送前的狀態",
                entry.entity_type, entry.entity_id
            );
        }
        None => {
            db.delete_local_entity(&entry.entity_type, &entry.entity_id)?;
            println!(
                "[sync] rollback: entity_type={} entity_id={} 第一次新增就失敗 (無 snapshot_before)，已從本地刪除",
                entry.entity_type, entry.entity_id
            );
        }
    }
    db.remove_pending_mutations_by_entity(&entry.entity_type, &entry.entity_id)?;
    eprintln!(
        "[sync] WARN 推送失敗已 rollback: mutation_id={} entity_type={} entity_id={}",
        entry.mutation_id, entry.entity_type, entry.entity_id
    );
    Ok(())
}

/// 在 `all_results` 裡找出跟 `entry` 同一個 entity、但 enqueue 時間
/// (`created_at`) 比 `entry` 晚的推播結果，取 `created_at` 最大 (最晚) 的
/// 一筆。直接比較 `created_at` 字串取最大值，不依賴 `all_results` 的
/// 陣列順序跟 enqueue 順序一致這個假設。
fn find_later_result<'a>(
    all_results: &'a [PushResult],
    mutation_map: &HashMap<String, PendingMutation>,
    entry: &PendingMutation,
) -> Option<&'a PushResult> {
    all_results
        .iter()
        .filter_map(|r| {
            let e = mutation_map.get(&r.mutation_id)?;
            if e.entity_type == entry.entity_type
                && e.entity_id == entry.entity_id
                && e.created_at.as_str() > entry.created_at.as_str()
            {
                Some((e.created_at.clone(), r))
            } else {
                None
            }
        })
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(_, r)| r)
}

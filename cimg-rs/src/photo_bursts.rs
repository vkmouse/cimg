//! `--update-photo-bursts` 模式:對本機 `photos` 資料跑「密集拍照區間」
//! 偵測,結果寫回本機 `photo_bursts` 表。完全不開 window / webview,也不
//! 打任何網路請求,純粹讀寫本機 sqlite。
//!
//! 流程:查出所有 user_id -> 對每個 user 各自跑一次演算法 -> 把這個 user
//! 的完整結果丟給 `Database::sync_user_bursts` 做新增/更新/軟刪除。
//!
//! 演算法參數目前先寫死常數(還在調參階段,不想每次測新數值都要重讀
//! 環境變數設定 / 重新驗證),之後穩定下來要抽成可調參數再說。
//! sync_queue / 跨機同步目前不處理,這張表暫時只當本機衍生資料。

use std::path::Path;

use crate::db::photo_bursts::{ComputedBurst, DayCount};
use crate::db::Database;
use crate::error::AppResult;

/// Gap tolerance:中間最多容忍幾天沒拍照,仍算同一段連續區間。
const GAP_TOLERANCE_DAYS: i64 = 1;

/// 密度門檻倍數:cluster 的「平均每日張數」要達到基準線(全域中位數)的
/// 幾倍,才判定為密集拍照區間。
const DENSITY_RATIO: f64 = 2.5;

/// 使用者「有拍照的日期數」至少要達到這個數字,才有足夠統計意義計算
/// 基準線;不足則整個跳過偵測(這個 user 這次的 computed 結果視為空,
/// 既有的 photo_bursts 列會依 `sync_bursts` 規則被軟刪除)。
const MIN_ACTIVE_DAYS: usize = 10;

/// 執行 `--update-photo-bursts` 模式的進入點。
pub fn run(db_path: &Path) -> AppResult<()> {
    let db = Database::open(db_path)?;

    let user_ids = db.list_user_ids()?;
    println!("[photo_bursts] 共 {} 位使用者,開始逐一計算", user_ids.len());

    for user_id in &user_ids {
        let days = db.daily_photo_counts(user_id)?;
        let computed = detect_bursts(&days);

        println!(
            "[photo_bursts] user_id={} 有拍照天數={} -> 偵測到 {} 段密集區間",
            user_id,
            days.len(),
            computed.len()
        );

        db.sync_user_bursts(user_id, &computed)?;
    }

    println!("[photo_bursts] 全部使用者計算完成");
    Ok(())
}

/// 對單一使用者的「每日張數序列」跑 gap-based 分群 + 密度過濾,
/// 回傳這次全量重算出的密集拍照區間清單。
///
/// `days` 必須已經依 `day_index` 由小到大排序(`Database::daily_photo_counts`
/// 底層的 SQL 已經 `ORDER BY day_index`,這裡不再重排)。
fn detect_bursts(days: &[DayCount]) -> Vec<ComputedBurst> {
    if days.len() < MIN_ACTIVE_DAYS {
        return Vec::new();
    }

    let baseline = median_count(days);

    let mut bursts = Vec::new();
    let mut cluster_start = 0usize;

    for i in 1..=days.len() {
        // 掃到序列尾端,或跟前一天的間隔超過容忍值,就把
        // [cluster_start, i-1] 這段收尾成一個候選 cluster。
        let gap_exceeded = i == days.len()
            || (days[i].day_index - days[i - 1].day_index) > GAP_TOLERANCE_DAYS + 1;

        if gap_exceeded {
            let cluster = &days[cluster_start..i];
            if let Some(burst) = evaluate_cluster(cluster, baseline) {
                bursts.push(burst);
            }
            cluster_start = i;
        }
    }

    bursts
}

/// 「有拍照的日子」張數中位數,當作這個使用者的日常基準線。
/// 用中位數而非平均數,避免密集區間本身的極端值把基準線拉高。
fn median_count(days: &[DayCount]) -> f64 {
    let mut counts: Vec<i64> = days.iter().map(|d| d.count).collect();
    counts.sort_unstable();
    let n = counts.len();
    if n % 2 == 1 {
        counts[n / 2] as f64
    } else {
        (counts[n / 2 - 1] + counts[n / 2]) as f64 / 2.0
    }
}

/// 判斷一段候選 cluster 是否密度達標;達標則組成 `ComputedBurst`。
fn evaluate_cluster(cluster: &[DayCount], baseline: f64) -> Option<ComputedBurst> {
    let total_count: i64 = cluster.iter().map(|d| d.count).sum();
    let span_days = cluster.last().unwrap().day_index - cluster.first().unwrap().day_index + 1;
    let avg_per_day = total_count as f64 / span_days as f64;

    if avg_per_day < baseline * DENSITY_RATIO {
        return None;
    }

    let start_date = cluster.first().unwrap().min_ts;
    let end_date = cluster.last().unwrap().max_ts;

    Some(ComputedBurst {
        start_date,
        end_date,
        total_count,
        span_days,
    })
}

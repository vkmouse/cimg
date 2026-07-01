//! Cookie 解析與寫入的對外入口。
//!
//! `wry` 的 `cookies_for_url` 回傳的是 `cookie` crate 的 `Cookie<'_>`
//! (已經解析好的物件,不是原始 Set-Cookie 字串),所以 name/value 可以
//! 直接透過 `.name()` / `.value()` 取得。
//!
//! 每一個被攔截到的目標 API (`getBucketInfo` / `getFileList` /
//! `getDetailInfo`) 都會先走過這裡同一套流程,確保三者行為一致:
//!   1. 從 webview 讀出目前網址底下所有 cookie。
//!   2. 解析 userProfile cookie → upsert `users` 表,取得 user_id。
//!   3. 解析 userInfo cookie    → upsert `credentials` 表。
//!   4. 回傳 user_id,讓呼叫端 (各個 handler) 用它去處理自己的 API
//!      response_data,寫入對應的表格 (buckets / photos)。
//!
//! 若找不到 userProfile cookie (尚未登入),會回傳 `Ok(None)`,呼叫端
//! 應該跳過這次的 API 回應處理,不寫入任何資料。
//!
//! 補充:bucket 資訊不在這裡的 cookie 流程處理。雖然來源頁面上還有一個
//! 對應 bucket 設定的 cookie,但目前 bucket 設定改由
//! `getBucketInfo` API 的 response_data 直接提供 (見
//! `handlers::bucket_info`),`cookie` 模組沒有對應的解析邏輯。

mod user;
mod user_profile;

use wry::WebView;

use crate::config::Config;
use crate::db::Database;
use crate::error::{AppError, AppResult};

/// 從 webview 讀出 `config.url` 底下所有 cookie,依固定順序解析並寫入
/// 資料庫,回傳解析出的 user_id。
///
/// 兩個 cookie 名稱 (`config.user_profile_cookie` / `config.user_info_cookie`)
/// 現在是 runtime 設定,不再是模組內的固定常數。
///
/// - 找不到 userProfile cookie → 回傳 `Ok(None)`,呼叫端應跳過後續處理。
/// - userInfo cookie 不存在或解析失敗,只印警告,不影響 user_id 的回傳
///   (credentials 是附加資訊,不是流程繼續的必要條件)。
pub fn handle_cookies(webview: &WebView, config: &Config, db: &Database) -> AppResult<Option<String>> {
    let cookies = webview
        .cookies_for_url(&config.url)
        .map_err(|e| AppError::WryError(e.to_string()))?;

    // Step 1: 解析 userProfile,取得 user_id。
    let user_id = match parse_user_profile(db, &cookies, &config.user_profile_cookie) {
        Ok(Some(id)) => id,
        Ok(None) => {
            eprintln!("[cookie] 找不到 {},跳過此次處理", config.user_profile_cookie);
            return Ok(None);
        }
        Err(e) => {
            eprintln!("[cookie] 解析 {} 失敗: {e}", config.user_profile_cookie);
            return Ok(None);
        }
    };

    // Step 2: 解析 user credentials。
    if let Some(c) = cookies.iter().find(|c| c.name() == config.user_info_cookie) {
        if let Err(e) = parse_user(db, &user_id, c.value()) {
            eprintln!("[cookie] 處理 {} 失敗: {e}", config.user_info_cookie);
        }
    }

    Ok(Some(user_id))
}

/// 找到 userProfile cookie,解析後寫入 users 表,回傳 user_id (sub)。
fn parse_user_profile(
    db: &Database,
    cookies: &[cookie_lib::Cookie<'_>],
    cookie_name: &str,
) -> Result<Option<String>, String> {
    let c = match cookies.iter().find(|c| c.name() == cookie_name) {
        Some(c) => c,
        None => return Ok(None),
    };
    let profile: user_profile::UserProfile =
        serde_json::from_str(c.value()).map_err(|e| e.to_string())?;
    db.ensure_user_exists(&profile.sub, &profile.email)
        .map_err(|e| e.to_string())?;
    Ok(Some(profile.sub))
}

/// 解析 user credentials cookie 並寫入 user_credentials 表。
fn parse_user(db: &Database, user_id: &str, value: &str) -> Result<(), String> {
    let info: user::UserInfo =
        serde_json::from_str(value).map_err(|e| e.to_string())?;
    let creds = info.to_user_credentials();
    db.upsert_credential(user_id, &creds)
        .map_err(|e| e.to_string())
}

//! Runtime 設定：全部從環境變數讀取。
//!
//! 設計原則很單純：**啟動時一次讀完、一次驗證完**。任何一個必要的環境
//! 變數沒設，就把「所有缺少的變數」一次列出來再結束程式，而不是抓到
//! 第一個缺的就中斷、使用者補一個、重跑、再抓到下一個缺的。
//!
//! 不分「一般模式」/「--sync 模式」個別檢查：所有變數啟動當下一律要求
//! 齊全，即使當次執行用不到（例如一般模式用不到 `CF_BASE_URL`）。這樣心智
//! 模型最單純：「這支程式要跑，環境變數就要備齊」，不用去記哪個模式需要
//! 哪幾個子集合。

use std::path::PathBuf;

/// 執行期設定值，啟動時從環境變數讀一次，之後整個程式生命週期不再變動。
#[derive(Debug, Clone)]
pub struct Config {
    /// 對應原本的 `TARGET_URL`：cimg-rs 開啟的頁面網址。
    pub url: String,
    /// 對應原本的 `USER_PROFILE_COOKIE`。
    pub user_profile_cookie: String,
    /// 對應原本的 `USER_INFO_COOKIE`。
    pub user_info_cookie: String,
    /// 對應原本的 `GET_FILE_LIST_API_URL`。
    pub get_file_list_api_url: String,
    /// 對應原本的 `GET_DETAIL_INFO_API_URL`。
    pub get_detail_info_api_url: String,
    /// 對應原本的 `GET_BUCKET_INFO_API_URL`。
    pub get_bucket_info_api_url: String,
    /// `--sync` 模式打的 CF Pages Functions base URL(例如
    /// `https://xxx.pages.dev`,不含路徑、結尾不帶 `/`)。
    /// `/api/rs/sync`、`/api/rs/initdb` 這兩個路徑固定由程式組成,
    /// 見 `sync_url()` / `initdb_url()`。
    pub cf_base_url: String,
    /// 本機資料目錄（sqlite 資料庫、webview 的 cookie/cache 都放在這底下）。
    pub data_dir: PathBuf,
    /// Cloudflare Access Service Token 的 Client ID，`--sync` 打 `/api/rs/sync`
    /// 時帶在 `CF-Access-Client-Id` header，用來通過該路徑獨立的 Service Auth 驗證
    /// （跟前台 webview 登入用的 email 驗證完全無關）。
    pub cf_access_client_id: String,
    /// 對應上面 Service Token 的 Client Secret，帶在 `CF-Access-Client-Secret` header。
    pub cf_access_client_secret: String,
}

impl Config {
    /// `--sync` 模式打的 sync endpoint 完整網址:`{cf_base_url}/api/rs/sync`。
    pub fn sync_url(&self) -> String {
        format!("{}/api/rs/sync", self.cf_base_url.trim_end_matches('/'))
    }

    /// `--sync` 模式打的 initdb endpoint 完整網址:`{cf_base_url}/api/rs/initdb`。
    pub fn initdb_url(&self) -> String {
        format!("{}/api/rs/initdb", self.cf_base_url.trim_end_matches('/'))
    }

    /// 從環境變數讀取所有設定值；缺少任何一個都會印出完整清單並
    /// `exit(1)`。
    pub fn from_env() -> Self {
        let mut missing = Vec::new();

        let url = require_env("CIMG_URL", &mut missing);
        let user_profile_cookie = require_env("CIMG_USER_PROFILE_COOKIE", &mut missing);
        let user_info_cookie = require_env("CIMG_USER_INFO_COOKIE", &mut missing);
        let get_file_list_api_url = require_env("CIMG_GET_FILE_LIST_API_URL", &mut missing);
        let get_detail_info_api_url = require_env("CIMG_GET_DETAIL_INFO_API_URL", &mut missing);
        let get_bucket_info_api_url = require_env("CIMG_GET_BUCKET_INFO_API_URL", &mut missing);
        let cf_base_url = require_env("CF_BASE_URL", &mut missing);
        let data_dir = require_env("DATA_DIR", &mut missing);
        let cf_access_client_id = require_env("CF_ACCESS_CLIENT_ID", &mut missing);
        let cf_access_client_secret = require_env("CF_ACCESS_CLIENT_SECRET", &mut missing);

        if !missing.is_empty() {
            eprintln!("[config] 啟動失敗，缺少下列環境變數：");
            for key in &missing {
                eprintln!("  - {key}");
            }
            std::process::exit(1);
        }

        Config {
            url: url.unwrap(),
            user_profile_cookie: user_profile_cookie.unwrap(),
            user_info_cookie: user_info_cookie.unwrap(),
            get_file_list_api_url: get_file_list_api_url.unwrap(),
            get_detail_info_api_url: get_detail_info_api_url.unwrap(),
            get_bucket_info_api_url: get_bucket_info_api_url.unwrap(),
            cf_base_url: cf_base_url.unwrap(),
            data_dir: PathBuf::from(data_dir.unwrap()),
            cf_access_client_id: cf_access_client_id.unwrap(),
            cf_access_client_secret: cf_access_client_secret.unwrap(),
        }
    }
}

/// 讀取單一環境變數；不存在或是空字串都視為「沒設」，記錄到 `missing`
/// 清單裡並回傳 `None`（空字串通常是 `KEY=` 這種打錯的寫法，直接當作
/// 沒設比較不容易讓人誤以為「有設但是空的」是合法狀態）。
fn require_env(key: &str, missing: &mut Vec<String>) -> Option<String> {
    match std::env::var(key) {
        Ok(v) if !v.is_empty() => Some(v),
        _ => {
            missing.push(key.to_string());
            None
        }
    }
}

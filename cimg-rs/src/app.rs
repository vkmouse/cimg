//! Application bootstrap: creates the data directories, database, window,
//! and WebView, then runs the event loop.

use std::path::PathBuf;

use tao::{
    event_loop::{ControlFlow, EventLoop, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::{WebContext, WebViewBuilder};

use crate::config::Config;
use crate::db::Database;
use crate::handlers::{dispatch, AppEvent};
use crate::webview::intercept::{intercept_context_script, parse_intercepted_context};

/// 偽裝成 Chrome 的 User-Agent。
const CHROME_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/// 檢查命令列參數是否包含指定的 boolean flag（例如 `--sync`）。
/// 只認完全相等的參數字串，不支援 `--sync=xxx` 這種寫法——`--sync` 本身
/// 不帶值，值一律從 `CF_BASE_URL` 環境變數讀。
fn has_flag(flag: &str) -> bool {
    std::env::args().any(|arg| arg == flag)
}

/// 把路徑轉成絕對路徑（若已經是絕對路徑就直接回傳）。
///
/// `DATA_DIR` 環境變數若給的是相對路徑,我們這裡是用「目前的工作目錄」去
/// 解析；但底層 webview 引擎 (webkit2gtk / WebView2) 收到同一個相對路徑
/// 字串時,不一定用同一個基準目錄解析 (實測會跑到執行檔旁邊),導致我們
/// 建立的資料夾跟 webview 實際寫入的資料夾變成兩個不同的地方。統一先轉成
/// 絕對路徑,就不會有「兩邊各自解讀」的空間。
fn to_absolute(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .expect("無法取得目前工作目錄")
            .join(path)
    }
}

/// Set up and run the application event loop. Does not return.
pub fn run() -> wry::Result<()> {
    // 所有設定值一律從環境變數讀,缺任何一個都會在這裡直接印出完整清單並
    // exit(1),不分「一般模式」或「--sync 模式」個別檢查(細節見 `config.rs`)。
    let config = Config::from_env();

    // 所有本機資料 (sqlite 資料庫、webview 的 cookie/cache) 都放在同一個
    // data dir 底下。一律先轉成絕對路徑,理由見 `to_absolute` 的註解。
    let data_dir = to_absolute(config.data_dir.clone());
    std::fs::create_dir_all(&data_dir).expect("無法建立資料目錄");
    println!("[app] 使用資料目錄: {}", data_dir.display());

    let db_path = data_dir.join("cimg.sqlite3");

    // --sync 有帶就走純 sync 流程,不開 window / webview,目標網址從
    // `CF_BASE_URL` 組出(見 `Config::sync_url()` / `Config::initdb_url()`)。
    if has_flag("--sync") {
        println!("[app] --sync 模式,跳過 webview 登入流程");
        if let Err(e) = crate::sync::run(&config, &db_path) {
            eprintln!("[sync] 錯誤: {e}");
            std::process::exit(1);
        }
        return Ok(());
    }

    let webview_data_dir = data_dir.join("webview_data");
    std::fs::create_dir_all(&webview_data_dir).expect("無法建立 webview 資料目錄");

    // 資料庫檔案放在 data dir 底下,跟 webview_data 平行,啟動時就會自動建表。
    let db = Database::open(&db_path).expect("無法初始化資料庫");

    let mut web_context = WebContext::new(Some(webview_data_dir));

    let event_loop: EventLoop<AppEvent> =
        EventLoopBuilder::<AppEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("Browser")
        .with_inner_size(tao::dpi::LogicalSize::new(160.0, 120.0))
        .build(&event_loop)
        .expect("無法建立視窗");

    let target_api_urls = [
        config.get_file_list_api_url.as_str(),
        config.get_detail_info_api_url.as_str(),
        config.get_bucket_info_api_url.as_str(),
    ];

    // `with_ipc_handler` 要求 `'static move` closure,而 `config` 之後在
    // `event_loop.run` 裡還要再用一次,所以這裡複製一份給 ipc handler 專用。
    let ipc_config = config.clone();
    let webview = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_user_agent(CHROME_USER_AGENT)
        .with_initialization_script(&intercept_context_script(&target_api_urls))
        .with_ipc_handler(move |request| {
            let payload = request.body();

            let ctx = match parse_intercepted_context(payload) {
                Ok(ctx) => ctx,
                Err(e) => {
                    eprintln!("[ipc] 無法解析攔截到的回應: {e}");
                    return;
                }
            };

            println!(
                "[ipc] {} {} => status {}",
                ctx.request_method, ctx.request_url, ctx.response_status
            );

            if ctx.request_url.starts_with(&ipc_config.get_bucket_info_api_url) {
                let _ = proxy.send_event(AppEvent::GetBucketInfoReceived(ctx));
            } else if ctx.request_url.starts_with(&ipc_config.get_file_list_api_url) {
                let _ = proxy.send_event(AppEvent::GetFileListReceived(ctx));
            } else if ctx.request_url.starts_with(&ipc_config.get_detail_info_api_url) {
                let _ = proxy.send_event(AppEvent::GetDetailInfoReceived(ctx));
            }
        })
        .with_url(&config.url)
        .build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        // 事件驅動:沒有事件就讓執行緒休息。
        *control_flow = ControlFlow::Wait;
        dispatch(event, control_flow, &db, &webview, &config);
    })
}

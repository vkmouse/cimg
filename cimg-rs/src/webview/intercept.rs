//! 注入到頁面裡、攔截 fetch / XMLHttpRequest 的 JS 腳本,
//! 以及對應的 IPC 訊息格式定義。
//!
//! 從 `main.rs` 抽出來單獨放一個檔案,純粹是為了讓 `main.rs`
//! 專心做「組裝」這件事,不要塞一大段字串格式化邏輯。

use serde::Deserialize;

/// 對應注入腳本透過 `window.ipc.postMessage` 送回來的訊息格式。
#[derive(Debug, Deserialize)]
pub struct InterceptedContext {
    pub request_url: String,
    pub request_method: String,
    pub request_data: String,
    pub response_status: u16,
    pub response_data: String,
}

/// 把 IPC 收到的原始字串解析成結構化的攔截結果。
///
/// 解析格式跟下面 `intercept_context_script` 產生的
/// `JSON.stringify({ request_url, request_method, request_data, response_status, response_data })` 是一對的,
/// 如果之後要在 JS 那邊塞更多欄位,記得這裡也要同步更新。
pub fn parse_intercepted_context(payload: &str) -> Result<InterceptedContext, serde_json::Error> {
    serde_json::from_str(payload)
}

/// 組出同時改寫 window.fetch 跟 XMLHttpRequest 的注入腳本。
/// 保證在頁面任何程式碼跑之前就會先執行,所以不管網站用哪種方式發請求都攔得到。
///
/// `target_api_urls`:想攔截的 API 端點清單,只要請求網址符合其中任何一個
/// 前綴,response 內容就會被送回 Rust。這份清單現在來自 `Config`(runtime
/// 環境變數),呼叫端(`app.rs`)負責組好陣列傳進來。
pub fn intercept_context_script(target_api_urls: &[&str]) -> String {
    // 把 Rust 陣列序列化成 JS 陣列字面值,例如:
    // ["https://.../getFileList","https://.../getDetailInfo","https://.../getBucketInfo"]
    let target_api_urls_json =
        serde_json::to_string(target_api_urls).expect("序列化 target_api_urls 失敗");

    format!(
        r#"
(function () {{
    const TARGET_API_URLS = {target_api_urls_json};

    function matchesTarget(url) {{
        return TARGET_API_URLS.some((prefix) => url.startsWith(prefix));
    }}

    function reportResponse(requestUrl, requestMethod, requestData, responseStatus, responseData) {{
        try {{
            window.ipc.postMessage(JSON.stringify({{ request_url: requestUrl, request_method: requestMethod, request_data: requestData, response_status: responseStatus, response_data: responseData }}));
        }} catch (e) {{
            // 序列化失敗或 ipc 還沒準備好,忽略即可
        }}
    }}

    // 攔截 fetch
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {{
        // 在發出請求前先取得 method 與 request data (GET 請求通常沒有 body)
        const init = args[1];
        const requestMethod = (init && init.method) ? init.method.toUpperCase() : 'GET';
        let requestData = '';
        if (init && typeof init.body === 'string') {{
            requestData = init.body;
        }} else if (init && init.body instanceof URLSearchParams) {{
            requestData = init.body.toString();
        }}

        const response = await originalFetch.apply(this, args);
        const requestUrl = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].href : args[0].url);

        if (matchesTarget(requestUrl)) {{
            try {{
                const responseData = await response.clone().text();
                reportResponse(requestUrl, requestMethod, requestData, response.status, responseData);
            }} catch (e) {{
                // 跨網域 / no-cors 的 opaque response 讀不到內容
            }}
        }}

        return response;
    }};

    // 攔截 XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {{
        this._interceptUrl = url;
        this._interceptMethod = method ? method.toUpperCase() : 'GET';
        return originalOpen.apply(this, [method, url, ...rest]);
    }};

    XMLHttpRequest.prototype.send = function (...args) {{
        // 在送出前先記錄 request data;GET 請求的 args[0] 通常是 null
        this._interceptRequestData = (args[0] != null) ? String(args[0]) : '';

        this.addEventListener('load', function () {{
            const requestUrl = this._interceptUrl || '';
            if (matchesTarget(requestUrl)) {{
                let responseData;
                if (this.responseType === '' || this.responseType === 'text') {{
                    responseData = this.responseText;
                }} else if (this.responseType === 'json') {{
                    responseData = JSON.stringify(this.response);
                }} else {{
                    responseData = `[unsupported responseType: ${{this.responseType}}]`;
                }}
                reportResponse(requestUrl, this._interceptMethod || 'GET', this._interceptRequestData || '', this.status, responseData);
            }}
        }});
        return originalSend.apply(this, args);
    }};
}})();
"#
    )
}

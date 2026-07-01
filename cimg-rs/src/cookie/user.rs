//! 解析 userInfo cookie(名稱由 `CIMG_USER_INFO_COOKIE` 指定)。
//!
//! 內容包含 token 時間戳、idToken、AWS 暫時憑證 (RawCredentials)、
//! 裝置連結狀態等欄位。目前需求只要展開 `RawCredentials` 裡的四個欄位,
//! 但保留其餘欄位的反序列化是為了:
//! 1. 結構完整,日後要存其他欄位時不用重寫 parser。
//! 2. 即使之後在 JSON 裡新增欄位,反序列化也不會直接失敗
//!    (未知欄位會被忽略,不影響既有欄位的解析)。

use serde::Deserialize;

use crate::db::credentials::UserCredentials;

#[derive(Debug, Deserialize)]
struct RawCredentials {
    #[serde(rename = "AccessKeyId")]
    access_key_id: String,
    #[serde(rename = "Expiration")]
    expiration: i64,
    #[serde(rename = "SecretAccessKey")]
    secret_access_key: String,
    #[serde(rename = "SessionToken")]
    session_token: String,
}

/// 供 `cookie::mod` 呼叫,取得解析結果並轉成 `UserCredentials` 寫入資料庫。
/// 不需要對整個 crate 公開,只有父模組 (`cookie::mod`) 會用到。
#[derive(Debug, Deserialize)]
pub(super) struct UserInfo {
    #[serde(rename = "Credentials")]
    credentials: RawCredentials,
}

impl UserInfo {
    /// 從解析結果中提取出 `UserCredentials`,供資料庫寫入。
    pub fn to_user_credentials(&self) -> UserCredentials {
        UserCredentials {
            access_key_id: self.credentials.access_key_id.clone(),
            expiration: self.credentials.expiration,
            secret_access_key: self.credentials.secret_access_key.clone(),
            session_token: self.credentials.session_token.clone(),
        }
    }
}

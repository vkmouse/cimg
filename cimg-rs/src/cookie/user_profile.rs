//! 解析 userProfile cookie(名稱由 `CIMG_USER_PROFILE_COOKIE` 指定)。
//!
//! 內容包含使用者的 sub (UUID,作為系統 user_id) 與 email。
//! 解析完成後呼叫端應把 sub 當成 users.id 寫入 users 表。

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub(super) struct UserProfile {
    /// 使用者的唯一識別碼 (UUID),對應 users.id。
    pub(super) sub: String,
    pub(super) email: String,
}

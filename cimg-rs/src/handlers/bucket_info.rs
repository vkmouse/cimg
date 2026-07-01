//! 處理 `getBucketInfo` API 的攔截結果。
//!
//! 流程跟其他 API handler 一致:
//!   1. 透過 `cookie::handle_cookies` 讀取 cookie,寫入 users / credentials,
//!      取得 user_id。
//!   2. 解析這支 API 自己的 `response_data`(S3 bucket 設定),寫入 buckets 表。
//!
//! `response_data` 範例 (欄位固定為 snake_case):
//! ```json
//! {
//!   "region": "eu-west-1",
//!   "middle": {"bucket": "...", "keybase": "..."},
//!   "extra_large": {"bucket": "...", "keybase": "..."},
//!   "original": {"bucket": "...", "keybase": "..."},
//!   "exif": {"bucket": "...", "keybase": "..."},
//!   "expand_original": {"bucket": "...", "keybase": "..."},
//!   "expand_exif": {"bucket": "...", "keybase": "..."}
//! }
//! ```

use serde::Deserialize;

use crate::db::buckets::UserBuckets;
use crate::error::{AppError, AppResult};
use super::{ApiHandler, HandlerContext};

#[derive(Debug, Deserialize)]
struct BucketEntry {
    bucket: String,
    keybase: String,
}

/// `getBucketInfo` 回應的固定結構,欄位皆為 snake_case,
/// 直接對應 `buckets` 表的欄位,不需要再額外嘗試 camelCase。
#[derive(Debug, Deserialize)]
struct BucketInfoResponse {
    region: String,
    middle: BucketEntry,
    extra_large: BucketEntry,
    original: BucketEntry,
    exif: BucketEntry,
    expand_original: BucketEntry,
    expand_exif: BucketEntry,
}

impl BucketInfoResponse {
    fn into_user_buckets(self) -> UserBuckets {
        UserBuckets {
            region: Some(self.region),
            exif_bucket: Some(self.exif.bucket),
            exif_keybase: Some(self.exif.keybase),
            expand_exif_bucket: Some(self.expand_exif.bucket),
            expand_exif_keybase: Some(self.expand_exif.keybase),
            expand_original_bucket: Some(self.expand_original.bucket),
            expand_original_keybase: Some(self.expand_original.keybase),
            extra_large_bucket: Some(self.extra_large.bucket),
            extra_large_keybase: Some(self.extra_large.keybase),
            middle_bucket: Some(self.middle.bucket),
            middle_keybase: Some(self.middle.keybase),
            original_bucket: Some(self.original.bucket),
            original_keybase: Some(self.original.keybase),
        }
    }
}

pub struct BucketInfoHandler;

impl ApiHandler for BucketInfoHandler {
    fn handle(&self, ctx: &HandlerContext) -> AppResult<()> {
        let user_id = match crate::cookie::handle_cookies(ctx.webview, ctx.config, ctx.db)? {
            Some(id) => id,
            None => {
                eprintln!("[bucket_info] 找不到 user_id (尚未登入),跳過本次處理");
                return Ok(());
            }
        };

        let parsed: BucketInfoResponse = serde_json::from_str(&ctx.intercepted.response_data)
            .map_err(|e| {
                AppError::ParseError(format!(
                    "無法解析 getBucketInfo 的 response_data: {e}"
                ))
            })?;

        let buckets = parsed.into_user_buckets();
        ctx.db.ensure_bucket_exists(&user_id, &buckets)?;
        Ok(())
    }
}

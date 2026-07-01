//! 處理 `getFileList` API 的攔截結果,確保每一筆 `imageId` 在 `photos`
//! 表裡都有對應的記錄,並帶上 user_id。
//!
//! 流程跟其他 API handler 一致:先透過 `cookie::handle_cookies` 取得
//! user_id,再解析這支 API 自己的 `response_data`(檔案清單)寫入 photos 表。
//!
//! user_id 改為一律從 cookie 取得,不再讀取 response 裡的
//! `LastEvaluatedKey.userId`(該欄位已不再解析)。

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use super::{ApiHandler, HandlerContext};

#[derive(Deserialize)]
struct FileListItem {
    #[serde(rename = "imageId")]
    image_id: String,
    #[serde(rename = "sourceDevice")]
    source_device: String,
    #[serde(rename = "datePath")]
    date_path: String,
}

#[derive(Deserialize)]
struct FileListResponse {
    #[serde(rename = "Items")]
    items: Vec<FileListItem>,
}

pub struct FileListHandler;

impl ApiHandler for FileListHandler {
    fn handle(&self, ctx: &HandlerContext) -> AppResult<()> {
        let user_id = match crate::cookie::handle_cookies(ctx.webview, ctx.config, ctx.db)? {
            Some(id) => id,
            None => {
                eprintln!("[file_list] 找不到 user_id (尚未登入),跳過本次處理");
                return Ok(());
            }
        };

        let parsed: FileListResponse =
            serde_json::from_str(&ctx.intercepted.response_data)
                .map_err(|e| AppError::ParseError(e.to_string()))?;

        for item in &parsed.items {
            ctx.db.ensure_photo_exists(&item.image_id, Some(&user_id), &item.source_device, &item.date_path)?;
        }
        Ok(())
    }
}

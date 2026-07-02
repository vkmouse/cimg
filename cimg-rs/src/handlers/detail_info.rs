//! 處理 `getDetailInfo` API 的攔截結果,補齊 `photos` 表中
//! 單張圖片的詳細欄位。
//!
//! 流程跟其他 API handler 一致:先透過 `cookie::handle_cookies` 確認已
//! 登入(順便 upsert users / credentials),再解析這支 API 自己的
//! `response_data`(圖片詳細資訊)更新 photos 表。更新時只用 `image_id`
//! 當作 WHERE 條件,不檢查 user_id。

use serde::Deserialize;

use crate::db::photos::PhotoDetail;
use crate::error::{AppError, AppResult};
use super::{ApiHandler, HandlerContext};

#[derive(Deserialize)]
struct RequestData {
    #[serde(rename = "sortKey")]
    sort_key: Option<String>,
}

#[derive(Deserialize)]
struct DetailInfoResponse {
    info: Vec<InfoItem>,
}

#[derive(Deserialize)]
struct InfoItem {
    name: String,
    value: Vec<String>,
}

/// 從 `request_data` JSON 的 `sortKey` 解析出 image_id。
/// sortKey 格式為 `image#<timestamp>#<uuid>`,最後一段即為 imageId。
fn extract_image_id(request_data: &str) -> Option<String> {
    let req: RequestData = serde_json::from_str(request_data).ok()?;
    let sort_key = req.sort_key?;
    sort_key.split('#').last().map(|s| s.to_owned())
}

/// 將 `response_data` JSON 解析成 `PhotoDetail`。
fn parse_detail(response_data: &str) -> Result<PhotoDetail, serde_json::Error> {
    let res: DetailInfoResponse = serde_json::from_str(response_data)?;
    let mut detail = PhotoDetail::default();
    for item in res.info {
        let val = item.value.into_iter().next();
        match item.name.as_str() {
            "拍攝影像的相機" => detail.shooting_camera = val,
            "影像大小" => detail.image_size = val,
            "檔案大小" => detail.file_size = val,
            "檔案格式" => detail.file_format = val,
            "Tv (快門速度)" => detail.shutter_speed = val,
            "Av (光圈)" => detail.aperture_value = val,
            "ISO 速度" => detail.iso_speed = val,
            "焦距" => detail.lens_focal_length = val,
            "白平衡模式" => detail.white_balance_mode = val,
            "曝光補償" => detail.exposure_compensation = val,
            "閃光燈" => detail.flash_firing = val,
            "鏡頭" => detail.lens = val,
            "主題類別" => detail.subject_category = val,
            "模糊判斷" => detail.blur_judgement = val,
            "曝光判斷" => detail.exposure_judgement = val,
            _ => {}
        }
    }
    Ok(detail)
}

pub struct DetailInfoHandler;

impl ApiHandler for DetailInfoHandler {
    fn handle(&self, ctx: &HandlerContext) -> AppResult<()> {
        // 流程上仍維持跟其他 handler 一致:先讀 cookie 確認已登入、
        // 順便 upsert users / credentials。但 photos 的 UPDATE 條件
        // 只比對 image_id,不檢查 user_id,所以這裡不需要使用這個值。
        let _user_id = match crate::cookie::handle_cookies(ctx.webview, ctx.config, ctx.db)? {
            Some(id) => id,
            None => {
                eprintln!("[detail_info] 找不到 user_id (尚未登入),跳過本次處理");
                return Ok(());
            }
        };

        let image_id = extract_image_id(&ctx.intercepted.request_data).ok_or_else(|| {
            AppError::ParseError(format!(
                "無法從 request_data 解析 image_id: {}",
                ctx.intercepted.request_data
            ))
        })?;

        let detail = parse_detail(&ctx.intercepted.response_data).map_err(|e| {
            AppError::ParseError(format!(
                "無法解析 response_data (image_id={image_id}): {e}"
            ))
        })?;

        ctx.db.update_photo_detail(&image_id, &detail)?;

        Ok(())
    }
}

//! `photos` 表的存取邏輯。
//!
//! `getFileList` 回應裡每一筆 imageId 都對應 photos 的一筆記錄:
//! 先確保這張表裡有這筆資料 (其他欄位先留空),之後 `getDetailInfo`
//! 回來再用 image_id 去補上剩下的欄位。
//!
//! PK 直接採用自然鍵 `image_id`,不另外生成 UUID。

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde_json::json;

use super::sync_queue::{self, EntityType};

/// `getDetailInfo` 解析出來的欄位,全部為 Option 以應對部分欄位缺失的情況。
#[derive(Debug, Default)]
pub struct PhotoDetail {
    pub shooting_date: Option<String>,
    pub uploaded_date: Option<String>,
    pub shooting_camera: Option<String>,
    pub image_size: Option<String>,
    pub file_size: Option<String>,
    pub file_format: Option<String>,
    pub shutter_speed: Option<String>,
    pub aperture_value: Option<String>,
    pub iso_speed: Option<String>,
    pub lens_focal_length: Option<String>,
    pub white_balance_mode: Option<String>,
    pub exposure_compensation: Option<String>,
    pub flash_firing: Option<String>,
    pub lens: Option<String>,
    pub subject_category: Option<String>,
    pub blur_judgement: Option<String>,
    pub exposure_judgement: Option<String>,
}

/// 既有一筆 photos 列的完整快照,用於組出 sync_queue 的 `old` / `new`。
struct PhotoRow {
    image_id: String,
    user_id: String,
    source_device: String,
    date_path: String,
    shooting_date: Option<String>,
    uploaded_date: Option<String>,
    shooting_camera: Option<String>,
    image_size: Option<String>,
    file_size: Option<String>,
    file_format: Option<String>,
    shutter_speed: Option<String>,
    aperture_value: Option<String>,
    iso_speed: Option<String>,
    lens_focal_length: Option<String>,
    white_balance_mode: Option<String>,
    exposure_compensation: Option<String>,
    flash_firing: Option<String>,
    lens: Option<String>,
    subject_category: Option<String>,
    blur_judgement: Option<String>,
    exposure_judgement: Option<String>,
    version: i64,
    is_deleted: i64,
}

fn row_from(row: &rusqlite::Row) -> rusqlite::Result<PhotoRow> {
    Ok(PhotoRow {
        image_id: row.get(0)?,
        user_id: row.get(1)?,
        source_device: row.get(2)?,
        date_path: row.get(3)?,
        shooting_date: row.get(4)?,
        uploaded_date: row.get(5)?,
        shooting_camera: row.get(6)?,
        image_size: row.get(7)?,
        file_size: row.get(8)?,
        file_format: row.get(9)?,
        shutter_speed: row.get(10)?,
        aperture_value: row.get(11)?,
        iso_speed: row.get(12)?,
        lens_focal_length: row.get(13)?,
        white_balance_mode: row.get(14)?,
        exposure_compensation: row.get(15)?,
        flash_firing: row.get(16)?,
        lens: row.get(17)?,
        subject_category: row.get(18)?,
        blur_judgement: row.get(19)?,
        exposure_judgement: row.get(20)?,
        version: row.get(21)?,
        is_deleted: row.get(22)?,
    })
}

const SELECT_COLUMNS: &str = "image_id, user_id, source_device, date_path,
    shooting_date, uploaded_date, shooting_camera, image_size, file_size,
    file_format, shutter_speed, aperture_value, iso_speed, lens_focal_length,
    white_balance_mode, exposure_compensation, flash_firing, lens,
    subject_category, blur_judgement, exposure_judgement, version, is_deleted";

fn to_json(row: &PhotoRow) -> serde_json::Value {
    json!({
        "image_id": row.image_id,
        "user_id": row.user_id,
        "source_device": row.source_device,
        "date_path": row.date_path,
        "shooting_date": row.shooting_date,
        "uploaded_date": row.uploaded_date,
        "shooting_camera": row.shooting_camera,
        "image_size": row.image_size,
        "file_size": row.file_size,
        "file_format": row.file_format,
        "shutter_speed": row.shutter_speed,
        "aperture_value": row.aperture_value,
        "iso_speed": row.iso_speed,
        "lens_focal_length": row.lens_focal_length,
        "white_balance_mode": row.white_balance_mode,
        "exposure_compensation": row.exposure_compensation,
        "flash_firing": row.flash_firing,
        "lens": row.lens,
        "subject_category": row.subject_category,
        "blur_judgement": row.blur_judgement,
        "exposure_judgement": row.exposure_judgement,
        "version": row.version,
        "is_deleted": row.is_deleted,
    })
}

/// 若 image_id 尚未存在,就新增一筆帶有 image_id、user_id、source_device、
/// date_path 的資料,並寫入 sync_queue;已存在就什麼都不做 (INSERT OR
/// IGNORE),也不寫入 sync_queue。
///
/// `user_id` 由呼叫端 (`handlers::file_list`) 從 cookie 解析取得後傳入。
/// 為 `None` 屬於不應該發生的情況 (理論上呼叫端一定能透過 cookie 取得
/// user_id,否則整個 handler 會在更早的步驟就跳過);發生時記錄錯誤並
/// 直接跳過這一筆,不寫入 DB。
///
/// 回傳值代表「這次呼叫是不是真的新增了一筆」。
pub fn ensure_exists(
    conn: &Connection,
    image_id: &str,
    user_id: Option<&str>,
    source_device: &str,
    date_path: &str,
) -> Result<bool> {
    let user_id = match user_id {
        Some(u) => u,
        None => {
            eprintln!(
                "[photos] ERROR: image_id={image_id} 缺少 user_id,這不應該發生,跳過此筆"
            );
            return Ok(false);
        }
    };

    let query = format!(
        "INSERT OR IGNORE INTO photos (image_id, user_id, source_device, date_path)
         VALUES (?1, ?2, ?3, ?4)
         RETURNING {SELECT_COLUMNS}"
    );
    let row = conn
        .query_row(
            &query,
            params![image_id, user_id, source_device, date_path],
            row_from,
        )
        .optional()?;

    let new_row = match row {
        Some(r) => r,
        None => return Ok(false),
    };

    let new_payload = to_json(&new_row);
    sync_queue::enqueue(
        conn,
        EntityType::Photo,
        &new_row.image_id,
        &new_payload,
        None,
        0,
    )?;
    Ok(true)
}

/// 用 `getDetailInfo` 解析出的資料更新對應 image_id 的欄位。
///
/// 先 `SELECT` 出更新前的狀態作為 sync_queue 的 `old`,再執行
/// `UPDATE ... WHERE image_id = ? AND (任一欄位有變) ... RETURNING` 取得
/// 更新後的 `new` (version = old.version + 1)。
///
/// 不寫入 sync_queue、回傳 `false` 的情況:
/// - image_id 在 DB 裡找不到。
/// - image_id 存在,但 17 個欄位都沒有變化 (WHERE 條件不成立,UPDATE 不會
///   真的執行,RETURNING 也不會有任何列)。
///
/// 回傳 `true` 代表確實更新到一筆 (且資料有變動);其餘情況都回傳 `false`,
/// 兩種情況在回傳值上不做區分。
pub fn update_detail(conn: &Connection, image_id: &str, detail: &PhotoDetail) -> Result<bool> {
    // Step 1: 先讀出目前的狀態,作為 sync_queue 的 `old`。
    let select_query = format!("SELECT {SELECT_COLUMNS} FROM photos WHERE image_id = ?1");
    let old = conn
        .query_row(&select_query, params![image_id], row_from)
        .optional()?;

    let old_row = match old {
        Some(r) => r,
        None => return Ok(false),
    };

    // Step 2: 執行 UPDATE,version = 原本的 version + 1。
    // WHERE 額外加上「任一欄位確實有變」的判斷 (IS NOT,可正確處理 NULL 比較),
    // 沒有變化就不會真的 UPDATE,RETURNING 也不會有任何列。
    let update_query = format!(
        "UPDATE photos SET
            shooting_date         = ?1,
            uploaded_date         = ?2,
            shooting_camera       = ?3,
            image_size            = ?4,
            file_size             = ?5,
            file_format           = ?6,
            shutter_speed         = ?7,
            aperture_value        = ?8,
            iso_speed             = ?9,
            lens_focal_length     = ?10,
            white_balance_mode    = ?11,
            exposure_compensation = ?12,
            flash_firing          = ?13,
            lens                  = ?14,
            subject_category      = ?15,
            blur_judgement        = ?16,
            exposure_judgement    = ?17,
            version               = photos.version + 1
        WHERE image_id = ?18
        AND (
            photos.shooting_date         IS NOT ?1  OR
            photos.uploaded_date         IS NOT ?2  OR
            photos.shooting_camera       IS NOT ?3  OR
            photos.image_size            IS NOT ?4  OR
            photos.file_size             IS NOT ?5  OR
            photos.file_format           IS NOT ?6  OR
            photos.shutter_speed         IS NOT ?7  OR
            photos.aperture_value        IS NOT ?8  OR
            photos.iso_speed             IS NOT ?9  OR
            photos.lens_focal_length     IS NOT ?10 OR
            photos.white_balance_mode    IS NOT ?11 OR
            photos.exposure_compensation IS NOT ?12 OR
            photos.flash_firing          IS NOT ?13 OR
            photos.lens                  IS NOT ?14 OR
            photos.subject_category      IS NOT ?15 OR
            photos.blur_judgement        IS NOT ?16 OR
            photos.exposure_judgement    IS NOT ?17
        )
        RETURNING {SELECT_COLUMNS}"
    );
    let new_row = conn
        .query_row(
            &update_query,
            params![
                detail.shooting_date,
                detail.uploaded_date,
                detail.shooting_camera,
                detail.image_size,
                detail.file_size,
                detail.file_format,
                detail.shutter_speed,
                detail.aperture_value,
                detail.iso_speed,
                detail.lens_focal_length,
                detail.white_balance_mode,
                detail.exposure_compensation,
                detail.flash_firing,
                detail.lens,
                detail.subject_category,
                detail.blur_judgement,
                detail.exposure_judgement,
                image_id,
            ],
            row_from,
        )
        .optional()?;

    // 沒有任何列被回傳:可能是 image_id 在 SELECT 與 UPDATE 之間消失
    // (理論上不會發生,單機單連線),也可能是 17 個欄位都沒變動。
    // 兩種情況都不寫 sync_queue,回傳 false。
    let new_row = match new_row {
        Some(r) => r,
        None => return Ok(false),
    };

    let new_payload = to_json(&new_row);
    let old_snapshot = to_json(&old_row);

    sync_queue::enqueue(
        conn,
        EntityType::Photo,
        &new_row.image_id,
        &new_payload,
        Some(&old_snapshot),
        old_row.version,
    )?;
    Ok(true)
}

/// CF 回傳的 `PullEvent.payload` (entity_type = PHT) 解析後的形狀,
/// 對應 CF 端的 `PhotoPayload`。`image_id`/`version` 由
/// entity_id/event.version 提供,這裡只負責業務欄位。
#[derive(Debug, Default, serde::Deserialize)]
struct RemotePayload {
    #[serde(default)]
    user_id: String,
    #[serde(default)]
    source_device: String,
    #[serde(default)]
    date_path: String,
    shooting_date: Option<String>,
    uploaded_date: Option<String>,
    shooting_camera: Option<String>,
    image_size: Option<String>,
    file_size: Option<String>,
    file_format: Option<String>,
    shutter_speed: Option<String>,
    aperture_value: Option<String>,
    iso_speed: Option<String>,
    lens_focal_length: Option<String>,
    white_balance_mode: Option<String>,
    exposure_compensation: Option<String>,
    flash_firing: Option<String>,
    lens: Option<String>,
    subject_category: Option<String>,
    blur_judgement: Option<String>,
    exposure_judgement: Option<String>,
    #[serde(default)]
    is_deleted: i64,
    #[serde(default)]
    version: i64,
}

/// 套用一筆來自 CF 的 pull event:寫入 (或覆蓋) 指定 image_id 的記錄。
///
/// 直接相信伺服器版本,不比較本地 version,無條件覆蓋本地資料 (呼叫端
/// 已經評估過接受「本地未推送的編輯有機會被遠端覆蓋」這個風險)。這個
/// 寫入「不」會觸發 sync_queue (資料本來就是從伺服器來的,不需要再
/// 推回去)。
pub fn apply_remote(
    conn: &Connection,
    image_id: &str,
    payload_json: Option<&str>,
    version: i64,
) -> Result<()> {
    let payload: RemotePayload = match payload_json {
        Some(raw) => serde_json::from_str(raw).unwrap_or_default(),
        None => RemotePayload::default(),
    };

    conn.execute(
        r#"
        INSERT INTO photos (
            image_id, user_id, source_device, date_path,
            shooting_date, uploaded_date, shooting_camera, image_size, file_size,
            file_format, shutter_speed, aperture_value, iso_speed, lens_focal_length,
            white_balance_mode, exposure_compensation, flash_firing, lens,
            subject_category, blur_judgement, exposure_judgement,
            version, is_deleted
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
        ON CONFLICT(image_id) DO UPDATE SET
            user_id                = excluded.user_id,
            source_device          = excluded.source_device,
            date_path              = excluded.date_path,
            shooting_date          = excluded.shooting_date,
            uploaded_date          = excluded.uploaded_date,
            shooting_camera        = excluded.shooting_camera,
            image_size             = excluded.image_size,
            file_size              = excluded.file_size,
            file_format            = excluded.file_format,
            shutter_speed          = excluded.shutter_speed,
            aperture_value         = excluded.aperture_value,
            iso_speed              = excluded.iso_speed,
            lens_focal_length      = excluded.lens_focal_length,
            white_balance_mode     = excluded.white_balance_mode,
            exposure_compensation  = excluded.exposure_compensation,
            flash_firing           = excluded.flash_firing,
            lens                   = excluded.lens,
            subject_category       = excluded.subject_category,
            blur_judgement         = excluded.blur_judgement,
            exposure_judgement     = excluded.exposure_judgement,
            version                = excluded.version,
            is_deleted             = excluded.is_deleted
        "#,
        params![
            image_id,
            payload.user_id,
            payload.source_device,
            payload.date_path,
            payload.shooting_date,
            payload.uploaded_date,
            payload.shooting_camera,
            payload.image_size,
            payload.file_size,
            payload.file_format,
            payload.shutter_speed,
            payload.aperture_value,
            payload.iso_speed,
            payload.lens_focal_length,
            payload.white_balance_mode,
            payload.exposure_compensation,
            payload.flash_firing,
            payload.lens,
            payload.subject_category,
            payload.blur_judgement,
            payload.exposure_judgement,
            version,
            payload.is_deleted,
        ],
    )?;
    Ok(())
}

/// Rollback 用:把 `snapshot_before` 的 JSON 強制寫回本地。蓄意覆蓋。
/// 這個寫入「不」會觸發 sync_queue。
pub fn restore_snapshot(conn: &Connection, image_id: &str, snapshot_json: &str) -> Result<()> {
    let payload: RemotePayload = serde_json::from_str(snapshot_json).unwrap_or_default();

    conn.execute(
        r#"
        INSERT INTO photos (
            image_id, user_id, source_device, date_path,
            shooting_date, uploaded_date, shooting_camera, image_size, file_size,
            file_format, shutter_speed, aperture_value, iso_speed, lens_focal_length,
            white_balance_mode, exposure_compensation, flash_firing, lens,
            subject_category, blur_judgement, exposure_judgement,
            version, is_deleted
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
        ON CONFLICT(image_id) DO UPDATE SET
            user_id                = excluded.user_id,
            source_device          = excluded.source_device,
            date_path              = excluded.date_path,
            shooting_date          = excluded.shooting_date,
            uploaded_date          = excluded.uploaded_date,
            shooting_camera        = excluded.shooting_camera,
            image_size             = excluded.image_size,
            file_size              = excluded.file_size,
            file_format            = excluded.file_format,
            shutter_speed          = excluded.shutter_speed,
            aperture_value         = excluded.aperture_value,
            iso_speed              = excluded.iso_speed,
            lens_focal_length      = excluded.lens_focal_length,
            white_balance_mode     = excluded.white_balance_mode,
            exposure_compensation  = excluded.exposure_compensation,
            flash_firing           = excluded.flash_firing,
            lens                   = excluded.lens,
            subject_category       = excluded.subject_category,
            blur_judgement         = excluded.blur_judgement,
            exposure_judgement     = excluded.exposure_judgement,
            version                = excluded.version,
            is_deleted             = excluded.is_deleted
        "#,
        params![
            image_id,
            payload.user_id,
            payload.source_device,
            payload.date_path,
            payload.shooting_date,
            payload.uploaded_date,
            payload.shooting_camera,
            payload.image_size,
            payload.file_size,
            payload.file_format,
            payload.shutter_speed,
            payload.aperture_value,
            payload.iso_speed,
            payload.lens_focal_length,
            payload.white_balance_mode,
            payload.exposure_compensation,
            payload.flash_firing,
            payload.lens,
            payload.subject_category,
            payload.blur_judgement,
            payload.exposure_judgement,
            payload.version,
            payload.is_deleted,
        ],
    )?;
    Ok(())
}

/// Rollback 用:這筆 photo 是第一次新增就被伺服器拒絕 (沒有
/// `snapshot_before` 可以還原),直接從本地表移除,不留痕跡。
pub fn delete_local(conn: &Connection, image_id: &str) -> Result<()> {
    conn.execute("DELETE FROM photos WHERE image_id = ?1", params![image_id])?;
    Ok(())
}

import type { AppConfig, PhotoCursor, PhotoListResponse } from "../types";

/**
 * 取得目前使用者的 ID（回傳第一筆 users 的 id）
 */
export async function fetchMe(): Promise<{ userId: string }> {
  const res = await fetch("/api/me");
  if (!res.ok) {
    throw new Error(`無法取得使用者資訊（${res.status}）`);
  }
  return res.json();
}

/**
 * 取得目前使用者的 S3 暫時憑證與 bucket 設定
 */
export async function fetchAppConfig(): Promise<AppConfig> {
  const res = await fetch(`/api/config`);
  if (!res.ok) {
    throw new Error(`無法取得設定（${res.status}）`);
  }
  return res.json();
}

/**
 * 取得一頁照片清單（僅含 metadata，不含實際圖片網址）。
 * 依 shootingDate 新到舊排序，用 keyset cursor 分頁，不帶 cursor 代表撈第一頁。
 */
export async function fetchPhotoItems(cursor?: PhotoCursor): Promise<PhotoListResponse> {
  const params = new URLSearchParams();
  if (cursor) {
    params.set("cursorDate", String(cursor.shootingDate));
    params.set("cursorId", cursor.imageId);
  }
  const query = params.toString();
  const res = await fetch(`/api/photos${query ? `?${query}` : ""}`);
  if (!res.ok) {
    throw new Error(`無法取得照片清單（${res.status}）`);
  }
  return res.json();
}

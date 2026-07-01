import type { AppConfig, PhotoItem } from "../types";

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
export async function fetchAppConfig(userId: string): Promise<AppConfig> {
  const res = await fetch(`/api/config?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) {
    throw new Error(`無法取得設定（${res.status}）`);
  }
  return res.json();
}

/**
 * 取得照片清單（僅含 metadata，不含實際圖片網址）
 */
export async function fetchPhotoItems(userId: string): Promise<PhotoItem[]> {
  const res = await fetch(`/api/photos?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) {
    throw new Error(`無法取得照片清單（${res.status}）`);
  }
  return res.json();
}

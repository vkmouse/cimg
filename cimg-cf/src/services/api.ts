import type {
  PhotoCursor,
  PhotoDateFilter,
  PhotoDetailResponse,
  PhotoListResponse,
  PhotoSortOrder,
} from "../types";

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
 * 取得一頁照片清單（僅含 metadata，不含實際圖片網址）。
 * 依 shootingDate 排序（`sort` 決定方向，預設新到舊），用 keyset cursor 分頁，不帶 cursor 代表撈第一頁。
 * `filter` 帶入時只回傳 shootingDate 落在區間內（含端點）的照片。
 * `sort` 為 `'asc'` 時才會帶上 query 參數；預設的 `'desc'` 不帶參數（維持網址簡潔，也跟後端預設值一致）。
 */
export async function fetchPhotoItems(
  cursor?: PhotoCursor,
  filter?: PhotoDateFilter | null,
  sort?: PhotoSortOrder,
): Promise<PhotoListResponse> {
  const params = new URLSearchParams();
  if (cursor) {
    params.set("cursorDate", String(cursor.shootingDate));
    params.set("cursorId", cursor.imageId);
  }
  if (filter) {
    params.set("startDate", String(filter.startDate));
    params.set("endDate", String(filter.endDate));
  }
  if (sort === "asc") {
    params.set("sort", "asc");
  }
  const query = params.toString();
  const res = await fetch(`/api/photos${query ? `?${query}` : ""}`);
  if (!res.ok) {
    throw new Error(`無法取得照片清單（${res.status}）`);
  }
  return res.json();
}

/**
 * 取得單張照片的詳細資料（含 extraLarge 尺寸的 imageUrl）。
 * 查無此照片（不存在 / 不屬於自己）時 API 回 404，這裡回傳 null 讓呼叫端視為「找不到這張照片」。
 * 其他非 2xx（網路壞掉、伺服器錯誤）則拋出例外，呼叫端視為「錯誤狀態」。
 */
export async function fetchPhotoDetail(imageId: string): Promise<PhotoDetailResponse | null> {
  const res = await fetch(`/api/photos/${encodeURIComponent(imageId)}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`無法取得照片（${res.status}）`);
  }
  return res.json();
}

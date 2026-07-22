import type { PhotoDateFilter } from "../types";

/**
 * 日曆與網址 query string 統一使用 `YYYY-MM-DD`（本地時區）字串代表「一天」，
 * 避免在元件間傳遞時還要處理時區/毫秒轉換。真正打 API 時才轉成 unix seconds 區間。
 */
export type DateKey = string;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 將 Date 轉成本地時區的 `YYYY-MM-DD` 字串。 */
export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 驗證字串是否為合法的 `YYYY-MM-DD`（且真的是存在的日期，例如排除 2026-02-30）。 */
export function isValidDateKey(key: string | null | undefined): key is DateKey {
  if (!key || !DATE_KEY_PATTERN.test(key)) return false;
  const parts = key.split("-").map(Number);
  const y = parts[0] ?? NaN;
  const m = parts[1] ?? NaN;
  const d = parts[2] ?? NaN;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** 把 `YYYY-MM-DD` 解析成該天本地時區 00:00:00 的 Date。 */
export function parseDateKey(key: DateKey): Date {
  const parts = key.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}

/**
 * 把「開始/結束日期」字串轉成打 API 用的 unix seconds 區間（含端點）：
 * 開始日期當天 00:00:00 ～ 結束日期當天 23:59:59（皆為本地時區）。
 */
export function dateKeysToFilter(startKey: DateKey, endKey: DateKey): PhotoDateFilter {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  end.setHours(23, 59, 59, 999);
  return {
    startDate: Math.floor(start.getTime() / 1000),
    endDate: Math.floor(end.getTime() / 1000),
  };
}

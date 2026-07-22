import type { PhotoCursor, PhotoDateRange, PhotoSortOrder } from '../repositories/photoRepository'

/**
 * 解析 ?cursorDate=&cursorId= query 參數。
 * 兩者需成對且合法才視為有效 cursor，否則視為第一頁（null）。
 */
export function parseCursor(url: URL): PhotoCursor | null {
  const cursorDateRaw = url.searchParams.get('cursorDate')
  const cursorId = url.searchParams.get('cursorId')

  if (!cursorDateRaw || !cursorId) {
    return null
  }

  const shootingDate = Number(cursorDateRaw)
  if (!Number.isFinite(shootingDate)) {
    return null
  }

  return { shootingDate, imageId: cursorId }
}

/**
 * 解析 ?startDate=&endDate=（unix seconds）query 參數。
 * 兩者需成對、皆為合法數字、且 startDate <= endDate 才視為有效篩選，否則視為不篩選（null）。
 */
export function parseDateRange(url: URL): PhotoDateRange | null {
  const startRaw = url.searchParams.get('startDate')
  const endRaw = url.searchParams.get('endDate')

  if (!startRaw || !endRaw) {
    return null
  }

  const startDate = Number(startRaw)
  const endDate = Number(endRaw)
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || startDate > endDate) {
    return null
  }

  return { startDate, endDate }
}

/**
 * 解析 ?sort= query 參數。
 * 只有明確帶 `sort=asc` 才視為「舊到新」，其他情況（沒帶 / 帶了不合法的值）一律視為預設的 `desc`（新到舊）。
 */
export function parseSortOrder(url: URL): PhotoSortOrder {
  return url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc'
}

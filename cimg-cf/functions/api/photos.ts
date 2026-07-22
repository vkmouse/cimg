import type { AuthContext, Env } from '../types'
import * as photoService from '../services/photoService'
import * as bucketService from '../services/bucketService'
import { MIDDLE_SUFFIX } from '../services/imageService'
import type { PhotoListDto } from '../services/photoService'
import type { BucketDto } from '../services/bucketService'
import type { PhotoCursor, PhotoDateRange, PhotoSortOrder } from '../repositories/photoRepository'

/**
 * 解析 ?cursorDate=&cursorId= query 參數。
 * 兩者需成對且合法才視為有效 cursor，否則視為第一頁（null）。
 */
function parseCursor(url: URL): PhotoCursor | null {
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
function parseDateRange(url: URL): PhotoDateRange | null {
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
function parseSortOrder(url: URL): PhotoSortOrder {
  return url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc'
}

/**
 * 組出 `/api/img` 可直接使用的相對網址。
 * bucket/keybase/region 皆來自這個使用者自己的 `buckets` 表設定，
 * 跟每一筆照片本身無關，因此在呼叫端只查一次、每筆照片共用。
 */
function buildImageUrl(photo: PhotoListDto, bucket: BucketDto): string {
  const params = new URLSearchParams({
    imageId: photo.imageId,
    sourceDevice: photo.sourceDevice,
    datePath: photo.datePath,
    bucket: bucket.middleBucket,
    keybase: bucket.middleKeybase,
    region: bucket.region,
    suffix: MIDDLE_SUFFIX,
  })
  return `/api/img?${params.toString()}`
}

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const { userId } = context.data

  try {
    const url = new URL(context.request.url)
    const cursor = parseCursor(url)
    const dateRange = parseDateRange(url)
    const sortOrder = parseSortOrder(url)

    const [{ items, nextCursor, hasMore }, bucket] = await Promise.all([
      photoService.getListByUserId(DB, userId, cursor, photoService.DEFAULT_PAGE_SIZE, dateRange, sortOrder),
      bucketService.getByUserId(DB, userId),
    ])

    return Response.json({
      items: items.map((p) => ({
        imageId: p.imageId,
        sourceDevice: p.sourceDevice,
        datePath: p.datePath,
        shootingDate: p.shootingDate,
        imageUrl: bucket ? buildImageUrl(p, bucket) : null,
      })),
      nextCursor,
      hasMore,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

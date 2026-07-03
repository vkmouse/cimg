import type { AuthContext, Env } from '../types'
import * as photoService from '../services/photoService'
import * as bucketService from '../services/bucketService'
import { MIDDLE_SUFFIX } from '../services/imageService'
import type { PhotoDto } from '../services/photoService'
import type { BucketDto } from '../services/bucketService'
import type { PhotoCursor } from '../repositories/photoRepository'

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
 * 組出 `/api/img` 可直接使用的相對網址。
 * bucket/keybase/region 皆來自這個使用者自己的 `buckets` 表設定，
 * 跟每一筆照片本身無關，因此在呼叫端只查一次、每筆照片共用。
 */
function buildImageUrl(photo: PhotoDto, bucket: BucketDto): string {
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

    const [{ items, nextCursor, hasMore }, bucket] = await Promise.all([
      photoService.getListByUserId(DB, userId, cursor),
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

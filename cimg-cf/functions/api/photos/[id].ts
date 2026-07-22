import type { AuthContext, Env } from '../../types'
import * as photoService from '../../services/photoService'
import * as bucketService from '../../services/bucketService'
import { EXTRA_LARGE_SUFFIX, MIDDLE_SUFFIX } from '../../services/imageService'
import type { PhotoListDto } from '../../services/photoService'
import type { BucketDto } from '../../services/bucketService'
import * as photoRepository from '../../repositories/photoRepository'
import type { PhotoListRow, PhotoSortOrder } from '../../repositories/photoRepository'
import { parseDateRange, parseSortOrder } from '../photoQueryParams'

/**
 * 組出 `/api/img` 可直接使用的相對網址。
 * 跟 `photos.ts` 裡的 `buildImageUrl` 邏輯一致，差別是這裡同一張照片要組兩種尺寸：
 * `imageUrl`（extraLarge，原圖畫質）跟 `thumbnailUrl`（middle，跟列表縮圖同一份，先秒開再背景升級用）。
 */
function buildUrl(photo: PhotoListDto, bucket: string, keybase: string, region: string, suffix: string): string {
  const params = new URLSearchParams({
    imageId: photo.imageId,
    sourceDevice: photo.sourceDevice,
    datePath: photo.datePath,
    bucket,
    keybase,
    region,
    suffix,
  })
  return `/api/img?${params.toString()}`
}

function buildImageUrl(photo: PhotoListDto, bucket: BucketDto): string {
  return buildUrl(photo, bucket.extraLargeBucket, bucket.extraLargeKeybase, bucket.region, EXTRA_LARGE_SUFFIX)
}

function buildThumbnailUrl(photo: PhotoListDto, bucket: BucketDto): string {
  return buildUrl(photo, bucket.middleBucket, bucket.middleKeybase, bucket.region, MIDDLE_SUFFIX)
}

/**
 * 鄰居（上一張／下一張）現在只需要 imageId：前端靠這個 id 換頁時打 `/api/photos/:id`
 * 取得那張照片自己的 imageUrl/thumbnailUrl，不在這裡預先組網址，也就不需要 bucket 參數。
 * row 為 null（已在時間軸邊界）就回傳 null。
 */
function buildNeighborPayload(row: PhotoListRow | null): string | null {
  return row ? row.image_id : null
}

/**
 * prev/next 對應「更新／更舊的鄰居」的方向要看 `sortOrder`：
 * - `desc`（預設，清單新到舊）：prev = 更新的鄰居、next = 更舊的鄰居
 * - `asc`（清單舊到新）：prev = 更舊的鄰居、next = 更新的鄰居（跟 desc 相反）
 */
function resolveNeighbors(
  sortOrder: PhotoSortOrder,
  newerRow: PhotoListRow | null,
  olderRow: PhotoListRow | null,
): { prev: PhotoListRow | null; next: PhotoListRow | null } {
  return sortOrder === 'asc' ? { prev: olderRow, next: newerRow } : { prev: newerRow, next: olderRow }
}

export const onRequest: PagesFunction<Env, 'id', AuthContext> = async (context) => {
  const { DB } = context.env
  const { userId } = context.data
  const imageId = context.params.id as string
  const url = new URL(context.request.url)
  const dateRange = parseDateRange(url)
  const sortOrder = parseSortOrder(url)

  try {
    const [photo, bucket] = await Promise.all([
      photoService.getByImageId(DB, userId, imageId),
      bucketService.getByUserId(DB, userId),
    ])

    if (!photo) {
      return Response.json({ error: 'photo not found' }, { status: 404 })
    }

    // 拿到 current 之後才知道 shootingDate，用它去平行查左右鄰居；
    // bucket 已經查過了，這裡不用再查一次。
    // 鄰居查詢帶入 dateRange：區間內查不到不代表全體時間軸上沒有，只是這個篩選條件下沒有。
    const [newerRow, olderRow] = await Promise.all([
      photoRepository.getNewerNeighbor(DB, userId, photo.shootingDate, photo.imageId, dateRange),
      photoRepository.getOlderNeighbor(DB, userId, photo.shootingDate, photo.imageId, dateRange),
    ])
    const { prev, next } = resolveNeighbors(sortOrder, newerRow, olderRow)

    return Response.json({
      imageId: photo.imageId,
      sourceDevice: photo.sourceDevice,
      datePath: photo.datePath,
      shootingDate: photo.shootingDate,
      imageUrl: bucket ? buildImageUrl(photo, bucket) : null,
      thumbnailUrl: bucket ? buildThumbnailUrl(photo, bucket) : null,
      prev: buildNeighborPayload(prev),
      next: buildNeighborPayload(next),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

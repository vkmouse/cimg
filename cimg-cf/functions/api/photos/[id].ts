import type { AuthContext, Env } from '../../types'
import * as photoService from '../../services/photoService'
import * as bucketService from '../../services/bucketService'
import { MIDDLE_SUFFIX } from '../../services/imageService'
import type { PhotoListDto } from '../../services/photoService'
import type { BucketDto } from '../../services/bucketService'
import * as photoRepository from '../../repositories/photoRepository'
import type { PhotoListRow } from '../../repositories/photoRepository'

/**
 * 組出 `/api/img` 可直接使用的相對網址。
 * 跟 `photos.ts` 裡的 `buildImageUrl` 邏輯一致，這裡改用跟列表頁一樣的 middle 尺寸
 * （detail 頁暫時先顯示 middle，不用 extraLarge）。
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

/**
 * 把鄰居的 PhotoListRow 組成回應要的 { imageId, imageUrl } 形狀。
 * row 為 null（已在時間軸邊界）→ 整體回 null；沒有 bucket → imageUrl 回 null（跟 current 邏輯一致）。
 */
function buildNeighborPayload(
  row: PhotoListRow | null,
  bucket: BucketDto | null,
): { imageId: string; imageUrl: string | null } | null {
  if (!row) {
    return null
  }
  const dto: PhotoListDto = {
    imageId: row.image_id,
    sourceDevice: row.source_device,
    datePath: row.date_path,
    shootingDate: row.shooting_date,
  }
  return {
    imageId: dto.imageId,
    imageUrl: bucket ? buildImageUrl(dto, bucket) : null,
  }
}

export const onRequest: PagesFunction<Env, 'id', AuthContext> = async (context) => {
  const { DB } = context.env
  const { userId } = context.data
  const imageId = context.params.id as string

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
    const [newerRow, olderRow] = await Promise.all([
      photoRepository.getNewerNeighbor(DB, userId, photo.shootingDate, photo.imageId),
      photoRepository.getOlderNeighbor(DB, userId, photo.shootingDate, photo.imageId),
    ])

    return Response.json({
      imageId: photo.imageId,
      sourceDevice: photo.sourceDevice,
      datePath: photo.datePath,
      shootingDate: photo.shootingDate,
      imageUrl: bucket ? buildImageUrl(photo, bucket) : null,
      prev: buildNeighborPayload(newerRow, bucket),
      next: buildNeighborPayload(olderRow, bucket),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

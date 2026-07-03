import type { AuthContext, Env } from '../../types'
import * as photoService from '../../services/photoService'
import * as bucketService from '../../services/bucketService'
import type { PhotoDto } from '../../services/photoService'
import type { BucketDto } from '../../services/bucketService'

/**
 * 組出 `/api/img` 可直接使用的相對網址。
 * 跟 `photos.ts` 裡的 `buildImageUrl` 邏輯一致，差別只在這裡固定用
 * extraLarge 尺寸（detail 頁要看比列表縮圖更清楚的畫質），而不是 middle。
 */
function buildImageUrl(photo: PhotoDto, bucket: BucketDto): string {
  const params = new URLSearchParams({
    imageId: photo.imageId,
    sourceDevice: photo.sourceDevice,
    datePath: photo.datePath,
    bucket: bucket.extraLargeBucket,
    keybase: bucket.extraLargeKeybase,
    region: bucket.region,
  })
  return `/api/img?${params.toString()}`
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

    return Response.json({
      imageId: photo.imageId,
      sourceDevice: photo.sourceDevice,
      datePath: photo.datePath,
      shootingDate: photo.shootingDate,
      imageUrl: bucket ? buildImageUrl(photo, bucket) : null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

import type { AuthContext, Env } from '../../types'
import * as photoService from '../../services/photoService'
import * as bucketService from '../../services/bucketService'
import { EXTRA_LARGE_SUFFIX } from '../../services/imageService'
import type { PhotoDto } from '../../services/photoService'
import type { BucketDto } from '../../services/bucketService'
import * as photoRepository from '../../repositories/photoRepository'
import type { PhotoRow } from '../../repositories/photoRepository'

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
    suffix: EXTRA_LARGE_SUFFIX,
  })
  return `/api/img?${params.toString()}`
}

/**
 * 把鄰居的 PhotoRow 組成回應要的 { imageId, imageUrl } 形狀。
 * row 為 null（已在時間軸邊界）→ 整體回 null；沒有 bucket → imageUrl 回 null（跟 current 邏輯一致）。
 */
function buildNeighborPayload(
  row: PhotoRow | null,
  bucket: BucketDto | null,
): { imageId: string; imageUrl: string | null } | null {
  if (!row) {
    return null
  }
  const dto: PhotoDto = {
    imageId: row.image_id,
    userId: row.user_id,
    sourceDevice: row.source_device,
    datePath: row.date_path,
    shootingDate: row.shooting_date,
    uploadedDate: row.uploaded_date,
    shootingCamera: row.shooting_camera,
    imageSize: row.image_size,
    fileSize: row.file_size,
    fileFormat: row.file_format,
    shutterSpeed: row.shutter_speed,
    apertureValue: row.aperture_value,
    isoSpeed: row.iso_speed,
    lensFocalLength: row.lens_focal_length,
    whiteBalanceMode: row.white_balance_mode,
    exposureCompensation: row.exposure_compensation,
    flashFiring: row.flash_firing,
    lens: row.lens,
    subjectCategory: row.subject_category,
    blurJudgement: row.blur_judgement,
    exposureJudgement: row.exposure_judgement,
    version: row.version,
    isDeleted: row.is_deleted === 1,
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

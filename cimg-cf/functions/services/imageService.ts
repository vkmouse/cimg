import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import * as credentialService from './credentialService'

const THUMBNAIL_SUFFIX = '_640.jpg'
/** presigned URL 僅供後端立即使用，不回傳給前端，TTL 可以給很短。 */
const PRESIGN_EXPIRES_IN_SECONDS = 60

export interface ImageParams {
  imageId: string
  sourceDevice: string
  datePath: string
  bucket: string
  keybase: string
  region: string
}

export type ImageErrorReason = 'invalid_params' | 'no_credential' | 'fetch_failed'

export interface ImageError {
  ok: false
  reason: ImageErrorReason
}

export interface ImageSuccess {
  ok: true
  bytes: ArrayBuffer
  contentType: string
}

export type ImageResult = ImageSuccess | ImageError

/**
 * 各參數的合法字元/形狀限制。
 *
 * - imageId / sourceDevice：不含分隔符的單一片段
 * - datePath / keybase：可以含 `/`（keybase 本身格式如 `u-8f21c/middle`），
 *   但不允許空片段、不允許 `.`／`..`，避免組出跳出預期路徑的 S3 key
 * - bucket：比照 AWS S3 bucket 命名規則（小寫英數字、`.`、`-`，3~63 字元）
 * - region：比照 AWS region 格式（如 `us-east-1`、`ap-northeast-1`）
 *
 * 這裡刻意先做 decodeURIComponent 後再驗證，避免 `%2e%2e%2f` 這類編碼過的
 * `../` 繞過檢查（URL.searchParams 拿到的值已經是 decode 過的，但仍在此顯式
 * 檢查一次以防呼叫端未來改用其他方式解析 query string）。
 */
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const REGION_RE = /^[a-z]{2}(-gov)?-[a-z]+-\d$/

function isValidSegment(value: string): boolean {
  return SEGMENT_RE.test(value)
}

/** 允許內含 `/` 的欄位：每個以 `/` 切開的片段都必須通過 isValidSegment（因此天生排除空片段、`.`、`..`）。 */
function isValidPath(value: string): boolean {
  if (value.startsWith('/') || value.endsWith('/') || value.includes('//')) {
    return false
  }
  return value.split('/').every(isValidSegment)
}

export function validateParams(raw: {
  imageId: string | null
  sourceDevice: string | null
  datePath: string | null
  bucket: string | null
  keybase: string | null
  region: string | null
}): ImageParams | null {
  const { imageId, sourceDevice, datePath, bucket, keybase, region } = raw

  if (!imageId || !sourceDevice || !datePath || !bucket || !keybase || !region) {
    return null
  }

  let decoded: [string, string, string, string, string, string]
  try {
    decoded = [imageId, sourceDevice, datePath, bucket, keybase, region].map((v) =>
      decodeURIComponent(v),
    ) as typeof decoded
  } catch {
    return null
  }
  const [dImageId, dSourceDevice, dDatePath, dBucket, dKeybase, dRegion] = decoded

  if (!isValidSegment(dImageId)) return null
  if (!isValidSegment(dSourceDevice)) return null
  if (!isValidPath(dDatePath)) return null
  if (!isValidPath(dKeybase)) return null
  if (!BUCKET_RE.test(dBucket)) return null
  if (!REGION_RE.test(dRegion)) return null

  return {
    imageId: dImageId,
    sourceDevice: dSourceDevice,
    datePath: dDatePath,
    bucket: dBucket,
    keybase: dKeybase,
    region: dRegion,
  }
}

function buildObjectKey(params: ImageParams): string {
  return `${params.keybase}/${params.sourceDevice}/${params.datePath}/${params.imageId}${THUMBNAIL_SUFFIX}`
}

/**
 * 依 `context.data.userId`（session 身分，不是 query string）查該使用者自己的
 * AWS 憑證，presign 一個短效期 GetObjectCommand，後端立即 fetch 取得圖片 bytes。
 *
 * 安全性完全建立在：每位使用者的憑證透過 IAM 只能存取自己 keybase 前綴下的物件
 * （per-user IAM 隔離）。query string 裡的 bucket/keybase 即使被竄改，用的仍是
 * 「這次登入者自己的」憑證去嘗試，不會因此換到別人的身分。
 */
export async function fetchImage(
  db: D1Database,
  userId: string,
  params: ImageParams,
): Promise<ImageResult> {
  const credential = await credentialService.getByUserId(db, userId)
  if (!credential) {
    return { ok: false, reason: 'no_credential' }
  }

  const client = new S3Client({
    region: params.region,
    credentials: {
      accessKeyId: credential.accessKeyId,
      secretAccessKey: credential.secretAccessKey,
      sessionToken: credential.sessionToken,
    },
    // 沿用原本前端 s3.ts 的設定：透過 S3 Transfer Acceleration endpoint 存取。
    useAccelerateEndpoint: true,
  })

  const command = new GetObjectCommand({
    Bucket: params.bucket,
    Key: buildObjectKey(params),
  })

  let presignedUrl: string
  try {
    presignedUrl = await getSignedUrl(client, command, {
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    })
  } catch {
    return { ok: false, reason: 'fetch_failed' }
  }

  try {
    const s3Response = await fetch(presignedUrl)
    if (!s3Response.ok) {
      return { ok: false, reason: 'fetch_failed' }
    }
    const bytes = await s3Response.arrayBuffer()
    // 不信任 S3 回的 Content-Type（常因上傳時 PutObject 沒設對 metadata 而錯，
    // 例如變成 binary/octet-stream）。本端點固定只服務 `_640.jpg` 縮圖，直接寫死。
    const contentType = 'image/jpeg'
    return { ok: true, bytes, contentType }
  } catch {
    return { ok: false, reason: 'fetch_failed' }
  }
}

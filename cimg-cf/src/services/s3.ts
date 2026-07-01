import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig, PhotoItem } from "../types";

const SIGNED_URL_EXPIRES_IN_SECONDS = 43200;
const THUMBNAIL_SUFFIX = "_640.jpg";

function createClient(config: AppConfig): S3Client {
  return new S3Client({
    region: config.bucketInfo.region ?? undefined,
    credentials: {
      accessKeyId: config.user.credentials.accessKeyId ?? "",
      secretAccessKey: config.user.credentials.secretAccessKey ?? "",
      sessionToken: config.user.credentials.sessionToken ?? undefined,
    },
    useAccelerateEndpoint: true,
  });
}

function buildObjectKey(config: AppConfig, photo: PhotoItem): string {
  return `${config.bucketInfo.middle.keybase}/${photo.sourceDevice}/${photo.datePath}/${photo.imageId}${THUMBNAIL_SUFFIX}`;
}

/**
 * 將照片清單轉換成可直接顯示的簽名縮圖網址
 */
export async function resolvePhotoThumbnailUrls(
  config: AppConfig,
  photos: PhotoItem[],
): Promise<string[]> {
  const client = createClient(config);

  return Promise.all(
    photos.map((photo) => {
      const command = new GetObjectCommand({
        Bucket: config.bucketInfo.middle.bucket ?? undefined,
        Key: buildObjectKey(config, photo),
      });
      return getSignedUrl(client, command, { expiresIn: SIGNED_URL_EXPIRES_IN_SECONDS });
    }),
  );
}

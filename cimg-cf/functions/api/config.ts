import type { AppConfig } from '../../src/types'
import type { AuthContext, Env } from '../types'
import * as credentialService from '../services/credentialService'
import * as bucketService from '../services/bucketService'

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const { userId } = context.data

  try {
    const [credential, bucket] = await Promise.all([
      credentialService.getByUserId(DB, userId),
      bucketService.getByUserId(DB, userId),
    ])

    const response: AppConfig = {
      user: {
        credentials: {
          accessKeyId: credential?.accessKeyId ?? null,
          expiration: credential?.expiration ?? null,
          secretAccessKey: credential?.secretAccessKey ?? null,
          sessionToken: credential?.sessionToken ?? null,
        },
      },
      bucketInfo: {
        region: bucket?.region ?? null,
        exif: {
          bucket: bucket?.exifBucket ?? null,
          keybase: bucket?.exifKeybase ?? null,
        },
        expandExif: {
          bucket: bucket?.expandExifBucket ?? null,
          keybase: bucket?.expandExifKeybase ?? null,
        },
        expandOriginal: {
          bucket: bucket?.expandOriginalBucket ?? null,
          keybase: bucket?.expandOriginalKeybase ?? null,
        },
        extraLarge: {
          bucket: bucket?.extraLargeBucket ?? null,
          keybase: bucket?.extraLargeKeybase ?? null,
        },
        middle: {
          bucket: bucket?.middleBucket ?? null,
          keybase: bucket?.middleKeybase ?? null,
        },
        original: {
          bucket: bucket?.originalBucket ?? null,
          keybase: bucket?.originalKeybase ?? null,
        },
      },
    }

    return Response.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

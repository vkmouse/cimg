import type { AuthContext, Env } from '../types'
import * as imageService from '../services/imageService'

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const { userId } = context.data
  const url = new URL(context.request.url)

  const params = imageService.validateParams({
    imageId: url.searchParams.get('imageId'),
    sourceDevice: url.searchParams.get('sourceDevice'),
    datePath: url.searchParams.get('datePath'),
    bucket: url.searchParams.get('bucket'),
    keybase: url.searchParams.get('keybase'),
    region: url.searchParams.get('region'),
    suffix: url.searchParams.get('suffix'),
  })

  if (!params) {
    return Response.json({ error: 'invalid parameters' }, { status: 400 })
  }

  const result = await imageService.fetchImage(DB, userId, params)

  if (!result.ok) {
    if (result.reason === 'no_credential') {
      return Response.json({ error: 'credential not available' }, { status: 401 })
    }
    // invalid_params 理論上已被 validateParams 擋下，這裡只會是 fetch_failed
    return Response.json({ error: 'failed to fetch image' }, { status: 502 })
  }

  return new Response(result.bytes, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=2592000, immutable',
    },
  })
}

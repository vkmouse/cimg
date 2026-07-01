import type { Env } from '../types'
import * as photoService from '../services/photoService'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { DB } = context.env

  const userId = new URL(context.request.url).searchParams.get('userId')
  if (!userId) {
    return Response.json({ error: 'Missing userId' }, { status: 400 })
  }

  try {
    const photos = await photoService.getListByUserId(DB, userId)

    const items = photos.map((p) => ({
      imageId: p.imageId,
      sourceDevice: p.sourceDevice,
      datePath: p.datePath,
    }))

    return Response.json(items)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

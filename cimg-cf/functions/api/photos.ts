import type { AuthContext, Env } from '../types'
import * as photoService from '../services/photoService'

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const { userId } = context.data

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

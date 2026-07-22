import type { AuthContext, Env } from '../types'
import * as photoBurstService from '../services/photoBurstService'

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const { userId } = context.data

  try {
    const items = await photoBurstService.getListByUserId(DB, userId)
    return Response.json({ items })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

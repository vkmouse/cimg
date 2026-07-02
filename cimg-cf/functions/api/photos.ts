import type { AuthContext, Env } from '../types'
import * as photoService from '../services/photoService'
import type { PhotoCursor } from '../repositories/photoRepository'

/**
 * 解析 ?cursorDate=&cursorId= query 參數。
 * 兩者需成對且合法才視為有效 cursor，否則視為第一頁（null）。
 */
function parseCursor(url: URL): PhotoCursor | null {
  const cursorDateRaw = url.searchParams.get('cursorDate')
  const cursorId = url.searchParams.get('cursorId')

  if (!cursorDateRaw || !cursorId) {
    return null
  }

  const shootingDate = Number(cursorDateRaw)
  if (!Number.isFinite(shootingDate)) {
    return null
  }

  return { shootingDate, imageId: cursorId }
}

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const { userId } = context.data

  try {
    const url = new URL(context.request.url)
    const cursor = parseCursor(url)

    const { items, nextCursor, hasMore } = await photoService.getListByUserId(DB, userId, cursor)

    return Response.json({
      items: items.map((p) => ({
        imageId: p.imageId,
        sourceDevice: p.sourceDevice,
        datePath: p.datePath,
        shootingDate: p.shootingDate,
      })),
      nextCursor,
      hasMore,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

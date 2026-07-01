import type { Env } from '../types'
import * as userService from '../services/userService'

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const { DB } = context.env

  try {
    const user = await userService.getFirst(DB)

    if (!user) {
      return Response.json({ userId: null }, { status: 404 })
    }

    return Response.json({ userId: user.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}

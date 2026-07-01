import type { AuthContext, Env } from '../types'

export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  if (context.request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const { email, userId } = context.data
  return Response.json({ userId, email })
}

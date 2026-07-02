import type { AuthContext, Env } from '../types'

/**
 * /api/test：簡易的下載 proxy。
 *
 * 用法：GET /api/test?url=<encodeURIComponent(目標 URL)>
 *
 * 伺服器端（Cloudflare Pages Function）會向 `url` 發送 GET 請求，
 * 取得回應後直接把 body 串流回傳給呼叫端，並盡量保留原始的
 * Content-Type / Content-Length，方便前端或未來的 CDN 直接消費。
 *
 * 目前只允許 https:// 目標，避免誤用來打內網或其他協定。
 */
export const onRequest: PagesFunction<Env, any, AuthContext> = async (context) => {
  if (context.request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const url = new URL(context.request.url)
  const target = url.searchParams.get('url')

  if (!target) {
    return Response.json({ error: 'Missing "url" query parameter' }, { status: 400 })
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return Response.json({ error: 'Invalid "url" query parameter' }, { status: 400 })
  }

  if (targetUrl.protocol !== 'https:') {
    return Response.json({ error: 'Only https:// URLs are allowed' }, { status: 400 })
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: context.request.headers.get('Accept') ?? '*/*',
      },
    })

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { error: `Upstream fetch failed with status ${upstream.status}` },
        { status: upstream.status || 502 },
      )
    }

    const headers = new Headers()
    const contentType = upstream.headers.get('Content-Type')
    const contentLength = upstream.headers.get('Content-Length')
    const etag = upstream.headers.get('ETag')
    const lastModified = upstream.headers.get('Last-Modified')

    if (contentType) headers.set('Content-Type', contentType)
    if (contentLength) headers.set('Content-Length', contentLength)
    if (etag) headers.set('ETag', etag)
    if (lastModified) headers.set('Last-Modified', lastModified)

    // 未來要接 CDN 的話，這裡可以視情況調整快取策略。
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')

    return new Response(upstream.body, {
      status: 200,
      headers,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 502 })
  }
}

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const ALLOWED_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'
const ALLOWED_HEADERS = [
  'Content-Type', 'Idempotency-Key', 'X-Retale-Base-Revision', 'X-Retale-Revision-Novel-Id',
  'X-Retale-Resource-Novel-Id', 'X-Retale-Resource-Chapter-Id', 'X-Retale-Resource-Delete',
]
const EXPOSED_HEADERS = 'ETag, X-Retale-Workspace-Revision, X-Retale-Revision-Novel-Id'

export function parseAllowedApiOrigins(value: string | undefined) {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const url = new URL(entry)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== entry || entry.includes('*')) {
      throw new Error('RETALE_ALLOWED_API_ORIGINS must contain exact HTTP(S) origins without paths or wildcards')
    }
    return url.origin
  })
}

export function protectApiRequest(request: Request, allowedOrigins: readonly string[]) {
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  const requestUrl = new URL(request.url)
  // Next can construct request.url with the bind address. Host is the browser's
  // actual target authority; forwarded hosts are deliberately not trusted here.
  const authority = request.headers.get('host') ?? requestUrl.host
  const targetOrigin = `${requestUrl.protocol}//${authority}`
  const explicitlyAllowed = origin !== null && allowedOrigins.includes(origin)
  const sameOrigin = origin === targetOrigin
  const foreignBrowserRequest = origin !== null
    ? !sameOrigin && !explicitlyAllowed
    : fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none'

  if (foreignBrowserRequest || (!explicitlyAllowed && fetchSite === 'cross-site')) {
    return NextResponse.json({ ok: false, error: 'Cross-origin API requests are not allowed' }, {
      status: 403,
      headers: { 'Cache-Control': 'no-store', Vary: 'Origin, Sec-Fetch-Site' },
    })
  }

  // Origin-less CLI clients remain supported. This guard is browser request
  // protection, not authentication for clients on the trusted network.
  const response = request.method === 'OPTIONS'
    ? new NextResponse(null, { status: 204 })
    : NextResponse.next()
  // Proxy response headers override route headers, including encoding negotiation.
  response.headers.set('Vary', 'Origin, Sec-Fetch-Site, Accept-Encoding')
  if (explicitlyAllowed) {
    response.headers.set('Access-Control-Allow-Origin', origin!)
    response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
    response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '))
    response.headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS)
  }
  return response
}

export function apiOriginProxy(request: NextRequest) {
  return protectApiRequest(request, parseAllowedApiOrigins(process.env.RETALE_ALLOWED_API_ORIGINS))
}

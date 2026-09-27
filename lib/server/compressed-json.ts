import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { ifNoneMatchMatches, PRIVATE_REVALIDATION_CACHE_CONTROL } from '@/lib/server/api-route'

const compressBrotli = promisify(brotliCompress)
const compressGzip = promisify(gzip)
const MIN_COMPRESSION_BYTES = 1024

function selectEncoding(value: string | null) {
  const qualities = new Map<string, number>()
  for (const entry of value?.split(',') ?? []) {
    const [name, ...parameters] = entry.trim().toLowerCase().split(';')
    const qualityParameter = parameters.map((parameter) => parameter.trim()).find((parameter) => parameter.startsWith('q='))
    const quality = qualityParameter === undefined ? 1 : Number(qualityParameter.slice(2))
    qualities.set(name, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0)
  }
  const quality = (name: string) => qualities.get(name) ?? qualities.get('*') ?? 0
  const brotliQuality = quality('br')
  const gzipQuality = quality('gzip')
  const bestQuality = Math.max(brotliQuality, gzipQuality)
  if (bestQuality === 0 || (qualities.get('identity') ?? 0) > bestQuality) return null
  return brotliQuality >= gzipQuality ? 'br' : 'gzip'
}

/** Revalidate cached novels before reuse; compress cache misses on the daily dev server. */
export async function revalidatedCompressedJson(request: Request, payload: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  const vary = headers.get('Vary')?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
  if (!vary.some((value) => value === '*' || value.toLowerCase() === 'accept-encoding')) vary.push('Accept-Encoding')
  headers.set('Vary', vary.join(', '))
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.delete('Content-Encoding')
  headers.delete('Content-Length')
  const body = Buffer.from(JSON.stringify(payload))
  // Knowledge projections can change without advancing the workspace revision.
  // Hash the complete representation; a weak tag covers all compression variants.
  const etag = `W/"${createHash('sha256').update(body).digest('base64url')}"`
  headers.set('ETag', etag)
  headers.set('Cache-Control', PRIVATE_REVALIDATION_CACHE_CONTROL)
  if (ifNoneMatchMatches(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers })
  }
  const encoding = body.byteLength >= MIN_COMPRESSION_BYTES ? selectEncoding(request.headers.get('Accept-Encoding')) : null
  // Async compression keeps other API requests responsive while a large novel is encoded.
  const compressed = encoding === 'br'
    ? await compressBrotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
    : encoding === 'gzip' ? await compressGzip(body, { level: 4 }) : null
  const encoded = compressed && compressed.byteLength < body.byteLength ? compressed : body
  if (encoded === compressed) headers.set('Content-Encoding', encoding!)
  headers.set('Content-Length', String(encoded.byteLength))
  return new Response(new Uint8Array(encoded), { ...init, headers })
}

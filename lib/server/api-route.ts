import { NextResponse } from 'next/server'
import type { PersistedNovelState } from '@/lib/types'
import { DomainError, InputValidationError } from '@/lib/server/domain-errors'

export const PRIVATE_REVALIDATION_CACHE_CONTROL = 'private, no-cache, max-age=0, must-revalidate'
export const MAX_WORKSPACE_CHAPTERS = 2_000
export const MAX_WORKSPACE_CHAPTER_CONTENT_CHARS = 1_000_000
export const MAX_WORKSPACE_AGGREGATE_CHAPTER_CHARS = 8_000_000
export const MAX_API_JSON_BODY_BYTES = 1024 * 1024
export const MAX_GENERATION_JSON_BODY_BYTES = 8 * 1024 * 1024
export const MAX_PRESET_JSON_BODY_BYTES = 16 * 1024 * 1024

export class ApiRequestError extends DomainError {
  constructor(status: 400 | 403 | 413 | 415 | 422, message: string) {
    super(status, message)
    this.name = 'ApiRequestError'
  }
}

function parseDeclaredContentLength(request: Request) {
  const value = request.headers.get('content-length')
  if (value === null) return null
  if (!/^\d+$/u.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function assertJsonMediaType(request: Request) {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new ApiRequestError(415, 'Content-Type must be application/json')
  }
}

export function assertMultipartFormDataMediaType(request: Request) {
  const contentType = request.headers.get('content-type')
  if (!contentType) throw new ApiRequestError(415, 'Content-Type must be multipart/form-data with a boundary')
  const parts = contentType.split(';').map((part) => part.trim())
  if (parts[0]?.toLowerCase() !== 'multipart/form-data') {
    throw new ApiRequestError(415, 'Content-Type must be multipart/form-data with a boundary')
  }
  const boundary = parts.slice(1).find((part) => part.toLowerCase().startsWith('boundary='))?.slice('boundary='.length).trim()
  const unquotedBoundary = boundary?.startsWith('"') && boundary.endsWith('"') ? boundary.slice(1, -1) : boundary
  if (!unquotedBoundary) {
    throw new ApiRequestError(415, 'Content-Type must be multipart/form-data with a non-empty boundary')
  }
}

export function createByteLimitedRequest(request: Request, maxBytes: number, message: string) {
  const declaredLength = parseDeclaredContentLength(request)
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new ApiRequestError(413, message)
  }
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  if (!request.body) {
    return new Request(request.url, { method: request.method, headers, signal: request.signal })
  }

  const reader = request.body.getReader()
  let bytesRead = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        if (bytesRead + value.byteLength > maxBytes) {
          const error = new ApiRequestError(413, message)
          // A tee's cancellation can wait for its other reader. Surface the
          // limit immediately instead of waiting on unrelated body consumers.
          void reader.cancel(error).catch(() => undefined)
          controller.error(error)
          return
        }
        bytesRead += value.byteLength
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
  const init: RequestInit & { duplex: 'half' } = {
    method: request.method,
    headers,
    body,
    signal: request.signal,
    duplex: 'half',
  }
  return new Request(request.url, init)
}

export async function readBoundedJsonObject(request: Request, maxBytes: number, sizeMessage: string) {
  assertJsonMediaType(request)
  const limitedRequest = createByteLimitedRequest(request, maxBytes, sizeMessage)
  let payload: unknown
  try {
    payload = await limitedRequest.json()
  } catch (error) {
    if (error instanceof ApiRequestError) throw error
    throw new ApiRequestError(400, 'Invalid JSON body')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ApiRequestError(400, 'Invalid JSON body')
  }
  return payload as Record<string, unknown>
}

function chapterContentLength(chapter: unknown) {
  if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) return 0
  const record = chapter as Record<string, unknown>
  return (typeof record.content === 'string' ? record.content.length : 0)
    + (typeof record.originalContent === 'string' ? record.originalContent.length : 0)
}

export function assertWorkspaceSnapshotSemantics(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return
  const chapters = (payload as Record<string, unknown>).localChapters
  if (!Array.isArray(chapters)) return
  if (chapters.length > MAX_WORKSPACE_CHAPTERS) {
    throw new ApiRequestError(422, `Workspace may contain at most ${MAX_WORKSPACE_CHAPTERS} chapters`)
  }
  let aggregateChars = 0
  for (const chapter of chapters) {
    if (chapter && typeof chapter === 'object' && !Array.isArray(chapter)) {
      const record = chapter as Record<string, unknown>
      for (const field of ['content', 'originalContent'] as const) {
        const value = record[field]
        if (typeof value === 'string' && value.length > MAX_WORKSPACE_CHAPTER_CONTENT_CHARS) {
          throw new ApiRequestError(422, `${field} may contain at most ${MAX_WORKSPACE_CHAPTER_CONTENT_CHARS} characters`)
        }
      }
      if (
        record.wordCount !== undefined
        && (typeof record.wordCount !== 'number' || !Number.isSafeInteger(record.wordCount) || record.wordCount < 0)
      ) {
        throw new ApiRequestError(422, 'wordCount must be a safe non-negative integer')
      }
    }
    aggregateChars += chapterContentLength(chapter)
    if (aggregateChars > MAX_WORKSPACE_AGGREGATE_CHAPTER_CHARS) {
      throw new ApiRequestError(422, `Workspace chapter content may contain at most ${MAX_WORKSPACE_AGGREGATE_CHAPTER_CHARS} aggregate characters`)
    }
  }
}

export function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status })
}

export function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Cache-Control', 'no-store')
  return NextResponse.json(body, { ...init, headers })
}

export function noStoreJsonError(error: string, status: number, init: ResponseInit = {}) {
  return noStoreJson({ ok: false, error }, { ...init, status })
}

export function formatRevisionEtag(namespace: string, schemaVersion: number, revision: number) {
  return `"${namespace}-v${schemaVersion}-r${revision}"`
}

export function ifNoneMatchMatches(requestValue: string | null, currentEtag: string) {
  const value = requestValue?.trim()
  if (!value) return false
  if (value === '*') return true

  let entry = ''
  let quoted = false
  const entries: string[] = []
  for (const character of value) {
    if (character === '"') quoted = !quoted
    if (character === ',' && !quoted) {
      entries.push(entry.trim())
      entry = ''
    } else {
      entry += character
    }
  }
  entries.push(entry.trim())

  const currentOpaqueTag = currentEtag.startsWith('W/') ? currentEtag.slice(2) : currentEtag
  return entries.some((candidate) => {
    const match = /^(?:W\/)?("[^"\r\n]*")$/u.exec(candidate)
    return match?.[1] === currentOpaqueTag
  })
}

export async function readJsonObject(request: Request, maxBytes = MAX_API_JSON_BODY_BYTES) {
  return readBoundedJsonObject(request, maxBytes, `JSON request body exceeds ${maxBytes} bytes`)
}

export function apiRequestErrorResponse(error: unknown) {
  return error instanceof DomainError ? noStoreJsonError(error.message, error.status) : null
}

export function requireNonEmptyId(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) {
    throw new InputValidationError(`${field} is required`)
  }

  return normalized
}

export function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

import { writeLlmDebugLog, type LlmDebugLogParams } from '@/lib/server/llm-debug-log'
import { redactUserFacingDiagnostic } from '@/lib/workspace-user-facing-errors'

type ProviderName = 'openai-compatible' | 'ollama'

type ProviderRequestDebug = Pick<LlmDebugLogParams, 'folder' | 'stage' | 'attempt' | 'presetCompat'>

type ProviderRequestTimeoutPhase = 'request' | 'stream-idle'

type ProviderRequestContext = {
  response: Response
  cleanup: () => void
}

type ProviderRequestMessage = {
  role: string
  content: string
}

export class ProviderRequestError extends Error {
  code: 'timeout' | 'aborted' | 'network' | 'http' | 'empty' | 'invalid_json'
  status?: number
  responseBody?: string

  constructor(
    code: ProviderRequestError['code'],
    message: string,
    status?: number,
    responseBody?: string,
  ) {
    super(message)
    this.name = 'ProviderRequestError'
    this.code = code
    this.status = status
    this.responseBody = responseBody
  }
}

export const STREAM_PROVIDER_IDLE_TIMEOUT_MS = 180000
export const NON_STREAM_PROVIDER_TIMEOUT_MS = 300000

/** Keep the provider's explanation without returning its entire response or credentials. */
export function extractProviderErrorDetail(responseBody: string | undefined) {
  const body = responseBody?.trim()
  if (!body) return ''
  let detail = ''
  try {
    const parsed = JSON.parse(body)
    detail = [parsed?.error?.message, parsed?.error?.detail, parsed?.message, parsed?.detail, parsed?.error, parsed?.error?.code, parsed?.error?.type]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim())) ?? ''
    const code = parsed?.error?.code
    if (typeof code === 'string' && code.trim() && !detail.includes(code)) detail += ` (${code})`
  } catch {
    // Gateways may return plain text. Do not dump an HTML error page or broken JSON.
    if (!/^(?:<|\{|\[)/.test(body)) detail = body
  }
  return redactUserFacingDiagnostic(detail).replace(/\s+/g, ' ').trim()
}

export function throwIfProviderError(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('error' in payload) || !payload.error) return
  const responseBody = JSON.stringify(payload)
  const detail = extractProviderErrorDetail(responseBody)
  throw new ProviderRequestError('http', `Provider request failed${detail ? `: ${detail}` : ''}`, undefined, responseBody)
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function toDebugMessages(value: unknown): Array<{ role: string; content: string }> | undefined {
  if (!Array.isArray(value)) return undefined

  const messages = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const role = 'role' in item && typeof item.role === 'string' ? item.role : null
    const content = 'content' in item && typeof item.content === 'string' ? item.content : null
    return role && content ? [{ role, content }] : []
  })

  return messages.length ? messages : undefined
}

function buildRequestError(params: {
  provider: ProviderName
  action: string
  timeoutMs: number
  error: unknown
  inputSignal?: AbortSignal
  timeoutPhase?: ProviderRequestTimeoutPhase | null
}) {
  if (isAbortError(params.error)) {
    if (params.inputSignal?.aborted) {
      return new ProviderRequestError('aborted', `${params.action} aborted`)
    }

    if (params.timeoutPhase === 'stream-idle') {
      return new ProviderRequestError('timeout', `${params.action} stream timed out after ${params.timeoutMs}ms of inactivity`)
    }

    return new ProviderRequestError('timeout', `${params.action} timed out after ${params.timeoutMs}ms`)
  }

  const detail = params.error instanceof Error ? redactUserFacingDiagnostic(params.error.message) : ''
  return new ProviderRequestError('network', `${params.action} failed${detail ? `: ${detail}` : ''}`)
}

export async function requestProviderEndpoint(params: {
  provider: ProviderName
  action: string
  url: string
  model: string
  requestBody: unknown
  requestInit: RequestInit
  timeoutMs: number
  streamed: boolean
  debug?: ProviderRequestDebug
  inputSignal?: AbortSignal
  requestMessages?: ProviderRequestMessage[]
  noBodyMessage?: string
}): Promise<ProviderRequestContext> {
  const effectiveTimeoutMs = params.streamed
    ? params.timeoutMs
    : Math.max(params.timeoutMs, NON_STREAM_PROVIDER_TIMEOUT_MS)
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | null = null
  let timeoutPhase: ProviderRequestTimeoutPhase | null = 'request'
  let cleanedUp = false
  const abortFromInputSignal = () => controller.abort()

  const clearRequestTimeout = () => {
    if (timeout !== null) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  const scheduleTimeout = (phase: ProviderRequestTimeoutPhase) => {
    timeoutPhase = phase
    clearRequestTimeout()
    timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs)
  }

  scheduleTimeout('request')

  if (params.inputSignal?.aborted) {
    controller.abort()
  } else {
    params.inputSignal?.addEventListener('abort', abortFromInputSignal, { once: true })
  }

  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    timeoutPhase = null
    clearRequestTimeout()
    params.inputSignal?.removeEventListener('abort', abortFromInputSignal)
  }

  try {
    const response = await fetch(params.url, {
      ...params.requestInit,
      signal: controller.signal,
    })

    if (!response.ok) {
      const rawText = await response.text().catch(() => '')
      const detail = extractProviderErrorDetail(rawText)
      const error = new ProviderRequestError(
        'http',
        `${params.action} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
        rawText,
      )
      await writeLlmDebugLog({
        folder: params.debug?.folder ?? params.provider,
        provider: params.provider,
        model: params.model,
        streamed: params.streamed,
        stage: params.debug?.stage,
        attempt: params.debug?.attempt,
        presetCompat: params.debug?.presetCompat,
        request: { url: params.url, body: params.requestBody, messages: toDebugMessages(params.requestMessages) },
        response: { status: response.status, rawText, error: error.message },
      })
      throw error
    }

    if (params.noBodyMessage && !response.body) {
      const error = new ProviderRequestError('empty', params.noBodyMessage)
      await writeLlmDebugLog({
        folder: params.debug?.folder ?? params.provider,
        provider: params.provider,
        model: params.model,
        streamed: params.streamed,
        stage: params.debug?.stage,
        attempt: params.debug?.attempt,
        presetCompat: params.debug?.presetCompat,
        request: { url: params.url, body: params.requestBody, messages: toDebugMessages(params.requestMessages) },
        response: { status: response.status, error: error.message },
      })
      throw error
    }

    if (!params.streamed || !response.body) {
      return { response, cleanup }
    }

    scheduleTimeout('stream-idle')

    const reader = response.body.getReader()
    const wrappedBody = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            cleanup()
            streamController.close()
            return
          }

          scheduleTimeout('stream-idle')
          streamController.enqueue(value)
        } catch (error) {
          const normalizedError = buildRequestError({
            provider: params.provider,
            action: params.action,
            timeoutMs: effectiveTimeoutMs,
            error,
            inputSignal: params.inputSignal,
            timeoutPhase,
          })
          cleanup()
          streamController.error(normalizedError)
        }
      },
      async cancel(reason) {
        cleanup()
        await reader.cancel(reason)
      },
    })

    return {
      response: new Response(wrappedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      cleanup,
    }
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      cleanup()
      throw error
    }

    const normalizedError = buildRequestError({
      provider: params.provider,
      action: params.action,
      timeoutMs: effectiveTimeoutMs,
      error,
      inputSignal: params.inputSignal,
      timeoutPhase,
    })
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? params.provider,
      provider: params.provider,
      model: params.model,
      streamed: params.streamed,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      presetCompat: params.debug?.presetCompat,
      request: { url: params.url, body: params.requestBody, messages: toDebugMessages(params.requestMessages) },
      response: { error: normalizedError.message },
    })
    cleanup()
    throw normalizedError
  }
}

export async function parseProviderJsonResponse<T>(params: {
  provider: ProviderName
  model: string
  response: Response
  streamed: boolean
  request: {
    url: string
    body: unknown
    messages?: ProviderRequestMessage[]
  }
  debug?: ProviderRequestDebug
  invalidJsonMessage: string
  emptyBodyMessage?: string
}) {
  const rawText = await params.response.text()
  if (!rawText.trim()) {
    const error = new ProviderRequestError('empty', params.emptyBodyMessage ?? 'Provider returned an empty response body')
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? params.provider,
      provider: params.provider,
      model: params.model,
      streamed: params.streamed,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      presetCompat: params.debug?.presetCompat,
      request: params.request,
      response: { status: params.response.status, rawText, error: error.message },
    })
    throw error
  }

  try {
    const data = JSON.parse(rawText) as T
    throwIfProviderError(data)
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? params.provider,
      provider: params.provider,
      model: params.model,
      streamed: params.streamed,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      presetCompat: params.debug?.presetCompat,
      request: params.request,
      response: { status: params.response.status, rawText, parsed: data },
    })
    return {
      data,
      rawText,
    }
  } catch (cause) {
    if (cause instanceof ProviderRequestError) throw cause
    const error = new ProviderRequestError('invalid_json', params.invalidJsonMessage)
    await writeLlmDebugLog({
      folder: params.debug?.folder ?? params.provider,
      provider: params.provider,
      model: params.model,
      streamed: params.streamed,
      stage: params.debug?.stage,
      attempt: params.debug?.attempt,
      presetCompat: params.debug?.presetCompat,
      request: params.request,
      response: { status: params.response.status, rawText, error: error.message },
    })
    throw error
  }
}

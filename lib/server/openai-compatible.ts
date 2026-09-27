import { resolveRewriteProviderPrompts } from '@/lib/rewrite-provider-prompt'
import type { AIScenarioKey, OpenAICompatibleProviderSettings } from '@/lib/types'
import type { ChapterKnowledgeExtraction } from '@/lib/story-knowledge'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { safeParseJson } from '@/lib/server/json-parse'
import {
  buildLocalEmbeddingQuery,
  isRetaleLocalEmbeddingConfig,
} from '@/lib/server/local-embedding-catalog'
import { ensureLocalEmbeddingRuntimeRunning } from '@/lib/server/local-embedding-runtime'
import { writeLlmDebugLog, type LlmDebugLogParams } from '@/lib/server/llm-debug-log'
import { withProviderModelDiscoveryDeadline } from '@/lib/server/provider-model-discovery'
import {
  NON_STREAM_PROVIDER_TIMEOUT_MS,
  parseProviderJsonResponse,
  requestProviderEndpoint,
  STREAM_PROVIDER_IDLE_TIMEOUT_MS,
  throwIfProviderError,
} from '@/lib/server/provider-request'
import {
  buildKnowledgeExtractionPrompt,
  hasUsableKnowledgeExtraction,
  normalizeKnowledgeExtraction,
  parseKnowledgeExtractionCandidates,
  type KnowledgeExtractionPromptMode,
} from '@/lib/server/ollama-local'

type RewriteRequest = {
  outputFormat?: 'rewrite' | 'roleplay-script'
  sourceText: string
  mode: string
  tone: string
  scope: string
  prompt: string
  keepCanon: boolean
  autoContinue: boolean
  thoughtLevel: string
  systemPrompt?: string
  userPrompt?: string
  requestOptions?: Partial<{
    temperature: number
    top_p: number
    frequency_penalty: number
    presence_penalty: number
    max_tokens: number
  }>
  presetCompat?: unknown
  signal?: AbortSignal
}

export type RewriteResult = {
  enabled: boolean
  content?: string[]
  usage?: {
    inputTokens: number | null
    outputTokens: number | null
  }
  error?: string
}

export type StreamRewriteRequest = {
  systemPrompt: string
  userPrompt: string
  temperature?: number
  requestOptions?: Partial<{
    temperature: number
    top_p: number
    frequency_penalty: number
    presence_penalty: number
    max_tokens: number
  }>
  presetCompat?: unknown
  signal?: AbortSignal
}

export type StreamRewriteResult = {
  enabled: boolean
  stream?: ReadableStream<Uint8Array>
  error?: string
}

type OpenAICompatibleChatMessage = {
  role: 'system' | 'user'
  content: string
}

type OpenAICompatibleChatCompletionResponse = {
  choices?: Array<{
    text?: unknown
    message?: {
      content?: unknown
    }
    delta?: {
      content?: unknown
    }
  }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    input_tokens?: unknown
    output_tokens?: unknown
  }
}

function normalizeTokenCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
}

function extractUsage(usage: OpenAICompatibleChatCompletionResponse['usage']) {
  if (!usage) return { inputTokens: null, outputTokens: null }
  return {
    inputTokens: normalizeTokenCount(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: normalizeTokenCount(usage.output_tokens ?? usage.completion_tokens),
  }
}

export type OpenAICompatibleExtractionResult = {
  enabled: boolean
  extraction?: ChapterKnowledgeExtraction
  model?: string
  error?: string
}

export type OpenAICompatibleModelOption = {
  id: string
  label: string
  ownedBy?: string
}

type OpenAICompatibleModelsResponse = {
  data?: unknown
}

type OpenAICompatibleEmbeddingsResponse = {
  data?: Array<{
    embedding?: unknown
  }>
  model?: string
}

export type OpenAICompatibleEmbeddingResult = {
  enabled: boolean
  embeddings?: number[][]
  model?: string
  error?: string
}

export function normalizeOpenAICompatibleBaseUrl(input: string) {
  const trimmed = input.trim().replace(/\/$/, '')
  if (!trimmed) {
    return ''
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Invalid OpenAI-compatible Base URL')
  }

  if (url.username || url.password) {
    throw new Error('Base URL must not include credentials')
  }

  if (url.search || url.hash) {
    throw new Error('Base URL must not include query or hash segments')
  }

  const protocol = url.protocol.toLowerCase()
  if (protocol === 'http:' || protocol === 'https:') {
    return trimmed
  }

  throw new Error('OpenAI-compatible Base URL must use HTTP or HTTPS')
}

function getConfig(
  scenario: AIScenarioKey,
  override?: Partial<OpenAICompatibleProviderSettings>
) {
  const stored = loadStoredAISettings()[scenario].openAICompatible
  const rawBaseUrl = (override?.baseUrl?.trim() || stored.baseUrl || '').trim()
  const apiKey = (override?.apiKey?.trim() || stored.apiKey || '').trim()
  const model = (override?.model?.trim() || stored.model || '').trim()
  let baseUrl = ''

  try {
    baseUrl = normalizeOpenAICompatibleBaseUrl(rawBaseUrl)
  } catch {
    baseUrl = ''
  }

  return {
    baseUrl,
    apiKey,
    model,
    enabled: Boolean(baseUrl && apiKey && model),
  }
}

function normalizeOpenAICompatibleModelItem(item: unknown): OpenAICompatibleModelOption | null {
  if (!item || typeof item !== 'object') return null

  const record = item as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (!id) return null

  const ownedBy = typeof record.owned_by === 'string'
    ? record.owned_by.trim()
    : typeof record.ownedBy === 'string'
      ? record.ownedBy.trim()
      : ''

  return {
    id,
    label: ownedBy ? `${id} · ${ownedBy}` : id,
    ownedBy: ownedBy || undefined,
  }
}

export async function listAvailableOpenAICompatibleModels(
  baseUrlOverride?: string,
  apiKeyOverride?: string,
  scenario: AIScenarioKey = 'rewrite',
  inputSignal?: AbortSignal,
): Promise<{ baseUrl: string; models: OpenAICompatibleModelOption[] }> {
  return withProviderModelDiscoveryDeadline(async (signal) => {
    const stored = getConfig(scenario)
    const rawBaseUrl = baseUrlOverride?.trim() || stored.baseUrl
    if (!rawBaseUrl) {
      return { baseUrl: '', models: [] }
    }

    const baseUrl = normalizeOpenAICompatibleBaseUrl(rawBaseUrl)
    const apiKey = apiKeyOverride?.trim() || stored.apiKey

    const headers: HeadersInit = {}
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await fetch(`${baseUrl}/models`, {
      cache: 'no-store',
      headers,
      signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = await response.json() as OpenAICompatibleModelsResponse
    const rawItems = Array.isArray(data.data) ? data.data : []
    const models = rawItems
      .map(normalizeOpenAICompatibleModelItem)
      .filter((item): item is OpenAICompatibleModelOption => Boolean(item))
      .sort((left, right) => left.id.localeCompare(right.id))

    return { baseUrl, models }
  }, inputSignal)
}

function collectChatCompletionText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        return collectChatCompletionText(item)
      })
      .join('')
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>
    const text = collectChatCompletionText(record.text)
    if (text) return text

    const outputText = collectChatCompletionText(record.output_text)
    if (outputText) return outputText

    return collectChatCompletionText(record.content)
  }

  return ''
}

function extractChatCompletionText(content: unknown) {
  return collectChatCompletionText(content).trim()
}

function extractChatCompletionChoiceText(choice: unknown) {
  if (!choice || typeof choice !== 'object') return ''

  const record = choice as Record<string, unknown>
  const delta = record.delta && typeof record.delta === 'object' ? record.delta as Record<string, unknown> : null
  const message = record.message && typeof record.message === 'object' ? record.message as Record<string, unknown> : null

  return [
    collectChatCompletionText(delta?.content),
    collectChatCompletionText(message?.content),
    collectChatCompletionText(record.text),
    collectChatCompletionText(record.output_text),
    collectChatCompletionText(record.content),
  ].find(Boolean) ?? ''
}

function extractChatCompletionResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''

  const record = payload as Record<string, unknown>
  if (Array.isArray(record.choices)) {
    const text = record.choices.map(extractChatCompletionChoiceText).join('')
    if (text) return text
  }

  const delta = record.delta && typeof record.delta === 'object' ? record.delta as Record<string, unknown> : null
  const message = record.message && typeof record.message === 'object' ? record.message as Record<string, unknown> : null

  return [
    collectChatCompletionText(record.delta),
    collectChatCompletionText(delta?.content),
    collectChatCompletionText(message?.content),
    collectChatCompletionText(record.text),
    collectChatCompletionText(record.output_text),
    collectChatCompletionText(record.content),
  ].find(Boolean) ?? ''
}

function extractStreamPayloadText(payload: string) {
  const trimmed = payload.trim()
  if (!trimmed || trimmed === '[DONE]') return ''

  const parsed = safeParseJson(trimmed)
  if (parsed !== null) {
    throwIfProviderError(parsed)
    return extractChatCompletionResponseText(parsed)
  }

  return trimmed.startsWith('{')
    || trimmed.startsWith('[')
    || trimmed.startsWith('}')
    || trimmed.startsWith(']')
    || trimmed.startsWith('"')
    || trimmed.startsWith(',')
    ? ''
    : trimmed
}

async function requestOpenAICompatibleChat(params: {
  baseUrl: string
  apiKey: string
  model: string
  messages: OpenAICompatibleChatMessage[]
  timeoutMs: number
  temperature?: number
  responseFormat?: Record<string, unknown>
  debug?: Pick<LlmDebugLogParams, 'folder' | 'stage' | 'attempt'>
}) {
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  const requestBody = {
    model: params.model,
    temperature: params.temperature ?? 0,
    response_format: params.responseFormat,
    messages: params.messages,
  }
  const request = { url, body: requestBody, messages: params.messages }

  const { response, cleanup } = await requestProviderEndpoint({
    provider: 'openai-compatible',
    action: 'OpenAI-compatible request',
    url,
    model: params.model,
    requestBody,
    requestInit: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    },
    timeoutMs: params.timeoutMs,
    streamed: false,
    debug: params.debug,
    requestMessages: params.messages,
  })

  try {
    const { data } = await parseProviderJsonResponse<OpenAICompatibleChatCompletionResponse>({
      provider: 'openai-compatible',
      model: params.model,
      response,
      streamed: false,
      request,
      debug: params.debug,
      invalidJsonMessage: 'OpenAI-compatible provider returned malformed JSON.',
      emptyBodyMessage: 'OpenAI-compatible provider returned an empty response body.',
    })
    return data
  } finally {
    cleanup()
  }
}

export async function extractChapterKnowledgeWithOpenAICompatible(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
  storyStateText?: string
  mode?: KnowledgeExtractionPromptMode
}, configOverride?: Partial<OpenAICompatibleProviderSettings>): Promise<OpenAICompatibleExtractionResult> {
  const config = getConfig('knowledgeExtraction', configOverride)
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const mode = params.mode ?? 'full'
  const prompt = buildKnowledgeExtractionPrompt(
    params.chapterTitle,
    params.chapterNo,
    params.rawText,
    mode,
    params.storyStateText,
  )
  const timeoutMs = 120000
  let lastError = 'Failed to parse OpenAI-compatible JSON'
  let lastContent = ''

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await requestOpenAICompatibleChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs,
        responseFormat: { type: 'json_object' },
        debug: {
          folder: 'knowledge-extraction',
          stage: attempt === 0 ? 'extract' : 'repair',
          attempt,
        },
        messages: attempt === 0
          ? [
              {
                role: 'system',
                content: 'Return exactly one valid JSON object for chapter knowledge. Never return a top-level array. Never output markdown or commentary.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ]
          : [
              {
                role: 'system',
                content: 'Repair malformed JSON into exactly one valid JSON object for chapter knowledge. Never return a top-level array. Do not add commentary or markdown.',
              },
              {
                role: 'user',
                content: [
                  '下面是一段模型生成的无效 JSON，请只修复 JSON 结构与字段组织。',
                  '请只返回与当前请求格式完全匹配的 JSON 对象。',
                  '不要补充原文中不存在的事实，不要输出解释。',
                  `解析错误：${lastError}`,
                  '无效 JSON：',
                  lastContent,
                ].join('\n\n'),
              },
            ],
      })

      const content = extractChatCompletionResponseText(response)
      lastContent = content
      if (!content) {
        lastError = 'OpenAI-compatible API returned empty content'
        continue
      }

      const parsedCandidates = parseKnowledgeExtractionCandidates(content)
      for (const parsed of parsedCandidates) {
        const extraction = normalizeKnowledgeExtraction(parsed, params.chapterNo)
        if (hasUsableKnowledgeExtraction(extraction, mode)) {
          return {
            enabled: true,
            model: config.model,
            extraction,
          }
        }
      }

      lastError = 'OpenAI-compatible API returned parseable JSON but no usable knowledge'
      if (attempt === 0) {
        continue
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'OpenAI-compatible extraction failed'
    }
  }

  return {
    enabled: true,
    model: config.model,
    error: lastError,
  }
}

export async function generateRewriteWithOpenAICompatible(
  input: RewriteRequest,
  configOverride?: Partial<OpenAICompatibleProviderSettings>
): Promise<RewriteResult> {
  const config = getConfig('rewrite', configOverride)
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const prompts = resolveRewriteProviderPrompts(input)

  const timeoutMs = NON_STREAM_PROVIDER_TIMEOUT_MS
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const messages: OpenAICompatibleChatMessage[] = [
    {
      role: 'system',
      content: prompts.systemPrompt,
    },
    { role: 'user', content: prompts.userPrompt },
  ]
  const requestBody = {
    model: config.model,
    temperature: input.requestOptions?.temperature ?? (input.tone === 'keep' ? 0.7 : 0.9),
    ...(typeof input.requestOptions?.top_p === 'number' ? { top_p: input.requestOptions.top_p } : {}),
    ...(typeof input.requestOptions?.frequency_penalty === 'number' ? { frequency_penalty: input.requestOptions.frequency_penalty } : {}),
    ...(typeof input.requestOptions?.presence_penalty === 'number' ? { presence_penalty: input.requestOptions.presence_penalty } : {}),
    ...(typeof input.requestOptions?.max_tokens === 'number' ? { max_tokens: input.requestOptions.max_tokens } : {}),
    response_format: { type: 'json_object' },
    messages,
  }
  const request = { url, body: requestBody, messages }

  try {
    const { response, cleanup } = await requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Provider request',
      url,
      model: config.model,
      requestBody,
      timeoutMs,
      streamed: false,
      debug: { folder: 'rewrite', stage: 'rewrite', presetCompat: input.presetCompat },
      inputSignal: input.signal,
      requestMessages: messages,
      requestInit: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      },
    })
    try {
      const { data } = await parseProviderJsonResponse<OpenAICompatibleChatCompletionResponse>({
        provider: 'openai-compatible',
        model: config.model,
        response,
        streamed: false,
        request,
        debug: { folder: 'rewrite', stage: 'rewrite', presetCompat: input.presetCompat },
        invalidJsonMessage: 'Provider returned malformed JSON.',
        emptyBodyMessage: 'Provider returned an empty response body.',
      })
      const raw = extractChatCompletionResponseText(data)
      const usage = extractUsage(data.usage)
      if (!raw) {
        await writeLlmDebugLog({
          folder: 'rewrite',
          provider: 'openai-compatible',
          model: config.model,
          streamed: false,
          stage: 'rewrite',
          presetCompat: input.presetCompat,
          request,
          response: { status: response.status, parsed: data, error: 'Provider returned empty content.' },
        })
        return { enabled: true, error: 'Provider returned empty content.' }
      }

      // RP uses its own blocks contract, validated by the script reader just as
      // for streaming responses; it is not a rewrite result/candidates envelope.
      if (input.outputFormat === 'roleplay-script') return { enabled: true, content: [raw], usage }
      const parsed = safeParseJson(raw)
      if (!parsed || typeof parsed !== 'object') {
        await writeLlmDebugLog({
          folder: 'rewrite',
          provider: 'openai-compatible',
          model: config.model,
          streamed: false,
          stage: 'rewrite',
          presetCompat: input.presetCompat,
          request,
          response: {
            status: response.status,
            rawText: extractChatCompletionText(raw),
            parsed: data,
            error: 'Provider returned malformed JSON.',
          },
        })
        return { enabled: true, error: 'Provider returned malformed JSON.' }
      }

      const candidateRecord = parsed as { result?: unknown; candidates?: unknown[] }
      const candidates = typeof candidateRecord.result === 'string'
        ? [candidateRecord.result].filter(Boolean)
        : Array.isArray(candidateRecord.candidates)
          ? candidateRecord.candidates.map((item: unknown) => String(item)).filter(Boolean).slice(0, 1)
          : []
      if (!candidates.length) {
        await writeLlmDebugLog({
          folder: 'rewrite',
          provider: 'openai-compatible',
          model: config.model,
          streamed: false,
          stage: 'rewrite',
          presetCompat: input.presetCompat,
          request,
          response: { status: response.status, rawText: extractChatCompletionText(raw), parsed, error: 'Provider returned empty content.' },
        })
        return { enabled: true, error: 'Provider returned empty content.' }
      }

      return { enabled: true, content: candidates, usage }
    } finally {
      cleanup()
    }
  } catch (error) {
    return {
      enabled: true,
      error: error instanceof Error ? error.message : 'Provider request failed',
    }
  }
}

export async function streamRewriteWithOpenAICompatible(
  input: StreamRewriteRequest,
  configOverride?: Partial<OpenAICompatibleProviderSettings>
): Promise<StreamRewriteResult> {
  const config = getConfig('rewrite', configOverride)
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const timeoutMs = STREAM_PROVIDER_IDLE_TIMEOUT_MS
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const messages: OpenAICompatibleChatMessage[] = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ]
  const requestBody = {
    model: config.model,
    temperature: input.requestOptions?.temperature ?? input.temperature ?? 0.7,
    ...(typeof input.requestOptions?.top_p === 'number' ? { top_p: input.requestOptions.top_p } : {}),
    ...(typeof input.requestOptions?.frequency_penalty === 'number' ? { frequency_penalty: input.requestOptions.frequency_penalty } : {}),
    ...(typeof input.requestOptions?.presence_penalty === 'number' ? { presence_penalty: input.requestOptions.presence_penalty } : {}),
    ...(typeof input.requestOptions?.max_tokens === 'number' ? { max_tokens: input.requestOptions.max_tokens } : {}),
    stream: true,
    messages,
  }
  const request = { url, body: requestBody, messages }

  try {
    const { response, cleanup } = await requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Provider request',
      url,
      model: config.model,
      requestBody,
      timeoutMs,
      streamed: true,
      debug: { folder: 'rewrite', stage: 'rewrite', presetCompat: input.presetCompat },
      inputSignal: input.signal,
      requestMessages: messages,
      noBodyMessage: 'Provider returned no response body.',
      requestInit: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      },
    })
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = ''
        let rawText = ''
        let upstreamText = ''

        const enqueueText = (text: string) => {
          if (!text) return
          rawText += text
          controller.enqueue(encoder.encode(text))
        }

        const consumePayload = (payload: string) => {
          enqueueText(extractStreamPayloadText(payload))
        }

        const consumeLine = (rawLine: string) => {
          const line = rawLine.trim()
          if (!line) return
          if (/^(?:event:|id:|retry:|:)/.test(line)) return

          if (line.startsWith('data:')) {
            consumePayload(line.slice(5).trim())
            return
          }

          consumePayload(line)
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            upstreamText += chunk
            buffer += chunk
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const rawLine of lines) {
              consumeLine(rawLine)
            }
          }

          const finalDecoderChunk = decoder.decode()
          upstreamText += finalDecoderChunk
          buffer += finalDecoderChunk
          if (buffer.trim()) consumeLine(buffer)
          if (!rawText && upstreamText.trim().startsWith('{')) consumePayload(upstreamText)
          if (!rawText) throw new Error('Provider returned empty content.')
        } catch (error) {
          await writeLlmDebugLog({
            folder: 'rewrite',
            provider: 'openai-compatible',
            model: config.model,
            streamed: true,
            stage: 'rewrite',
            presetCompat: input.presetCompat,
            request,
            response: {
              status: response.status,
              rawText,
              parsed: { upstreamText },
              error: error instanceof Error ? error.message : 'OpenAI-compatible stream failed',
              partial: true,
            },
          })
          controller.error(error)
          return
        } finally {
          await reader.cancel().catch(() => undefined)
          reader.releaseLock()
          cleanup()
        }

        await writeLlmDebugLog({
          folder: 'rewrite',
          provider: 'openai-compatible',
          model: config.model,
          streamed: true,
          stage: 'rewrite',
          presetCompat: input.presetCompat,
          request,
          response: { status: response.status, rawText, parsed: rawText ? undefined : { upstreamText } },
        })
        controller.close()
      },
    })

    return { enabled: true, stream }
  } catch (error) {
    return { enabled: true, error: error instanceof Error ? error.message : 'Provider request failed' }
  }
}

export async function embedTextsWithOpenAICompatible(
  input: string | string[],
  configOverride?: Partial<OpenAICompatibleProviderSettings>,
  options?: { inputType?: 'document' | 'query'; signal?: AbortSignal },
): Promise<OpenAICompatibleEmbeddingResult> {
  const config = getConfig('embeddings', configOverride)
  if (!config.enabled) {
    return { enabled: false, error: 'OpenAI-compatible config not set' }
  }

  const normalizedInput = (Array.isArray(input) ? input : [input])
    .map((item) => item.trim())
    .filter(Boolean)

  if (!normalizedInput.length) {
    return {
      enabled: true,
      embeddings: [],
      model: config.model,
    }
  }

  try {
    const localEmbedding = isRetaleLocalEmbeddingConfig(config.baseUrl, config.model)
    if (localEmbedding) {
      await ensureLocalEmbeddingRuntimeRunning()
    }
    const requestInput = localEmbedding && options?.inputType === 'query'
      ? normalizedInput.map((item) => buildLocalEmbeddingQuery(config.model, item))
      : normalizedInput
    const requestBody = {
      model: config.model,
      input: Array.isArray(input) ? requestInput : requestInput[0],
      encoding_format: 'float',
    }
    const { response, cleanup } = await requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'OpenAI-compatible embedding request',
      inputSignal: options?.signal,
      url: `${config.baseUrl.replace(/\/$/, '')}/embeddings`,
      model: config.model,
      requestBody,
      requestInit: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      },
      timeoutMs: NON_STREAM_PROVIDER_TIMEOUT_MS,
      streamed: false,
    })

    try {
      if (!response.ok) {
        return { enabled: true, model: config.model, error: `HTTP ${response.status}` }
      }

      const data = await response.json() as OpenAICompatibleEmbeddingsResponse
      const embeddings = Array.isArray(data.data)
        ? data.data
            .map((item) => (Array.isArray(item?.embedding) ? item.embedding : null))
            .filter((vector): vector is number[] => Array.isArray(vector) && vector.length > 0 && vector.every((value) => Number.isFinite(value)))
        : []

      if (!embeddings.length) {
        return {
          enabled: true,
          model: config.model,
          error: 'OpenAI-compatible embedding response did not contain usable vectors',
        }
      }

      return {
        enabled: true,
        embeddings,
        model: data.model ?? config.model,
      }
    } finally {
      cleanup()
    }
  } catch (error) {
    return {
      enabled: true,
      model: config.model,
      error: error instanceof Error ? error.message : 'Failed to generate embeddings with OpenAI-compatible API',
    }
  }
}

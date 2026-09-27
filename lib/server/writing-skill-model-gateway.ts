import type { z } from 'zod'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { safeParseJson } from '@/lib/server/json-parse'
import {
  NON_STREAM_PROVIDER_TIMEOUT_MS,
  ProviderRequestError,
  extractProviderErrorDetail,
  parseProviderJsonResponse,
  requestProviderEndpoint,
} from '@/lib/server/provider-request'
import { buildPlainJsonStructuredOutputInstruction } from '@/lib/server/writing-skill-prompts'
import type { AIScenarioKey } from '@/lib/types'
import type { ModelCapabilities } from '@/lib/writing-skill-defaults'

export type WritingSkillChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type StructuredGenerationResult<T> = {
  data: T
  usage: {
    inputTokens: number
    outputTokens: number
  }
}

export interface ModelGateway {
  getCapabilities(modelConfigId: string): Promise<ModelCapabilities>
  generateStructured<T>(options: {
    modelConfigId: string
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    runtimeSchema: z.ZodType<T>
    maxOutputTokens: number
    temperature?: number
    signal?: AbortSignal
    normalizeParsedOutput?: (value: unknown) => unknown
  }): Promise<StructuredGenerationResult<T>>
}

type ResolvedModelConfig = {
  scenario: 'knowledgeExtraction' | 'rewrite'
  provider: 'openai-compatible' | 'ollama'
  model: string
  baseUrl: string
  apiKey: string
}

type RawModelResponse = {
  content: string
  inputTokens: number
  outputTokens: number
}

function normalizeToken(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function enrichProviderRequestError(error: unknown, model: string) {
  if (!(error instanceof ProviderRequestError)) return error
  const detail = extractProviderErrorDetail(error.responseBody) || error.message
  const status = error.status ? `HTTP ${error.status}` : error.code
  error.message = `模型 ${model} 请求失败（${status}）${detail ? `：${detail}` : ''}`
  return error
}

function resolveScenario(modelConfigId: string): 'knowledgeExtraction' | 'rewrite' {
  const normalized = modelConfigId.trim() || 'knowledgeExtraction'
  if (normalized === 'knowledgeExtraction' || normalized.startsWith('knowledgeExtraction:')) {
    return 'knowledgeExtraction'
  }
  if (normalized === 'rewrite' || normalized.startsWith('rewrite:')) return 'rewrite'
  throw new Error('modelConfigId 必须引用 knowledgeExtraction 或 rewrite 模型配置')
}

export function resolveWritingSkillModelConfig(modelConfigId: string): ResolvedModelConfig {
  const scenario = resolveScenario(modelConfigId)
  const settings = loadStoredAISettings()[scenario]
  const provider = settings.provider
  const providerSettings = provider === 'openai-compatible'
    ? settings.openAICompatible
    : settings.ollama
  if (!providerSettings.configured || !providerSettings.baseUrl || !providerSettings.model) {
    throw new Error('当前写作技巧蒸馏模型尚未配置，请先在 AI 设置中配置对应模型')
  }
  return {
    scenario,
    provider,
    model: providerSettings.model,
    baseUrl: providerSettings.baseUrl,
    apiKey: provider === 'openai-compatible' ? settings.openAICompatible.apiKey : '',
  }
}

function inferContextWindow(model: string) {
  const configured = Number.parseInt(process.env.RETALE_WRITING_SKILL_CONTEXT_WINDOW ?? '', 10)
  const configuredWindow = Number.isFinite(configured) && configured >= 4096 ? configured : null
  const normalized = model.toLowerCase()
  if (configuredWindow !== null) return configuredWindow
  if (/deepseek.*(?:v?4).*flash/.test(normalized)) return 1_000_000
  if (/deepseek/.test(normalized)) return 96_000
  if (/gpt-4\.1|gpt-5|gemini-2\.5|gemini-3/.test(normalized)) return 1_000_000
  if (/gpt-oss/.test(normalized)) return 131_072
  if (/o3|o4|claude-3|claude-4|qwen3|qwen2\.5/.test(normalized)) return 200_000
  if (/gpt-4o|gpt-4-turbo|llama-3\.1|llama3\.1|mistral-large/.test(normalized)) return 128_000
  if (/32k|32768/.test(normalized)) return 32_768
  return 32_000
}

export function isWritingSkillContextLimitError(error: unknown) {
  if (!(error instanceof Error)) return false
  const providerBody = error instanceof ProviderRequestError ? error.responseBody ?? '' : ''
  const message = `${error.message}\n${providerBody}`.toLowerCase()
  const explicitlyMentionsContextLimit = [
    /context[_\s-]*(?:length|window)?[^\n]{0,100}(?:exceed|limit|maximum|too (?:large|long)|overflow)/,
    /(?:exceed|limit|maximum|too (?:large|long)|overflow)[^\n]{0,100}context/,
    /(?:prompt|input|request)(?: is)? too (?:large|long)/,
    /sequence(?: length)?[^\n]{0,100}(?:exceed|limit|maximum|too (?:large|long))/,
    /(?:maximum|max)[_\s-]*(?:sequence|input|prompt|token)[_\s-]*(?:length|count)/,
    /(?:token|prompt|input)[^\n]{0,100}(?:budget|limit)[^\n]{0,100}(?:exceed|overflow)/,
    /(?:超出|超过)[^\n]{0,80}(?:上下文|长度|token|令牌|输入)/,
    /(?:上下文|输入|提示词|token|令牌)[^\n]{0,80}(?:过长|过大|超限|上限)/,
  ].some((pattern) => pattern.test(message))
  if (error instanceof ProviderRequestError) {
    return error.code === 'http'
      && [400, 413, 422].includes(error.status ?? 0)
      && explicitlyMentionsContextLimit
  }
  return explicitlyMentionsContextLimit
}

function inferMaxOutputTokens(model: string) {
  const configured = Number.parseInt(process.env.RETALE_WRITING_SKILL_MAX_OUTPUT_TOKENS ?? '', 10)
  if (Number.isFinite(configured) && configured >= 1024) return configured
  return /gpt-5|gpt-4\.1|o3|o4|claude-4|qwen3/i.test(model) ? 16_384 : 8_192
}

function inferStructuredOutput(provider: ResolvedModelConfig['provider'], model: string) {
  if (provider === 'ollama') return true
  return /^(gpt-|o\d|chatgpt-|claude-|gemini-|qwen)/i.test(model.trim())
}

export function inferWritingSkillModelCapabilities(config: Pick<ResolvedModelConfig, 'provider' | 'model'>): ModelCapabilities {
  return {
    contextWindow: inferContextWindow(config.model),
    maxOutputTokens: inferMaxOutputTokens(config.model),
    supportsStructuredOutput: inferStructuredOutput(config.provider, config.model),
    supportsToolCalling: false,
  }
}

export function getWritingSkillModelSummary(modelConfigId = getDefaultWritingSkillModelConfigId()) {
  const config = resolveWritingSkillModelConfig(modelConfigId)
  return {
    modelConfigId,
    provider: config.provider,
    model: config.model,
  }
}

function extractOpenAIContent(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices.length) return ''
  const choice = choices[0]
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return ''
  const message = (choice as { message?: unknown }).message
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    const content = (message as { content?: unknown }).content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const text = (item as { text?: unknown }).text
        return typeof text === 'string' ? [text] : []
      }).join('')
    }
  }
  const text = (choice as { text?: unknown }).text
  return typeof text === 'string' ? text : ''
}

function extractOpenAIUsage(data: unknown) {
  const usage = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { usage?: unknown }).usage
    : null
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return { inputTokens: 0, outputTokens: 0 }
  const record = usage as Record<string, unknown>
  return {
    inputTokens: normalizeToken(record.input_tokens ?? record.prompt_tokens),
    outputTokens: normalizeToken(record.output_tokens ?? record.completion_tokens),
  }
}

function extractOllamaContent(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const message = (data as { message?: unknown }).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}

function parseJsonContent(content: string) {
  const trimmed = content.trim()
  const direct = safeParseJson(trimmed)
  if (direct !== null) return direct
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) {
    const parsed = safeParseJson(fenced)
    if (parsed !== null) return parsed
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return safeParseJson(trimmed.slice(start, end + 1))
  return null
}

function formatSchemaIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ')
}

export class ConfiguredWritingSkillModelGateway implements ModelGateway {
  async getCapabilities(modelConfigId: string) {
    return inferWritingSkillModelCapabilities(resolveWritingSkillModelConfig(modelConfigId))
  }

  private async requestOpenAICompatible(input: {
    config: ResolvedModelConfig
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    maxOutputTokens: number
    temperature: number
    structured: boolean
    signal?: AbortSignal
    attempt: number
  }): Promise<RawModelResponse> {
    const url = `${input.config.baseUrl.replace(/\/$/, '')}/chat/completions`
    const requestBody = {
      model: input.config.model,
      temperature: input.temperature,
      ...(input.maxOutputTokens > 0 ? { max_tokens: input.maxOutputTokens } : {}),
      messages: input.messages,
      ...(input.structured ? {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: input.schemaName,
            strict: true,
            schema: input.schema,
          },
        },
      } : {}),
    }
    const { response, cleanup } = await requestProviderEndpoint({
      provider: 'openai-compatible',
      action: 'Writing skill structured generation',
      url,
      model: input.config.model,
      requestBody,
      timeoutMs: NON_STREAM_PROVIDER_TIMEOUT_MS,
      streamed: false,
      debug: { folder: 'writing-skill-distillation', stage: input.schemaName, attempt: input.attempt },
      inputSignal: input.signal,
      requestMessages: input.messages,
      requestInit: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(input.config.apiKey ? { Authorization: `Bearer ${input.config.apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody),
      },
    })
    try {
      const { data } = await parseProviderJsonResponse<unknown>({
        provider: 'openai-compatible',
        model: input.config.model,
        response,
        streamed: false,
        request: { url, body: requestBody, messages: input.messages },
        debug: { folder: 'writing-skill-distillation', stage: input.schemaName, attempt: input.attempt },
        invalidJsonMessage: '模型返回了无法解析的响应',
      })
      return { content: extractOpenAIContent(data), ...extractOpenAIUsage(data) }
    } finally {
      cleanup()
    }
  }

  private async requestOllama(input: {
    config: ResolvedModelConfig
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    maxOutputTokens: number
    temperature: number
    structured: boolean
    signal?: AbortSignal
    attempt: number
  }): Promise<RawModelResponse> {
    const url = `${input.config.baseUrl.replace(/\/$/, '')}/api/chat`
    const requestBody = {
      model: input.config.model,
      stream: false,
      think: false,
      messages: input.messages,
      ...(input.structured ? { format: input.schema } : { format: 'json' }),
      options: {
        temperature: input.temperature,
        ...(input.maxOutputTokens > 0 ? { num_predict: input.maxOutputTokens } : {}),
      },
    }
    const { response, cleanup } = await requestProviderEndpoint({
      provider: 'ollama',
      action: 'Writing skill structured generation',
      url,
      model: input.config.model,
      requestBody,
      timeoutMs: NON_STREAM_PROVIDER_TIMEOUT_MS,
      streamed: false,
      debug: { folder: 'writing-skill-distillation', stage: input.schemaName, attempt: input.attempt },
      inputSignal: input.signal,
      requestMessages: input.messages,
      requestInit: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    })
    try {
      const { data } = await parseProviderJsonResponse<unknown>({
        provider: 'ollama',
        model: input.config.model,
        response,
        streamed: false,
        request: { url, body: requestBody, messages: input.messages },
        debug: { folder: 'writing-skill-distillation', stage: input.schemaName, attempt: input.attempt },
        invalidJsonMessage: '本地模型返回了无法解析的响应',
      })
      const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
      return {
        content: extractOllamaContent(data),
        inputTokens: normalizeToken(record.prompt_eval_count),
        outputTokens: normalizeToken(record.eval_count),
      }
    } finally {
      cleanup()
    }
  }

  private async requestRaw(input: {
    config: ResolvedModelConfig
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    maxOutputTokens: number
    temperature: number
    structured: boolean
    signal?: AbortSignal
    attempt: number
  }) {
    try {
      return await (input.config.provider === 'openai-compatible'
        ? this.requestOpenAICompatible(input)
        : this.requestOllama(input))
    } catch (error) {
      throw enrichProviderRequestError(error, input.config.model)
    }
  }

  async generateStructured<T>(options: {
    modelConfigId: string
    messages: WritingSkillChatMessage[]
    schemaName: string
    schema: Record<string, unknown>
    runtimeSchema: z.ZodType<T>
    maxOutputTokens: number
    temperature?: number
    signal?: AbortSignal
    normalizeParsedOutput?: (value: unknown) => unknown
  }): Promise<StructuredGenerationResult<T>> {
    const config = resolveWritingSkillModelConfig(options.modelConfigId)
    const capabilities = inferWritingSkillModelCapabilities(config)
    const temperature = options.temperature ?? 0
    let useStructuredOutput = capabilities.supportsStructuredOutput
    const buildPlainMessages = () => options.messages.map((message, index) => index === 0
      ? { ...message, content: `${message.content}\n\n${buildPlainJsonStructuredOutputInstruction(options.schema)}` }
      : message)
    let requestMessages = useStructuredOutput ? options.messages : buildPlainMessages()

    let first: RawModelResponse
    try {
      first = await this.requestRaw({
        config,
        messages: requestMessages,
        schemaName: options.schemaName,
        schema: options.schema,
        maxOutputTokens: Math.min(options.maxOutputTokens, capabilities.maxOutputTokens),
        temperature,
        structured: useStructuredOutput,
        signal: options.signal,
        attempt: 1,
      })
    } catch (error) {
      const structuredUnsupported = useStructuredOutput
        && error instanceof ProviderRequestError
        && error.code === 'http'
        && (error.status === 400 || error.status === 404 || error.status === 422)
        && !isWritingSkillContextLimitError(error)
      if (!structuredUnsupported) throw error
      useStructuredOutput = false
      requestMessages = buildPlainMessages()
      first = await this.requestRaw({
        config,
        messages: requestMessages,
        schemaName: options.schemaName,
        schema: options.schema,
        maxOutputTokens: Math.min(options.maxOutputTokens, capabilities.maxOutputTokens),
        temperature,
        structured: false,
        signal: options.signal,
        attempt: 1,
      })
    }

    const parsed = parseJsonContent(first.content)
    const normalizedParsed = options.normalizeParsedOutput
      ? options.normalizeParsedOutput(parsed)
      : parsed
    const validated = options.runtimeSchema.safeParse(normalizedParsed)
    if (validated.success) {
      return {
        data: validated.data,
        usage: { inputTokens: first.inputTokens, outputTokens: first.outputTokens },
      }
    }

    const repairMessages: WritingSkillChatMessage[] = [
      ...requestMessages,
      {
        role: 'user',
        content: [
          '上一次输出未通过 JSON 结构验证。',
          '请重新从本对话最初提供的原始任务与原始素材生成完整结果。',
          '不得把上一次 AI 输出作为提炼对象，也不得沿用其中没有原文证据支持的内容。',
          '只返回完整、合法、符合 Schema 的 JSON 对象，不要输出解释或 Markdown。',
          `验证错误：${formatSchemaIssues(validated.error)}`,
        ].join('\n\n'),
      },
    ]
    const repaired = await this.requestRaw({
      config,
      messages: repairMessages,
      schemaName: options.schemaName,
      schema: options.schema,
      maxOutputTokens: Math.min(options.maxOutputTokens, capabilities.maxOutputTokens),
      temperature: 0,
      structured: useStructuredOutput,
      signal: options.signal,
      attempt: 2,
    })
    const repairedParsed = parseJsonContent(repaired.content)
    const normalizedRepairedParsed = options.normalizeParsedOutput
      ? options.normalizeParsedOutput(repairedParsed)
      : repairedParsed
    const repairedValidated = options.runtimeSchema.safeParse(normalizedRepairedParsed)
    if (!repairedValidated.success) {
      throw new Error(`模型结构化输出修复失败：${formatSchemaIssues(repairedValidated.error)}`)
    }
    return {
      data: repairedValidated.data,
      usage: {
        inputTokens: first.inputTokens + repaired.inputTokens,
        outputTokens: first.outputTokens + repaired.outputTokens,
      },
    }
  }
}

export function getDefaultWritingSkillModelConfigId(scenario: AIScenarioKey = 'rewrite') {
  return scenario === 'rewrite' ? 'rewrite' : 'knowledgeExtraction'
}

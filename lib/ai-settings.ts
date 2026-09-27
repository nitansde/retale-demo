import type {
  AIProvider,
  AISettings,
  AIScenarioKey,
  AIScenarioSettings,
  EmbeddingsScenarioSettings,
  KnowledgeExtractionOpenAICompatibleProviderSettings,
  KnowledgeExtractionOllamaProviderSettings,
  KnowledgeExtractionScenarioSettings,
  OllamaProviderSettings,
  OpenAICompatibleProviderSettings,
} from '@/lib/types'

type PartialAISettings = Partial<{
  rewrite: unknown
  knowledgeExtraction: unknown
  embeddings: unknown
}>

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini'
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_OPENAI_EXTRACTION_PARALLELISM = 5
const DEFAULT_OLLAMA_EXTRACTION_PARALLELISM = 1
const MAX_KNOWLEDGE_EXTRACTION_PARALLELISM = 20
const DEFAULT_EMBEDDING_BATCH_SIZE = 16
const MAX_EMBEDDING_BATCH_SIZE = 128

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function normalizeProvider(value: unknown, fallback: AIProvider): AIProvider {
  return value === 'openai-compatible' || value === 'ollama' ? value : fallback
}

function normalizeParallelism(value: unknown, fallback: number) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(1, Math.min(MAX_KNOWLEDGE_EXTRACTION_PARALLELISM, Math.floor(parsed)))
}

function normalizeEmbeddingBatchSize(value: unknown, fallback: number) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(1, Math.min(MAX_EMBEDDING_BATCH_SIZE, Math.floor(parsed)))
}

export function maskApiKey(apiKey: string) {
  if (!apiKey) {
    return ''
  }

  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}***`
  }

  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`
}

function createDefaultOpenAICompatibleProviderSettings(): OpenAICompatibleProviderSettings {
  return {
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: '',
    apiKeyConfigured: false,
    apiKeyMasked: '',
    model: DEFAULT_OPENAI_MODEL,
    configured: false,
  }
}

function createDefaultOllamaProviderSettings(): OllamaProviderSettings {
  return {
    baseUrl: DEFAULT_OLLAMA_BASE_URL,
    model: '',
    configured: false,
  }
}

function createDefaultKnowledgeExtractionOpenAICompatibleProviderSettings(): KnowledgeExtractionOpenAICompatibleProviderSettings {
  return {
    ...createDefaultOpenAICompatibleProviderSettings(),
    parallelism: DEFAULT_OPENAI_EXTRACTION_PARALLELISM,
  }
}

function createDefaultKnowledgeExtractionOllamaProviderSettings(): KnowledgeExtractionOllamaProviderSettings {
  return {
    ...createDefaultOllamaProviderSettings(),
    parallelism: DEFAULT_OLLAMA_EXTRACTION_PARALLELISM,
  }
}

function createDefaultEmbeddingsScenarioSettings(): EmbeddingsScenarioSettings {
  return {
    provider: 'ollama',
    openAICompatible: {
      ...createDefaultOpenAICompatibleProviderSettings(),
      model: DEFAULT_OPENAI_EMBEDDING_MODEL,
    },
    ollama: createDefaultOllamaProviderSettings(),
    embeddingBatchSize: DEFAULT_EMBEDDING_BATCH_SIZE,
  }
}

export function createDefaultAISettings(): AISettings {
  return {
    rewrite: {
      provider: 'openai-compatible',
      openAICompatible: createDefaultOpenAICompatibleProviderSettings(),
      ollama: createDefaultOllamaProviderSettings(),
    },
    knowledgeExtraction: {
      provider: 'ollama',
      openAICompatible: createDefaultKnowledgeExtractionOpenAICompatibleProviderSettings(),
      ollama: createDefaultKnowledgeExtractionOllamaProviderSettings(),
    },
    embeddings: createDefaultEmbeddingsScenarioSettings(),
  }
}

function normalizeOpenAICompatibleProviderSettings(
  value: unknown,
  fallback: OpenAICompatibleProviderSettings
): OpenAICompatibleProviderSettings {
  const record = isRecord(value) ? value : {}
  const baseUrl = normalizeText(record.baseUrl) || fallback.baseUrl
  const apiKey = normalizeText(record.apiKey)
  const apiKeyConfigured = normalizeBoolean(record.apiKeyConfigured) ?? Boolean(apiKey || fallback.apiKey || fallback.apiKeyConfigured)
  const apiKeyMasked = normalizeText(record.apiKeyMasked) || (apiKey ? maskApiKey(apiKey) : fallback.apiKeyMasked ?? '')
  const model = normalizeText(record.model) || fallback.model
  const configured = normalizeBoolean(record.configured) ?? Boolean(baseUrl && model && (apiKey || apiKeyConfigured))

  return {
    baseUrl,
    apiKey,
    apiKeyConfigured,
    apiKeyMasked,
    model,
    configured,
  }
}

function normalizeOllamaProviderSettings(
  value: unknown,
  fallback: OllamaProviderSettings
): OllamaProviderSettings {
  const record = isRecord(value) ? value : {}
  const baseUrl = normalizeText(record.baseUrl) || fallback.baseUrl
  const model = normalizeText(record.model)
  const configured = normalizeBoolean(record.configured) ?? Boolean(baseUrl && model)

  return {
    baseUrl,
    model,
    configured,
  }
}

function normalizeKnowledgeExtractionOpenAICompatibleProviderSettings(
  value: unknown,
  fallback: KnowledgeExtractionOpenAICompatibleProviderSettings
): KnowledgeExtractionOpenAICompatibleProviderSettings {
  const record = isRecord(value) ? value : {}
  const base = normalizeOpenAICompatibleProviderSettings(value, fallback)

  return {
    ...base,
    parallelism: normalizeParallelism(record.parallelism, fallback.parallelism),
  }
}

function normalizeKnowledgeExtractionOllamaProviderSettings(
  value: unknown,
  fallback: KnowledgeExtractionOllamaProviderSettings
): KnowledgeExtractionOllamaProviderSettings {
  const record = isRecord(value) ? value : {}
  const base = normalizeOllamaProviderSettings(value, fallback)

  return {
    ...base,
    parallelism: normalizeParallelism(record.parallelism, fallback.parallelism),
  }
}

function normalizeKnowledgeExtractionScenarioSettings(
  value: unknown,
  fallback: KnowledgeExtractionScenarioSettings,
): KnowledgeExtractionScenarioSettings {
  const record = isRecord(value) ? value : {}

  return {
    provider: normalizeProvider(record.provider, fallback.provider),
    openAICompatible: normalizeKnowledgeExtractionOpenAICompatibleProviderSettings(
      record.openAICompatible,
      fallback.openAICompatible
    ),
    ollama: normalizeKnowledgeExtractionOllamaProviderSettings(
      record.ollama,
      fallback.ollama
    ),
  }
}

function normalizeScenarioSettings(
  value: unknown,
  fallback: AIScenarioSettings,
): AIScenarioSettings {
  const record = isRecord(value) ? value : {}

  return {
    provider: normalizeProvider(record.provider, fallback.provider),
    openAICompatible: normalizeOpenAICompatibleProviderSettings(
      record.openAICompatible,
      fallback.openAICompatible
    ),
    ollama: normalizeOllamaProviderSettings(record.ollama, fallback.ollama),
  }
}

function normalizeEmbeddingsScenarioSettings(
  value: unknown,
  fallback: EmbeddingsScenarioSettings,
): EmbeddingsScenarioSettings {
  const record = isRecord(value) ? value : {}
  const base = normalizeScenarioSettings(value, fallback)

  return {
    ...base,
    embeddingBatchSize: normalizeEmbeddingBatchSize(record.embeddingBatchSize, fallback.embeddingBatchSize),
  }
}

export function normalizeAISettings(value?: unknown): AISettings {
  const defaults = createDefaultAISettings()
  if (!isRecord(value)) {
    return defaults
  }

  const partial = value as PartialAISettings

  return {
    rewrite: normalizeScenarioSettings(partial.rewrite, defaults.rewrite),
    knowledgeExtraction: normalizeKnowledgeExtractionScenarioSettings(
      partial.knowledgeExtraction,
      defaults.knowledgeExtraction,
    ),
    embeddings: normalizeEmbeddingsScenarioSettings(partial.embeddings, defaults.embeddings),
  }
}

export function isAIScenarioConfigured(settings: AIScenarioSettings): boolean {
  if (settings.provider === 'ollama') {
    const { configured, baseUrl, model } = settings.ollama
    return Boolean(configured && baseUrl.trim() && model.trim())
  }

  const { configured, baseUrl, model, apiKey, apiKeyConfigured } = settings.openAICompatible
  return Boolean(configured && baseUrl.trim() && model.trim() && (apiKey.trim() || apiKeyConfigured))
}

export function sanitizeAISettingsForClient(settings: AISettings): AISettings {
  const normalized = normalizeAISettings(settings)

  const sanitizeScenario = (scenario: AIScenarioKey) => {
    const current = normalized[scenario]
    return {
      ...current,
      openAICompatible: {
        ...current.openAICompatible,
        apiKey: '',
        apiKeyConfigured: Boolean(current.openAICompatible.apiKeyConfigured || current.openAICompatible.apiKey),
        apiKeyMasked: current.openAICompatible.apiKey
          ? maskApiKey(current.openAICompatible.apiKey)
          : current.openAICompatible.apiKeyMasked ?? '',
        configured: Boolean(
          current.openAICompatible.baseUrl &&
          current.openAICompatible.model &&
          (current.openAICompatible.apiKey || current.openAICompatible.apiKeyConfigured)
        ),
      },
    }
  }

  const sanitizedKnowledgeExtraction: KnowledgeExtractionScenarioSettings = {
    ...normalized.knowledgeExtraction,
    openAICompatible: {
      ...normalized.knowledgeExtraction.openAICompatible,
      apiKey: '',
      apiKeyConfigured: Boolean(
        normalized.knowledgeExtraction.openAICompatible.apiKeyConfigured
        || normalized.knowledgeExtraction.openAICompatible.apiKey
      ),
      apiKeyMasked: normalized.knowledgeExtraction.openAICompatible.apiKey
        ? maskApiKey(normalized.knowledgeExtraction.openAICompatible.apiKey)
        : normalized.knowledgeExtraction.openAICompatible.apiKeyMasked ?? '',
      configured: Boolean(
        normalized.knowledgeExtraction.openAICompatible.baseUrl
        && normalized.knowledgeExtraction.openAICompatible.model
        && (
          normalized.knowledgeExtraction.openAICompatible.apiKey
          || normalized.knowledgeExtraction.openAICompatible.apiKeyConfigured
        )
      ),
    },
  }

  const sanitizedEmbeddings: EmbeddingsScenarioSettings = {
    ...(sanitizeScenario('embeddings') as EmbeddingsScenarioSettings),
    embeddingBatchSize: normalized.embeddings.embeddingBatchSize,
  }

  return {
    rewrite: sanitizeScenario('rewrite'),
    knowledgeExtraction: sanitizedKnowledgeExtraction,
    embeddings: sanitizedEmbeddings,
  }
}

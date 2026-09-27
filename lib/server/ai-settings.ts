import { DEFAULT_OPENAI_EMBEDDING_MODEL, normalizeAISettings } from '@/lib/ai-settings'
import type { AISettings } from '@/lib/types'
import { safeParseJson } from '@/lib/server/json-parse'
import { findAppSettings, upsertAppSettings } from '@/lib/server/persistence'

export const AI_SETTINGS_V2_KEY = 'AI_SETTINGS_V2'
export const OLLAMA_TIMEOUT_MS_KEY = 'OLLAMA_TIMEOUT_MS'

function parseStoredSettingsBlob(value: string | null | undefined) {
  return safeParseJson(value)
}

function isPositiveIntegerString(value: string) {
  return /^[1-9]\d*$/.test(value.trim())
}

export type ProtectedAISettingsResetSnapshot = {
  aiSettingsV2: string | null
  ollamaTimeoutMs: string | null
}

export function loadProtectedAISettingsResetSnapshot(): ProtectedAISettingsResetSnapshot {
  const entries = findAppSettings([AI_SETTINGS_V2_KEY, OLLAMA_TIMEOUT_MS_KEY])
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value])) as Partial<Record<typeof AI_SETTINGS_V2_KEY | typeof OLLAMA_TIMEOUT_MS_KEY, string>>
  return {
    aiSettingsV2: map.AI_SETTINGS_V2 ?? null,
    ollamaTimeoutMs: map.OLLAMA_TIMEOUT_MS ?? null,
  }
}

export function validateProtectedAISettingsResetSnapshot(snapshot: ProtectedAISettingsResetSnapshot) {
  if (snapshot.aiSettingsV2 !== null && parseStoredSettingsBlob(snapshot.aiSettingsV2) === null) {
    throw new Error('Protected reset snapshot for AI_SETTINGS_V2 is invalid')
  }

  if (snapshot.ollamaTimeoutMs !== null && !isPositiveIntegerString(snapshot.ollamaTimeoutMs)) {
    throw new Error('Protected reset snapshot for OLLAMA_TIMEOUT_MS is invalid')
  }
}

function createEnvironmentBackedAISettings(): AISettings {
  const openAIBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim() || 'https://api.openai.com/v1'
  const openAIApiKey = process.env.OPENAI_COMPATIBLE_API_KEY?.trim() || ''
  const openAIModel = process.env.OPENAI_COMPATIBLE_MODEL?.trim() || 'gpt-4.1-mini'
  const openAIEmbeddingModel = process.env.OPENAI_COMPATIBLE_EMBEDDING_MODEL?.trim() || DEFAULT_OPENAI_EMBEDDING_MODEL
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434'
  const ollamaRewriteModel = process.env.OLLAMA_REWRITE_MODEL?.trim() || ''
  const ollamaKnowledgeModel = process.env.OLLAMA_MODEL?.trim() || ''
  const ollamaEmbeddingModel = process.env.OLLAMA_EMBEDDING_MODEL?.trim() || ''

  return {
    rewrite: {
      provider: 'openai-compatible',
      openAICompatible: {
        baseUrl: openAIBaseUrl,
        apiKey: openAIApiKey,
        apiKeyConfigured: Boolean(openAIApiKey),
        apiKeyMasked: '',
        model: openAIModel,
        configured: Boolean(openAIBaseUrl && openAIModel && openAIApiKey),
      },
      ollama: {
        baseUrl: ollamaBaseUrl,
        model: ollamaRewriteModel,
        configured: Boolean(ollamaBaseUrl && ollamaRewriteModel),
      },
    },
    knowledgeExtraction: {
      provider: 'ollama',
      openAICompatible: {
        baseUrl: openAIBaseUrl,
        apiKey: openAIApiKey,
        apiKeyConfigured: Boolean(openAIApiKey),
        apiKeyMasked: '',
        model: openAIModel,
        configured: Boolean(openAIBaseUrl && openAIModel && openAIApiKey),
        parallelism: 5,
      },
      ollama: {
        baseUrl: ollamaBaseUrl,
        model: ollamaKnowledgeModel,
        configured: Boolean(ollamaBaseUrl && ollamaKnowledgeModel),
        parallelism: 1,
      },
    },
    embeddings: {
      provider: 'ollama',
      openAICompatible: {
        baseUrl: openAIBaseUrl,
        apiKey: openAIApiKey,
        apiKeyConfigured: Boolean(openAIApiKey),
        apiKeyMasked: '',
        model: openAIEmbeddingModel,
        configured: Boolean(openAIBaseUrl && openAIEmbeddingModel && openAIApiKey),
      },
      ollama: {
        baseUrl: ollamaBaseUrl,
        model: ollamaEmbeddingModel,
        configured: Boolean(ollamaBaseUrl && ollamaEmbeddingModel),
      },
      embeddingBatchSize: 16,
    },
  }
}

export function loadStoredAISettings(): AISettings {
  const entries = findAppSettings([AI_SETTINGS_V2_KEY])
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value])) as Partial<Record<typeof AI_SETTINGS_V2_KEY, string>>
  const parsed = parseStoredSettingsBlob(map[AI_SETTINGS_V2_KEY])
  if (parsed) {
    return normalizeAISettings(parsed)
  }

  return normalizeAISettings(createEnvironmentBackedAISettings())
}

export async function saveStoredAISettings(settings: AISettings) {
  await upsertAppSettings([[AI_SETTINGS_V2_KEY, JSON.stringify(normalizeAISettings(settings))]])
}

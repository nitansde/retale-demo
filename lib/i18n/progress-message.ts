import { progressZhMessages, type ProgressMessageKey } from '@/lib/i18n/progress-messages'
import type { TranslationValues } from '@/lib/i18n/messages'

const PREFIX = '@retale-progress:'
type ProgressMessage = { key: ProgressMessageKey; values?: TranslationValues }

// Store stable keys and parameters; localization happens when rendering.
export function progressMessage(key: ProgressMessageKey, values?: TranslationValues) {
  return PREFIX + JSON.stringify({ key, ...(values ? { values } : {}) })
}

function isProgressKey(key: unknown): key is ProgressMessageKey {
  return typeof key === 'string' && Object.hasOwn(progressZhMessages, key)
}

export function parseProgressMessage(text: string | null | undefined): ProgressMessage | null {
  const value = text?.trim()
  if (!value) return null
  if (value.startsWith(PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(value.slice(PREFIX.length))
      if (!parsed || typeof parsed !== 'object' || !('key' in parsed) || !isProgressKey(parsed.key)) return null
      const values = 'values' in parsed ? parsed.values : undefined
      if (values !== undefined && (
        !values || typeof values !== 'object' || Array.isArray(values)
        || Object.values(values).some((item) => typeof item !== 'string' && !(typeof item === 'number' && Number.isFinite(item)))
      )) return null
      return { key: parsed.key, values: values as TranslationValues | undefined }
    } catch {
      return null
    }
  }
  return null
}

export function formatProgressMessage(
  text: string | null | undefined,
  translate: (key: ProgressMessageKey, values?: TranslationValues) => string,
) {
  const message = parseProgressMessage(text)
  return message ? translate(message.key, message.values) : text?.trim() || null
}

export function isRawEmbeddingProgress(text: string | null | undefined) {
  const message = parseProgressMessage(text)
  return message?.key.startsWith('progress.rawEmbedding') ?? false
}

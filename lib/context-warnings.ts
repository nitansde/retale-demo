import { getMessage, type Locale, type TranslationKey } from '@/lib/i18n/messages'
import type { KnowledgeStatusOverview } from '@/components/workspace/selection-novel-studio-helpers'

const LEGACY_WARNING_KEYS: Record<string, TranslationKey> = {
  'Lance retrieval index is missing or stale for this branch; rebuild knowledge to refresh retrieval evidence.': 'contextWarning.retrievalUnavailable',
  'GraphRAG 未命中明确实体，已降级为空图谱上下文。': 'contextWarning.noMatchedEntities',
  '当前章节在知识图谱里还没有可用的实体出场记录。': 'contextWarning.noChapterEntities',
  'Graph subgraph 请求缺少 entityIds。': 'contextWarning.noEntitySelection',
}

// Compatibility/export diagnostics belong in runtime metadata, not the writing UI.
export function isUserFacingContextWarning(warning: string) {
  return !/^Preset (?:field|image field|extension) `[^`]+` was preserved for export but not applied to /.test(warning)
    && !/^Prompt formatting field `[^`]+` was preserved but not applied because runtime reason /.test(warning)
    && !/^Prompt rule `[^`]+` was active but skipped because its content was empty\./.test(warning)
}

// Translate at render time so cached context also follows the current UI language.
export function formatContextWarning(warning: string, locale: Locale): string {
  const key = LEGACY_WARNING_KEYS[warning.trim()]
  if (key) return getMessage(locale, key)
  const skippedEntities = warning.match(/^以下实体在当前章节之前不可用，已跳过：(.+)$/)
  if (skippedEntities) return getMessage(locale, 'contextWarning.skippedEntities', { entities: skippedEntities[1] })
  return warning
}

export function buildContextWarnings({ warnings, overview }: {
  warnings: string[]
  overview?: KnowledgeStatusOverview | null
}, locale: Locale): string[] {
  const messages: string[] = []
  const add = (key: TranslationKey) => messages.push(getMessage(locale, key))
  const graph = overview?.knowledgeGraph
  if (graph?.status === 'missing') add('contextWarning.knowledgeMissing')
  if (graph?.status === 'partial') {
    messages.push(getMessage(locale, 'contextWarning.knowledgePartial', {
      covered: graph.coveredChapterCount, total: graph.totalChapterCount,
    }))
  }

  const embedding = overview?.embeddingCache
  if (embedding?.status === 'missing') add('contextWarning.embeddingMissing')
  if (embedding?.status === 'partial') {
    messages.push(getMessage(locale, 'contextWarning.embeddingPartial', {
      covered: embedding.coveredChapterCount, total: embedding.totalChapterCount,
    }))
  }

  const retrieval = overview?.retrievalIndex
  if (retrieval?.status === 'pending') add('contextWarning.retrievalPending')
  if (retrieval?.status === 'missing') add('contextWarning.retrievalUnavailable')
  if (retrieval?.status === 'partial') add('contextWarning.retrievalPartial')
  if (retrieval?.status !== 'full' && retrieval?.task?.status === 'failed') add('contextWarning.retrievalFailed')
  if (retrieval?.status !== 'full' && retrieval?.task?.status === 'paused') add('contextWarning.retrievalPaused')

  for (const warning of warnings) {
    if (!warning.trim() || !isUserFacingContextWarning(warning)) continue
    // Prefer the more specific live status over a generic cached index warning.
    if (LEGACY_WARNING_KEYS[warning.trim()] === 'contextWarning.retrievalUnavailable'
      && (retrieval?.status === 'pending' || retrieval?.status === 'partial')) continue
    messages.push(formatContextWarning(warning, locale))
  }
  return [...new Set(messages)]
}

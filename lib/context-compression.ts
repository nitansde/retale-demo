import { estimateTokenCount } from '@/lib/utils'

export const CONTEXT_WARNING_TOKENS = 200_000
export const CONTEXT_COMPRESSION_SUMMARY_TARGET_CHARACTERS = 2_000

export type GeneratedHistoryScope = {
  novelId: string
  branchId: string
  branchContextNodeId?: string
  branchContextInclusion?: 'ancestors_only' | 'include_selected'
  roleplaySessionId?: string
  roleplayLeafMessageId?: string | null
}

export type ContextCompressionPreview = {
  scope: GeneratedHistoryScope
  fingerprint: string
  totalChapters: number
  compressedChapters: number
  chapters: Array<{ label: string; tokenEstimate: number }>
  summary: string | null
  tokenEstimate: number
}

/** Forecast only the incremental saving; already-compressed originals are absent from the request. */
export function estimateCompressionSavings(preview: ContextCompressionPreview, additionalChapters: number) {
  if (!Number.isInteger(additionalChapters) || additionalChapters < 1 || additionalChapters > preview.totalChapters - preview.compressedChapters) return null
  const currentSummaryTokens = preview.summary ? estimateTokenCount(preview.summary) : 0
  const beforeTokens = currentSummaryTokens + preview.chapters
    .slice(preview.compressedChapters, preview.compressedChapters + additionalChapters)
    .reduce((sum, chapter) => sum + chapter.tokenEstimate, 0)
  // The generation prompt targets 2,000 characters; short inputs may save very
  // little. The actual summary is unknown until generation completes.
  const summaryTokens = Math.min(beforeTokens, estimateTokenCount('文'.repeat(CONTEXT_COMPRESSION_SUMMARY_TARGET_CHARACTERS)))
  return { beforeTokens, summaryTokens, savedTokens: Math.max(0, beforeTokens - summaryTokens) }
}

/** Estimate the saving achieved by the persisted summary against the original generated text. */
export function estimateSavedCompressionTokens(preview: ContextCompressionPreview) {
  if (!preview.compressedChapters || !preview.summary) return 0
  const originalTokens = preview.chapters.slice(0, preview.compressedChapters).reduce((sum, chapter) => sum + chapter.tokenEstimate, 0)
  return Math.max(0, originalTokens - estimateTokenCount(preview.summary))
}

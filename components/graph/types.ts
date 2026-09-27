import type { ContextCompressionPreview } from '@/lib/context-compression'
import type { GraphAwareResult, GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { RetrievalDocSourceType } from '@/lib/server/retrieval-index'
import type { RequestPromptMessage } from '@/lib/generation-prompt-preview'

export type GenerationContextPromptBlock = {
  id: string
  label: string
  enabled: boolean
  priority: 'highest' | 'high' | 'medium'
  content: string
  required?: boolean
  trimmed?: boolean
}

export type GenerationContextEvidence = {
  id: string
  sourceType: RetrievalDocSourceType
  sourceId: string
  chapterId: string | null
  chapterNo: number
  lineStart: number | null
  lineEnd: number | null
  title: string | null
  sourceLabel: string
  text: string
  score: number
}

export type GraphContextSourceMeta = {
  mode: 'direct' | 'inherited-parent'
  chapterId: string
  chapterNo: number
  chapterTitle: string
}

export type GraphNodeGenerationState = {
  connectedEdgeIds: string[]
  inclusionState: 'included' | 'partial' | 'excluded' | 'unavailable'
}

export type GenerationContextBuildData = {
  compression?: ContextCompressionPreview | null
  requestMessages?: RequestPromptMessage[]
  contextSnapshotId?: string | null
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  selectedLineStart: number | null
  selectedLineEnd: number | null
  warnings: string[]
  promptBlocks: GenerationContextPromptBlock[]
  assembledContext: string
  graphContext: GraphAwareResult
  lanceEvidence: GenerationContextEvidence[]
  tokenEstimate: number
  sourceMeta?: GraphContextSourceMeta
}

export type GraphEdgeEditDraft = {
  linkType: string
  label: string
  description: string
  polarity: '' | 'positive' | 'negative' | 'neutral' | 'mixed'
  strength: number
  validFromChapter: number
  validUntilChapter: string
  includeByDefault: boolean
}

export type GenerationContextResponse = {
  ok: boolean
  error?: string
} & Partial<GenerationContextBuildData>

export type GraphSubgraphResponse = {
  ok: boolean
  error?: string
} & Partial<GraphAwareResult>

export type ChapterGraphContextData = {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  chapterTitle: string
  warnings: string[]
  graphContext: GraphAwareResult
  lanceEvidence: GenerationContextEvidence[]
  tokenEstimate: number
  sourceMeta?: GraphContextSourceMeta
}

export type ChapterGraphContextResponse = {
  ok: boolean
  error?: string
} & Partial<ChapterGraphContextData>

export type GraphReviewControls = {
  maxHops: 1 | 2
  hideLowConfidence: boolean
  confirmedOnly: boolean
  showPotentiallyStale: boolean
}

export type GraphSelection =
  | { type: 'node'; node: GraphNode }
  | { type: 'edge'; edge: GraphEdge }
  | null

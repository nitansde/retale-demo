"use client"

import { formatProgressMessage } from '@/lib/i18n/progress-message'
import Link from 'next/link'
import { useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  LoaderCircle,
  MessageCircleMore,
  Pencil,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { type WorkspaceActionMode } from '@/components/workspace/use-workspace-chapter-selection'
import { toBranchTimelineSelection } from '@/components/workspace/workspace-selection'
import type {
  ChapterGraphContextResponse,
  GenerationContextBuildData,
  GenerationContextResponse,
  GraphReviewControls,
  GraphSelection,
  GraphSubgraphResponse,
} from '@/components/graph/types'
import type { GraphEdge } from '@/lib/server/graph-types'
import { cn, countChineseFriendlyWords, htmlToPlainText } from '@/lib/utils'
import type {
  ContinueBlockMutationResponse,
  FutureJumpSourceContext,
  FutureJumpRunDetail,
  StoryTimelineBranchNode,
  StoryTimelineResponse,
  TimelineSelection,
  WhatIfCreateResponse,
  WhatIfSessionDetail,
} from '@/lib/story-branch-types'
import type {
  AIScenarioKey,
  Chapter,
  Character,
  CharacterRoleCardFacet,
  KnowledgeRebuildChapterRange,
  OutlineType,
  WorldEntry,
  WorldEntryType,
} from '@/lib/types'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import { requestClientGet } from '@/lib/client-request-broker'
import { getClientLocale, tm, type Locale } from '@/lib/i18n/messages'
import { useI18n } from '@/lib/i18n/provider'

export const TOOLBAR_EDGE_PADDING = 12
export const TOOLBAR_OFFSET_Y = 56
export const DEFAULT_REWRITE_PROMPT = tm('workspace.rewrite.defaultPrompt')

export type GenerationState = {
  loading: boolean
  result: string
  error: string
}

export type RewriteApiCandidate = {
  title: string
  summary: string
  content: string
  inputTokens?: number | null
  outputTokens?: number | null
}

export type RecoverableRewriteResult = RewriteApiCandidate & {
  provider: string
  metadata?: unknown
  presetCompat?: unknown
}

export type RecoverableRewriteJob = {
  jobId: string
  status: string
  progress: number
  currentStep: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  panel: {
    novelId: string
    branchId: string
    chapterId: string
    selectedText: string
    sourceText: string
    sourceTextOverride: string | null
    userInstruction: string
    rewriteLaunchSource: string | null
    branchContextNodeId: string | null
    branchContextInclusion: string | null
    continueBlockId: string | null
    writingSkillCardIds?: string[]
    writingSkillCardId?: string | null
    writingSkillExampleCount?: number | null
    writingSkillSeed?: number | null
    createdAt: string
  }
  result: RecoverableRewriteResult | null
}

export type RewriteFlowState = {
  loading: boolean
  error: string
  provider: string
  candidates: RewriteApiCandidate[]
  selectedIndex: number
  jobId: string | null
  jobStatus: string | null
  jobCurrentStep: string | null
}

export type PendingWhatIfRewriteLaunch = {
  detail: WhatIfSessionDetail
  targetChapterId: string
  variant: 'regenerate' | 'continue'
}

export type PendingFutureJumpRewriteLaunch = {
  detail: FutureJumpRunDetail
  targetChapterId: string
  targetTitle: string
  parentTimelineNodeId: string | null
  selectedText: string
  originalText: string
  userInstruction: string
  inputTokens?: number | null
  outputTokens?: number | null
}

export type PendingContinueBlockRewriteLaunch = {
  continueBlockId: string
  nodeId: string
  anchorChapterNo: number
  latestText: string
  userInstruction: string
  selectedText: string
  originalText: string
  title: string
  subtitle: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  writingSkillCardIds: string[]
  writingSkillExampleCount: number
  writingSkillSeed: number
  targetChapterId: string
  variant: 'continue' | 'regenerate'
}

export type RewriteLaunchSource = 'chapter' | 'what_if' | 'future_jump' | 'continue_block'

export type BranchContextPreviewOptions = {
  branchContextNodeId?: string
  branchContextInclusion?: 'ancestors_only' | 'include_selected'
  continueBlockId?: string
  omitSelectedText?: boolean
}

export type FutureMapLaunchState = {
  novelId: string
  branchId: string
  sourceContext: FutureJumpSourceContext
  title: string
  parentTimelineNodeId: string | null
}

export type KnowledgeRebuildStatus = {
  jobId: string
  novelId: string
  jobType: 'extract_chapter_knowledge' | 'rebuild_retrieval_index'
  status: string
  errorMessage?: string | null
  progress: number
  currentStep: string | null
  createdAt: string
  updatedAt: string
  etaMinutes: number | null
  steps: Array<{
    key: 'hanlp-bootstrap' | 'extract' | 'batch-sync' | 'cleanup' | 'write' | 'raw-embedding' | 'index'
    label: string
    status: 'pending' | 'running' | 'paused' | 'completed'
    progress: number
    etaMinutes: number | null
    detail: string | null
  }>
  chapterRange?: KnowledgeRebuildChapterRange
  rawTextEmbeddingProgress?: number
  rawTextEmbeddingCacheHitRate?: number
  hanlpCacheStatus?: 'queued' | 'running' | 'paused' | 'ready' | 'empty'
  hanlpCacheHitRate?: number
  hanlpBootstrapProgress?: number
  hanlpBootstrapCompletedChapterCount?: number
  hanlpBootstrapTotalChapterCount?: number
  hanlpBootstrapCacheHitCount?: number
  hanlpBootstrapCacheMissCount?: number
  hanlpBootstrapInitializedCharacterEntities?: boolean
  hanlpSettingsSnapshot?: {
    hanlpScriptVersionHash: string
    hanlpModelOrConfigHash: string
    outputSchemaVersion: string
    pipelineVersion: string
  }
  stageTimingsMs?: Record<string, number>
  embeddingSettingsSnapshot?: {
    provider: string
    model: string
    embeddingBatchSize: number
  }
}

export type HanlpCacheSnapshot = {
  status: NonNullable<KnowledgeRebuildStatus['hanlpCacheStatus']>
  settingsSnapshot?: NonNullable<KnowledgeRebuildStatus['hanlpSettingsSnapshot']>
}

export type KnowledgeCoverageStatus = 'missing' | 'partial' | 'full'
export type RetrievalIndexCoverageStatus = KnowledgeCoverageStatus | 'pending'

export type KnowledgeChapterCoverageOverview = {
  status: KnowledgeCoverageStatus
  coveredChapterCount: number
  totalChapterCount: number
  validThroughChapterNo: number | null
}

export type RetrievalIndexCoverageOverview = {
  status: RetrievalIndexCoverageStatus
  indexedScopeCount: number
  chapterRange?: KnowledgeRebuildChapterRange
  task: KnowledgeRebuildStatus | null
}

export type KnowledgeStatusOverview = {
  knowledgeGraph: KnowledgeChapterCoverageOverview
  extractionCache: KnowledgeChapterCoverageOverview
  embeddingCache: KnowledgeChapterCoverageOverview & {
    provider: string | null
    model: string | null
  }
  retrievalIndex: RetrievalIndexCoverageOverview
}

function createLocalizedRecord<T extends string, V>(zh: Record<T, V>, en: Record<T, V>): Record<T, V> {
  return new Proxy({} as Record<T, V>, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      const locale = getClientLocale()
      const source = locale === 'en' ? en : zh
      return source[property as T]
    },
    ownKeys() {
      return Reflect.ownKeys(zh)
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true }
    },
  })
}

export function resolveCurrentNodeMetrics(params: {
  selection: TimelineSelection
  chapterText: string
  selectedNode: StoryTimelineBranchNode | null
  override?: { currentText: string; inputTokens: number | null; outputTokens: number | null } | null
}) {
  const override = params.override ?? null
  const visibleText = params.selection.kind === 'chapter'
    ? params.chapterText
    : override?.currentText ?? params.selectedNode?.currentText ?? params.selectedNode?.latestText ?? ''

  return {
    wordCount: countChineseFriendlyWords(visibleText),
    inputTokens: params.selection.kind === 'chapter'
      ? null
      : override
        ? override.inputTokens
        : params.selectedNode?.inputTokens ?? null,
    outputTokens: params.selection.kind === 'chapter'
      ? null
      : override
        ? override.outputTokens
        : params.selectedNode?.outputTokens ?? null,
  }
}

export function shouldLoadWorkspaceFromBackendOnMount(backendLoaded: boolean) {
  return !backendLoaded
}

export function buildContinueBlockLineageRequestContext(context: PendingContinueBlockRewriteLaunch | null): BranchContextPreviewOptions {
  if (!context) return {}
  const nodeId = context.nodeId.trim()
  if (!nodeId) return {}

  return {
    branchContextNodeId: nodeId,
    branchContextInclusion: 'include_selected',
    continueBlockId: context.continueBlockId,
    omitSelectedText: context.variant === 'continue',
  }
}

export type OllamaModelOption = {
  id: string
  label: string
  family?: string
  parameterSize?: string
  quantization?: string
}

export type OpenAICompatibleModelOption = {
  id: string
  label: string
}

export const AI_SCENARIO_META: Record<AIScenarioKey, {
  eyebrow: string
  title: string
  description: string
  recommendation: string
  shortLabel: string
  ollamaPurpose: 'text' | 'embedding'
  openAIPlaceholder: string
  ollamaPlaceholder: string
}> = {
  rewrite: {
    eyebrow: 'Rewrite',
    title: '写作 AI 模型',
    description: '负责魔改、续写和角色扮演。',
    recommendation: '推荐 DeepSeek 等写作风格自由的模型。',
    shortLabel: '改写',
    ollamaPurpose: 'text',
    openAIPlaceholder: 'deepseek-v4-flash',
    ollamaPlaceholder: 'qwen3:8b',
  },
  knowledgeExtraction: {
    eyebrow: 'Knowledge extraction',
    title: '知识库构建 AI 模型',
    description: '整理人物、关系与设定，记住前情。',
    recommendation: '对模型能力要求不高，优先选便宜的小模型（如 gpt-oss-120b 或本地模型）。',
    shortLabel: '知识',
    ollamaPurpose: 'text',
    openAIPlaceholder: 'gpt-4.1-mini',
    ollamaPlaceholder: 'llama3.1:8b',
  },
  embeddings: {
    eyebrow: 'Embeddings',
    title: 'Embedding 模型',
    description: '语义搜索，帮助写作贴近原著。',
    recommendation: '不配置也能魔改，但写作无法完美贴近原著，且无法语义搜索。',
    shortLabel: '向量',
    ollamaPurpose: 'embedding',
    openAIPlaceholder: 'text-embedding-3-small',
    ollamaPlaceholder: 'nomic-embed-text',
  },
}

export function getAIScenarioMeta(locale: Locale): typeof AI_SCENARIO_META {
  if (locale === 'zh') {
    return AI_SCENARIO_META
  }

  return {
    rewrite: {
      eyebrow: 'Rewrite',
      title: 'Writing AI model',
      description: 'Rewrites, continuations, and roleplay.',
      recommendation: 'Consider DeepSeek or another model with a flexible writing style.',
      shortLabel: 'Rewrite',
      ollamaPurpose: 'text',
      openAIPlaceholder: 'deepseek-v4-flash',
      ollamaPlaceholder: 'qwen3:8b',
    },
    knowledgeExtraction: {
      eyebrow: 'Knowledge extraction',
      title: 'Knowledge-building AI model',
      description: 'Tracks characters, relationships, and story details.',
      recommendation: 'This task is less demanding. Prefer a low-cost model, such as gpt-oss-120b or a local model.',
      shortLabel: 'Knowledge',
      ollamaPurpose: 'text',
      openAIPlaceholder: 'gpt-4.1-mini',
      ollamaPlaceholder: 'llama3.1:8b',
    },
    embeddings: {
      eyebrow: 'Embeddings',
      title: 'Embedding model',
      description: 'Semantic search and closer alignment with the original.',
      recommendation: 'Without embeddings, rewriting still works, but the writing cannot fully match the original work and semantic search is unavailable.',
      shortLabel: 'Embedding',
      ollamaPurpose: 'embedding',
      openAIPlaceholder: 'text-embedding-3-small',
      ollamaPlaceholder: 'nomic-embed-text',
    },
  }
}

export function WorkspaceStatusState(props: {
  icon: typeof LoaderCircle
  title: string
  description: string
  ctaLabel?: string
}) {
  const { t } = useI18n()
  const Icon = props.icon

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_var(--page-glow),_transparent_30%),var(--background)] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] items-center justify-center px-3 py-8 sm:px-5 lg:px-6">
        <section className="w-full max-w-2xl rounded-[30px] border border-line/10 bg-raised p-6 shadow-[0_28px_90px_rgb(0_0_0/calc(0.35*var(--shadow-strength)))] sm:p-8">
          <div className="rounded-[24px] border border-line/8 bg-surface p-6 sm:p-7">
            <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[20px] border border-line/10 bg-overlay/[0.04] text-zinc-200">
              <Icon className={cn('h-6 w-6', props.icon === LoaderCircle && 'animate-spin')} />
            </div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{t('workspace.statusEyebrow')}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{props.title}</h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-400">{props.description}</p>
            {props.ctaLabel ? (
              <div className="mt-6">
                <Link
                  href="/library"
                  className="inline-flex items-center gap-2 rounded-2xl border border-line/10 bg-overlay/[0.04] px-4 py-2.5 text-sm text-zinc-100 transition hover:bg-overlay/[0.08]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {props.ctaLabel}
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}

export const OUTLINE_TYPE_LABELS: Record<OutlineType, string> = createLocalizedRecord({
  main: '主线',
  side: '支线',
  foreshadow: '伏笔',
  conflict: '冲突',
  climax: '高潮',
}, {
  main: 'Main',
  side: 'Side',
  foreshadow: 'Foreshadowing',
  conflict: 'Conflict',
  climax: 'Climax',
})

export const WORLD_TYPE_LABELS: Record<WorldEntryType, string> = createLocalizedRecord({
  location: '地点',
  scene: '场景',
  organization: '组织',
  rule: '规则',
  item: '物件',
  history: '历史',
}, {
  location: 'Location',
  scene: 'Scene',
  organization: 'Organization',
  rule: 'Rule',
  item: 'Item',
  history: 'History',
})

export const KNOWLEDGE_STEP_STATUS_LABELS: Record<KnowledgeRebuildStatus['steps'][number]['status'], string> = createLocalizedRecord({
  pending: '待处理',
  running: '进行中',
  paused: '已暂停',
  completed: '已完成',
}, {
  pending: 'Pending',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
})

export const HANLP_CACHE_STATUS_LABELS: Record<NonNullable<KnowledgeRebuildStatus['hanlpCacheStatus']>, string> = createLocalizedRecord({
  queued: '排队中',
  running: '扫描中',
  paused: '已暂停',
  ready: '缓存就绪',
  empty: '暂无缓存',
}, {
  queued: 'Queued',
  running: 'Scanning',
  paused: 'Paused',
  ready: 'Cache ready',
  empty: 'No cache',
})

const CHARACTER_CLASSIFICATION_DISPLAY_LABELS: Record<NonNullable<Character['classificationKey']>, string> = createLocalizedRecord({
  tier0: 'Tier 0 主角',
  tier1: 'Tier 1 重要配角',
  tier2: 'Tier 2 篇章配角',
  candidate: 'Candidate',
  ignored: 'Ignored',
}, {
  tier0: 'Tier 0 Protagonist',
  tier1: 'Tier 1 Major Support',
  tier2: 'Tier 2 Arc Support',
  candidate: 'Candidate',
  ignored: 'Ignored',
})

export const RAW_TEXT_PRECOMPUTE_STAGE_KEY = 'raw_text_precompute'
export const HANLP_BOOTSTRAP_STAGE_KEY = 'hanlp-bootstrap'

export type KnowledgeStepDisplayStatus = KnowledgeRebuildStatus['steps'][number]['status']
export type KnowledgeRebuildRangeMode = 'all' | 'first' | 'custom'

export function toProgressPercent(value: number | null | undefined) {
  return Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)))
}

export function formatStageDuration(ms: number) {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`

  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    return tm('workspace.knowledge.seconds', { count: totalSeconds >= 10 ? Math.round(totalSeconds) : totalSeconds.toFixed(1) })
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return seconds > 0
    ? tm('workspace.knowledge.minutesSeconds', { minutes, seconds })
    : tm('workspace.knowledge.minutesOnly', { minutes })
}

export function formatEmbeddingProviderLabel(provider: string) {
  if (provider === 'openai-compatible') return 'OpenAI-compatible'
  if (provider === 'ollama') return 'Ollama'
  return provider
}

function parsePositiveChapterInput(value: string) {
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : null
}

export function normalizeKnowledgeRebuildChapterRangeInput(params: {
  mode: KnowledgeRebuildRangeMode
  firstChapterCount: string
  startChapter: string
  endChapter: string
  maxChapterCount: number
}): KnowledgeRebuildChapterRange | undefined {
  const maxChapterCount = Math.max(0, Math.floor(params.maxChapterCount))
  if (params.mode === 'all' || maxChapterCount <= 0) return undefined

  if (params.mode === 'first') {
    const requestedEnd = parsePositiveChapterInput(params.firstChapterCount) ?? maxChapterCount
    return { startChapter: 1, endChapter: Math.min(maxChapterCount, requestedEnd) }
  }

  const requestedStart = parsePositiveChapterInput(params.startChapter) ?? 1
  const requestedEnd = parsePositiveChapterInput(params.endChapter) ?? maxChapterCount
  const startChapter = Math.min(maxChapterCount, requestedStart)
  const endChapter = Math.min(maxChapterCount, requestedEnd)
  return startChapter <= endChapter
    ? { startChapter, endChapter }
    : { startChapter: endChapter, endChapter: startChapter }
}

export function formatKnowledgeRebuildChapterRangeLabel(range: KnowledgeRebuildChapterRange | null | undefined) {
  if (!range?.startChapter && !range?.endChapter) return tm('workspace.knowledge.allChapters')
  if ((range.startChapter ?? 1) <= 1 && range.endChapter) return tm('workspace.knowledge.firstNChapters', { count: range.endChapter })
  if (range.startChapter && range.endChapter) return tm('workspace.knowledge.chapterRangeLabel', { start: range.startChapter, end: range.endChapter })
  if (range.startChapter) return tm('workspace.knowledge.chapterRangeStart', { count: range.startChapter })
  return tm('workspace.knowledge.firstNChapters', { count: range.endChapter ?? 1 })
}

export function getCharacterClassificationBadgeLabel(character: Pick<Character, 'classificationKey' | 'classificationLabel' | 'importanceTier'>) {
  if (character.classificationKey && character.classificationKey in CHARACTER_CLASSIFICATION_DISPLAY_LABELS) {
    return CHARACTER_CLASSIFICATION_DISPLAY_LABELS[character.classificationKey]
  }

  if (character.importanceTier === 'candidate') return 'Candidate'
  if (character.importanceTier === 'ignored') return 'Ignored'

  return character.classificationLabel?.trim() || null
}

type WorkspaceWorldEntryGroups = {
  organizations: WorldEntry[]
  locations: WorldEntry[]
  worldbuilding: WorldEntry[]
}

function getWorkspaceCharacterImportanceRank(importanceTier: Character['importanceTier']) {
  switch (importanceTier) {
    case 'protagonist':
      return 0
    case 'important':
      return 1
    case 'arc':
      return 2
    case 'candidate':
      return 3
    case 'ignored':
      return 4
    default:
      return 5
  }
}

export function sortCharactersForWorkspaceRail(characters: Character[]) {
  return characters.slice().sort((left, right) => {
    const leftRank = getWorkspaceCharacterImportanceRank(left.importanceTier)
    const rightRank = getWorkspaceCharacterImportanceRank(right.importanceTier)
    if (leftRank !== rightRank) return leftRank - rightRank

    const nameOrder = left.name.localeCompare(right.name, 'zh-Hans-CN')
    if (nameOrder !== 0) return nameOrder

    return left.id.localeCompare(right.id)
  })
}

export function groupWorldEntriesForWorkspaceRail(entries: WorldEntry[]): WorkspaceWorldEntryGroups {
  return entries.reduce<WorkspaceWorldEntryGroups>((groups, entry) => {
    if (entry.type === 'organization') {
      groups.organizations.push(entry)
    } else if (entry.type === 'location') {
      groups.locations.push(entry)
    } else {
      groups.worldbuilding.push(entry)
    }

    return groups
  }, {
    organizations: [],
    locations: [],
    worldbuilding: [],
  })
}

export function formatKnowledgeEtaLabel(params: {
  etaMinutes: number | null | undefined
  isPaused: boolean
  isFailed: boolean
  hasTelemetry: boolean
}) {
  if (params.isFailed) return tm('workspace.knowledge.etaFailed')
  if (params.isPaused) return tm('workspace.knowledge.etaPaused')
  if (typeof params.etaMinutes === 'number' && Number.isFinite(params.etaMinutes) && params.etaMinutes > 0) {
    return tm('workspace.knowledge.etaMinutes', { count: params.etaMinutes })
  }
  return params.hasTelemetry ? tm('workspace.knowledge.calculating') : tm('workspace.knowledge.waitingProgress')
}

export function resolveKnowledgeStepDisplayStatus(params: {
  step: KnowledgeRebuildStatus['steps'][number]
  isCurrentRunningStep: boolean
}) {
  return params.step.status satisfies KnowledgeStepDisplayStatus
}

export function resolveKnowledgeRebuildFailureMessage(status: Pick<KnowledgeRebuildStatus, 'status' | 'errorMessage'> | null) {
  if (status?.status !== 'failed') return null
  return status.errorMessage?.trim() || tm('workspace.knowledge.failedDefault')
}

export function formatKnowledgeCoverageBadge(coverage: KnowledgeChapterCoverageOverview | null | undefined) {
  if (!coverage) return tm('workspace.knowledge.waitingState')
  if (coverage.status === 'full') return tm('workspace.knowledge.coverageCompleted')
  if (coverage.status === 'partial') return coverage.validThroughChapterNo ? tm('workspace.knowledge.coverageThroughChapter', { count: coverage.validThroughChapterNo }) : tm('workspace.knowledge.coveragePartial')
  return tm('workspace.knowledge.coverageMissing')
}

export function formatKnowledgeCoverageDetail(label: string, coverage: KnowledgeChapterCoverageOverview | null | undefined) {
  if (!coverage) return tm('workspace.knowledge.coverageStatusNotLoaded', { label })
  if (coverage.totalChapterCount <= 0) return tm('workspace.knowledge.noChapterStats')
  if (coverage.status === 'full') return tm('workspace.knowledge.coverageAll', { label, count: coverage.totalChapterCount })
  if (coverage.status === 'partial') {
    return coverage.validThroughChapterNo
      ? tm('workspace.knowledge.coverageContiguous', { chapter: coverage.validThroughChapterNo, covered: coverage.coveredChapterCount, total: coverage.totalChapterCount })
      : tm('workspace.knowledge.coverageCount', { covered: coverage.coveredChapterCount, total: coverage.totalChapterCount })
  }
  return tm('workspace.knowledge.coverageNone', { label, count: coverage.totalChapterCount })
}

export function formatRetrievalIndexBadge(overview: RetrievalIndexCoverageOverview | null | undefined) {
  if (!overview) return tm('workspace.knowledge.waitingState')
  if (overview.status === 'pending') return tm('workspace.knowledge.job.queued')
  if (overview.status === 'full') return tm('workspace.knowledge.indexed')
  if (overview.status === 'partial') {
    if (overview.chapterRange) return formatKnowledgeRebuildChapterRangeLabel(overview.chapterRange)
    return overview.indexedScopeCount > 1 ? tm('workspace.knowledge.scopeCount', { count: overview.indexedScopeCount }) : tm('workspace.knowledge.coveragePartial')
  }
  return tm('workspace.knowledge.notBuilt')
}

export function formatRetrievalIndexDetail(overview: RetrievalIndexCoverageOverview | null | undefined) {
  if (!overview) return tm('workspace.knowledge.lancedbStatusNotLoaded')
  if (overview.status === 'pending') return overview.chapterRange
    ? tm('workspace.knowledge.lancedbPendingRange', { range: formatKnowledgeRebuildChapterRangeLabel(overview.chapterRange) })
    : tm('workspace.knowledge.lancedbPending')
  if (overview.status === 'full') return tm('workspace.knowledge.lancedbFullyIndexed')
  if (overview.status === 'partial') {
    if (overview.chapterRange) {
      return tm('workspace.knowledge.lancedbRangeOnly', { range: formatKnowledgeRebuildChapterRangeLabel(overview.chapterRange) })
    }
    return tm('workspace.knowledge.lancedbScopeOnly', { count: overview.indexedScopeCount })
  }
  return tm('workspace.knowledge.lancedbNotBuilt')
}

export type KnowledgeActionLoading =
  | 'rebuild-retrieval-index'
  | 'pause'
  | 'abort'
  | 'delete'
  | 'delete-hanlp-cache'
  | 'delete-extraction-cache'
  | 'delete-embedding-cache'
  | null

export type RetrievalTaskControlAction = 'start' | 'refresh' | 'pause' | 'abort' | 'continue' | 'retry'

export function isKnowledgeJobBusy(status: Pick<KnowledgeRebuildStatus, 'status'> | null | undefined) {
  return status?.status === 'queued' || status?.status === 'running' || status?.status === 'paused'
}

export function formatKnowledgeJobStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'queued':
      return tm('workspace.knowledge.job.queued')
    case 'running':
      return tm('workspace.knowledge.job.running')
    case 'paused':
      return tm('workspace.knowledge.job.paused')
    case 'failed':
      return tm('workspace.knowledge.job.failed')
    case 'completed':
    case 'succeeded':
      return tm('workspace.knowledge.job.completed')
    case 'aborted':
      return tm('workspace.knowledge.job.aborted')
    default:
      return tm('workspace.knowledge.waitingState')
  }
}

export function resolveKnowledgeJobPhaseLabel(status: KnowledgeRebuildStatus | null | undefined, translate = tm) {
  if (!status) return null
  const activeStep = status.steps.find((step) => step.status === 'running' || step.status === 'paused') ?? null
  const detail = activeStep?.detail?.trim()
  if (detail) return formatProgressMessage(detail, translate)
  const currentStep = status.currentStep?.trim()
  if (currentStep) return formatProgressMessage(currentStep, translate)
  return formatProgressMessage(activeStep?.label, translate)
}

export function resolveRetrievalTaskControlsState(params: {
  retrievalTask: Pick<KnowledgeRebuildStatus, 'status'> | null
  retrievalIndexOverview: Pick<RetrievalIndexCoverageOverview, 'status'> | null
  knowledgeRebuildStatus: Pick<KnowledgeRebuildStatus, 'status' | 'jobType'> | null
  knowledgeActionLoading: KnowledgeActionLoading
  knowledgeRebuilding: boolean
}) {
  const mainRebuildBusy = params.knowledgeRebuildStatus?.jobType === 'extract_chapter_knowledge'
    && isKnowledgeJobBusy(params.knowledgeRebuildStatus)
  const disabled = mainRebuildBusy || params.knowledgeRebuilding || Boolean(params.knowledgeActionLoading)
  const hasCoverage = params.retrievalIndexOverview?.status === 'full' || params.retrievalIndexOverview?.status === 'partial'

  if (!params.retrievalTask) {
    return {
      disabled,
      helperText: mainRebuildBusy ? tm('workspace.knowledge.mainRebuildLocksRetrieval') : null,
      actions: [hasCoverage ? 'refresh' : 'start'] satisfies RetrievalTaskControlAction[],
    }
  }

  if (params.retrievalTask.status === 'queued' || params.retrievalTask.status === 'running') {
    return {
      disabled,
      helperText: mainRebuildBusy ? tm('workspace.knowledge.mainRebuildLocksRetrieval') : null,
      actions: ['pause', 'abort'] satisfies RetrievalTaskControlAction[],
    }
  }

  if (params.retrievalTask.status === 'paused') {
    return {
      disabled,
      helperText: mainRebuildBusy ? tm('workspace.knowledge.mainRebuildLocksRetrieval') : null,
      actions: ['continue', 'abort'] satisfies RetrievalTaskControlAction[],
    }
  }

  if (params.retrievalTask.status === 'failed') {
    return {
      disabled,
      helperText: mainRebuildBusy ? tm('workspace.knowledge.mainRebuildLocksRetrieval') : null,
      actions: ['retry'] satisfies RetrievalTaskControlAction[],
    }
  }

  return {
    disabled,
    helperText: mainRebuildBusy ? tm('workspace.knowledge.mainRebuildLocksRetrieval') : null,
    actions: [hasCoverage ? 'refresh' : 'start'] satisfies RetrievalTaskControlAction[],
  }
}

export function resolveCacheDeleteState(params: {
  knowledgeRebuildStatus: Pick<KnowledgeRebuildStatus, 'status'> | null
  knowledgeActionLoading: KnowledgeActionLoading
  idleHelperText: string
}) {
  const blockedByActiveRebuild = params.knowledgeRebuildStatus?.status === 'queued'
    || params.knowledgeRebuildStatus?.status === 'running'
    || params.knowledgeRebuildStatus?.status === 'paused'

  return {
    disabled: blockedByActiveRebuild || Boolean(params.knowledgeActionLoading),
    helperText: blockedByActiveRebuild
      ? tm('workspace.knowledge.cacheDeleteBlocked')
      : params.idleHelperText,
  }
}

export function resolveHanlpCacheDeleteState(params: {
  knowledgeRebuildStatus: Pick<KnowledgeRebuildStatus, 'status'> | null
  knowledgeActionLoading: KnowledgeActionLoading
}) {
  return resolveCacheDeleteState({
    ...params,
    idleHelperText: tm('workspace.knowledge.hanlpDeleteIdleHelper'),
  })
}

export const ACTION_META: Record<WorkspaceActionMode, { label: string; title: string; description: string; icon: typeof Wand2 }> = createLocalizedRecord({
  rewrite: {
    label: '魔改',
    title: '魔改 · 全章重写',
    description: '围绕选中片段与额外要求，产出一个完整章节重写版本。',
    icon: Wand2,
  },
  future_jump: {
    label: '未来跳转',
    title: 'Future Jump · 目标节点改写',
    description: '围绕 what-if 分歧与桥接上下文，生成目标未来节点的改写结果。',
    icon: Sparkles,
  },
  roleplay: {
    label: '角色扮演',
    title: '角色扮演 · 剧情推进',
    description: '像聊天一样输入角色台词或行动，让故事围绕当前选区继续推进。',
    icon: MessageCircleMore,
  },
}, {
  rewrite: {
    label: 'Rewrite',
    title: 'Rewrite · Full chapter rewrite',
    description: 'Create a full rewritten chapter around the selected excerpt and your extra instruction.',
    icon: Wand2,
  },
  future_jump: {
    label: 'Future Jump',
    title: 'Future Jump · Target node rewrite',
    description: 'Generate the rewrite for the target future node from the what-if branch and bridge context.',
    icon: Sparkles,
  },
  roleplay: {
    label: 'Roleplay',
    title: 'Roleplay · Story progression',
    description: 'Enter dialogue or actions like chat messages and keep the story moving from the current selection.',
    icon: MessageCircleMore,
  },
})

export const CHAPTER_ACTION_ENTRY_TEST_IDS = {
  rewrite: 'workspace-chapter-rewrite-entry',
  roleplay: 'workspace-chapter-roleplay-entry',
} as const

export const CONTINUE_BLOCK_ACTION_TEST_IDS = {
  continue: 'workspace-continue-block-continue-entry',
  regenerate: 'workspace-continue-block-regenerate-entry',
  futureJump: 'workspace-continue-block-future-jump-entry',
} as const

const CHARACTER_PROFILE_LABELS = createLocalizedRecord({
  personality: '性格',
  gender: '性别',
  identity: '身份 / 背景',
  capability: '能力 / 战力',
  appearance: '外形',
  body: '体态',
  clothing: '衣着',
  speakingStyle: '说话风格',
  likes: '偏好',
}, {
  personality: 'Personality',
  gender: 'Gender',
  identity: 'Identity / Background',
  capability: 'Capability / Power',
  appearance: 'Appearance',
  body: 'Build',
  clothing: 'Clothing',
  speakingStyle: 'Speaking style',
  likes: 'Preferences',
})

const CHARACTER_PROFILE_ORDER = [
  'identity',
  'capability',
  'personality',
  'gender',
  'appearance',
  'body',
  'clothing',
  'speakingStyle',
  'likes',
] as const

const WORKSPACE_CHARACTER_PLACEHOLDER_ROLES = new Set(['角色', '主要人物', 'Character', 'Main character'])
const WORKSPACE_CHARACTER_PLACEHOLDER_TEXT = new Set(['待补充', 'TBD'])

export function getCharacterFacetContent(facet?: CharacterRoleCardFacet | null) {
  return facet?.content?.trim() || facet?.summary?.trim() || ''
}

export function hasCharacterProfile(profile: Character['profile']) {
  return CHARACTER_PROFILE_ORDER.some((key) => Boolean(getCharacterFacetContent(profile?.[key])))
}

function isWorkspaceCharacterPlaceholderText(value: string) {
  return WORKSPACE_CHARACTER_PLACEHOLDER_TEXT.has(value)
}

export function isWorkspaceCharacterVisible(character: Character) {
  const aliases = (character.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)
  if (aliases.length > 0) return true
  if (hasCharacterProfile(character.profile)) return true

  const role = character.role.trim()
  if (role && !WORKSPACE_CHARACTER_PLACEHOLDER_ROLES.has(role)) return true

  const goal = character.goal.trim()
  if (goal && !isWorkspaceCharacterPlaceholderText(goal)) return true

  const trait = character.trait.trim()
  if (trait && !isWorkspaceCharacterPlaceholderText(trait)) return true

  const note = character.note.trim()
  if (note && !isWorkspaceCharacterPlaceholderText(note)) return true

  return false
}

export function filterWorkspaceVisibleCharacters(characters: Character[]) {
  return characters.filter(isWorkspaceCharacterVisible)
}

export function buildCharacterProfileSections(profile: Character['profile']) {
  return CHARACTER_PROFILE_ORDER.flatMap((key) => {
    const facet = profile?.[key]
    const content = getCharacterFacetContent(facet)
    if (!content) return []
    return [{
      key,
      label: CHARACTER_PROFILE_LABELS[key],
      summary: content,
      note: facet?.note?.trim() || '',
      evidence: facet?.evidence?.trim() || '',
    }]
  })
}

export function characterCardNeedsExpansion(params: {
  profileSections: ReturnType<typeof buildCharacterProfileSections>
}) {
  const { profileSections } = params
  if (profileSections.length > 3) return true
  return profileSections.some((section) => section.note.length > 72 || section.evidence.length > 96 || section.summary.length > 140)
}

export function WorkspaceCharacterReferenceCard({
  char,
  knowledgePanelReadOnly,
  onEdit,
  onDelete,
}: {
  char: Character
  knowledgePanelReadOnly: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const [isExpanded, setIsExpanded] = useState(false)
  const profileSections = buildCharacterProfileSections(char.profile)
  const showProfile = hasCharacterProfile(char.profile)
  const classificationBadgeLabel = getCharacterClassificationBadgeLabel(char)
  const aliasBadges = (char.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)
  const identitySummary = getCharacterFacetContent(char.profile?.identity)
  const genderSummary = getCharacterFacetContent(char.profile?.gender)
  const cardCanExpand = characterCardNeedsExpansion({
    profileSections,
  })
  const collapsedPrioritySections = profileSections.filter((section) => ['identity', 'capability', 'personality'].includes(section.key))
  const visibleProfileSections = !cardCanExpand || isExpanded
    ? profileSections
    : (collapsedPrioritySections.length > 0 ? collapsedPrioritySections : profileSections).slice(0, 3)

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-zinc-100">{char.name}</p>
          {!identitySummary && char.role.trim() ? <p className="text-xs text-violet-300">{char.role}</p> : null}
        </div>
        {!knowledgePanelReadOnly ? (
          <div className="flex gap-1">
            <button onClick={onEdit} className="rounded-lg border border-line/10 p-1.5 text-zinc-400 hover:text-zinc-200"><Pencil className="h-3 w-3" /></button>
            <button onClick={onDelete} className="rounded-lg border border-line/10 p-1.5 text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
          </div>
        ) : null}
      </div>
      {(classificationBadgeLabel || aliasBadges.length > 0 || genderSummary) ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {classificationBadgeLabel ? (
            <span
              data-testid={`workspace-character-tier-${char.classificationKey ?? char.importanceTier ?? 'unknown'}`}
              className="rounded-full border border-emerald-300/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100"
            >
              {classificationBadgeLabel}
            </span>
          ) : null}
          {aliasBadges.map((alias) => (
            <span key={`${char.id}-${alias}`} className="rounded-full border border-line/10 px-2 py-0.5 text-[10px] text-zinc-400">
              {t('workspace.character.aliasBadge', { alias })}
            </span>
          ))}
          {genderSummary ? <span data-testid="workspace-character-gender-badge" className="rounded-full border border-line/10 px-2 py-0.5 text-[10px] text-zinc-400">{genderSummary}</span> : null}
        </div>
      ) : null}
      {showProfile ? (
        <div className="space-y-2">
          <div id={`workspace-character-profile-${char.id}`} className="space-y-2 text-xs leading-5 text-zinc-300">
            {visibleProfileSections.map((section) => (
              <div key={section.key} className="rounded-xl border border-line/8 bg-overlay/[0.03] px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{section.label}</p>
                <p className="mt-1 text-zinc-200">{section.summary}</p>
                {section.note ? <p className={cn('mt-1 text-zinc-400', !isExpanded && cardCanExpand && 'line-clamp-2')}>{t('workspace.character.noteLine', { value: section.note })}</p> : null}
                {section.evidence ? <p className={cn('mt-1 text-zinc-500', !isExpanded && cardCanExpand && 'line-clamp-2')}>{t('workspace.character.evidenceLine', { value: section.evidence })}</p> : null}
              </div>
            ))}
          </div>
          {cardCanExpand ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-controls={`workspace-character-profile-${char.id}`}
              onClick={() => setIsExpanded((current) => !current)}
              className="inline-flex items-center gap-1 rounded-lg border border-line/10 px-2 py-1 text-[11px] text-zinc-400 transition hover:border-line/20 hover:text-zinc-200"
            >
              <ChevronDown className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-180')} />
              {isExpanded ? t('workspace.character.collapseDetails') : t('workspace.character.expandDetails')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1 text-xs leading-5 text-zinc-400">
          <p><span className="text-zinc-500">{t('workspace.character.goal')}</span> {char.goal}</p>
          <p><span className="text-zinc-500">{t('workspace.character.trait')}</span> {char.trait}</p>
          {char.note && <p className="line-clamp-2"><span className="text-zinc-500">{t('workspace.character.remark')}</span> {char.note}</p>}
        </div>
      )}
    </>
  )
}

export const CHAPTER_PAGE_SIZE = 80

export function resolveChapterListTargetForAnchorVisibility(params: {
  anchorChapterNo: number
  currentTarget: number
  sortedChapters: Array<Pick<Chapter, 'id' | 'order' | 'parentChapterId'>>
}) {
  const anchorChapter = params.sortedChapters.find((chapter) => !chapter.parentChapterId && chapter.order === params.anchorChapterNo)
  if (!anchorChapter) return params.currentTarget

  const mainlineChapters = params.sortedChapters.filter((chapter) => !chapter.parentChapterId)
  const anchorIndex = mainlineChapters.findIndex((chapter) => chapter.id === anchorChapter.id)
  if (anchorIndex < 0) return params.currentTarget

  return Math.max(params.currentTarget, anchorIndex + 1)
}

export const DEFAULT_GRAPH_REVIEW_CONTROLS: GraphReviewControls = {
  maxHops: 1,
  hideLowConfidence: true,
  confirmedOnly: false,
  showPotentiallyStale: true,
}

export function normalizeSourceSearchText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function buildChapterLineExcerpt(chapter: Chapter, lineStart: number | null, lineEnd: number | null) {
  if (lineStart === null || lineStart < 1) return ''

  const lines = htmlToPlainText(chapter.content)
    .split('\n')
    .map((line) => line.trim())

  const startIndex = Math.max(0, lineStart - 1)
  const endIndex = Math.max(startIndex, (lineEnd ?? lineStart) - 1)
  return lines.slice(startIndex, endIndex + 1).join(' ').trim()
}

export function findSourceBlock(root: HTMLElement, searchText: string) {
  const normalizedSearchText = normalizeSourceSearchText(searchText)
  if (!normalizedSearchText) return null

  const blocks = Array.from(root.querySelectorAll<HTMLElement>('p, li, blockquote, h1, h2, h3, h4, h5, h6'))
  const probes = [120, 80, 48, 24]

  for (const length of probes) {
    const probe = normalizedSearchText.slice(0, Math.min(length, normalizedSearchText.length))
    if (!probe) continue

    const match = blocks.find((block) => {
      const text = normalizeSourceSearchText(block.textContent ?? '')
      return text.includes(probe) || probe.includes(text)
    })

    if (match) return match
  }

  return null
}

export function extractSelection(root: HTMLElement | null) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !root) return null
  const range = selection.getRangeAt(0)
  const text = selection.toString().trim()
  if (!text) return null
  const common = range.commonAncestorContainer
  const isInside = root.contains(common.nodeType === Node.TEXT_NODE ? common.parentNode : common)
  if (!isInside) return null
  const rect = range.getBoundingClientRect()
  return {
    text,
    rect,
  }
}

export async function callGenerationContextApi(payload: Record<string, unknown>): Promise<GenerationContextResponse> {
  const response = await fetch('/api/rag/build-generation-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return response.json()
}

export async function callGraphSubgraphApi(url: string): Promise<GraphSubgraphResponse> {
  const response = await fetch(url, { cache: 'no-store' })
  return response.json()
}

export async function callChapterGraphContextApi(url: string): Promise<ChapterGraphContextResponse> {
  const response = await fetch(url, { cache: 'no-store' })
  return response.json()
}

export async function callGraphEdgeConfirmApi(edgeId: string, novelId: string) {
  const response = await fetch(`/api/graph/edge/${edgeId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId }),
  })
  return response.json()
}

export async function callGraphEdgeRejectApi(edgeId: string, novelId: string) {
  const response = await fetch(`/api/graph/edge/${edgeId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId }),
  })
  return response.json()
}

export async function callGraphEdgeEditApi(edgeId: string, novelId: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/graph/edge/${edgeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, novelId }),
  })
  return response.json()
}

export function resolveGraphSelection(graph: GenerationContextBuildData['graphContext'], selection: GraphSelection) {
  if (selection?.type === 'node') {
    const nextNode = graph.nodes.find((node) => node.id === selection.node.id) ?? graph.seedEntities.find((node) => node.id === selection.node.id)
    if (nextNode) return { type: 'node', node: nextNode } satisfies GraphSelection
  }

  if (selection?.type === 'edge') {
    const nextEdge = graph.edges.find((edge) => edge.id === selection.edge.id)
    if (nextEdge) return { type: 'edge', edge: nextEdge } satisfies GraphSelection
  }

  const defaultNode = graph.seedEntities[0] ?? graph.nodes[0] ?? null
  return defaultNode ? ({ type: 'node', node: defaultNode } satisfies GraphSelection) : null
}

export function getConnectedGraphEdgeIds(nodeId: string, edges: GraphEdge[]) {
  return edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).map((edge) => edge.id)
}

export function toRewriteCandidateFromRecoverableResult(result: RecoverableRewriteResult): RewriteApiCandidate {
  return {
    title: result.title,
    summary: result.summary,
    content: result.content,
    inputTokens: result.inputTokens ?? null,
    outputTokens: result.outputTokens ?? null,
  }
}

export async function callCreateRecoverableRewriteJobApi(payload: Record<string, unknown>) {
  const response = await fetch('/api/rewrite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, recoverableRewriteJob: true, stream: true }),
  })

  const data = await response.json() as { ok?: boolean; job?: RecoverableRewriteJob | null; error?: string }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || tm('workspace.actionError.createRecoverableRewriteJobFailed'))
  }

  if (!data.job) {
    throw new Error(tm('workspace.actionError.recoverableRewriteJobMissing'))
  }

  return data.job
}

export async function callGetRecoverableRewriteJobApi(params: {
  jobId?: string
  novelId?: string
  branchId?: string
  chapterId?: string
  signal?: AbortSignal
}) {
  const searchParams = new URLSearchParams()
  if (params.jobId) searchParams.set('jobId', params.jobId)
  if (params.novelId) searchParams.set('novelId', params.novelId)
  if (params.branchId) searchParams.set('branchId', params.branchId)
  if (params.chapterId) searchParams.set('chapterId', params.chapterId)

  return requestClientGet(`/api/rewrite?${searchParams.toString()}`, {
    signal: params.signal,
    parse: async (response) => {
      const data = await response.json() as { ok?: boolean; job?: RecoverableRewriteJob | null; error?: string }
      if (!response.ok || !data.ok) throw new Error(data.error || tm('workspace.actionError.readRecoverableRewriteJobFailed'))
      return data.job ?? null
    },
  })
}

export async function callAbortRecoverableRewriteJobApi(params: { jobId: string; novelId: string; branchId: string; chapterId?: string }) {
  const searchParams = new URLSearchParams({
    jobId: params.jobId,
    novelId: params.novelId,
    branchId: params.branchId,
  })
  if (params.chapterId) searchParams.set('chapterId', params.chapterId)
  const response = await fetch(`/api/rewrite?${searchParams.toString()}`, { method: 'DELETE' })
  const data = await response.json() as { ok?: boolean; job?: RecoverableRewriteJob | null; error?: string }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || tm('workspace.actionError.abortGenerationFailed'))
  }

  return data.job ?? null
}

export async function callCreateWhatIfSessionApi(payload: Record<string, unknown>): Promise<WhatIfCreateResponse> {
  const response = await fetch('/api/what-if/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as WhatIfCreateResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || tm('workspace.actionError.createWhatIfFailed'))
  }

  return data
}

export async function callCreateRoleplaySessionApi(payload: Record<string, unknown>): Promise<{
  sessionId: string
  timelineNodeId: string
}> {
  const response = await fetch('/api/roleplay/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as { sessionId?: string; timelineNodeId?: string; error?: string }
  if (!response.ok || !data.sessionId || !data.timelineNodeId) {
    throw new Error(data.error || tm('workspace.actionError.createRoleplaySessionFailed'))
  }

  return {
    sessionId: data.sessionId,
    timelineNodeId: data.timelineNodeId,
  }
}

export async function callCreateContinueBlockApi(payload: Record<string, unknown>): Promise<{
  continueBlockId: string
  timelineNodeId: string
  nodeType: 'rewrite' | 'continue_block'
  readableLabel?: string
  readableLineageLabel?: string
  generatedText: string
  inputTokens?: number | null
  outputTokens?: number | null
  title: string
  subtitle: string | null
  latestRevisionNo: number
  writingSkillCardIds: string[]
  writingSkillExampleCount: number
}> {
  const response = await fetch('/api/continue-blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as {
    continueBlockId: string
    timelineNodeId: string
    nodeType: 'rewrite' | 'continue_block'
    readableLabel?: string
    readableLineageLabel?: string
    generatedText: string
    title: string
    subtitle: string | null
    latestRevisionNo: number
    writingSkillCardIds: string[]
    writingSkillExampleCount: number
    error?: string
  }
  if (!response.ok) {
    throw new Error(data.error || tm('workspace.actionError.saveContinueBlockFailed'))
  }

  return data
}

export async function callRegenerateContinueBlockApi(payload: Record<string, unknown>): Promise<{
  continueBlockId: string
  timelineNodeId: string
  nodeType: 'rewrite' | 'continue_block'
  readableLabel?: string
  readableLineageLabel?: string
  generatedText: string
  inputTokens?: number | null
  outputTokens?: number | null
  title: string
  subtitle: string | null
  latestRevisionNo: number
  writingSkillCardIds: string[]
  writingSkillExampleCount: number
}> {
  const response = await fetch('/api/continue-blocks', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = await response.json() as {
    continueBlockId: string
    timelineNodeId: string
    nodeType: 'rewrite' | 'continue_block'
    readableLabel?: string
    readableLineageLabel?: string
    generatedText: string
    title: string
    subtitle: string | null
    latestRevisionNo: number
    writingSkillCardIds: string[]
    writingSkillExampleCount: number
    error?: string
  }
  if (!response.ok) {
    throw new Error(data.error || tm('workspace.actionError.regenerateContinueBlockFailed'))
  }

  return data
}

export async function callDeleteStoryTimelineNodeApi(nodeId: string, novelId: string, branchId: string) {
  const searchParams = new URLSearchParams({ novelId, branchId })
  const response = await fetch(`/api/story-timeline?${searchParams.toString()}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeId }),
  })

  const data = await response.json() as { ok?: boolean; error?: string }
  if (!response.ok || !data.ok) {
    throw new Error(data.error || tm('workspace.actionError.deleteTimelineNodeFailed'))
  }
}

export function toContinueBranchSelection(selection: Extract<TimelineSelection, { kind: 'rewrite' | 'continue_block' }>) {
  return {
    kind: selection.kind,
    nodeId: selection.nodeId,
    continueBlockId: selection.continueBlockId,
    anchorChapterNo: selection.anchorChapterNo,
  } satisfies Extract<TimelineSelection, { kind: 'rewrite' | 'continue_block' }>
}

export function resolveContinueBlockSelectionAfterSave(params: {
  matchingNode: StoryTimelineBranchNode | null | undefined
  result: Pick<ContinueBlockMutationResponse, 'timelineNodeId' | 'continueBlockId' | 'nodeType'>
  fallbackAnchorChapterNo: number
  parentTimelineNodeId: string | null
}) {
  const { matchingNode, result, fallbackAnchorChapterNo } = params

  const fallbackSelection = {
    kind: result.nodeType,
    nodeId: result.timelineNodeId,
    continueBlockId: result.continueBlockId,
    anchorChapterNo: fallbackAnchorChapterNo,
  } satisfies Extract<TimelineSelection, { kind: 'rewrite' | 'continue_block' }>

  if (matchingNode) {
    const selection = toBranchTimelineSelection(matchingNode)
    if (selection?.kind === 'rewrite' || selection?.kind === 'continue_block') {
      return selection
    }
  }

  return fallbackSelection
}

export function createOptimisticContinueBlockTimelineNode(params: {
  result: ContinueBlockMutationResponse
  storyTimeline: StoryTimelineResponse | null
  parentTimelineNodeId: string | null
  sourceChapterNo: number
  selectedText: string
  originalText: string
  generatedText: string
  inputTokens: number | null
  outputTokens: number | null
  userInstruction: string
}) {
  const trimLabel = (value?: string | null) => value?.trim() || ''
  const parseContinueBlockLabelNumber = (value?: string | null) => {
    const match = trimLabel(value).match(/^CONT-(\d+)$/)
    return match ? Number.parseInt(match[1] ?? '', 10) : null
  }
  const formatContinueBlockLabel = (value: number) => `CONT-${String(value).padStart(2, '0')}`
  const resolvedNodeType = params.result.nodeType ?? 'continue_block'
  const branchNodes = params.storyTimeline?.branchNodes ?? []
  const nodesById = new Map(branchNodes.map((node) => [node.id, node]))
  const rootNodeIdByNodeId = new Map<string, string | null>()
  const getRootNodeIdForNode = (nodeId: string) => {
    if (rootNodeIdByNodeId.has(nodeId)) return rootNodeIdByNodeId.get(nodeId) ?? null

    let currentNodeId: string | null = nodeId
    const visited = new Set<string>()
    while (currentNodeId && !visited.has(currentNodeId)) {
      visited.add(currentNodeId)
      const node = nodesById.get(currentNodeId)
      if (!node) {
        rootNodeIdByNodeId.set(nodeId, null)
        return null
      }
      if (!node.parentNodeId) {
        rootNodeIdByNodeId.set(nodeId, node.id)
        return node.id
      }
      currentNodeId = node.parentNodeId
    }

    rootNodeIdByNodeId.set(nodeId, null)
    return null
  }
  const existingNode = params.storyTimeline?.branchNodes.find(
    (node) => node.id === params.result.timelineNodeId || node.continueBlockId === params.result.continueBlockId
  ) ?? null
  const parentNode = params.parentTimelineNodeId
    ? params.storyTimeline?.branchNodes.find((node) => node.id === params.parentTimelineNodeId) ?? null
    : null
  const scopedRootNodeId = params.parentTimelineNodeId ? getRootNodeIdForNode(params.parentTimelineNodeId) : null
  const maxScopedContinueBlockNumber = branchNodes
    .filter((node) => node.nodeType === 'continue_block' && (!scopedRootNodeId || getRootNodeIdForNode(node.id) === scopedRootNodeId))
    .reduce((max, node) => {
      const labelNumber = parseContinueBlockLabelNumber(node.readableLabel)
      return labelNumber == null ? max : Math.max(max, labelNumber)
    }, 0)
  const fallbackReadableLabel = trimLabel(existingNode?.readableLabel)
    || trimLabel(params.result.readableLabel)
    || (resolvedNodeType === 'continue_block' ? formatContinueBlockLabel(maxScopedContinueBlockNumber + 1) : '')
  const fallbackParentLineage = trimLabel(parentNode?.readableLineageLabel) || trimLabel(parentNode?.readableLabel)
  const fallbackReadableLineageLabel = trimLabel(existingNode?.readableLineageLabel)
    || trimLabel(params.result.readableLineageLabel)
    || (fallbackParentLineage ? `${fallbackParentLineage}, ${fallbackReadableLabel}` : fallbackReadableLabel)
  const now = new Date().toISOString()
  return {
    type: 'branch_node',
    id: params.result.timelineNodeId,
    nodeType: resolvedNodeType,
    readableLabel: fallbackReadableLabel || undefined,
    readableLineageLabel: fallbackReadableLineageLabel || undefined,
    anchorChapterNo: params.sourceChapterNo,
    parentNodeId: params.parentTimelineNodeId,
    title: params.result.title,
    subtitle: params.result.subtitle,
    laneIndex: 0,
    colorToken: 'fuchsia',
    sourceChapterNo: params.sourceChapterNo,
    targetChapterNo: null,
    continueBlockId: params.result.continueBlockId,
    whatIfSessionId: null,
    futureJumpRunId: null,
    roleplaySessionId: null,
    latestText: params.generatedText,
    latestRevisionNo: params.result.latestRevisionNo,
    userInstruction: params.userInstruction,
    selectedText: params.selectedText,
    originalText: params.originalText,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    writingSkillCardIds: params.result.writingSkillCardIds,
    writingSkillExampleCount: params.result.writingSkillExampleCount,
    createdAt: now,
    updatedAt: now,
    status: 'active',
  } satisfies StoryTimelineBranchNode
}

export function upsertOptimisticContinueBlockTimelineNode(
  current: StoryTimelineResponse | null,
  nextNode: StoryTimelineBranchNode,
  fallbackTimeline?: Pick<StoryTimelineResponse, 'novelId' | 'branchId' | 'chapters'>,
) {
  const branchNodes = [
    ...(current?.branchNodes ?? []).filter((node) => node.id !== nextNode.id && (nextNode.continueBlockId == null || node.continueBlockId !== nextNode.continueBlockId)),
    nextNode,
  ]
  const edges = branchNodes
    .filter((node) => node.parentNodeId)
    .map((node) => ({ fromNodeId: node.parentNodeId!, toNodeId: node.id }))

  if (current) return { ...current, branchNodes, edges }
  if (!fallbackTimeline) return null
  return { ...fallbackTimeline, branchNodes, edges }
}

export function removeDeletedStoryTimelineNode(current: StoryTimelineResponse, deletedNode: StoryTimelineBranchNode) {
  const branchNodes = current.branchNodes
    .filter((node) => node.id !== deletedNode.id)
    .map((node) => node.parentNodeId === deletedNode.id
      ? { ...node, parentNodeId: deletedNode.parentNodeId }
      : node
    )
  const edges = branchNodes
    .filter((node) => node.parentNodeId)
    .map((node) => ({ fromNodeId: node.parentNodeId!, toNodeId: node.id }))

  return { ...current, branchNodes, edges }
}

export function toPresetCompatSessionSurfaceId(mode: WorkspaceActionMode): PresetCompatSurfaceId {
  return mode === 'roleplay' ? 'roleplay' : 'rewrite'
}

export function toGenerationContextOperationType(mode: WorkspaceActionMode): WorkspaceActionMode {
  return mode === 'roleplay' ? 'roleplay' : 'rewrite'
}

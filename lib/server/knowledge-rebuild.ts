import { progressMessage } from '@/lib/i18n/progress-message'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { AIProvider, Chapter, KnowledgeExtractionScenarioSettings, KnowledgeRebuildChapterRange, PersistedNovelState } from '@/lib/types'
import {
  CHARACTER_ROLE_CARD_KEYS,
  buildCharacterRoleCardLines,
  buildCharacterDescriptionDelta,
  hasCharacterRoleCardProfile,
  mergeCharacterRoleCardProfiles,
  type CharacterRoleCardProfile,
  type ChapterKnowledgeExtraction,
} from '@/lib/story-knowledge'
import { extractChapterKnowledgeOffline } from '@/lib/server/knowledge-extraction'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { INF_CHAPTER } from '@/lib/server/chapter-interval'
import { buildKnowledgeExtractionStoryState } from '@/lib/server/context-builder'
import {
  enqueueKnowledgeJob,
  getMainBranchId,
  hashContent,
} from '@/lib/server/knowledge-store'
import {
  deleteBranchRetrievalIndex,
  getEmbeddingCacheModelIdentity,
  getEmbeddingInputMaxCodePoints,
  precomputeRawTextEmbeddingCache,
  rebuildBranchRetrievalIndex,
  type RawTextEmbeddingPrecomputeResult,
  type RetrievalIndexBuildProgress,
} from '@/lib/server/retrieval-index'
import {
  execute,
  queryAll,
  queryOne,
  runWithNovelDatabaseAccess,
  type SqlParam,
  withPerNovelWriteTransaction,
  withTransaction,
} from '@/lib/server/database-access'
import { plainTextToHtml, uid } from '@/lib/utils'
import type { CharacterImportanceTier } from '@/lib/server/hanlp-contracts'
import { runHanlpBootstrapForChapter } from '@/lib/server/hanlp-bootstrap'
import { initializeHanlpBootstrapCharacterEntities } from '@/lib/server/hanlp-bootstrap-initializer'
import { generateCandidatePromotionSummary } from '@/lib/server/candidate-promotion-summary'
import { classifyHanlpBootstrapCharacters } from '@/lib/server/character-tier'
import { abortKnowledgeRebuildUntilIdle, waitForKnowledgeJobCompletionStatus } from '@/lib/server/knowledge-job-status'
import { createWorkspaceKnowledgeSync } from '@/lib/server/knowledge-workspace-sync'
import { reconcileKnowledgeJobWatchdog } from '@/lib/server/knowledge-job-watchdog'
import {
  createTaskWatchdogAttemptId,
  getTaskWatchdogAttemptId,
  mergeTaskWatchdogState,
  parseTaskWatchdogPayload,
} from '@/lib/server/task-watchdog-attempt'

export type { WorkspaceKnowledgeSyncPayload } from '@/lib/server/knowledge-workspace-sync'

type KnowledgeChapterRow = {
  id: string
  novelId: string
  branchId: string
  chapterNo: number
  title: string | null
  rawText: string
  summary: string | null
  revision: number
  isDirty: number
  dirtyReason: string | null
  sourceHash: string
  knowledgeStatus: string
}

type HanlpChapterEntityPromptRow = {
  entityText: string
  entityType: 'person' | 'location' | 'organization' | 'setting'
  totalCount: number
  score: number
}

type HanlpWorldCategory = Extract<HanlpChapterEntityPromptRow['entityType'], 'location' | 'organization' | 'setting'>

type KnowledgeRebuildPayloadChapter = {
  chapterId: string
  chapterNo: number
}

type ChapterExtractionCandidateStatus = 'queued' | 'extracting' | 'extracted' | 'resolving' | 'persisted' | 'failed' | 'stale'

type ChapterExtractionCandidateRow = {
  id: string
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  chapterRevision: number | null
  chapterSourceHash: string
  extractionJson: string
  processingBatchId: string | null
  processingBatchContextJson: string | null
  processingResultJson: string | null
  status: ChapterExtractionCandidateStatus
  provider: string | null
  model: string | null
  errorMessage: string | null
}

type ChapterExtractionCandidate = {
  id: string
  chapterId: string
  chapterNo: number
  chapterRevision: number | null
  chapterSourceHash: string
  extractionJson: string
  processingBatchId: string | null
  processingBatchContextJson: string | null
  processingResultJson: string | null
  status: ChapterExtractionCandidateStatus
  provider: string | null
  model: string | null
  errorMessage: string | null
}

type ResolvedChapterKnowledge = {
  extraction: ChapterKnowledgeExtraction
}

type ChapterExtractionBatchProcessingContext = {
  chapterIds: string[]
  chapterNos: number[]
  aliasDiscoveries: KnowledgeRebuildBatchAliasDiscovery[]
}

type ChapterExtractionProcessingCache = {
  schemaVersion: typeof CHAPTER_EXTRACTION_PROCESSING_SCHEMA_VERSION
  batch: ChapterExtractionBatchProcessingContext
  resolved: ResolvedChapterKnowledge
}

type ChapterExtractionResolvedProcessingCache = {
  schemaVersion: typeof CHAPTER_EXTRACTION_RESOLVED_SCHEMA_VERSION
  resolved: ResolvedChapterKnowledge
}

type CandidatePromotionSummaryStatus = 'not_requested' | 'pending' | 'completed'

type CharacterCandidatePromotion = {
  candidateId: string
  entityId: string
}

type FormalCharacterImportanceTier = Extract<CharacterImportanceTier, 'protagonist' | 'important' | 'arc'>

type KnowledgeRebuildBatchAliasDiscovery = {
  chapterId: string
  chapterNo: number
  outputOrder: number
  alias: string
  target: string
}

type KnowledgeRebuildStepKey = 'hanlp-bootstrap' | 'extract' | 'batch-sync' | 'cleanup' | 'write' | 'raw-embedding' | 'index'

type KnowledgeRebuildStepStatus = 'pending' | 'running' | 'paused' | 'completed'

export type KnowledgeRebuildPayloadStep = {
  key: KnowledgeRebuildStepKey
  label: string
  status: KnowledgeRebuildStepStatus
  progress: number
  etaMinutes: number | null
  detail: string | null
}

type KnowledgeRebuildIndexProgress = RetrievalIndexBuildProgress

type KnowledgeRebuildEmbeddingSettingsSnapshot = {
  provider: AIProvider
  model: string
  cacheModelIdentity?: string
  embeddingInputMaxCodePoints?: number | null
  embeddingBatchSize: number
}

type KnowledgeRebuildTelemetryUpdate = {
  rawTextEmbeddingProgress?: number
  rawTextEmbeddingCacheHitRate?: number
  rawTextEmbeddingPrecomputeCompleted?: boolean
  stageTimingsMs?: Record<string, number>
}

type KnowledgeRebuildHanlpBootstrapState = {
  completedChapterIds: string[]
  totalChapterCount: number
  completedChapterCount: number
  cacheHitCount: number
  cacheMissCount: number
  initializedCharacterEntities: boolean
}

type HanlpBootstrapCoverageMarker = {
  validThroughChapterNo: number
}

type KnowledgeRebuildJobPayload = {
  branchId: string
  rebuildStartChapter?: number
  chapterRange?: KnowledgeRebuildChapterRange
  phase?: KnowledgeRebuildStepKey
  inlineCleanupCompleted?: boolean
  currentChapterId?: string | null
  pendingChapterIds?: string[]
  chapterWeightsById?: Record<string, number>
  totalChapterWeight?: number
  processedChapterWeight?: number
  extractedChapters?: KnowledgeRebuildPayloadChapter[]
  currentBatchChapters?: KnowledgeRebuildPayloadChapter[]
  totalChapterCount?: number
  extractionSettings?: KnowledgeExtractionScenarioSettings
  rawTextEmbeddingProgress?: number
  rawTextEmbeddingCacheHitRate?: number
  rawTextEmbeddingPrecomputeCompleted?: boolean
  stageTimingsMs?: Record<string, number>
  embeddingSettingsSnapshot?: KnowledgeRebuildEmbeddingSettingsSnapshot
  indexProgress?: KnowledgeRebuildIndexProgress
  stageStartedAtByKey?: Partial<Record<KnowledgeRebuildStepKey, string>>
  hanlpBootstrap?: KnowledgeRebuildHanlpBootstrapState
  orderedAliasDiscoveries?: KnowledgeRebuildBatchAliasDiscovery[]
  appliedAliasDiscoveryCount?: number
  steps?: KnowledgeRebuildPayloadStep[]
}

type KnowledgeRebuildJobState = {
  payload: KnowledgeRebuildJobPayload
  pendingChapterIds: string[]
  chapterWeightsById: Record<string, number>
  totalChapterWeight: number
  processedChapterWeight: number
  extractedChapters: KnowledgeRebuildPayloadChapter[]
  phase: KnowledgeRebuildJobPayload['phase']
}

type RawTextEmbeddingPrecomputeRun = {
  promise: Promise<RawTextEmbeddingPrecomputeResult>
}

export type KnowledgeRebuildStartOutcome = 'queued' | 'running'

export type KnowledgeJobType = 'extract_chapter_knowledge' | 'rebuild_retrieval_index'

const KNOWLEDGE_REBUILD_STEP_ORDER: KnowledgeRebuildStepKey[] = ['hanlp-bootstrap', 'extract', 'batch-sync', 'cleanup', 'write', 'raw-embedding', 'index']

const RAW_TEXT_PRECOMPUTE_STAGE_KEY = 'raw_text_precompute'
const CHAPTER_EXTRACTION_CANDIDATE_SCHEMA_VERSION = 'knowledge-extraction-candidate:v2'
const CHAPTER_EXTRACTION_PROCESSING_SCHEMA_VERSION = 'knowledge-extraction-processing:v1'
const CHAPTER_EXTRACTION_RESOLVED_SCHEMA_VERSION = 'knowledge-extraction-processing:v2'
const CHAPTER_EXTRACTION_BATCH_CONTEXT_SCHEMA_VERSION = 'knowledge-extraction-processing-batch:v1'
const CANDIDATE_PROMOTION_CHAPTER_THRESHOLD = 10
const CANDIDATE_PROMOTION_SUMMARY_STATUS = 'candidate_promoted_summary'
const MAIN_KNOWLEDGE_JOB_TYPE: KnowledgeJobType = 'extract_chapter_knowledge'
const RETRIEVAL_REBUILD_JOB_TYPE: KnowledgeJobType = 'rebuild_retrieval_index'
const rawTextEmbeddingPrecomputeRuns = new Map<string, RawTextEmbeddingPrecomputeRun>()
const activeKnowledgeRebuildRuns = new Set<string>()
const activeKnowledgeRetrievalRuns = new Set<string>()
const knowledgeJobAttemptContext = new AsyncLocalStorage<Map<string, string>>()

const KNOWLEDGE_REBUILD_STEP_LABELS: Record<KnowledgeRebuildStepKey, string> = {
  'hanlp-bootstrap': progressMessage('progress.hanlpLabel'),
  extract: progressMessage('progress.extract'),
  'batch-sync': progressMessage('progress.batchLabel'),
  cleanup: progressMessage('progress.cleanupLabel'),
  write: progressMessage('progress.writeLabel'),
  'raw-embedding': progressMessage('progress.rawEmbeddingLabel'),
  index: progressMessage('progress.indexBuild'),
}

export type KnowledgeRebuildJobOutcome = 'completed' | 'paused' | 'aborted'

class KnowledgeRebuildPausedError extends Error {
  constructor() {
    super('Knowledge rebuild paused')
  }
}

class KnowledgeRebuildAbortedError extends Error {
  constructor() {
    super('Knowledge rebuild aborted')
  }
}

function toChapterLike(params: { chapterId: string; novelId: string; title: string; chapterNo: number; rawText: string }): Chapter {
  return {
    id: params.chapterId,
    novelId: params.novelId,
    title: params.title,
    order: params.chapterNo,
    content: plainTextToHtml(params.rawText),
    originalContent: plainTextToHtml(params.rawText),
    status: 'draft',
    wordCount: params.rawText.length,
    updatedAt: '刚刚',
  }
}

function chooseConciseKnowledgeText(existing: string | null | undefined, incoming: string | null | undefined) {
  const left = (existing ?? '').trim()
  const right = (incoming ?? '').trim()
  if (!left) return right
  if (!right) return left
  if (left === right) return left
  if (left.includes(right)) return right
  if (right.includes(left)) return left
  return left.length <= right.length ? left : right
}

function getFormalCharacterImportanceTierRank(tier: CharacterImportanceTier | null | undefined) {
  switch (tier) {
    case 'protagonist':
      return 3
    case 'important':
      return 2
    case 'arc':
      return 1
    default:
      return 0
  }
}

function isFormalCharacterImportanceTier(tier: CharacterImportanceTier | null | undefined): tier is FormalCharacterImportanceTier {
  return tier === 'protagonist' || tier === 'important' || tier === 'arc'
}

function chooseStrongerFormalCharacterTier(
  existing: CharacterImportanceTier | null | undefined,
  incoming: FormalCharacterImportanceTier,
) {
  return isFormalCharacterImportanceTier(existing) && getFormalCharacterImportanceTierRank(existing) >= getFormalCharacterImportanceTierRank(incoming)
    ? existing
    : incoming
}

function chooseKnownFormalCharacterTierByName(params: {
  branchId: string
  name: string
}) {
  const normalizedName = normalizeCharacterMentionName(params.name)
  if (!normalizedName || isBlockedCharacterMention(normalizedName)) {
    return null
  }

  const directMatches = queryAll<{
    entityId: string
    importanceTier: FormalCharacterImportanceTier
    userConfirmed: number
  }>(
    `
      SELECT entityId, importanceTier, userConfirmed
      FROM (
        SELECT e.id AS entityId, e.importanceTier AS importanceTier, e.userConfirmed AS userConfirmed
        FROM KnowledgeEntity e
        WHERE e.branchId = ?
          AND e.entityType = 'character'
          AND e.importanceTier IN ('protagonist', 'important', 'arc')
          AND e.canonicalName = ?
        UNION ALL
        SELECT e.id AS entityId, e.importanceTier AS importanceTier, e.userConfirmed AS userConfirmed
        FROM EntityAliasMapping m
        JOIN KnowledgeEntity e ON e.id = m.entityId
        WHERE m.branchId = ?
          AND e.entityType = 'character'
          AND e.importanceTier IN ('protagonist', 'important', 'arc')
          AND m.alias = ?
        UNION ALL
        SELECT e.id AS entityId, e.importanceTier AS importanceTier, e.userConfirmed AS userConfirmed
        FROM EntityAlias a
        JOIN KnowledgeEntity e ON e.id = a.entityId
        WHERE e.branchId = ?
          AND e.entityType = 'character'
          AND e.importanceTier IN ('protagonist', 'important', 'arc')
          AND a.alias = ?
      )
    `,
    params.branchId,
    normalizedName,
    params.branchId,
    normalizedName,
    params.branchId,
    normalizedName,
  )

  const bestDirectMatch = directMatches.reduce<{
    importanceTier: FormalCharacterImportanceTier
    userConfirmed: number
  } | null>((best, match) => {
    if (!best) {
      return { importanceTier: match.importanceTier, userConfirmed: match.userConfirmed }
    }

    if (match.userConfirmed !== best.userConfirmed) {
      return match.userConfirmed > best.userConfirmed
        ? { importanceTier: match.importanceTier, userConfirmed: match.userConfirmed }
        : best
    }

    return getFormalCharacterImportanceTierRank(match.importanceTier) > getFormalCharacterImportanceTierRank(best.importanceTier)
      ? { importanceTier: match.importanceTier, userConfirmed: match.userConfirmed }
      : best
  }, null)

  if (bestDirectMatch?.importanceTier) {
    return bestDirectMatch.importanceTier
  }

  const totalChapters = queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM KnowledgeChapter WHERE branchId = ?',
    params.branchId,
  )?.count ?? 0
  const bootstrapPeople = queryAll<{
    name: string
    totalCount: number
    chapterCount: number
    score: number
    firstSeenChapter: number | null
    lastSeenChapter: number | null
  }>(
    `
      SELECT
        entity_text AS name,
        SUM(total_count) AS totalCount,
        COUNT(DISTINCT chapter_no) AS chapterCount,
        MAX(score) AS score,
        MIN(chapter_no) AS firstSeenChapter,
        MAX(chapter_no) AS lastSeenChapter
      FROM hanlp_bootstrap_entities
      WHERE branch_id = ?
        AND entity_type = 'person'
      GROUP BY entity_text
    `,
    params.branchId,
  )

  const bootstrapDecision = classifyHanlpBootstrapCharacters({
    people: bootstrapPeople,
    totalChapters,
  }).find((decision) => decision.normalizedName === normalizedName)

  if (bootstrapDecision?.tier === 'protagonist' || bootstrapDecision?.tier === 'important' || bootstrapDecision?.tier === 'arc') {
    return bootstrapDecision.tier
  }

  return null
}

function chooseBootstrapSafeEntityStatus(params: {
  existingStatus: string | null | undefined
  incomingStatus: string
  userConfirmed: number
}) {
  const existingStatus = params.existingStatus?.trim() || null
  if (params.userConfirmed && existingStatus) {
    return existingStatus
  }
  if (params.incomingStatus === 'hanlp_bootstrap' && existingStatus && existingStatus !== 'hanlp_bootstrap') {
    return existingStatus
  }
  return params.incomingStatus || existingStatus || 'hanlp_bootstrap'
}

function listPendingCharacterCandidatePromotions(params: { branchId: string }) {
  return queryAll<CharacterCandidatePromotion>(
    `
      SELECT id AS candidateId,
             promoted_entity_id AS entityId
      FROM character_candidates
      WHERE branch_id = ?
        AND promoted_entity_id IS NOT NULL
        AND promotion_summary_status = 'pending'
      ORDER BY last_seen_chapter DESC, updated_at ASC, id ASC
    `,
    params.branchId,
  )
}

function findEvidenceSpanId(chapterId: string, lineStart: number, lineEnd: number) {
  return (
    queryOne<{ id: string }>(
      `
        SELECT id
        FROM TextSpan
        WHERE chapterId = ? AND spanType = 'evidence' AND lineStart <= ? AND lineEnd >= ?
        LIMIT 1
      `,
      chapterId,
      lineStart,
      lineEnd
    )?.id ?? null
  )
}

function updateKnowledgeJob(
  jobId: string,
  fields: {
    status?: string
    currentStep?: string | null
    progress?: number
    payload?: unknown
    errorMessage?: string | null
  },
  options?: {
    expectedAttemptId?: string | null
  }
) {
  const expectedAttemptId = options?.expectedAttemptId ?? knowledgeJobAttemptContext.getStore()?.get(jobId) ?? null
  let nextPayloadJson: string | null | undefined
  if (fields.status !== undefined || fields.currentStep !== undefined || fields.progress !== undefined || fields.payload !== undefined) {
    const currentRow = queryOne<{ status: string; currentStep: string | null; progress: number; payloadJson: string | null }>(
      'SELECT status, currentStep, progress, payloadJson FROM KnowledgeJob WHERE id = ?',
      jobId
    )
    const basePayload = fields.payload === undefined
      ? parseKnowledgeRebuildJobPayload(currentRow?.payloadJson ?? null)
      : normalizeKnowledgeRebuildJobPayload(fields.payload)

    if (basePayload) {
      const syncedPayload = syncKnowledgeRebuildPayload(basePayload, {
        status: fields.status ?? currentRow?.status ?? 'queued',
        currentStep: fields.currentStep ?? currentRow?.currentStep ?? null,
        progress: fields.progress ?? currentRow?.progress ?? 0,
      })
      nextPayloadJson = JSON.stringify(expectedAttemptId
        ? mergeTaskWatchdogState(syncedPayload, { attemptId: expectedAttemptId })
        : syncedPayload)
    } else if (fields.payload === null) {
      nextPayloadJson = null
    }
  }

  const entries = Object.entries(fields).flatMap<[string, SqlParam]>(([key, value]) => {
    if (value === undefined) return []
    if (key === 'payload') return nextPayloadJson === undefined ? [] : [['payloadJson', nextPayloadJson]]
    return [[key, value as SqlParam]]
  })
  if (fields.payload === undefined && nextPayloadJson !== undefined) {
    entries.push(['payloadJson', nextPayloadJson])
  }
  if (!entries.length) return
  const attemptGuardSql = expectedAttemptId
    ? ` AND json_extract(COALESCE(payloadJson, '{}'), '$.taskWatchdog.attemptId') = ?`
    : ''
  return execute(
    `UPDATE KnowledgeJob SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?${attemptGuardSql}`,
    ...entries.map(([, value]) => value ?? null),
    jobId,
    ...(expectedAttemptId ? [expectedAttemptId] : [])
  )
}

async function runKnowledgeJobWithAttempt<T>(jobId: string, attemptId: string, callback: () => Promise<T>) {
  const store = new Map(knowledgeJobAttemptContext.getStore() ?? [])
  store.set(jobId, attemptId)
  return knowledgeJobAttemptContext.run(store, callback)
}

async function claimQueuedKnowledgeJob(params: {
  jobId: string
  currentStep: string | null
  progress: number
  payload?: unknown
  expectedAttemptId?: string | null
}) {
  return withTransaction(() => {
    const currentJob = queryOne<{ status: string; currentStep: string | null; progress: number; payloadJson: string | null }>(
      'SELECT status, currentStep, progress, payloadJson FROM KnowledgeJob WHERE id = ?',
      params.jobId,
    )
    if (!currentJob?.status || currentJob.status !== 'queued') {
      return { claimed: false as const, status: currentJob?.status ?? null, attemptId: null }
    }

    const scheduledAttemptId = params.expectedAttemptId?.trim() || null
    const attemptId = scheduledAttemptId ?? createTaskWatchdogAttemptId()
    const basePayload = params.payload === undefined
      ? parseKnowledgeRebuildJobPayload(currentJob.payloadJson)
      : normalizeKnowledgeRebuildJobPayload(params.payload)
    const nextPayload = basePayload
      ? mergeTaskWatchdogState(syncKnowledgeRebuildPayload(basePayload, {
          status: 'running',
          currentStep: params.currentStep,
          progress: params.progress,
        }), {
          attemptId,
          claimedAt: new Date().toISOString(),
          claimedBy: 'knowledge_worker',
        })
      : mergeTaskWatchdogState({}, {
          attemptId,
          claimedAt: new Date().toISOString(),
          claimedBy: 'knowledge_worker',
        })

    const attemptGuardSql = scheduledAttemptId
      ? " AND CASE WHEN json_valid(payloadJson) THEN json_extract(payloadJson, '$.taskWatchdog.attemptId') = ? ELSE 0 END"
      : " AND CASE WHEN payloadJson IS NULL THEN 1 WHEN json_valid(payloadJson) THEN json_extract(payloadJson, '$.taskWatchdog.attemptId') IS NULL ELSE 0 END"
    const claimResult = execute(
      `UPDATE KnowledgeJob SET status = 'running', progress = ?, currentStep = ?, payloadJson = ?, errorMessage = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'${attemptGuardSql}`,
      params.progress,
      params.currentStep,
      JSON.stringify(nextPayload),
      params.jobId,
      ...(scheduledAttemptId ? [scheduledAttemptId] : []),
    )
    if (claimResult.changes !== 1) {
      const nextJob = queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE id = ?', params.jobId)
      return { claimed: false as const, status: nextJob?.status ?? null, attemptId: null }
    }

    return { claimed: true as const, status: 'running' as const, attemptId }
  })
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function normalizePositiveChapterNo(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(1, Math.floor(value))
}

function normalizeKnowledgeRebuildChapterRange(value: unknown): KnowledgeRebuildChapterRange | undefined {
  if (!value || typeof value !== 'object') return undefined

  const candidate = value as KnowledgeRebuildChapterRange
  const startChapter = normalizePositiveChapterNo(candidate.startChapter)
  const endChapter = normalizePositiveChapterNo(candidate.endChapter)

  if (startChapter === undefined && endChapter === undefined) return undefined
  if (startChapter !== undefined && endChapter !== undefined && startChapter > endChapter) {
    return { startChapter: endChapter, endChapter: startChapter }
  }

  return {
    ...(startChapter !== undefined ? { startChapter } : {}),
    ...(endChapter !== undefined ? { endChapter } : {}),
  }
}

function resolveKnowledgeRebuildChapterRange(params: {
  payload: Pick<KnowledgeRebuildJobPayload, 'chapterRange' | 'rebuildStartChapter'>
  defaultStartChapter: number
}): Required<Pick<KnowledgeRebuildChapterRange, 'startChapter'>> & Pick<KnowledgeRebuildChapterRange, 'endChapter'> {
  const normalizedPayloadRange = normalizeKnowledgeRebuildChapterRange(params.payload.chapterRange)
  const startChapter = normalizedPayloadRange?.startChapter
    ?? normalizePositiveChapterNo(params.payload.rebuildStartChapter)
    ?? params.defaultStartChapter

  return {
    startChapter,
    ...(normalizedPayloadRange?.endChapter !== undefined ? { endChapter: normalizedPayloadRange.endChapter } : {}),
  }
}

function chapterIsInRebuildRange(chapterNo: number, range: Required<Pick<KnowledgeRebuildChapterRange, 'startChapter'>> & Pick<KnowledgeRebuildChapterRange, 'endChapter'>) {
  return chapterNo >= range.startChapter && (range.endChapter === undefined || chapterNo <= range.endChapter)
}

function normalizeKnowledgeRebuildJobPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || typeof (payload as { branchId?: unknown }).branchId !== 'string') {
    return null
  }

  const candidate = payload as KnowledgeRebuildJobPayload & {
    stageStartedAtByKey?: Partial<Record<KnowledgeRebuildStepKey, string>>
  }
  const rawPhase = (payload as { phase?: unknown }).phase
  const normalizedPhase: KnowledgeRebuildJobPayload['phase'] = rawPhase === 'hanlp-bootstrap' || rawPhase === 'extract' || rawPhase === 'batch-sync' || rawPhase === 'cleanup' || rawPhase === 'write' || rawPhase === 'raw-embedding' || rawPhase === 'index'
      ? rawPhase
      : undefined
  const normalizedChapterRange = normalizeKnowledgeRebuildChapterRange(candidate.chapterRange)

  const embeddingSettingsSnapshot = candidate.embeddingSettingsSnapshot
  const normalizedSnapshot =
    embeddingSettingsSnapshot
    && typeof embeddingSettingsSnapshot.provider === 'string'
    && typeof embeddingSettingsSnapshot.model === 'string'
    && typeof embeddingSettingsSnapshot.embeddingBatchSize === 'number'
      ? {
          provider: embeddingSettingsSnapshot.provider,
          model: embeddingSettingsSnapshot.model,
          cacheModelIdentity: typeof embeddingSettingsSnapshot.cacheModelIdentity === 'string'
            ? embeddingSettingsSnapshot.cacheModelIdentity : undefined,
          embeddingInputMaxCodePoints: typeof embeddingSettingsSnapshot.embeddingInputMaxCodePoints === 'number'
            && Number.isFinite(embeddingSettingsSnapshot.embeddingInputMaxCodePoints)
            && embeddingSettingsSnapshot.embeddingInputMaxCodePoints > 0
            ? embeddingSettingsSnapshot.embeddingInputMaxCodePoints : null,
          embeddingBatchSize: Math.max(1, Math.floor(embeddingSettingsSnapshot.embeddingBatchSize)),
        }
      : undefined

  const hanlpBootstrap = candidate.hanlpBootstrap
  const normalizedHanlpBootstrap =
    hanlpBootstrap
    && typeof hanlpBootstrap === 'object'
    && Array.isArray(hanlpBootstrap.completedChapterIds)
    && typeof hanlpBootstrap.totalChapterCount === 'number'
    && typeof hanlpBootstrap.completedChapterCount === 'number'
    && typeof hanlpBootstrap.cacheHitCount === 'number'
    && typeof hanlpBootstrap.cacheMissCount === 'number'
      ? {
          completedChapterIds: hanlpBootstrap.completedChapterIds.filter((value): value is string => typeof value === 'string'),
          totalChapterCount: Math.max(0, Math.floor(hanlpBootstrap.totalChapterCount)),
          completedChapterCount: Math.max(0, Math.floor(hanlpBootstrap.completedChapterCount)),
          cacheHitCount: Math.max(0, Math.floor(hanlpBootstrap.cacheHitCount)),
          cacheMissCount: Math.max(0, Math.floor(hanlpBootstrap.cacheMissCount)),
          initializedCharacterEntities: Boolean(hanlpBootstrap.initializedCharacterEntities),
        } satisfies KnowledgeRebuildHanlpBootstrapState
      : undefined

  const orderedAliasDiscoveries = Array.isArray(candidate.orderedAliasDiscoveries)
    ? candidate.orderedAliasDiscoveries.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const row = item as Partial<KnowledgeRebuildBatchAliasDiscovery>
        if (
          typeof row.chapterId !== 'string'
          || typeof row.chapterNo !== 'number'
          || typeof row.outputOrder !== 'number'
          || typeof row.alias !== 'string'
          || typeof row.target !== 'string'
        ) {
          return []
        }
        return [{
          chapterId: row.chapterId,
          chapterNo: Math.max(1, Math.floor(row.chapterNo)),
          outputOrder: Math.max(0, Math.floor(row.outputOrder)),
          alias: row.alias,
          target: row.target,
        } satisfies KnowledgeRebuildBatchAliasDiscovery]
      })
    : undefined
  const currentBatchChapters = Array.isArray(candidate.currentBatchChapters)
    ? candidate.currentBatchChapters.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const row = item as Partial<KnowledgeRebuildPayloadChapter>
        if (typeof row.chapterId !== 'string' || typeof row.chapterNo !== 'number') return []
        return [{
          chapterId: row.chapterId,
          chapterNo: Math.max(1, Math.floor(row.chapterNo)),
        } satisfies KnowledgeRebuildPayloadChapter]
      }).sort((left, right) => left.chapterNo - right.chapterNo)
    : undefined

  return {
    ...candidate,
    phase: normalizedPhase,
    chapterRange: normalizedChapterRange,
    rebuildStartChapter: normalizedChapterRange?.startChapter ?? normalizePositiveChapterNo(candidate.rebuildStartChapter),
    rawTextEmbeddingProgress: typeof candidate.rawTextEmbeddingProgress === 'number'
      ? clampProgress(candidate.rawTextEmbeddingProgress)
      : undefined,
    rawTextEmbeddingCacheHitRate: typeof candidate.rawTextEmbeddingCacheHitRate === 'number'
      ? clampProgress(candidate.rawTextEmbeddingCacheHitRate)
      : undefined,
    rawTextEmbeddingPrecomputeCompleted: typeof candidate.rawTextEmbeddingPrecomputeCompleted === 'boolean'
      ? candidate.rawTextEmbeddingPrecomputeCompleted
      : undefined,
    stageTimingsMs: {
      ...((candidate.stageTimingsMs && typeof candidate.stageTimingsMs === 'object') ? candidate.stageTimingsMs : {}),
    },
    embeddingSettingsSnapshot: normalizedSnapshot,
    stageStartedAtByKey: { ...(candidate.stageStartedAtByKey ?? {}) },
    hanlpBootstrap: normalizedHanlpBootstrap,
    orderedAliasDiscoveries,
    currentBatchChapters,
    appliedAliasDiscoveryCount: typeof candidate.appliedAliasDiscoveryCount === 'number'
      ? Math.max(0, Math.floor(candidate.appliedAliasDiscoveryCount))
      : undefined,
  }
}

function parseStageStartedAt(value: string | undefined) {
  if (!value) return Number.NaN
  return Date.parse(value)
}

function estimateStageEtaMinutes(progress: number, stageStartedAt: string | undefined) {
  if (progress <= 0.02 || progress >= 0.999) return null

  const startedAt = parseStageStartedAt(stageStartedAt)
  if (!Number.isFinite(startedAt)) return null

  const elapsedMs = Date.now() - startedAt
  if (elapsedMs <= 0) return null

  const estimatedTotalMs = elapsedMs / progress
  const remainingMs = Math.max(0, estimatedTotalMs - elapsedMs)
  return Math.max(1, Math.ceil(remainingMs / 60000))
}

function getKnowledgeExtractionSettingsSnapshot(payload: KnowledgeRebuildJobPayload) {
  if (payload.extractionSettings?.provider === 'openai-compatible' || payload.extractionSettings?.provider === 'ollama') {
    return payload.extractionSettings
  }

  return loadStoredAISettings().knowledgeExtraction
}

function createEmptyHanlpBootstrapState(totalChapterCount: number): KnowledgeRebuildHanlpBootstrapState {
  return {
    completedChapterIds: [],
    totalChapterCount: Math.max(0, totalChapterCount),
    completedChapterCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    initializedCharacterEntities: false,
  }
}

function getHanlpBootstrapCoverageMarker(novelId: string): HanlpBootstrapCoverageMarker | null {
  const row = queryOne<{ validThroughChapterNo: number }>(
    'SELECT valid_through_chapter_no AS validThroughChapterNo FROM hanlp_bootstrap_coverage WHERE novel_id = ? LIMIT 1',
    novelId
  )
  if (!row || typeof row.validThroughChapterNo !== 'number') return null

  return { validThroughChapterNo: Math.max(0, Math.floor(row.validThroughChapterNo)) }
}

function upsertHanlpBootstrapCoverageMarker(novelId: string, validThroughChapterNo: number) {
  const normalizedChapterNo = Math.max(0, Math.floor(validThroughChapterNo))
  execute(
    `
      INSERT INTO hanlp_bootstrap_coverage (id, novel_id, valid_through_chapter_no)
      VALUES (?, ?, ?)
      ON CONFLICT(novel_id) DO UPDATE SET
        valid_through_chapter_no = MAX(hanlp_bootstrap_coverage.valid_through_chapter_no, excluded.valid_through_chapter_no),
        updated_at = CURRENT_TIMESTAMP
    `,
    `${novelId}:hanlp-bootstrap-coverage`,
    novelId,
    normalizedChapterNo
  )
}

function formatDurationForKnowledgeStep(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 1000) return '0s'
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

function buildHanlpBootstrapStepDetail(payload: KnowledgeRebuildJobPayload, runtimeStatus: string) {
  const hanlp = payload.hanlpBootstrap
  if (!hanlp) return null

  const startedAt = parseStageStartedAt(payload.stageStartedAtByKey?.['hanlp-bootstrap'])
  const durationMs = Number.isFinite(startedAt)
    ? Math.max(0, Date.now() - startedAt)
    : 0
  const durationText = formatDurationForKnowledgeStep(durationMs)
  const etaMinutes = runtimeStatus === 'paused'
    ? null
    : estimateStageEtaMinutes(
        hanlp.totalChapterCount > 0 ? clampProgress(hanlp.completedChapterCount / hanlp.totalChapterCount) : 1,
        payload.stageStartedAtByKey?.['hanlp-bootstrap']
      )
  return progressMessage(etaMinutes ? 'progress.hanlpDetailEta' : 'progress.hanlpDetail', {
    completed: hanlp.completedChapterCount,
    total: Math.max(0, hanlp.totalChapterCount),
    hits: hanlp.cacheHitCount,
    misses: hanlp.cacheMissCount,
    duration: durationText,
    ...(etaMinutes ? { minutes: etaMinutes } : {}),
  })
}

function buildRawTextEmbeddingStepDetail(payload: KnowledgeRebuildJobPayload, runtime: { currentStep: string | null }, isCurrent: boolean) {
  const progress = typeof payload.rawTextEmbeddingProgress === 'number'
    ? toProgressPercentValue(payload.rawTextEmbeddingProgress)
    : null

  if (isCurrent) {
    return runtime.currentStep ?? (progress !== null ? progressMessage('progress.rawEmbeddingPercent', { percent: progress }) : progressMessage('progress.rawEmbeddingWait'))
  }

  if (progress === null) return null
  return progress >= 100 ? progressMessage('progress.rawEmbeddingCompleted') : progressMessage('progress.rawEmbeddingPercent', { percent: progress })
}

function toProgressPercentValue(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 100)))
}

function buildEmbeddingSettingsSnapshot(): KnowledgeRebuildEmbeddingSettingsSnapshot {
  const { embeddings } = loadStoredAISettings()
  return {
    provider: embeddings.provider,
    model: embeddings.provider === 'openai-compatible' ? embeddings.openAICompatible.model : embeddings.ollama.model,
    cacheModelIdentity: getEmbeddingCacheModelIdentity(embeddings),
    embeddingInputMaxCodePoints: getEmbeddingInputMaxCodePoints(embeddings),
    embeddingBatchSize: Math.max(1, Math.floor(embeddings.embeddingBatchSize || 1)),
  }
}

function getOrCreateEmbeddingSettingsSnapshot(payload: KnowledgeRebuildJobPayload) {
  return payload.embeddingSettingsSnapshot ?? buildEmbeddingSettingsSnapshot()
}

function isKnowledgeJobActivelyRunning(jobId: string) {
  const status = getKnowledgeJobRow(jobId)?.status
  return status === 'queued' || status === 'running'
}

function buildRawTextEmbeddingTelemetryUpdate(result: RawTextEmbeddingPrecomputeResult): KnowledgeRebuildTelemetryUpdate {
  const hasDocs = result.totalDocs > 0
  return {
    rawTextEmbeddingProgress: hasDocs ? result.completedDocs / result.totalDocs : 1,
    rawTextEmbeddingCacheHitRate: hasDocs ? result.cacheHits / result.totalDocs : 1,
    rawTextEmbeddingPrecomputeCompleted: !result.cancelled,
    stageTimingsMs: {
      [RAW_TEXT_PRECOMPUTE_STAGE_KEY]: result.durationMs,
    },
  }
}

function ensureRawTextEmbeddingPrecomputeStarted(params: {
  jobId: string
  novelId: string
  branchId: string
  chapterRange?: KnowledgeRebuildChapterRange
  embeddingSettingsSnapshot: KnowledgeRebuildEmbeddingSettingsSnapshot
}) {
  const activeRun = rawTextEmbeddingPrecomputeRuns.get(params.jobId)
  if (activeRun) {
    return activeRun.promise
  }

  const startedAt = Date.now()
  const promise = precomputeRawTextEmbeddingCache({
    novelId: params.novelId,
    branchId: params.branchId,
    settingsSnapshot: params.embeddingSettingsSnapshot,
    chapterRange: params.chapterRange,
    maxConcurrentBatches: 2,
    shouldContinue: () => isKnowledgeJobActivelyRunning(params.jobId),
    onProgress: async (progress) => {
      updateKnowledgeRebuildJobTelemetry(params.jobId, {
        rawTextEmbeddingProgress: progress.totalDocs > 0 ? progress.completedDocs / progress.totalDocs : 1,
        rawTextEmbeddingCacheHitRate: progress.totalDocs > 0 ? progress.cacheHits / progress.totalDocs : 1,
      })
    },
  }).catch(() => ({
    totalDocs: 0,
    completedDocs: 0,
    cacheHits: 0,
    cacheMisses: 0,
    failedDocs: 0,
    totalBatches: 0,
    completedBatches: 0,
    degraded: true,
    cancelled: false,
    durationMs: Date.now() - startedAt,
  })).then((result) => {
    updateKnowledgeRebuildJobTelemetry(params.jobId, buildRawTextEmbeddingTelemetryUpdate(result))
    return result
  }).finally(() => {
    rawTextEmbeddingPrecomputeRuns.delete(params.jobId)
  })

  rawTextEmbeddingPrecomputeRuns.set(params.jobId, { promise })
  return promise
}

async function waitForRawTextEmbeddingPrecompute(jobId: string) {
  const run = rawTextEmbeddingPrecomputeRuns.get(jobId)
  return run ? run.promise : null
}

function getKnowledgeExtractionParallelism(settings: KnowledgeExtractionScenarioSettings) {
  const configuredParallelism = settings.provider === 'openai-compatible'
    ? settings.openAICompatible.parallelism
    : settings.ollama.parallelism

  return Math.max(1, configuredParallelism)
}

function getHanlpBootstrapParallelism() {
  const configured = Number(process.env.HANLP_BOOTSTRAP_PARALLELISM?.trim() || '1')
  return Number.isInteger(configured) && configured > 0 ? configured : 1
}

function getIndexProgressValue(progress?: KnowledgeRebuildIndexProgress) {
  if (!progress) return 0

  switch (progress.phase) {
    case 'loading':
      return 0.04
    case 'embedding': {
      const totalBatches = Math.max(1, progress.totalBatches)
      return 0.08 + clampProgress(progress.completedBatches / totalBatches) * 0.62
    }
    case 'creating_table':
      return 0.76
    case 'building_text_index':
      return 0.88
    case 'building_vector_index':
      return 0.96
    case 'completed':
      return 1
    default:
      return 0
  }
}

function getIndexCurrentStep(progress?: KnowledgeRebuildIndexProgress) {
  if (!progress) return progressMessage('progress.indexBuild')

  switch (progress.phase) {
    case 'loading':
      return progressMessage('progress.indexLoad')
    case 'embedding': {
      return progressMessage('progress.indexEmbed', {
        rows: progress.embeddedRows,
        totalRows: Math.max(progress.totalRows, 1),
        batches: progress.completedBatches,
        totalBatches: Math.max(progress.totalBatches, 1),
      })
    }
    case 'creating_table':
      return progressMessage('progress.indexWrite')
    case 'building_text_index':
      return progressMessage('progress.indexText')
    case 'building_vector_index':
      return progressMessage('progress.indexVector')
    case 'completed':
      return progressMessage('progress.indexBuild')
    default:
      return progressMessage('progress.indexBuild')
  }
}

function buildKnowledgeRebuildSteps(payload: KnowledgeRebuildJobPayload, runtime: {
  status: string
  currentStep: string | null
  progress: number
}): KnowledgeRebuildPayloadStep[] {
  const phase = payload.phase ?? 'extract'
  const hanlpBootstrap = payload.hanlpBootstrap
  const totalChapterWeight = Math.max(0, payload.totalChapterWeight ?? 0)
  const processedChapterWeight = Math.max(0, payload.processedChapterWeight ?? 0)
  const indexProgress = payload.indexProgress
  const stageStartedAtByKey = payload.stageStartedAtByKey ?? {}
  const currentPhaseIndex = KNOWLEDGE_REBUILD_STEP_ORDER.indexOf(phase)
  const currentPhaseOrder = currentPhaseIndex >= 0 ? currentPhaseIndex : 0
  const hanlpProgress = hanlpBootstrap
    ? (hanlpBootstrap.totalChapterCount > 0 ? clampProgress(hanlpBootstrap.completedChapterCount / hanlpBootstrap.totalChapterCount) : 1)
    : 0
  const extractProgress = totalChapterWeight > 0
    ? clampProgress(processedChapterWeight / totalChapterWeight)
    : phase === 'extract'
      ? clampProgress(runtime.progress)
      : 0
  const writeProgress = getKnowledgeWriteProgress(payload)
  const rawTextEmbeddingProgress = typeof payload.rawTextEmbeddingProgress === 'number'
    ? clampProgress(payload.rawTextEmbeddingProgress)
    : 0
  const indexStartedAt = stageStartedAtByKey.index
  const activeIndexProgress = getIndexProgressValue(indexProgress)
  const activeIndexEtaMinutes = runtime.status === 'paused'
    ? null
    : estimateStageEtaMinutes(activeIndexProgress, indexStartedAt)

  return KNOWLEDGE_REBUILD_STEP_ORDER.map((key, index) => {
    const isCurrent = index === currentPhaseOrder
    let status: KnowledgeRebuildStepStatus = 'pending'
    if ((runtime.status === 'succeeded' && index <= currentPhaseOrder) || index < currentPhaseOrder) {
      status = 'completed'
    } else if (isCurrent) {
      status = runtime.status === 'paused' ? 'paused' : 'running'
    }

    let progress = 0
    let etaMinutes: number | null = null
    if (key === 'hanlp-bootstrap') {
      progress = status === 'completed' ? 1 : hanlpProgress
      etaMinutes = status === 'running' ? estimateStageEtaMinutes(progress, stageStartedAtByKey['hanlp-bootstrap']) : null
    } else if (key === 'extract') {
      progress = status === 'completed' ? 1 : extractProgress
      etaMinutes = status === 'running' ? estimateStageEtaMinutes(progress, stageStartedAtByKey.extract) : null
    } else if (key === 'batch-sync') {
      progress = status === 'completed' ? 1 : (phase === 'batch-sync' ? 0.65 : 0)
    } else if (key === 'cleanup') {
      progress = status === 'completed' ? 1 : (phase === 'cleanup' ? 0.35 : 0)
    } else if (key === 'write') {
      progress = status === 'completed' ? 1 : writeProgress
      etaMinutes = status === 'running' ? estimateStageEtaMinutes(progress, stageStartedAtByKey.write) : null
    } else if (key === 'raw-embedding') {
      progress = status === 'completed' ? 1 : rawTextEmbeddingProgress
      etaMinutes = status === 'running' ? estimateStageEtaMinutes(progress, stageStartedAtByKey['raw-embedding']) : null
    } else if (key === 'index') {
      progress = status === 'completed' ? 1 : (phase === 'index' ? activeIndexProgress : 0)
      etaMinutes = status === 'running' ? activeIndexEtaMinutes : null
    }

    if (status === 'pending') {
      progress = 0
    } else if (status === 'completed') {
      progress = 1
    }

    return {
      key,
      label: KNOWLEDGE_REBUILD_STEP_LABELS[key],
      status,
      progress: clampProgress(progress),
      etaMinutes,
      detail: key === 'hanlp-bootstrap'
        ? buildHanlpBootstrapStepDetail(payload, runtime.status)
        : key === 'raw-embedding'
          ? buildRawTextEmbeddingStepDetail(payload, runtime, isCurrent)
        : (isCurrent ? runtime.currentStep : null),
    }
  })
}

function syncKnowledgeRebuildPayload(payload: KnowledgeRebuildJobPayload, runtime: {
  status: string
  currentStep: string | null
  progress: number
}) {
  const phase = payload.phase ?? 'extract'
  const stageStartedAtByKey = {
    ...(payload.stageStartedAtByKey ?? {}),
  }
  if (!stageStartedAtByKey[phase]) {
    stageStartedAtByKey[phase] = new Date().toISOString()
  }

  const syncedPayload: KnowledgeRebuildJobPayload = {
    ...payload,
    phase,
    totalChapterWeight: Math.max(0, payload.totalChapterWeight ?? 0),
    processedChapterWeight: Math.max(0, payload.processedChapterWeight ?? 0),
    totalChapterCount: Math.max(
      0,
      payload.totalChapterCount
        ?? ((payload.pendingChapterIds?.length ?? 0) + (payload.extractedChapters?.length ?? 0))
    ),
    stageStartedAtByKey,
  }
  syncedPayload.steps = buildKnowledgeRebuildSteps(syncedPayload, runtime)
  return syncedPayload
}

function getChapterProgressWeight(rawText: string | null) {
  const normalized = (rawText ?? '').trim()
  return Math.max(1, normalized.length)
}

function parseKnowledgeRebuildJobPayload(payloadJson: string | null) {
  if (!payloadJson) return null

  try {
    return normalizeKnowledgeRebuildJobPayload(JSON.parse(payloadJson))
  } catch {
    return null
  }
}

function getKnowledgeWriteSettledChapterCount(payload: Pick<KnowledgeRebuildJobPayload, 'totalChapterCount' | 'pendingChapterIds' | 'extractedChapters'>) {
  const totalChapterCount = Math.max(0, Math.floor(payload.totalChapterCount ?? 0))
  const unsettledChapterIds = new Set([
    ...(payload.pendingChapterIds ?? []),
    ...(payload.extractedChapters ?? []).map((chapter) => chapter.chapterId),
  ])
  return Math.max(0, Math.min(totalChapterCount, totalChapterCount - unsettledChapterIds.size))
}

function getKnowledgeWriteProgress(payload: Pick<KnowledgeRebuildJobPayload, 'totalChapterCount' | 'pendingChapterIds' | 'extractedChapters'>) {
  const totalChapterCount = Math.max(0, Math.floor(payload.totalChapterCount ?? 0))
  if (totalChapterCount <= 0) return 0
  return clampProgress(getKnowledgeWriteSettledChapterCount(payload) / totalChapterCount)
}

function getKnowledgeStructuredWorkProgress(state: Pick<KnowledgeRebuildJobState, 'payload' | 'pendingChapterIds' | 'totalChapterWeight' | 'processedChapterWeight' | 'extractedChapters'>) {
  const extractionProgress = state.totalChapterWeight > 0
    ? clampProgress(state.processedChapterWeight / state.totalChapterWeight)
    : state.pendingChapterIds.length === 0
      ? 1
      : 0
  const writeProgress = getKnowledgeWriteProgress({
    totalChapterCount: state.payload.totalChapterCount,
    pendingChapterIds: state.pendingChapterIds,
    extractedChapters: state.extractedChapters,
  })
  return Math.max(0.1, Math.min(0.96, 0.1 + extractionProgress * 0.7 + writeProgress * 0.16))
}

function isKnowledgeRebuildControlError(error: unknown) {
  return error instanceof KnowledgeRebuildPausedError || error instanceof KnowledgeRebuildAbortedError
}

function getRebuildStartChapter(chapters: KnowledgeChapterRow[]) {
  const firstDirtyChapter = chapters.find((chapter) => chapter.isDirty || chapter.knowledgeStatus !== 'ready')
  return firstDirtyChapter?.chapterNo ?? chapters[0]?.chapterNo ?? 1
}

function getRebuildChapters(chapters: KnowledgeChapterRow[], chapterRange: Required<Pick<KnowledgeRebuildChapterRange, 'startChapter'>> & Pick<KnowledgeRebuildChapterRange, 'endChapter'>) {
  return chapters.filter((chapter) => chapterIsInRebuildRange(chapter.chapterNo, chapterRange))
}

function setWriteQueueInKnowledgeJob(jobId: string, chapters: Array<{ chapterId: string; chapterNo: number }>) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  const extractedChapters = Array.from(
    new Map(chapters.map((chapter) => [chapter.chapterId, {
      chapterId: chapter.chapterId,
      chapterNo: chapter.chapterNo,
    }])).values(),
  ).sort((left, right) => left.chapterNo - right.chapterNo)
  const nextState: KnowledgeRebuildJobState = {
    ...state,
    extractedChapters,
  }

  updateKnowledgeJob(jobId, {
    progress: getKnowledgeStructuredWorkProgress(nextState),
    payload: {
      ...state.payload,
      phase: state.phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters,
      currentBatchChapters: extractedChapters,
    },
  })

  return nextState
}

function resetCurrentBatchAndReturnToExtract(jobId: string, state: KnowledgeRebuildJobState) {
  updateKnowledgeJob(jobId, {
    payload: {
      ...state.payload,
      phase: 'extract',
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: [],
      currentBatchChapters: [],
      orderedAliasDiscoveries: [],
      appliedAliasDiscoveryCount: 0,
      stageStartedAtByKey: {
        ...(state.payload.stageStartedAtByKey ?? {}),
        extract: (state.payload.stageStartedAtByKey ?? {}).extract ?? new Date().toISOString(),
      },
    },
  })
}

function getCurrentBatchChaptersForProcessing(state: KnowledgeRebuildJobState, writeQueue: KnowledgeRebuildPayloadChapter[]) {
  const currentBatchChapters = state.payload.currentBatchChapters?.length
    ? state.payload.currentBatchChapters
    : writeQueue
  return currentBatchChapters
    .slice()
    .sort((left, right) => left.chapterNo - right.chapterNo)
}

function getKnowledgeRebuildJobState(jobId: string): KnowledgeRebuildJobState | null {
  const row = queryOne<{ payloadJson: string | null }>('SELECT payloadJson FROM KnowledgeJob WHERE id = ?', jobId)
  const payload = parseKnowledgeRebuildJobPayload(row?.payloadJson ?? null)
  if (!payload) {
    return null
  }

  return {
    payload,
    phase: payload.phase ?? 'extract',
    pendingChapterIds: Array.isArray(payload.pendingChapterIds) ? payload.pendingChapterIds : [],
    chapterWeightsById: payload.chapterWeightsById ?? {},
    totalChapterWeight: typeof payload.totalChapterWeight === 'number' ? Math.max(0, payload.totalChapterWeight) : 0,
    processedChapterWeight: typeof payload.processedChapterWeight === 'number' ? Math.max(0, payload.processedChapterWeight) : 0,
    extractedChapters: Array.isArray(payload.extractedChapters) ? payload.extractedChapters : [],
  }
}

function isKnowledgeRebuildJobStateInitialized(state: KnowledgeRebuildJobState | null) {
  if (!state) return false

  return state.pendingChapterIds.length > 0
    || Object.keys(state.chapterWeightsById).length > 0
    || state.totalChapterWeight > 0
    || state.processedChapterWeight > 0
    || state.extractedChapters.length > 0
    || state.phase !== 'extract'
}

function initializeKnowledgeRebuildJobState(jobId: string, payload: KnowledgeRebuildJobPayload) {
  const pendingChapterIds = payload.pendingChapterIds ?? []
  const chapterWeightsById = payload.chapterWeightsById ?? {}
  const totalChapterWeight =
    typeof payload.totalChapterWeight === 'number'
      ? Math.max(0, payload.totalChapterWeight)
      : pendingChapterIds.reduce((sum, chapterId) => sum + (chapterWeightsById[chapterId] ?? 0), 0)

  updateKnowledgeJob(jobId, {
    payload: {
      ...payload,
      phase: payload.phase ?? 'extract',
      pendingChapterIds,
      chapterWeightsById,
      totalChapterWeight,
      totalChapterCount: Math.max(0, payload.totalChapterCount ?? pendingChapterIds.length),
      currentChapterId: payload.currentChapterId ?? null,
      processedChapterWeight: Math.max(0, payload.processedChapterWeight ?? 0),
      extractedChapters: payload.extractedChapters ?? [],
      currentBatchChapters: payload.currentBatchChapters ?? [],
      embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot(payload),
      stageStartedAtByKey: {
        ...(payload.stageStartedAtByKey ?? {}),
        [payload.phase ?? 'extract']: (payload.stageStartedAtByKey ?? {})[payload.phase ?? 'extract'] ?? new Date().toISOString(),
      },
    },
  })
}

export function mergeKnowledgeRebuildTelemetryPayloadForTesting(
  payload: KnowledgeRebuildJobPayload,
  telemetry: KnowledgeRebuildTelemetryUpdate
): KnowledgeRebuildJobPayload {
  return {
    ...payload,
    rawTextEmbeddingProgress: telemetry.rawTextEmbeddingProgress ?? payload.rawTextEmbeddingProgress,
    rawTextEmbeddingCacheHitRate: telemetry.rawTextEmbeddingCacheHitRate ?? payload.rawTextEmbeddingCacheHitRate,
    rawTextEmbeddingPrecomputeCompleted: telemetry.rawTextEmbeddingPrecomputeCompleted ?? payload.rawTextEmbeddingPrecomputeCompleted,
    stageTimingsMs: {
      ...(payload.stageTimingsMs ?? {}),
      ...(telemetry.stageTimingsMs ?? {}),
    },
    embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot(payload),
  }
}

export function updateKnowledgeRebuildJobTelemetry(jobId: string, telemetry: KnowledgeRebuildTelemetryUpdate) {
  const row = queryOne<{ branchId: string | null; payloadJson: string | null }>(
    'SELECT branchId, payloadJson FROM KnowledgeJob WHERE id = ?',
    jobId
  )
  const parsedPayload = parseKnowledgeRebuildJobPayload(row?.payloadJson ?? null)
  const basePayload: KnowledgeRebuildJobPayload | null = parsedPayload ?? (typeof row?.branchId === 'string' ? { branchId: row.branchId } : null)
  if (!basePayload) return null

  const mergedPayload = mergeKnowledgeRebuildTelemetryPayloadForTesting(basePayload, telemetry)
  const pendingChapterIds = Array.isArray(basePayload.pendingChapterIds) ? basePayload.pendingChapterIds : []
  const chapterWeightsById = basePayload.chapterWeightsById ?? {}
  const extractedChapters = Array.isArray(basePayload.extractedChapters) ? basePayload.extractedChapters : []
  const phase = basePayload.phase ?? 'extract'
  const totalChapterWeight = typeof basePayload.totalChapterWeight === 'number'
    ? Math.max(0, basePayload.totalChapterWeight)
    : 0
  const processedChapterWeight = typeof basePayload.processedChapterWeight === 'number'
    ? Math.max(0, basePayload.processedChapterWeight)
    : 0

  updateKnowledgeJob(jobId, {
    payload: {
      ...mergedPayload,
      phase,
      currentChapterId: basePayload.currentChapterId ?? null,
      pendingChapterIds,
      chapterWeightsById,
      totalChapterWeight,
      processedChapterWeight,
      extractedChapters,
      currentBatchChapters: basePayload.currentBatchChapters ?? [],
      totalChapterCount: basePayload.totalChapterCount ?? (pendingChapterIds.length + extractedChapters.length),
    },
  })

  return {
    phase,
    pendingChapterIds,
    chapterWeightsById,
    totalChapterWeight,
    processedChapterWeight,
    extractedChapters,
    payload: mergedPayload,
  }
}

function setKnowledgeRebuildJobIndexProgress(jobId: string, indexProgress: KnowledgeRebuildIndexProgress) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) {
    return null
  }

  const nextProgress = getIndexProgressValue(indexProgress)
  updateKnowledgeJob(jobId, {
    currentStep: getIndexCurrentStep(indexProgress),
    progress: 0.96 + nextProgress * 0.04,
    payload: {
      ...state.payload,
      phase: state.phase,
      currentChapterId: state.payload.currentChapterId ?? null,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
      currentBatchChapters: state.payload.currentBatchChapters ?? [],
      extractionSettings: state.payload.extractionSettings,
      rawTextEmbeddingProgress: state.payload.rawTextEmbeddingProgress,
      rawTextEmbeddingCacheHitRate: state.payload.rawTextEmbeddingCacheHitRate,
      stageTimingsMs: state.payload.stageTimingsMs,
      embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot(state.payload),
      indexProgress,
    },
  })

  return {
    ...state,
    payload: {
      ...state.payload,
      indexProgress,
    },
  }
}

function removePendingChaptersFromKnowledgeJob(jobId: string, chapterIds: string[]) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state || !chapterIds.length) {
    return state
  }

  const removedIds = new Set(chapterIds.filter((chapterId) => chapterId !== state.payload.currentChapterId))
  if (!removedIds.size) {
    return state
  }

  let removedWeight = 0
  const pendingChapterIds = state.pendingChapterIds.filter((chapterId) => {
    if (!removedIds.has(chapterId)) return true
    removedWeight += state.chapterWeightsById[chapterId] ?? 0
    return false
  })

  if (pendingChapterIds.length === state.pendingChapterIds.length) {
    return state
  }

  const chapterWeightsById = { ...state.chapterWeightsById }
  for (const chapterId of chapterIds) {
    delete chapterWeightsById[chapterId]
  }
  const extractedChapters = state.extractedChapters.filter((chapter) => !removedIds.has(chapter.chapterId))

  const nextState: KnowledgeRebuildJobState = {
    ...state,
    pendingChapterIds,
    chapterWeightsById,
    totalChapterWeight: Math.max(0, state.totalChapterWeight - removedWeight),
    extractedChapters,
  }

  updateKnowledgeJob(jobId, {
    progress: getKnowledgeStructuredWorkProgress(nextState),
    payload: {
      ...state.payload,
      phase: nextState.phase,
      pendingChapterIds: nextState.pendingChapterIds,
      chapterWeightsById: nextState.chapterWeightsById,
      totalChapterWeight: nextState.totalChapterWeight,
      processedChapterWeight: nextState.processedChapterWeight,
      extractedChapters: nextState.extractedChapters,
      currentBatchChapters: state.payload.currentBatchChapters ?? [],
    },
  })

  return nextState
}

function completePendingChapterInKnowledgeJob(
  jobId: string,
  chapterId: string,
  extractedChapter?: KnowledgeRebuildPayloadChapter,
) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) {
    return null
  }

  if (!state.pendingChapterIds.includes(chapterId)) {
    return state
  }

  const chapterWeight = state.chapterWeightsById[chapterId] ?? 0
  const pendingChapterIds = state.pendingChapterIds.filter((id) => id !== chapterId)
  const chapterWeightsById = { ...state.chapterWeightsById }
  delete chapterWeightsById[chapterId]
  const extractedChapters = extractedChapter
    ? Array.from(
        new Map(
          [...state.extractedChapters, extractedChapter].map((chapter) => [chapter.chapterId, chapter]),
        ).values(),
      ).sort((left, right) => left.chapterNo - right.chapterNo)
    : state.extractedChapters

  const nextState: KnowledgeRebuildJobState = {
    ...state,
    pendingChapterIds,
    chapterWeightsById,
    processedChapterWeight: Math.min(state.totalChapterWeight, state.processedChapterWeight + chapterWeight),
    extractedChapters,
  }

  updateKnowledgeJob(jobId, {
    progress: getKnowledgeStructuredWorkProgress(nextState),
    payload: {
      ...state.payload,
      currentChapterId: null,
      phase: state.phase,
      pendingChapterIds: nextState.pendingChapterIds,
      chapterWeightsById: nextState.chapterWeightsById,
      totalChapterWeight: nextState.totalChapterWeight,
      processedChapterWeight: nextState.processedChapterWeight,
      extractedChapters: nextState.extractedChapters,
      currentBatchChapters: state.payload.currentBatchChapters ?? [],
    },
  })

  return nextState
}

function chapterStillExists(chapterId: string) {
  return Boolean(queryOne<{ id: string }>('SELECT id FROM KnowledgeChapter WHERE id = ? LIMIT 1', chapterId)?.id)
}

function setKnowledgeRebuildJobPhase(
  jobId: string,
  phase: NonNullable<KnowledgeRebuildJobPayload['phase']>,
  runtime?: { currentStep?: string; progress?: number },
) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  const nextState: KnowledgeRebuildJobState = {
    ...state,
    phase,
  }

  updateKnowledgeJob(jobId, {
    currentStep: runtime?.currentStep,
    progress: runtime?.progress,
    payload: {
      ...state.payload,
      phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
      currentBatchChapters: state.payload.currentBatchChapters ?? [],
      totalChapterCount: state.payload.totalChapterCount ?? (state.pendingChapterIds.length + state.extractedChapters.length),
      stageStartedAtByKey: {
        ...(state.payload.stageStartedAtByKey ?? {}),
        [phase]: (state.payload.stageStartedAtByKey ?? {})[phase] ?? new Date().toISOString(),
      },
    },
  })

  return nextState
}

function markInlineKnowledgeCleanupCompleted(jobId: string) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  updateKnowledgeJob(jobId, {
    payload: {
      ...state.payload,
      phase: state.phase,
      inlineCleanupCompleted: true,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
      currentBatchChapters: state.payload.currentBatchChapters ?? [],
      stageStartedAtByKey: {
        ...(state.payload.stageStartedAtByKey ?? {}),
        cleanup: (state.payload.stageStartedAtByKey ?? {}).cleanup ?? new Date().toISOString(),
      },
    },
  })

  return getKnowledgeRebuildJobState(jobId)
}

function removeExtractedChapterFromKnowledgeJob(jobId: string, chapterId: string) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  if (!state.extractedChapters.some((chapter) => chapter.chapterId === chapterId)) {
    return state
  }

  const extractedChapters = state.extractedChapters.filter((chapter) => chapter.chapterId !== chapterId)
  const nextState: KnowledgeRebuildJobState = {
    ...state,
    extractedChapters,
  }

  updateKnowledgeJob(jobId, {
    progress: getKnowledgeStructuredWorkProgress(nextState),
    payload: {
      ...state.payload,
      phase: state.phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters,
      currentBatchChapters: extractedChapters.length ? state.payload.currentBatchChapters ?? [] : [],
    },
  })

  return nextState
}

function getKnowledgeJobRow(jobId: string) {
  return queryOne<{ status: string; errorMessage: string | null; payloadJson: string | null }>(
    'SELECT status, errorMessage, payloadJson FROM KnowledgeJob WHERE id = ?',
    jobId
  )
}

function invalidateKnowledgeJobAttempt(jobId: string, updates: Record<string, unknown> = {}) {
  const row = queryOne<{ payloadJson: string | null }>('SELECT payloadJson FROM KnowledgeJob WHERE id = ?', jobId)
  return mergeTaskWatchdogState(parseTaskWatchdogPayload(row?.payloadJson ?? null), {
    ...updates,
    attemptId: createTaskWatchdogAttemptId(),
  })
}

function assertKnowledgeRebuildContinues(jobId: string) {
  const job = getKnowledgeJobRow(jobId)
  if (!job) {
    throw new KnowledgeRebuildAbortedError()
  }

  const expectedAttemptId = knowledgeJobAttemptContext.getStore()?.get(jobId) ?? null
  const currentAttemptId = getTaskWatchdogAttemptId(parseTaskWatchdogPayload(job.payloadJson ?? null))

  if (job.status === 'paused') {
    throw new KnowledgeRebuildPausedError()
  }

  if (job.status !== 'queued' && job.status !== 'running') {
    throw new KnowledgeRebuildAbortedError()
  }

  if (expectedAttemptId && currentAttemptId && currentAttemptId !== expectedAttemptId) {
    throw new KnowledgeRebuildAbortedError()
  }
}

async function waitForKnowledgeJobCompletion(jobId: string, options?: { timeoutMs?: number; pollMs?: number }) {
  await waitForKnowledgeJobCompletionStatus({
    jobId,
    timeoutMs: options?.timeoutMs,
    pollMs: options?.pollMs,
    loadJob: (currentJobId) => queryOne<{ status: string; errorMessage: string | null }>(
      'SELECT status, errorMessage FROM KnowledgeJob WHERE id = ?',
      currentJobId,
    ),
    onTimeout: (timedOutJobId) => {
      updateKnowledgeJob(timedOutJobId, {
        status: 'failed',
        currentStep: progressMessage('progress.timeout'),
        errorMessage: 'Knowledge rebuild timed out',
        payload: invalidateKnowledgeJobAttempt(timedOutJobId, {
          lastAction: 'timed_out',
          lastActionAt: new Date().toISOString(),
        }),
      })
    },
  })
}

function getKnowledgeJobOutcome(jobId: string): KnowledgeRebuildJobOutcome {
  const status = queryOne<{ status: string }>('SELECT status FROM KnowledgeJob WHERE id = ?', jobId)?.status
  if (status === 'paused') return 'paused'
  if (status === 'aborted') return 'aborted'
  return 'completed'
}

function findKnowledgeJobByTypes(params: {
  novelId: string
  branchId: string
  jobTypes: KnowledgeJobType[]
  statuses: string[]
}) {
  if (params.statuses.includes('queued') || params.statuses.includes('running')) {
    reconcileKnowledgeJobWatchdog({
      novelId: params.novelId,
      branchId: params.branchId,
      jobTypes: params.jobTypes,
    })
  }

  const jobTypePlaceholders = params.jobTypes.map(() => '?').join(', ')
  const statusPlaceholders = params.statuses.map(() => '?').join(', ')
  return queryOne<{ id: string; status: string; jobType: KnowledgeJobType }>(
    `
      SELECT id, status, jobType
      FROM KnowledgeJob
      WHERE novelId = ?
        AND branchId = ?
        AND jobType IN (${jobTypePlaceholders})
        AND status IN (${statusPlaceholders})
      ORDER BY updatedAt DESC, createdAt DESC
      LIMIT 1
    `,
    params.novelId,
    params.branchId,
    ...params.jobTypes,
    ...params.statuses,
  )
}

function abortKnowledgeJob(jobId: string) {
  updateKnowledgeJob(jobId, {
    status: 'aborted',
    currentStep: null,
    progress: 0,
    payload: invalidateKnowledgeJobAttempt(jobId, {
      lastAction: 'aborted',
      lastActionAt: new Date().toISOString(),
    }),
  })
}

function pauseKnowledgeJob(jobId: string) {
  updateKnowledgeJob(jobId, {
    status: 'paused',
    currentStep: progressMessage('progress.paused'),
    payload: invalidateKnowledgeJobAttempt(jobId, {
      lastAction: 'paused',
      lastActionAt: new Date().toISOString(),
    }),
  })
}

export async function startKnowledgeRetrievalRebuildForNovel(params: { novelId: string; branchId?: string; chapterRange?: KnowledgeRebuildChapterRange }) {
  return runWithNovelDatabaseAccess(params.novelId, async () => {
    const branchId = params.branchId ?? getMainBranchId(params.novelId)
    const chapterRange = normalizeKnowledgeRebuildChapterRange(params.chapterRange)
    reconcileKnowledgeJobWatchdog({
      novelId: params.novelId,
      branchId,
      jobTypes: [RETRIEVAL_REBUILD_JOB_TYPE],
    })
    const activeJob = queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN ('queued', 'running', 'paused') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1`,
      params.novelId,
      branchId,
      RETRIEVAL_REBUILD_JOB_TYPE,
    )

    if (activeJob?.id) {
      if (activeJob.status === 'paused') {
        updateKnowledgeJob(activeJob.id, { status: 'queued', currentStep: progressMessage('progress.indexResume') })
        return { jobId: activeJob.id, outcome: 'queued' as KnowledgeRebuildStartOutcome }
      }

      return {
        jobId: activeJob.id,
        outcome: activeJob.status === 'running' ? 'running' as const : 'queued' as const,
      }
    }

    const job = await enqueueKnowledgeJob({
      novelId: params.novelId,
      branchId,
      jobType: RETRIEVAL_REBUILD_JOB_TYPE,
      currentStep: progressMessage('progress.indexPrepare'),
      payload: {
        branchId,
        chapterRange,
        rebuildStartChapter: chapterRange?.startChapter,
        phase: 'raw-embedding',
        inlineCleanupCompleted: true,
        pendingChapterIds: [],
        chapterWeightsById: {},
        totalChapterWeight: 0,
        processedChapterWeight: 0,
        extractedChapters: [],
        currentBatchChapters: [],
        totalChapterCount: 0,
        extractionSettings: loadStoredAISettings().knowledgeExtraction,
        embeddingSettingsSnapshot: buildEmbeddingSettingsSnapshot(),
        indexProgress: undefined,
        hanlpBootstrap: createEmptyHanlpBootstrapState(0),
        orderedAliasDiscoveries: [],
        appliedAliasDiscoveryCount: 0,
        stageStartedAtByKey: {
          'raw-embedding': new Date().toISOString(),
        },
      },
    })

    if (!job?.id) {
      throw new Error('Failed to create retrieval rebuild job')
    }

    return { jobId: job.id, outcome: 'queued' as const }
  })
}

export async function runStartedKnowledgeRetrievalRebuildForNovel(params: { novelId: string; branchId?: string; jobId: string; attemptId?: string | null }) {
  return runWithNovelDatabaseAccess(params.novelId, async () => {
    if (activeKnowledgeRetrievalRuns.has(params.jobId)) {
      return
    }

    activeKnowledgeRetrievalRuns.add(params.jobId)
    try {
      await rebuildKnowledgeRetrievalForNovel(params)
    } finally {
      activeKnowledgeRetrievalRuns.delete(params.jobId)
    }
  })
}

async function rebuildKnowledgeRetrievalForNovel(params: RebuildKnowledgeForNovelParams) {
  const branchId = params.branchId ?? getMainBranchId(params.novelId)
  reconcileKnowledgeJobWatchdog({
    novelId: params.novelId,
    branchId,
    jobTypes: [RETRIEVAL_REBUILD_JOB_TYPE],
  })
  const targetedJob = params.jobId
    ? queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM KnowledgeJob WHERE id = ? AND novelId = ? AND branchId = ? AND jobType = ?',
        params.jobId,
        params.novelId,
        branchId,
        RETRIEVAL_REBUILD_JOB_TYPE,
      )
    : null
  const activeJob = targetedJob ?? queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN (\'queued\', \'running\', \'paused\') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1',
    params.novelId,
    branchId,
    RETRIEVAL_REBUILD_JOB_TYPE,
  )

  if (params.jobId && !targetedJob?.id) {
    throw new Error('Retrieval rebuild job not found')
  }

  if (activeJob?.id) {
    if (params.jobId && activeJob.status !== 'queued') {
      if (activeJob.status === 'running') {
        return null
      }

      return { jobId: activeJob.id, outcome: getKnowledgeJobOutcome(activeJob.id) }
    }

    if (!params.jobId && activeJob.status === 'running') {
      await waitForKnowledgeJobCompletion(activeJob.id)
      return { jobId: activeJob.id, outcome: getKnowledgeJobOutcome(activeJob.id) }
    }

    if (!params.jobId && activeJob.status === 'paused') {
      return { jobId: activeJob.id, outcome: 'paused' as const }
    }
  }

  const job = activeJob?.id
    ? { id: activeJob.id }
    : await enqueueKnowledgeJob({
        novelId: params.novelId,
        branchId,
        jobType: RETRIEVAL_REBUILD_JOB_TYPE,
        currentStep: progressMessage('progress.indexPrepare'),
        payload: {
          branchId,
          chapterRange: normalizeKnowledgeRebuildChapterRange(params.chapterRange),
          rebuildStartChapter: normalizeKnowledgeRebuildChapterRange(params.chapterRange)?.startChapter,
          phase: 'raw-embedding',
          inlineCleanupCompleted: true,
          pendingChapterIds: [],
          chapterWeightsById: {},
          totalChapterWeight: 0,
          processedChapterWeight: 0,
          extractedChapters: [],
          currentBatchChapters: [],
          totalChapterCount: 0,
          extractionSettings: loadStoredAISettings().knowledgeExtraction,
          embeddingSettingsSnapshot: buildEmbeddingSettingsSnapshot(),
          indexProgress: undefined,
          hanlpBootstrap: createEmptyHanlpBootstrapState(0),
          orderedAliasDiscoveries: [],
          appliedAliasDiscoveryCount: 0,
          stageStartedAtByKey: {
            'raw-embedding': new Date().toISOString(),
          },
        },
      })

  if (!job?.id) {
    throw new Error('Failed to create retrieval rebuild job')
  }

  let claimedAttemptId: string | null = null
  try {
    const claimedProgress = Math.max(0.94, queryOne<{ progress: number }>('SELECT progress FROM KnowledgeJob WHERE id = ?', job.id)?.progress ?? 0.94)
    const claimedJob = await claimQueuedKnowledgeJob({
      jobId: job.id,
      currentStep: progressMessage('progress.rawEmbeddingWait'),
      progress: claimedProgress,
      expectedAttemptId: params.attemptId,
    })
    if (!claimedJob.claimed) {
      if (claimedJob.status === 'running') {
        if (params.jobId) return { jobId: job.id, outcome: 'running' as const }

        await waitForKnowledgeJobCompletion(job.id)
        return { jobId: job.id, outcome: getKnowledgeJobOutcome(job.id) }
      }

      return { jobId: job.id, outcome: getKnowledgeJobOutcome(job.id) }
    }

    if (!claimedJob.attemptId) {
      throw new Error('Claimed retrieval rebuild job is missing an attempt id')
    }

    claimedAttemptId = claimedJob.attemptId
    return await runKnowledgeJobWithAttempt(job.id, claimedAttemptId, async () => {
      const initialState = getKnowledgeRebuildJobState(job.id)
      const defaultChapterRange = resolveKnowledgeRebuildChapterRange({
        payload: {
          rebuildStartChapter: initialState?.payload.rebuildStartChapter ?? 1,
          chapterRange: initialState?.payload.chapterRange ?? normalizeKnowledgeRebuildChapterRange(params.chapterRange),
        },
        defaultStartChapter: 1,
      })

      updateKnowledgeJob(job.id, {
        currentStep: progressMessage('progress.rawEmbeddingWait'),
        progress: claimedProgress,
        payload: {
          ...(initialState?.payload ?? {}),
          branchId,
          chapterRange: initialState?.payload.chapterRange ?? normalizeKnowledgeRebuildChapterRange(params.chapterRange),
          rebuildStartChapter: initialState?.payload.rebuildStartChapter ?? defaultChapterRange.startChapter,
          phase: initialState?.payload.phase ?? 'raw-embedding',
          inlineCleanupCompleted: true,
          pendingChapterIds: [],
          chapterWeightsById: {},
          totalChapterWeight: 0,
          processedChapterWeight: 0,
          extractedChapters: [],
          currentBatchChapters: [],
          totalChapterCount: 0,
          extractionSettings: initialState?.payload.extractionSettings ?? loadStoredAISettings().knowledgeExtraction,
          embeddingSettingsSnapshot: initialState?.payload.embeddingSettingsSnapshot ?? buildEmbeddingSettingsSnapshot(),
          hanlpBootstrap: initialState?.payload.hanlpBootstrap ?? createEmptyHanlpBootstrapState(0),
          orderedAliasDiscoveries: [],
          appliedAliasDiscoveryCount: 0,
          stageStartedAtByKey: {
            ...(initialState?.payload.stageStartedAtByKey ?? {}),
            'raw-embedding': (initialState?.payload.stageStartedAtByKey ?? {})['raw-embedding'] ?? new Date().toISOString(),
          },
        },
      })

      const rawTextEmbeddingState = setKnowledgeRebuildJobPhase(job.id, 'raw-embedding') ?? getKnowledgeRebuildJobState(job.id)
      const rawTextEmbeddingProgress = typeof rawTextEmbeddingState?.payload.rawTextEmbeddingProgress === 'number'
        ? clampProgress(rawTextEmbeddingState.payload.rawTextEmbeddingProgress)
        : 0
      updateKnowledgeJob(job.id, {
        currentStep: rawTextEmbeddingProgress >= 1 ? progressMessage('progress.rawEmbeddingConfirm') : progressMessage('progress.rawEmbeddingWait'),
        progress: 0.94 + rawTextEmbeddingProgress * 0.02,
      })
      ensureRawTextEmbeddingPrecomputeStarted({
        jobId: job.id,
        novelId: params.novelId,
        branchId,
        chapterRange: rawTextEmbeddingState?.payload.chapterRange ?? defaultChapterRange,
        embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot(rawTextEmbeddingState?.payload ?? { branchId }),
      })
      await waitForRawTextEmbeddingPrecompute(job.id)
      assertKnowledgeRebuildContinues(job.id)

      setKnowledgeRebuildJobPhase(job.id, 'index')
      setKnowledgeRebuildJobIndexProgress(job.id, {
        phase: 'loading',
        totalRows: 0,
        embeddedRows: 0,
        totalBatches: 0,
        completedBatches: 0,
      })
      await rebuildDerivedIndexes({
        novelId: params.novelId,
        branchId,
        chapterRange: rawTextEmbeddingState?.payload.chapterRange ?? defaultChapterRange,
        onProgress: async (indexProgress) => {
          assertKnowledgeRebuildContinues(job.id)
          setKnowledgeRebuildJobIndexProgress(job.id, indexProgress)
        },
      })

      updateKnowledgeJob(job.id, { status: 'succeeded', currentStep: progressMessage('progress.completed'), progress: 1 })

      return { jobId: job.id, outcome: 'completed' as const }
    })
  } catch (error) {
    if (!claimedAttemptId) {
      throw error
    }

    if (error instanceof KnowledgeRebuildPausedError) {
      updateKnowledgeJob(job.id, { status: 'paused', currentStep: progressMessage('progress.paused') }, { expectedAttemptId: claimedAttemptId })
      return { jobId: job.id, outcome: 'paused' as const }
    }

    if (error instanceof KnowledgeRebuildAbortedError) {
      updateKnowledgeJob(job.id, {
        status: 'aborted',
        currentStep: null,
        progress: 0,
        payload: {
          branchId,
          phase: 'raw-embedding',
          currentChapterId: null,
          pendingChapterIds: [],
          chapterWeightsById: {},
          totalChapterWeight: 0,
          totalChapterCount: 0,
          processedChapterWeight: 0,
          extractedChapters: [],
          currentBatchChapters: [],
          extractionSettings: loadStoredAISettings().knowledgeExtraction,
          embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot({ branchId }),
          indexProgress: undefined,
          hanlpBootstrap: createEmptyHanlpBootstrapState(0),
          orderedAliasDiscoveries: [],
          appliedAliasDiscoveryCount: 0,
          stageStartedAtByKey: {},
        },
      }, { expectedAttemptId: claimedAttemptId })
      return { jobId: job.id, outcome: 'aborted' as const }
    }

    updateKnowledgeJob(job.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Knowledge retrieval rebuild failed',
    }, { expectedAttemptId: claimedAttemptId })
    throw error
  }
}

async function withKnowledgeWriteTransaction<T>(novelId: string, callback: () => T | Promise<T>) {
  return withPerNovelWriteTransaction({ novelId, execute, callback })
}

async function clearKnowledgeGraphData(novelId: string, branchId: string) {
  await withKnowledgeWriteTransaction(novelId, async () => {
    execute('DELETE FROM EntityMention WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute(
      'DELETE FROM FactEvidence WHERE factId IN (SELECT id FROM KnowledgeFact WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute('DELETE FROM KnowledgeFact WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM KnowledgeRelation WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM EntityLink WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM EntityState WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute(
      'DELETE FROM EventParticipant WHERE eventId IN (SELECT id FROM KnowledgeEvent WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute('DELETE FROM KnowledgeEvent WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM EventLink WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute('DELETE FROM KnowledgeWorld WHERE novelId = ? AND branchId = ?', novelId, branchId)
    execute(
      'DELETE FROM EntityAppearance WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute(
      'DELETE FROM EntityAlias WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?)',
      novelId,
      branchId
    )
    execute('DELETE FROM KnowledgeEntity WHERE novelId = ? AND branchId = ?', novelId, branchId)
  })
}

function appendChapterRangeSql(columnName: string, range: Required<Pick<KnowledgeRebuildChapterRange, 'startChapter'>> & Pick<KnowledgeRebuildChapterRange, 'endChapter'>) {
  return range.endChapter === undefined
    ? { sql: `${columnName} >= ?`, params: [range.startChapter] as SqlParam[] }
    : { sql: `${columnName} BETWEEN ? AND ?`, params: [range.startChapter, range.endChapter] as SqlParam[] }
}

function clearDerivedKnowledgeInChapterRangeWithinTransaction(
  novelId: string,
  branchId: string,
  chapterRange: Required<Pick<KnowledgeRebuildChapterRange, 'startChapter'>> & Pick<KnowledgeRebuildChapterRange, 'endChapter'>
) {
    const candidateChapterRange = appendChapterRangeSql('chapter_no', chapterRange)
    const mentionRange = appendChapterRangeSql('chapterNo', chapterRange)
    const sourceChapterRange = appendChapterRangeSql('sourceChapter', chapterRange)
    const eventChapterRange = appendChapterRangeSql('chapterNo', chapterRange)
    const worldRange = appendChapterRangeSql('validFromChapter', chapterRange)
    const firstSeenRange = appendChapterRangeSql('firstSeenChapter', chapterRange)
    execute(
      `
        DELETE FROM character_candidate_chapters
        WHERE novel_id = ?
          AND branch_id = ?
          AND ${candidateChapterRange.sql}
          AND candidate_id IN (
            SELECT id
            FROM character_candidates
            WHERE novel_id = ? AND branch_id = ? AND promoted_entity_id IS NULL
          )
      `,
      novelId,
      branchId,
      ...candidateChapterRange.params,
      novelId,
      branchId,
    )
    refreshCharacterCandidatesAfterChapterCleanup({ novelId, branchId })
    execute(
      `DELETE FROM EntityMention WHERE novelId = ? AND branchId = ? AND ${mentionRange.sql}`,
      novelId,
      branchId,
      ...mentionRange.params
    )
    execute(
      `
        DELETE FROM FactEvidence
        WHERE factId IN (SELECT id FROM KnowledgeFact WHERE novelId = ? AND branchId = ?)
          AND (${appendChapterRangeSql('chapterNo', chapterRange).sql}
           OR factId IN (
              SELECT id FROM KnowledgeFact
              WHERE novelId = ? AND branchId = ? AND ${sourceChapterRange.sql} AND status != 'user_confirmed'
            ))
      `,
      novelId,
      branchId,
      ...appendChapterRangeSql('chapterNo', chapterRange).params,
      novelId,
      branchId,
      ...sourceChapterRange.params
    )
    execute(
      `DELETE FROM KnowledgeFact WHERE novelId = ? AND branchId = ? AND ${sourceChapterRange.sql} AND status != 'user_confirmed'`,
      novelId,
      branchId,
      ...sourceChapterRange.params
    )
    execute(
      `DELETE FROM KnowledgeRelation WHERE novelId = ? AND branchId = ? AND ${sourceChapterRange.sql} AND status != 'user_confirmed'`,
      novelId,
      branchId,
      ...sourceChapterRange.params
    )
    execute(
      `DELETE FROM EntityLink WHERE novelId = ? AND branchId = ? AND ${sourceChapterRange.sql} AND status != 'user_confirmed'`,
      novelId,
      branchId,
      ...sourceChapterRange.params
    )
    execute(
      `DELETE FROM EntityState WHERE novelId = ? AND branchId = ? AND ${sourceChapterRange.sql} AND status != 'user_confirmed'`,
      novelId,
      branchId,
      ...sourceChapterRange.params
    )
    execute(
      `DELETE FROM EventParticipant WHERE eventId IN (SELECT id FROM KnowledgeEvent WHERE novelId = ? AND branchId = ? AND ${eventChapterRange.sql} AND status != 'user_confirmed')`,
      novelId,
      branchId,
      ...eventChapterRange.params
    )
    execute(
      `DELETE FROM KnowledgeEvent WHERE novelId = ? AND branchId = ? AND ${eventChapterRange.sql} AND status != 'user_confirmed'`,
      novelId,
      branchId,
      ...eventChapterRange.params
    )
    execute(
      `DELETE FROM EventLink WHERE novelId = ? AND branchId = ? AND ${sourceChapterRange.sql} AND status != 'user_confirmed'`,
      novelId,
      branchId,
      ...sourceChapterRange.params
    )
    execute(
      `DELETE FROM KnowledgeWorld WHERE novelId = ? AND branchId = ? AND ${worldRange.sql} AND status != 'user_confirmed'`,
      novelId,
      branchId,
      ...worldRange.params
    )
    execute(
      `DELETE FROM EntityAppearance WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND id NOT IN (SELECT promoted_entity_id FROM character_candidates WHERE novel_id = ? AND branch_id = ? AND promoted_entity_id IS NOT NULL)) AND ${mentionRange.sql}`,
      novelId,
      branchId,
      novelId,
      branchId,
      ...mentionRange.params
    )
    execute(
      `DELETE FROM EntityAliasMapping WHERE novelId = ? AND branchId = ? AND ${sourceChapterRange.sql} AND entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND userConfirmed = 0 AND id NOT IN (SELECT promoted_entity_id FROM character_candidates WHERE novel_id = ? AND branch_id = ? AND promoted_entity_id IS NOT NULL))`,
      novelId,
      branchId,
      ...sourceChapterRange.params,
      novelId,
      branchId,
      novelId,
      branchId,
    )
    execute(
      `DELETE FROM EntityAlias WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND id NOT IN (SELECT promoted_entity_id FROM character_candidates WHERE novel_id = ? AND branch_id = ? AND promoted_entity_id IS NOT NULL)) AND ${sourceChapterRange.sql}`,
      novelId,
      branchId,
      novelId,
      branchId,
      ...sourceChapterRange.params
    )
    if (chapterRange.endChapter === undefined) {
      execute(
        `DELETE FROM EntityAlias WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND ${firstSeenRange.sql} AND userConfirmed = 0 AND id NOT IN (SELECT promoted_entity_id FROM character_candidates WHERE novel_id = ? AND branch_id = ? AND promoted_entity_id IS NOT NULL))`,
        novelId,
        branchId,
        ...firstSeenRange.params,
        novelId,
        branchId
      )
      execute(
        `DELETE FROM EntityAppearance WHERE entityId IN (SELECT id FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND ${firstSeenRange.sql} AND userConfirmed = 0 AND id NOT IN (SELECT promoted_entity_id FROM character_candidates WHERE novel_id = ? AND branch_id = ? AND promoted_entity_id IS NOT NULL))`,
        novelId,
        branchId,
        ...firstSeenRange.params,
        novelId,
        branchId
      )
      execute(
        `DELETE FROM KnowledgeEntity WHERE novelId = ? AND branchId = ? AND ${firstSeenRange.sql} AND userConfirmed = 0 AND id NOT IN (SELECT promoted_entity_id FROM character_candidates WHERE novel_id = ? AND branch_id = ? AND promoted_entity_id IS NOT NULL)`,
        novelId,
        branchId,
        ...firstSeenRange.params,
        novelId,
        branchId
      )
    }
    execute(
      `
        UPDATE KnowledgeEntity
        SET lastSeenChapter = COALESCE(
              (
                SELECT MAX(a.chapterNo)
                FROM EntityAppearance a
                WHERE a.entityId = KnowledgeEntity.id
              ),
              (
                SELECT c.last_seen_chapter
                FROM character_candidates c
                WHERE c.promoted_entity_id = KnowledgeEntity.id
                LIMIT 1
              ),
              firstSeenChapter
            ),
            updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
      `,
      novelId,
      branchId
    )
    execute(
      `
        UPDATE KnowledgeChapter
        SET summary = NULL,
            knowledgeStatus = 'stale',
            updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ? AND ${appendChapterRangeSql('chapterNo', chapterRange).sql}
      `,
      novelId,
      branchId,
      ...appendChapterRangeSql('chapterNo', chapterRange).params
    )
}

function readChapterExtractionCandidate(row: ChapterExtractionCandidateRow | null | undefined): ChapterExtractionCandidate | null {
  if (!row) return null

  return {
    id: row.id,
    chapterId: row.chapterId,
    chapterNo: row.chapterNo,
    chapterRevision: row.chapterRevision,
    chapterSourceHash: row.chapterSourceHash,
    extractionJson: row.extractionJson,
    processingBatchId: row.processingBatchId,
    processingBatchContextJson: row.processingBatchContextJson,
    processingResultJson: row.processingResultJson,
    status: row.status,
    provider: row.provider,
    model: row.model,
    errorMessage: row.errorMessage,
  }
}

function loadChapterExtractionCandidate(params: { branchId: string; chapterId: string; chapterSourceHash: string }) {
  return readChapterExtractionCandidate(
    queryOne<ChapterExtractionCandidateRow>(
      `
        SELECT chapter_extraction_candidates.id AS id,
               chapter_extraction_candidates.novel_id AS novelId,
               chapter_extraction_candidates.branch_id AS branchId,
               chapter_extraction_candidates.chapter_id AS chapterId,
               chapter_extraction_candidates.chapter_no AS chapterNo,
               chapter_extraction_candidates.chapter_revision AS chapterRevision,
               chapter_extraction_candidates.chapter_source_hash AS chapterSourceHash,
               chapter_extraction_candidates.extraction_json AS extractionJson,
               chapter_extraction_candidates.processing_batch_id AS processingBatchId,
               chapter_extraction_processing_batches.batch_context_json AS processingBatchContextJson,
               chapter_extraction_candidates.processing_result_json AS processingResultJson,
               chapter_extraction_candidates.status AS status,
               chapter_extraction_candidates.provider AS provider,
               chapter_extraction_candidates.model AS model,
               chapter_extraction_candidates.error_message AS errorMessage
        FROM chapter_extraction_candidates
        LEFT JOIN chapter_extraction_processing_batches
          ON chapter_extraction_processing_batches.id = chapter_extraction_candidates.processing_batch_id
        WHERE chapter_extraction_candidates.branch_id = ?
          AND chapter_extraction_candidates.chapter_id = ?
          AND chapter_extraction_candidates.chapter_source_hash = ?
        LIMIT 1
      `,
      params.branchId,
      params.chapterId,
      params.chapterSourceHash
    )
  )
}

function loadChapterExtractionCandidatesForBatch(params: {
  branchId: string
  chapters: Array<{ chapterId: string; chapterSourceHash: string }>
}) {
  const uniqueChapters = Array.from(
    new Map(params.chapters.map((chapter) => [`${chapter.chapterId}:${chapter.chapterSourceHash}`, chapter])).values()
  )
  if (!uniqueChapters.length) {
    return new Map<string, ChapterExtractionCandidate>()
  }

  const matchSql = uniqueChapters
    .map(() => '(chapter_extraction_candidates.chapter_id = ? AND chapter_extraction_candidates.chapter_source_hash = ?)')
    .join(' OR ')
  const rows = queryAll<ChapterExtractionCandidateRow>(
    `
      SELECT chapter_extraction_candidates.id AS id,
             chapter_extraction_candidates.novel_id AS novelId,
             chapter_extraction_candidates.branch_id AS branchId,
             chapter_extraction_candidates.chapter_id AS chapterId,
             chapter_extraction_candidates.chapter_no AS chapterNo,
             chapter_extraction_candidates.chapter_revision AS chapterRevision,
             chapter_extraction_candidates.chapter_source_hash AS chapterSourceHash,
             chapter_extraction_candidates.extraction_json AS extractionJson,
             chapter_extraction_candidates.processing_batch_id AS processingBatchId,
             chapter_extraction_processing_batches.batch_context_json AS processingBatchContextJson,
             chapter_extraction_candidates.processing_result_json AS processingResultJson,
             chapter_extraction_candidates.status AS status,
             chapter_extraction_candidates.provider AS provider,
             chapter_extraction_candidates.model AS model,
             chapter_extraction_candidates.error_message AS errorMessage
      FROM chapter_extraction_candidates
      LEFT JOIN chapter_extraction_processing_batches
        ON chapter_extraction_processing_batches.id = chapter_extraction_candidates.processing_batch_id
      WHERE chapter_extraction_candidates.branch_id = ?
        AND (${matchSql})
    `,
    params.branchId,
    ...uniqueChapters.flatMap((chapter) => [chapter.chapterId, chapter.chapterSourceHash]),
  )

  const candidates = new Map<string, ChapterExtractionCandidate>()
  for (const row of rows) {
    const candidate = readChapterExtractionCandidate(row)
    if (candidate) {
      candidates.set(candidate.chapterId, candidate)
    }
  }
  return candidates
}

function getKnowledgeExtractionSettingsVersionPayload(settings: KnowledgeExtractionScenarioSettings) {
  return settings.provider === 'openai-compatible'
    ? {
        provider: settings.provider,
        model: settings.openAICompatible.model,
        baseUrl: settings.openAICompatible.baseUrl,
        parallelism: settings.openAICompatible.parallelism,
        configured: settings.openAICompatible.configured,
      }
    : {
        provider: settings.provider,
        model: settings.ollama.model,
        baseUrl: settings.ollama.baseUrl,
        parallelism: settings.ollama.parallelism,
        configured: settings.ollama.configured,
      }
}

export function buildChapterExtractionCandidateSourceHash(params: {
  chapterSourceHash: string
  settings: KnowledgeExtractionScenarioSettings
}) {
  return hashContent(JSON.stringify({
    chapterSourceHash: params.chapterSourceHash,
    settings: getKnowledgeExtractionSettingsVersionPayload(params.settings),
    schemaVersion: CHAPTER_EXTRACTION_CANDIDATE_SCHEMA_VERSION,
  }))
}

function buildChapterExtractionBatchProcessingContext(params: {
  chapters: Array<{ chapterId: string; chapterNo: number }>
  aliasDiscoveries: KnowledgeRebuildBatchAliasDiscovery[]
}): ChapterExtractionBatchProcessingContext {
  const orderedChapters = params.chapters.slice().sort((left, right) => left.chapterNo - right.chapterNo)
  const orderedAliasDiscoveries = params.aliasDiscoveries.slice().sort((left, right) => {
    if (left.chapterNo !== right.chapterNo) return left.chapterNo - right.chapterNo
    return left.outputOrder - right.outputOrder
  })

  return {
    chapterIds: orderedChapters.map((chapter) => chapter.chapterId),
    chapterNos: orderedChapters.map((chapter) => chapter.chapterNo),
    aliasDiscoveries: orderedAliasDiscoveries,
  }
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameNumberList(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function batchProcessingContextMatches(left: ChapterExtractionBatchProcessingContext, right: ChapterExtractionBatchProcessingContext) {
  return sameStringList(left.chapterIds, right.chapterIds)
    && sameNumberList(left.chapterNos, right.chapterNos)
    && JSON.stringify(left.aliasDiscoveries) === JSON.stringify(right.aliasDiscoveries)
}

function readChapterExtractionBatchProcessingContext(value: string | null | undefined) {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as {
      schemaVersion?: string
      batch?: ChapterExtractionBatchProcessingContext
    } | ChapterExtractionBatchProcessingContext | null
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if ('chapterIds' in parsed && 'chapterNos' in parsed && 'aliasDiscoveries' in parsed) {
      return parsed as ChapterExtractionBatchProcessingContext
    }
    if ('schemaVersion' in parsed && parsed.schemaVersion === CHAPTER_EXTRACTION_BATCH_CONTEXT_SCHEMA_VERSION && 'batch' in parsed) {
      return parsed.batch ?? null
    }
    return null
  } catch {
    return null
  }
}

function readResolvedChapterExtractionProcessingCache(value: string | null | undefined) {
  if (!value) return null

  try {
    const parsed = JSON.parse(value) as Partial<ChapterExtractionResolvedProcessingCache> | null
    if (!parsed || parsed.schemaVersion !== CHAPTER_EXTRACTION_RESOLVED_SCHEMA_VERSION || !parsed.resolved) {
      return null
    }
    return parsed.resolved
  } catch {
    return null
  }
}

function readChapterExtractionProcessingCache(candidate: Pick<ChapterExtractionCandidate, 'processingBatchId' | 'processingBatchContextJson' | 'processingResultJson'>, context: ChapterExtractionBatchProcessingContext | undefined) {
  if (!candidate.processingResultJson || !context) return null

  const resolved = readResolvedChapterExtractionProcessingCache(candidate.processingResultJson)
  if (resolved) {
    const sharedContext = readChapterExtractionBatchProcessingContext(candidate.processingBatchContextJson)
    if (candidate.processingBatchId && sharedContext && batchProcessingContextMatches(sharedContext, context)) {
      return resolved
    }
  }

  if (candidate.processingBatchId) {
    return null
  }

  try {
    const parsed = JSON.parse(candidate.processingResultJson) as Partial<ChapterExtractionProcessingCache> | null
    if (!parsed || parsed.schemaVersion !== CHAPTER_EXTRACTION_PROCESSING_SCHEMA_VERSION || !parsed.batch || !parsed.resolved) {
      return null
    }
    if (!batchProcessingContextMatches(parsed.batch, context)) {
      return null
    }
    return parsed.resolved
  } catch {
    return null
  }
}

function serializeChapterExtractionProcessingCache(params: {
  batchContext: ChapterExtractionBatchProcessingContext
  resolved: ResolvedChapterKnowledge
}) {
  return JSON.stringify({
    schemaVersion: CHAPTER_EXTRACTION_RESOLVED_SCHEMA_VERSION,
    resolved: params.resolved,
  } satisfies ChapterExtractionResolvedProcessingCache)
}

function serializeChapterExtractionBatchProcessingContext(batchContext: ChapterExtractionBatchProcessingContext) {
  return JSON.stringify({
    schemaVersion: CHAPTER_EXTRACTION_BATCH_CONTEXT_SCHEMA_VERSION,
    batch: batchContext,
  })
}

function buildChapterExtractionBatchIdentityHash(batchContext: ChapterExtractionBatchProcessingContext) {
  return hashContent(serializeChapterExtractionBatchProcessingContext(batchContext))
}

function createOrReuseChapterExtractionProcessingBatch(params: {
  novelId: string
  branchId: string
  batchContext: ChapterExtractionBatchProcessingContext
}) {
  const batchContextJson = serializeChapterExtractionBatchProcessingContext(params.batchContext)
  const batchIdentityHash = buildChapterExtractionBatchIdentityHash(params.batchContext)
  const existing = queryOne<{ id: string }>(
    'SELECT id FROM chapter_extraction_processing_batches WHERE branch_id = ? AND batch_identity_hash = ? LIMIT 1',
    params.branchId,
    batchIdentityHash,
  )

  if (existing?.id) {
    execute(
      `
        UPDATE chapter_extraction_processing_batches
        SET novel_id = ?,
            batch_context_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      params.novelId,
      batchContextJson,
      existing.id,
    )
    return existing.id
  }

  const batchId = uid('candidate-batch')
  execute(
    `
      INSERT INTO chapter_extraction_processing_batches (
        id, novel_id, branch_id, batch_identity_hash, batch_context_json
      ) VALUES (?, ?, ?, ?, ?)
    `,
    batchId,
    params.novelId,
    params.branchId,
    batchIdentityHash,
    batchContextJson,
  )
  return batchId
}

function assignChapterExtractionProcessingBatch(params: {
  branchId: string
  chapterId: string
  chapterSourceHash: string
  processingBatchId: string
}) {
  execute(
    `
      UPDATE chapter_extraction_candidates
      SET processing_batch_id = ?,
          processing_result_json = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE branch_id = ? AND chapter_id = ? AND chapter_source_hash = ?
    `,
    params.processingBatchId,
    params.branchId,
    params.chapterId,
    params.chapterSourceHash,
  )
}

function updateHanlpBootstrapState(jobId: string, updater: (state: KnowledgeRebuildHanlpBootstrapState) => KnowledgeRebuildHanlpBootstrapState) {
  const state = getKnowledgeRebuildJobState(jobId)
  if (!state) return null

  const nextHanlpBootstrap = updater(state.payload.hanlpBootstrap ?? createEmptyHanlpBootstrapState(state.payload.totalChapterCount ?? 0))
  updateKnowledgeJob(jobId, {
    payload: {
      ...state.payload,
      phase: state.phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
      hanlpBootstrap: nextHanlpBootstrap,
    },
  })

  return {
    ...state,
    payload: {
      ...state.payload,
      hanlpBootstrap: nextHanlpBootstrap,
    },
  }
}

function completeHanlpBootstrapChapterInKnowledgeJob(jobId: string, chapterId: string, source: 'cache' | 'runner') {
  return updateHanlpBootstrapState(jobId, (state) => {
    if (state.completedChapterIds.includes(chapterId)) {
      return state
    }

    return {
      ...state,
      completedChapterIds: [...state.completedChapterIds, chapterId],
      completedChapterCount: state.completedChapterCount + 1,
      cacheHitCount: state.cacheHitCount + (source === 'cache' ? 1 : 0),
      cacheMissCount: state.cacheMissCount + (source === 'runner' ? 1 : 0),
    }
  })
}

function applyHanlpBootstrapCoverageToKnowledgeJob(jobId: string, chapters: KnowledgeChapterRow[], validThroughChapterNo: number) {
  const normalizedChapterNo = Math.max(0, Math.floor(validThroughChapterNo))
  return updateHanlpBootstrapState(jobId, (state) => {
    const currentChapterIds = new Set(chapters.map((chapter) => chapter.id))
    const completedChapterIds = new Set(state.completedChapterIds.filter((chapterId) => currentChapterIds.has(chapterId)))
    for (const chapter of chapters) {
      if (chapter.chapterNo <= normalizedChapterNo) {
        completedChapterIds.add(chapter.id)
      }
    }

    return {
      ...state,
      completedChapterIds: [...completedChapterIds],
      totalChapterCount: chapters.length,
      completedChapterCount: completedChapterIds.size,
    }
  })
}

function markHanlpBootstrapCharacterInitializationCompleted(jobId: string) {
  return updateHanlpBootstrapState(jobId, (state) => ({
    ...state,
    initializedCharacterEntities: true,
  }))
}

function upsertChapterExtractionCandidate(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  chapterRevision?: number | null
  chapterSourceHash: string
  extractionJson: string
  processingBatchId?: string | null
  processingResultJson?: string | null
  status: ChapterExtractionCandidateStatus
  provider?: string | null
  model?: string | null
  errorMessage?: string | null
}) {
  execute(
    `
      UPDATE chapter_extraction_candidates
      SET status = 'stale',
          processing_batch_id = NULL,
          processing_result_json = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE branch_id = ? AND chapter_id = ? AND chapter_source_hash != ?
    `,
    params.branchId,
    params.chapterId,
    params.chapterSourceHash
  )

  execute(
    `
      INSERT INTO chapter_extraction_candidates (
        id,
        novel_id,
        branch_id,
        chapter_id,
        chapter_no,
        chapter_revision,
        chapter_source_hash,
        extraction_json,
        processing_batch_id,
        processing_result_json,
        status,
        provider,
        model,
        error_message
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(branch_id, chapter_id, chapter_source_hash) DO UPDATE SET
        chapter_no = excluded.chapter_no,
        chapter_revision = excluded.chapter_revision,
        extraction_json = excluded.extraction_json,
        processing_batch_id = CASE
          WHEN ? THEN chapter_extraction_candidates.processing_batch_id
          ELSE excluded.processing_batch_id
        END,
        processing_result_json = CASE
          WHEN ? THEN chapter_extraction_candidates.processing_result_json
          ELSE excluded.processing_result_json
        END,
        status = excluded.status,
        provider = excluded.provider,
        model = excluded.model,
        error_message = excluded.error_message,
        updated_at = CURRENT_TIMESTAMP
    `,
    uid('candidate'),
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    params.chapterRevision ?? null,
    params.chapterSourceHash,
    params.extractionJson,
    params.processingBatchId ?? null,
    params.processingResultJson ?? null,
    params.status,
    params.provider ?? null,
    params.model ?? null,
    params.errorMessage ?? null,
    params.processingBatchId === undefined ? 1 : 0,
    params.processingResultJson === undefined ? 1 : 0,
  )
}

function updateChapterKnowledgeStatus(params: {
  chapterId: string
  knowledgeStatus: string
  dirtyReason?: string | null
}) {
  execute(
    `
      UPDATE KnowledgeChapter
      SET knowledgeStatus = ?,
          dirtyReason = ?,
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    params.knowledgeStatus,
    params.dirtyReason ?? null,
    params.chapterId
  )
}

function updateExistingChapterExtractionCandidate(params: {
  candidateId: string
  status: ChapterExtractionCandidateStatus
  errorMessage?: string | null
  processingBatchId?: string | null
  processingResultJson?: string | null
}) {
  if (params.processingResultJson === undefined && params.processingBatchId === undefined) {
    execute(
      `
        UPDATE chapter_extraction_candidates
        SET status = ?,
            error_message = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      params.status,
      params.errorMessage ?? null,
      params.candidateId
    )
    return
  }

  execute(
    `
      UPDATE chapter_extraction_candidates
      SET status = ?,
          error_message = ?,
          processing_batch_id = CASE
            WHEN ? THEN processing_batch_id
            ELSE ?
          END,
          processing_result_json = CASE
            WHEN ? THEN processing_result_json
            ELSE ?
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    params.status,
    params.errorMessage ?? null,
    params.processingBatchId === undefined ? 1 : 0,
    params.processingBatchId ?? null,
    params.processingResultJson === undefined ? 1 : 0,
    params.processingResultJson ?? null,
    params.candidateId
  )
}

async function extractChapterCandidates(params: {
  novelId: string
  branchId: string
  chapter: KnowledgeChapterRow
  settings: KnowledgeExtractionScenarioSettings
  assertCanContinue?: () => void | Promise<void>
}) {
  const candidateSourceHash = buildChapterExtractionCandidateSourceHash({
    chapterSourceHash: params.chapter.sourceHash,
    settings: params.settings,
  })
  const existing = loadChapterExtractionCandidate({
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterSourceHash: candidateSourceHash,
  })
  if (existing?.status === 'extracted' || existing?.status === 'persisted') {
    return existing
  }

  const storyStateText = buildKnowledgeExtractionStoryState({
    novelId: params.novelId,
    branchId: params.branchId,
    asOfChapter: Math.max(0, params.chapter.chapterNo - 1),
    currentChapterText: params.chapter.rawText,
  })
  const hanlpPromptContextText = buildHanlpCurrentChapterPromptContextText({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterNo: params.chapter.chapterNo,
  })
  const extractionStoryStateText = [storyStateText.trim(), hanlpPromptContextText.trim()]
    .filter(Boolean)
    .join('\n\n')

  upsertChapterExtractionCandidate({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterNo: params.chapter.chapterNo,
    chapterRevision: params.chapter.revision,
    chapterSourceHash: candidateSourceHash,
    extractionJson: existing?.extractionJson ?? '{}',
    processingBatchId: null,
    status: 'extracting',
    errorMessage: null,
  })

  const chapterLike = toChapterLike({
    chapterId: params.chapter.id,
    novelId: params.novelId,
    title: params.chapter.title ?? `第${params.chapter.chapterNo}章`,
    chapterNo: params.chapter.chapterNo,
    rawText: params.chapter.rawText,
  })
  const extractionResult = await extractChapterKnowledgeOffline({
    chapter: chapterLike,
    chapterNo: params.chapter.chapterNo,
    storyStateText: extractionStoryStateText,
    settings: params.settings,
    assertCanContinue: params.assertCanContinue,
  })

  await params.assertCanContinue?.()

  upsertChapterExtractionCandidate({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterNo: params.chapter.chapterNo,
    chapterRevision: params.chapter.revision,
    chapterSourceHash: candidateSourceHash,
    extractionJson: JSON.stringify(extractionResult.extraction),
    processingBatchId: null,
    processingResultJson: null,
    status: 'extracted',
    provider: extractionResult.provider,
    model: extractionResult.model,
    errorMessage: null,
  })

  return loadChapterExtractionCandidate({
    branchId: params.branchId,
    chapterId: params.chapter.id,
    chapterSourceHash: candidateSourceHash,
  })
}

function buildHanlpCurrentChapterPromptContextText(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
}) {
  const rows = queryAll<HanlpChapterEntityPromptRow>(
    `
      SELECT entity_text AS entityText,
             entity_type AS entityType,
             MAX(total_count) AS totalCount,
             MAX(score) AS score
      FROM hanlp_bootstrap_entities
      WHERE branch_id = ? AND chapter_id = ?
      GROUP BY entity_type, entity_text
      ORDER BY entity_type ASC, MAX(total_count) DESC, MAX(score) DESC, entity_text ASC
    `,
    params.branchId,
    params.chapterId,
  )

  if (!rows.length) {
    return ''
  }

  const tierGroups = new Map<string, string[]>()
  const otherCharacters: string[] = []
  const appendTierLine = (label: string, line: string) => {
    const existing = tierGroups.get(label) ?? []
    if (!existing.includes(line)) {
      existing.push(line)
      tierGroups.set(label, existing)
    }
  }

  const formatSimpleTerms = (entityType: HanlpChapterEntityPromptRow['entityType']) => {
    return Array.from(new Set(rows
      .filter((row) => row.entityType === entityType)
      .map((row) => row.entityText.trim())
      .filter(Boolean)))
  }

  const seenResolvedEntityIds = new Set<string>()
  const seenOtherCharacters = new Set<string>()

  for (const row of rows.filter((item) => item.entityType === 'person')) {
    const normalizedName = normalizeCharacterMentionName(row.entityText)
    if (!normalizedName) continue

    const resolution = resolveCharacterEntityByName({
      branchId: params.branchId,
      name: normalizedName,
      chapterNo: params.chapterNo,
    })

    if (resolution.kind !== 'resolved') {
      if (!seenOtherCharacters.has(normalizedName)) {
        seenOtherCharacters.add(normalizedName)
        otherCharacters.push(normalizedName)
      }
      continue
    }

    if (seenResolvedEntityIds.has(resolution.entityId)) {
      continue
    }
    seenResolvedEntityIds.add(resolution.entityId)

    const entity = queryOne<{
      canonicalName: string
      importanceTier: CharacterImportanceTier | null
    }>(
      'SELECT canonicalName, importanceTier FROM KnowledgeEntity WHERE id = ? LIMIT 1',
      resolution.entityId,
    )
    if (!entity?.canonicalName) {
      continue
    }

    const aliases = queryAll<{ alias: string }>(
      'SELECT alias FROM EntityAlias WHERE entityId = ? ORDER BY alias ASC',
      resolution.entityId,
    )
      .map((item) => item.alias.trim())
      .filter((alias) => Boolean(alias) && alias !== entity.canonicalName)
    if (normalizedName !== entity.canonicalName && !aliases.includes(normalizedName)) {
      aliases.push(normalizedName)
    }

    const nameText = aliases.length
      ? `${entity.canonicalName}（别名：${aliases.join('、')}）`
      : entity.canonicalName
    const profile = (entity.importanceTier === 'protagonist' || entity.importanceTier === 'important')
      ? loadMergedCharacterProfileAtChapter({
          novelId: params.novelId,
          branchId: params.branchId,
          entityId: resolution.entityId,
          chapterNo: Math.max(0, params.chapterNo - 1),
        })
      : {}
    const profileLines = buildCharacterRoleCardLines(profile, { includeEvidence: false, includeNotes: true })
    const line = profileLines.length
      ? `${nameText}｜角色卡：${profileLines.join('｜')}`
      : nameText

    switch (entity.importanceTier) {
      case 'protagonist':
        appendTierLine('Tier 0 主角', line)
        break
      case 'important':
        appendTierLine('Tier 1 重要配角', line)
        break
      case 'arc':
        appendTierLine('Tier 2 篇章配角', line)
        break
      default:
        if (!seenOtherCharacters.has(line)) {
          seenOtherCharacters.add(line)
          otherCharacters.push(line)
        }
        break
    }
  }

  const lines = [
    'HanLP 当前章节实体提示（仅作称呼判别与本章背景补充，不能替代原文证据）：',
    '主角和重要配角若附带角色卡，只能用于判断本章 delta；本章新增/变化仍必须由章节正文证据支持。',
  ]

  for (const label of ['Tier 0 主角', 'Tier 1 重要配角', 'Tier 2 篇章配角']) {
    const entries = tierGroups.get(label) ?? []
    if (entries.length) {
      lines.push(`- ${label}：${entries.join('；')}`)
    }
  }
  if (otherCharacters.length) {
    lines.push(`- 其他 HanLP 人物：${otherCharacters.join('；')}`)
  }

  const locations = formatSimpleTerms('location')
  const organizations = formatSimpleTerms('organization')
  const settings = formatSimpleTerms('setting')
  if (locations.length) {
    lines.push(`- HanLP 地点词：${locations.join('、')}`)
  }
  if (organizations.length) {
    lines.push(`- HanLP 组织词：${organizations.join('、')}`)
  }
  if (settings.length) {
    lines.push(`- HanLP 场景/设定词：${settings.join('、')}`)
  }

  return lines.length > 1 ? lines.join('\n') : ''
}

function loadHanlpWorldCategoryByTerm(params: {
  branchId: string
  chapterId: string
}) {
  const rows = queryAll<{
    entityText: string
    entityType: HanlpWorldCategory
  }>(
    `
      SELECT entity_text AS entityText,
             entity_type AS entityType
      FROM hanlp_bootstrap_entities
      WHERE branch_id = ?
        AND chapter_id = ?
        AND entity_type IN ('location', 'organization', 'setting')
      GROUP BY entity_type, entity_text
      ORDER BY entity_text ASC,
               MAX(total_count) DESC,
               MAX(score) DESC,
               CASE entity_type
                 WHEN 'location' THEN 0
                 WHEN 'organization' THEN 1
                 WHEN 'setting' THEN 2
                 ELSE 3
               END ASC
    `,
    params.branchId,
    params.chapterId,
  )

  const categoryByTerm = new Map<string, HanlpWorldCategory>()
  for (const row of rows) {
    const term = row.entityText.trim()
    if (!term || categoryByTerm.has(term)) continue
    categoryByTerm.set(term, row.entityType)
  }
  return categoryByTerm
}

function buildBatchAliasDiscoveryPlan(params: {
  branchId: string
  chapters: Array<{ chapterId: string; chapterNo: number; chapterSourceHash: string }>
}) {
  const candidateByChapterId = loadChapterExtractionCandidatesForBatch({
    branchId: params.branchId,
    chapters: params.chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterSourceHash: chapter.chapterSourceHash,
    })),
  })
  const candidates = params.chapters.flatMap((chapter) => {
    const candidate = candidateByChapterId.get(chapter.chapterId) ?? null
    if (!candidate || (candidate.status !== 'extracted' && candidate.status !== 'persisted' && candidate.status !== 'resolving')) {
      return []
    }
    const parsed = JSON.parse(candidate.extractionJson) as Partial<ChapterKnowledgeExtraction> | null
    if (!parsed || !Array.isArray(parsed.aliasDiscoveries)) {
      return []
    }
    return [{
      chapterId: chapter.chapterId,
      chapterNo: chapter.chapterNo,
      extraction: {
        aliasDiscoveries: parsed.aliasDiscoveries,
      },
    } satisfies BatchAliasDiscoveryCandidate]
  })

  return buildOrderedBatchAliasDiscoveriesForTesting(candidates)
}

function setBatchAliasSyncPlanInKnowledgeJob(params: {
  jobId: string
  chapters: Array<{ chapterId: string; chapterNo: number }>
  orderedAliasDiscoveries: KnowledgeRebuildBatchAliasDiscovery[]
}) {
  const state = getKnowledgeRebuildJobState(params.jobId)
  if (!state) return null

  const extractedChapters = params.chapters.map((chapter) => ({
    chapterId: chapter.chapterId,
    chapterNo: chapter.chapterNo,
  }))

  updateKnowledgeJob(params.jobId, {
    payload: {
      ...state.payload,
      phase: state.phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters,
      currentBatchChapters: extractedChapters,
      orderedAliasDiscoveries: params.orderedAliasDiscoveries,
      appliedAliasDiscoveryCount: Math.min(
        Math.max(0, state.payload.appliedAliasDiscoveryCount ?? 0),
        params.orderedAliasDiscoveries.length,
      ),
    },
  })

  return getKnowledgeRebuildJobState(params.jobId)
}

function logSkippedBatchAliasDiscovery(params: {
  novelId: string
  branchId: string
  alias: string
  target: string
  sourceChapter: number
  details: Record<string, unknown>
}) {
  execute(
    `
      INSERT INTO EntityAliasConflictLog (
        id, novelId, branchId, alias, existingEntityId, attemptedEntityId,
        existingCanonicalName, attemptedCanonicalName, sourceChapter, detailsJson
      )
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)
    `,
    uid('alias-conflict'),
    params.novelId,
    params.branchId,
    params.alias,
    params.target,
    params.sourceChapter,
    JSON.stringify(params.details),
  )
}

function resolveExistingCharacterEntityIdForAliasTarget(params: {
  branchId: string
  target: string
}) {
  const resolution = resolveCharacterEntityByName({
    branchId: params.branchId,
    name: params.target,
    chapterNo: INF_CHAPTER,
  })
  return resolution.kind === 'resolved' ? resolution.entityId : null
}

function applyOrderedBatchAliasDiscoveries(params: {
  novelId: string
  branchId: string
  jobId: string
}) {
  const state = getKnowledgeRebuildJobState(params.jobId)
  if (!state) return null

  const orderedAliasDiscoveries = state.payload.orderedAliasDiscoveries ?? []
  const startIndex = Math.max(0, state.payload.appliedAliasDiscoveryCount ?? 0)
  if (startIndex >= orderedAliasDiscoveries.length) {
    return state
  }

  for (const discovery of orderedAliasDiscoveries.slice(startIndex)) {
    const targetEntityId = resolveExistingCharacterEntityIdForAliasTarget({
      branchId: params.branchId,
      target: discovery.target,
    })
    if (!targetEntityId) {
      logSkippedBatchAliasDiscovery({
        novelId: params.novelId,
        branchId: params.branchId,
        alias: discovery.alias,
        target: discovery.target,
        sourceChapter: discovery.chapterNo,
        details: {
          reason: 'alias_target_unresolved',
          chapterId: discovery.chapterId,
          outputOrder: discovery.outputOrder,
        },
      })
      continue
    }
    claimBranchGlobalCharacterAlias({
      novelId: params.novelId,
      branchId: params.branchId,
      alias: discovery.alias,
      entityId: targetEntityId,
      sourceChapter: discovery.chapterNo,
      targetName: discovery.target,
    })
  }

  updateKnowledgeJob(params.jobId, {
    payload: {
      ...state.payload,
      phase: state.phase,
      pendingChapterIds: state.pendingChapterIds,
      chapterWeightsById: state.chapterWeightsById,
      totalChapterWeight: state.totalChapterWeight,
      processedChapterWeight: state.processedChapterWeight,
      extractedChapters: state.extractedChapters,
      orderedAliasDiscoveries,
      appliedAliasDiscoveryCount: orderedAliasDiscoveries.length,
    },
  })

  return getKnowledgeRebuildJobState(params.jobId)
}

function resolveChapterCandidate(params: {
  candidate: ChapterExtractionCandidate
  storyState: string
  batchContext?: ChapterExtractionBatchProcessingContext
}): ResolvedChapterKnowledge {
  void params.storyState

  const cached = readChapterExtractionProcessingCache(params.candidate, params.batchContext)
  if (cached) return cached

  const parsed = JSON.parse(params.candidate.extractionJson) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Chapter ${params.candidate.chapterNo} candidate payload is invalid`)
  }

  return {
    extraction: parsed as ChapterKnowledgeExtraction,
  }
}

async function persistResolvedChapterKnowledge(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  candidateId: string
  resolved: ResolvedChapterKnowledge
}) {
  await withKnowledgeWriteTransaction(params.novelId, async () => {
    clearDerivedKnowledgeInChapterRangeWithinTransaction(params.novelId, params.branchId, {
      startChapter: params.chapterNo,
      endChapter: params.chapterNo,
    })
    const persisted = await persistChapterExtraction({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      extraction: params.resolved.extraction,
    })
    updateExistingChapterExtractionCandidate({
      candidateId: params.candidateId,
      status: 'persisted',
      errorMessage: null,
    })
  })

  for (const promotion of listPendingCharacterCandidatePromotions({ branchId: params.branchId })) {
    await finalizeCharacterCandidatePromotion({
      novelId: params.novelId,
      branchId: params.branchId,
      promotion,
    })
  }
}

async function rebuildDerivedIndexes(params: {
  novelId: string
  branchId: string
  chapterRange?: KnowledgeRebuildChapterRange
  onProgress?: (progress: KnowledgeRebuildIndexProgress) => void | Promise<void>
}) {
  await rebuildBranchRetrievalIndex(params.novelId, params.branchId, {
    chapterRange: params.chapterRange,
    onProgress: params.onProgress,
  })
}

const BLOCKED_CHARACTER_MENTIONS = new Set([
  '他',
  '她',
  '它',
  '他们',
  '她们',
  '它们',
  '那人',
  '这人',
  '那位',
  '这位',
  '对方',
  '某人',
  '此人',
  '别人',
  '男人',
  '女人',
  '少女',
  '少年',
  '老者',
])

type CharacterEntityResolution =
  | { kind: 'blocked' }
  | { kind: 'ambiguous' }
  | { kind: 'unresolved' }
  | { kind: 'resolved'; entityId: string; canonicalName: string; matchSource: 'canonical' | 'alias_mapping' | 'alias' }

type CharacterCandidateObservationSnapshot = {
  chapterNo: number
  observation: string
  evidenceQuote: string | null
}

type BatchAliasDiscoveryCandidate = {
  chapterId: string
  chapterNo: number
  extraction: Pick<ChapterKnowledgeExtraction, 'aliasDiscoveries'>
}

type BatchAliasClaimResult = {
  ownerEntityId: string | null
  sourceAliasId: string | null
  conflict: boolean
}

type CanonicalMergeCharacterEntityRow = {
  id: string
  canonicalName: string
  description: string | null
  firstSeenChapter: number | null
  lastSeenChapter: number | null
  importanceTier: CharacterImportanceTier | null
  status: string | null
  userConfirmed: number
  createdAt: string
}

const CHARACTER_CANONICAL_MERGE_SEPARATOR_REGEX = /[\s·・･•‧∙⋅·]+/gu

export function normalizeCharacterMentionName(name: string) {
  return name.trim()
}

function buildCharacterCanonicalMergeKey(name: string) {
  const normalizedName = normalizeCharacterMentionName(name)
  if (!normalizedName) return ''
  return normalizedName.normalize('NFKC').replace(CHARACTER_CANONICAL_MERGE_SEPARATOR_REGEX, '')
}

export function isBlockedCharacterMention(name: string) {
  return BLOCKED_CHARACTER_MENTIONS.has(normalizeCharacterMentionName(name))
}

function getCharacterEntityStatusRank(status: string | null | undefined) {
  switch (status?.trim() || '') {
    case 'user_confirmed':
      return 100
    case 'candidate_promoted':
      return 80
    case 'known_character_update':
      return 70
    case 'ready':
      return 60
    case 'ai_generated':
      return 50
    case 'conflicted':
      return 40
    case 'hanlp_bootstrap':
      return 10
    default:
      return status?.trim() ? 25 : 0
  }
}

function chooseStrongerCharacterEntityStatus(existing: string | null | undefined, incoming: string | null | undefined) {
  const normalizedExisting = existing?.trim() || null
  const normalizedIncoming = incoming?.trim() || null
  if (!normalizedExisting) return normalizedIncoming
  if (!normalizedIncoming) return normalizedExisting
  return getCharacterEntityStatusRank(normalizedIncoming) > getCharacterEntityStatusRank(normalizedExisting)
    ? normalizedIncoming
    : normalizedExisting
}

function chooseEarlierChapterNumber(existing: number | null | undefined, incoming: number | null | undefined) {
  if (typeof existing !== 'number') return typeof incoming === 'number' ? incoming : null
  if (typeof incoming !== 'number') return existing
  return Math.min(existing, incoming)
}

function chooseLaterChapterNumber(existing: number | null | undefined, incoming: number | null | undefined) {
  if (typeof existing !== 'number') return typeof incoming === 'number' ? incoming : null
  if (typeof incoming !== 'number') return existing
  return Math.max(existing, incoming)
}

function compareCanonicalMergeCharacterEntities(left: CanonicalMergeCharacterEntityRow, right: CanonicalMergeCharacterEntityRow) {
  if (left.userConfirmed !== right.userConfirmed) {
    return right.userConfirmed - left.userConfirmed
  }

  const tierDelta = getFormalCharacterImportanceTierRank(right.importanceTier) - getFormalCharacterImportanceTierRank(left.importanceTier)
  if (tierDelta !== 0) {
    return tierDelta
  }

  const leftNameLength = normalizeCharacterMentionName(left.canonicalName).length
  const rightNameLength = normalizeCharacterMentionName(right.canonicalName).length
  if (leftNameLength !== rightNameLength) {
    return leftNameLength - rightNameLength
  }

  const leftFirstSeen = left.firstSeenChapter ?? Number.POSITIVE_INFINITY
  const rightFirstSeen = right.firstSeenChapter ?? Number.POSITIVE_INFINITY
  if (leftFirstSeen !== rightFirstSeen) {
    return leftFirstSeen - rightFirstSeen
  }

  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt)
  }

  return left.id.localeCompare(right.id)
}

function mergeCanonicalCharacterEntityMetadata(
  winner: CanonicalMergeCharacterEntityRow,
  loser: CanonicalMergeCharacterEntityRow,
): CanonicalMergeCharacterEntityRow {
  const nextWinner = { ...winner }
  nextWinner.firstSeenChapter = chooseEarlierChapterNumber(winner.firstSeenChapter, loser.firstSeenChapter)
  nextWinner.lastSeenChapter = chooseLaterChapterNumber(winner.lastSeenChapter, loser.lastSeenChapter)

  if (!winner.userConfirmed) {
    nextWinner.description = chooseConciseKnowledgeText(winner.description, loser.description) || null
    nextWinner.status = chooseStrongerCharacterEntityStatus(winner.status, loser.status)
    if (isFormalCharacterImportanceTier(loser.importanceTier)) {
      nextWinner.importanceTier = chooseStrongerFormalCharacterTier(winner.importanceTier, loser.importanceTier)
    }
  }
  return nextWinner
}

function repointCharacterEventParticipants(params: {
  loserEntityId: string
  winnerEntityId: string
}) {
  const participants = queryAll<{
    id: string
    eventId: string
    role: string | null
  }>(
    'SELECT id, eventId, role FROM EventParticipant WHERE entityId = ?',
    params.loserEntityId,
  )

  for (const participant of participants) {
    const existingWinnerParticipant = queryOne<{ id: string }>(
      'SELECT id FROM EventParticipant WHERE eventId = ? AND entityId = ? AND role IS ? LIMIT 1',
      participant.eventId,
      params.winnerEntityId,
      participant.role,
    )
    if (existingWinnerParticipant?.id) {
      execute('DELETE FROM EventParticipant WHERE id = ?', participant.id)
      continue
    }

    execute(
      'UPDATE EventParticipant SET entityId = ? WHERE id = ?',
      params.winnerEntityId,
      participant.id,
    )
  }
}

function moveCharacterAliasesToWinner(params: {
  branchId: string
  loserEntityId: string
  winnerEntityId: string
}) {
  const loserAliases = queryAll<{
    id: string
    alias: string
    evidenceSpanId: string | null
    evidenceQuote: string | null
    sourceChapter: number | null
    confidence: number
    userConfirmed: number
  }>(
    `
      SELECT id, alias, evidenceSpanId, evidenceQuote, sourceChapter, confidence, userConfirmed
      FROM EntityAlias
      WHERE entityId = ?
      ORDER BY alias ASC, createdAt ASC, id ASC
    `,
    params.loserEntityId,
  )

  for (const loserAlias of loserAliases) {
    const existingWinnerAlias = queryOne<{
      id: string
      sourceChapter: number | null
      confidence: number
      userConfirmed: number
      evidenceSpanId: string | null
      evidenceQuote: string | null
    }>(
      `
        SELECT id, sourceChapter, confidence, userConfirmed, evidenceSpanId, evidenceQuote
        FROM EntityAlias
        WHERE entityId = ? AND alias = ?
        LIMIT 1
      `,
      params.winnerEntityId,
      loserAlias.alias,
    )

    if (existingWinnerAlias?.id) {
      const mergedSourceChapter = chooseEarlierChapterNumber(existingWinnerAlias.sourceChapter, loserAlias.sourceChapter)
      execute(
        `
          UPDATE EntityAlias
          SET sourceChapter = ?,
              confidence = ?,
              userConfirmed = ?,
              evidenceSpanId = COALESCE(evidenceSpanId, ?),
              evidenceQuote = COALESCE(evidenceQuote, ?),
              updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        mergedSourceChapter,
        Math.max(existingWinnerAlias.confidence, loserAlias.confidence),
        Math.max(existingWinnerAlias.userConfirmed, loserAlias.userConfirmed),
        loserAlias.evidenceSpanId,
        loserAlias.evidenceQuote,
        existingWinnerAlias.id,
      )
      execute(
        `
          UPDATE EntityAliasMapping
          SET entityId = ?,
              sourceAliasId = ?,
              sourceChapter = MIN(COALESCE(sourceChapter, ?), ?),
              updatedAt = CURRENT_TIMESTAMP
          WHERE branchId = ? AND entityId = ? AND alias = ?
        `,
        params.winnerEntityId,
        existingWinnerAlias.id,
        loserAlias.sourceChapter,
        loserAlias.sourceChapter,
        params.branchId,
        params.loserEntityId,
        loserAlias.alias,
      )
      execute('DELETE FROM EntityAlias WHERE id = ?', loserAlias.id)
      continue
    }

    execute(
      'UPDATE EntityAlias SET entityId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      params.winnerEntityId,
      loserAlias.id,
    )
    execute(
      `
        UPDATE EntityAliasMapping
        SET entityId = ?,
            sourceAliasId = ?,
            sourceChapter = MIN(COALESCE(sourceChapter, ?), ?),
            updatedAt = CURRENT_TIMESTAMP
        WHERE branchId = ? AND entityId = ? AND alias = ?
      `,
      params.winnerEntityId,
      loserAlias.id,
      loserAlias.sourceChapter,
      loserAlias.sourceChapter,
      params.branchId,
      params.loserEntityId,
      loserAlias.alias,
    )
  }

  const remainingMappings = queryAll<{
    id: string
    alias: string
    sourceChapter: number | null
  }>(
    'SELECT id, alias, sourceChapter FROM EntityAliasMapping WHERE branchId = ? AND entityId = ?',
    params.branchId,
    params.loserEntityId,
  )
  for (const mapping of remainingMappings) {
    const winnerAlias = queryOne<{ id: string }>(
      'SELECT id FROM EntityAlias WHERE entityId = ? AND alias = ? LIMIT 1',
      params.winnerEntityId,
      mapping.alias,
    )
    execute(
      `
        UPDATE EntityAliasMapping
        SET entityId = ?,
            sourceAliasId = COALESCE(?, sourceAliasId),
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      params.winnerEntityId,
      winnerAlias?.id ?? null,
      mapping.id,
    )
  }
}

function getCanonicalMergeCharacterEntityRows(params: {
  novelId: string
  branchId: string
}) {
  return queryAll<CanonicalMergeCharacterEntityRow>(
    `
      SELECT id, canonicalName, description, firstSeenChapter, lastSeenChapter, importanceTier, status, userConfirmed, createdAt
      FROM KnowledgeEntity
      WHERE novelId = ?
        AND branchId = ?
        AND entityType = 'character'
        AND importanceTier IN ('protagonist', 'important', 'arc')
      ORDER BY createdAt ASC, id ASC
    `,
    params.novelId,
    params.branchId,
  )
}

function findCanonicalNameMergeGroup(rows: CanonicalMergeCharacterEntityRow[]) {
  const groups = new Map<string, CanonicalMergeCharacterEntityRow[]>()
  for (const row of rows) {
    const mergeKey = buildCharacterCanonicalMergeKey(row.canonicalName)
    if (!mergeKey) continue
    const existingGroup = groups.get(mergeKey) ?? []
    existingGroup.push(row)
    groups.set(mergeKey, existingGroup)
  }

  for (const group of groups.values()) {
    if (group.length > 1) return group
  }
  return null
}

function findCanonicalAliasMergeGroup(params: {
  branchId: string
  rows: CanonicalMergeCharacterEntityRow[]
}) {
  const aliases = queryAll<{ entityId: string; alias: string }>(
    `
      SELECT DISTINCT entityId, alias
      FROM (
        SELECT a.entityId AS entityId, a.alias AS alias
        FROM EntityAlias a
        JOIN KnowledgeEntity e ON e.id = a.entityId
        WHERE e.branchId = ?
          AND e.entityType = 'character'
          AND e.importanceTier IN ('protagonist', 'important', 'arc')
        UNION
        SELECT m.entityId AS entityId, m.alias AS alias
        FROM EntityAliasMapping m
        JOIN KnowledgeEntity e ON e.id = m.entityId
        WHERE m.branchId = ?
          AND e.entityType = 'character'
          AND e.importanceTier IN ('protagonist', 'important', 'arc')
      )
    `,
    params.branchId,
    params.branchId,
  )

  const aliasKeysByEntityId = new Map<string, Set<string>>()
  for (const alias of aliases) {
    const aliasKey = buildCharacterCanonicalMergeKey(alias.alias)
    if (!aliasKey) continue
    const existingKeys = aliasKeysByEntityId.get(alias.entityId) ?? new Set<string>()
    existingKeys.add(aliasKey)
    aliasKeysByEntityId.set(alias.entityId, existingKeys)
  }

  for (let leftIndex = 0; leftIndex < params.rows.length; leftIndex += 1) {
    const left = params.rows[leftIndex]
    const leftKey = buildCharacterCanonicalMergeKey(left.canonicalName)
    if (!leftKey) continue

    for (let rightIndex = leftIndex + 1; rightIndex < params.rows.length; rightIndex += 1) {
      const right = params.rows[rightIndex]
      const rightKey = buildCharacterCanonicalMergeKey(right.canonicalName)
      if (!rightKey || leftKey === rightKey) continue

      const leftAliases = aliasKeysByEntityId.get(left.id)
      const rightAliases = aliasKeysByEntityId.get(right.id)
      if (leftAliases?.has(rightKey) || rightAliases?.has(leftKey)) {
        return [left, right]
      }
    }
  }

  return null
}

function mergeCanonicalCharacterEntityGroup(params: {
  branchId: string
  group: CanonicalMergeCharacterEntityRow[]
}) {
  if (params.group.length < 2) return false
  const orderedGroup = params.group.slice().sort(compareCanonicalMergeCharacterEntities)
  let winner = orderedGroup[0]

  for (const loser of orderedGroup.slice(1)) {
    if (loser.id === winner.id) continue

    execute('UPDATE EntityMention SET entityId = ? WHERE branchId = ? AND entityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE EntityAppearance SET entityId = ? WHERE entityId = ?', winner.id, loser.id)
    execute('UPDATE EntityLink SET sourceEntityId = ? WHERE branchId = ? AND sourceEntityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE EntityLink SET targetEntityId = ? WHERE branchId = ? AND targetEntityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE EntityState SET entityId = ? WHERE branchId = ? AND entityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE KnowledgeFact SET subjectEntityId = ? WHERE branchId = ? AND subjectEntityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE KnowledgeFact SET objectEntityId = ? WHERE branchId = ? AND objectEntityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE KnowledgeRelation SET sourceEntityId = ? WHERE branchId = ? AND sourceEntityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE KnowledgeRelation SET targetEntityId = ? WHERE branchId = ? AND targetEntityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE what_if_deltas SET subject_entity_id = ? WHERE subject_entity_id = ?', winner.id, loser.id)
    execute('UPDATE what_if_deltas SET target_entity_id = ? WHERE target_entity_id = ?', winner.id, loser.id)
    execute('UPDATE EntityAliasConflictLog SET existingEntityId = ? WHERE branchId = ? AND existingEntityId = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE EntityAliasConflictLog SET attemptedEntityId = ? WHERE branchId = ? AND attemptedEntityId = ?', winner.id, params.branchId, loser.id)
    repointCharacterEventParticipants({ loserEntityId: loser.id, winnerEntityId: winner.id })
    execute('UPDATE character_candidates SET promoted_entity_id = ? WHERE branch_id = ? AND promoted_entity_id = ?', winner.id, params.branchId, loser.id)
    execute('UPDATE character_candidates SET merged_entity_id = ? WHERE branch_id = ? AND merged_entity_id = ?', winner.id, params.branchId, loser.id)
    moveCharacterAliasesToWinner({
      branchId: params.branchId,
      loserEntityId: loser.id,
      winnerEntityId: winner.id,
    })

    winner = mergeCanonicalCharacterEntityMetadata(winner, loser)
    execute(
      `
        UPDATE KnowledgeEntity
        SET description = ?,
            firstSeenChapter = ?,
            lastSeenChapter = ?,
            importanceTier = ?,
            status = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      winner.description,
      winner.firstSeenChapter,
      winner.lastSeenChapter,
      winner.importanceTier,
      winner.status,
      winner.id,
    )
    execute('DELETE FROM KnowledgeEntity WHERE id = ?', loser.id)
  }

  return true
}

function mergeDuplicateCharacterEntitiesForBranch(params: {
  novelId: string
  branchId: string
}) {
  for (;;) {
    const rows = getCanonicalMergeCharacterEntityRows(params)
    const canonicalGroup = findCanonicalNameMergeGroup(rows)
    if (canonicalGroup) {
      mergeCanonicalCharacterEntityGroup({ branchId: params.branchId, group: canonicalGroup })
      continue
    }

    const aliasGroup = findCanonicalAliasMergeGroup({ branchId: params.branchId, rows })
    if (aliasGroup) {
      mergeCanonicalCharacterEntityGroup({ branchId: params.branchId, group: aliasGroup })
      continue
    }

    break
  }
}

function normalizeAliasDiscoveryRecord(alias: string, target: string) {
  const normalizedAlias = normalizeCharacterMentionName(alias)
  const normalizedTarget = normalizeCharacterMentionName(target)
  if (!normalizedAlias || !normalizedTarget) return null
  if (normalizedAlias === normalizedTarget) return null
  if (isBlockedCharacterMention(normalizedAlias) || isBlockedCharacterMention(normalizedTarget)) return null
  return {
    alias: normalizedAlias,
    target: normalizedTarget,
  }
}

export function buildOrderedBatchAliasDiscoveriesForTesting(candidates: BatchAliasDiscoveryCandidate[]) {
  return candidates
    .flatMap((candidate) => candidate.extraction.aliasDiscoveries.map((item, outputOrder) => ({
      chapterId: candidate.chapterId,
      chapterNo: candidate.chapterNo,
      outputOrder,
      normalized: normalizeAliasDiscoveryRecord(item.alias, item.target),
    })))
    .flatMap((item) => item.normalized ? [{
      chapterId: item.chapterId,
      chapterNo: item.chapterNo,
      outputOrder: item.outputOrder,
      alias: item.normalized.alias,
      target: item.normalized.target,
    } satisfies KnowledgeRebuildBatchAliasDiscovery] : [])
    .sort((left, right) => {
      if (left.chapterNo !== right.chapterNo) return left.chapterNo - right.chapterNo
      if (left.outputOrder !== right.outputOrder) return left.outputOrder - right.outputOrder
      if (left.alias !== right.alias) return left.alias.localeCompare(right.alias, 'zh-Hans-CN')
      return left.target.localeCompare(right.target, 'zh-Hans-CN')
    })
}

function parseObservationSnapshots(observationsJson: string | null | undefined) {
  if (!observationsJson) return [] as CharacterCandidateObservationSnapshot[]
  try {
    const parsed = JSON.parse(observationsJson) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Partial<CharacterCandidateObservationSnapshot>
      if (typeof row.chapterNo !== 'number' || typeof row.observation !== 'string') return []
      return [{
        chapterNo: Math.max(1, Math.floor(row.chapterNo)),
        observation: row.observation,
        evidenceQuote: typeof row.evidenceQuote === 'string' ? row.evidenceQuote : null,
      } satisfies CharacterCandidateObservationSnapshot]
    })
  } catch {
    return []
  }
}

function serializeObservationSnapshots(
  observationsJson: string | null | undefined,
  nextSnapshot: CharacterCandidateObservationSnapshot,
) {
  const existing = parseObservationSnapshots(observationsJson)
  if (!existing.some((item) => (
    item.chapterNo === nextSnapshot.chapterNo
    && item.observation === nextSnapshot.observation
    && item.evidenceQuote === nextSnapshot.evidenceQuote
  ))) {
    existing.push(nextSnapshot)
  }
  return JSON.stringify(existing.slice(-12))
}

function buildObservationSnapshotsFromCandidateChapterRows(rows: Array<{
  chapterNo: number
  observation: string | null
  evidenceQuote: string | null
}>) {
  return JSON.stringify(rows
    .filter((row) => row.observation?.trim())
    .sort((left, right) => left.chapterNo - right.chapterNo)
    .slice(-12)
    .map((row) => ({
      chapterNo: row.chapterNo,
      observation: row.observation?.trim() ?? '',
      evidenceQuote: row.evidenceQuote?.trim() || null,
    } satisfies CharacterCandidateObservationSnapshot)))
}

function refreshCharacterCandidatesAfterChapterCleanup(params: {
  novelId: string
  branchId: string
}) {
  const remainingCandidates = queryAll<{
    id: string
    promotedEntityId: string | null
  }>(
    `
      SELECT id, promoted_entity_id AS promotedEntityId
      FROM character_candidates
      WHERE novel_id = ? AND branch_id = ?
    `,
    params.novelId,
    params.branchId,
  )

  for (const candidate of remainingCandidates) {
    if (candidate.promotedEntityId) {
      continue
    }

    const chapterRows = queryAll<{
      chapterNo: number
      mentionCount: number
      observation: string | null
      evidenceQuote: string | null
    }>(
      `
        SELECT chapter_no AS chapterNo,
               mention_count AS mentionCount,
               best_observation AS observation,
               best_evidence AS evidenceQuote
        FROM character_candidate_chapters
        WHERE candidate_id = ?
        ORDER BY chapter_no ASC
      `,
      candidate.id,
    )

    if (!chapterRows.length) {
      execute('DELETE FROM character_candidates WHERE id = ?', candidate.id)
      continue
    }

    execute(
      `
        UPDATE character_candidates
        SET first_seen_chapter = ?,
            last_seen_chapter = ?,
            chapter_count = ?,
            mention_count = ?,
            observations_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      chapterRows[0].chapterNo,
      chapterRows[chapterRows.length - 1].chapterNo,
      chapterRows.length,
      chapterRows.reduce((sum, row) => sum + Math.max(1, row.mentionCount), 0),
      buildObservationSnapshotsFromCandidateChapterRows(chapterRows),
      candidate.id,
    )
  }
}

export function upsertHanlpBootstrapCharacterEntity(params: {
  novelId: string
  branchId: string
  name: string
  firstSeenChapter: number
  lastSeenChapter: number
  importanceTier: Extract<CharacterImportanceTier, 'protagonist' | 'important' | 'arc'>
  status?: string | null
  description?: string | null
}) {
  const normalizedName = normalizeCharacterMentionName(params.name)
  if (!normalizedName || isBlockedCharacterMention(normalizedName)) {
    return null
  }

  const effectiveLastSeenChapter = Math.max(params.firstSeenChapter, params.lastSeenChapter)
  const resolution = resolveCharacterEntityByName({
    branchId: params.branchId,
    name: normalizedName,
    chapterNo: effectiveLastSeenChapter,
  })

  if (resolution.kind === 'blocked' || resolution.kind === 'ambiguous') {
    return null
  }

  const description = params.description?.trim() || null
  const status = params.status?.trim() || 'hanlp_bootstrap'

  if (resolution.kind === 'resolved') {
    const existing = queryOne<{
      id: string
      description: string | null
      firstSeenChapter: number | null
      lastSeenChapter: number | null
      status: string | null
      userConfirmed: number
      importanceTier: CharacterImportanceTier | null
    }>(
      'SELECT id, description, firstSeenChapter, lastSeenChapter, status, userConfirmed, importanceTier FROM KnowledgeEntity WHERE id = ? LIMIT 1',
      resolution.entityId,
    )

    const nextDescription = existing?.userConfirmed && existing.description?.trim()
      ? existing.description.trim()
      : chooseConciseKnowledgeText(existing?.description, description)
    const nextStatus = chooseBootstrapSafeEntityStatus({
      existingStatus: existing?.status,
      incomingStatus: status,
      userConfirmed: existing?.userConfirmed ?? 0,
    })
    const nextImportanceTier = existing?.userConfirmed && existing.importanceTier
      ? existing.importanceTier
      : chooseStrongerFormalCharacterTier(existing?.importanceTier, params.importanceTier)

    execute(
      `
        UPDATE KnowledgeEntity
        SET description = ?,
            status = ?,
            firstSeenChapter = ?,
            lastSeenChapter = ?,
            importanceTier = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      nextDescription,
      nextStatus,
      Math.min(existing?.firstSeenChapter ?? params.firstSeenChapter, params.firstSeenChapter),
      Math.max(existing?.lastSeenChapter ?? effectiveLastSeenChapter, effectiveLastSeenChapter),
      nextImportanceTier,
      resolution.entityId,
    )

    return resolution.entityId
  }

  const entityId = uid('entity')
  execute(
    `
      INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, importanceTier, status
      )
      VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?)
    `,
    entityId,
    params.novelId,
    params.branchId,
    normalizedName,
    description,
    params.firstSeenChapter,
    effectiveLastSeenChapter,
    params.importanceTier,
    status,
  )
  return entityId
}

function resolveCharacterEntityByName(params: {
  branchId: string
  name: string
  chapterNo: number
}): CharacterEntityResolution {
  const normalizedName = normalizeCharacterMentionName(params.name)
  if (!normalizedName || isBlockedCharacterMention(normalizedName)) {
    return { kind: 'blocked' }
  }

  const rows = queryAll<{
    id: string
    canonicalName: string
    matchSource: 'canonical' | 'alias_mapping' | 'alias'
    userConfirmed: number
  }>(
    `
        SELECT e.id AS id, e.canonicalName AS canonicalName, 'alias_mapping' AS matchSource, e.userConfirmed AS userConfirmed
        FROM EntityAliasMapping m
        JOIN KnowledgeEntity e ON e.id = m.entityId
        WHERE m.branchId = ?
          AND e.entityType = 'character'
          AND e.importanceTier IN ('protagonist', 'important', 'arc')
          AND m.alias = ?
        UNION ALL
        SELECT e.id AS id, e.canonicalName AS canonicalName, 'canonical' AS matchSource, e.userConfirmed AS userConfirmed
        FROM KnowledgeEntity e
        WHERE e.branchId = ?
          AND e.entityType = 'character'
          AND e.importanceTier IN ('protagonist', 'important', 'arc')
          AND e.canonicalName = ?
        UNION ALL
        SELECT e.id AS id, e.canonicalName AS canonicalName, 'alias' AS matchSource, e.userConfirmed AS userConfirmed
        FROM EntityAlias a
        JOIN KnowledgeEntity e ON e.id = a.entityId
        WHERE e.branchId = ?
          AND e.entityType = 'character'
          AND e.importanceTier IN ('protagonist', 'important', 'arc')
          AND a.alias = ?
          AND a.sourceChapter <= ?
    `,
    params.branchId,
    normalizedName,
    params.branchId,
    normalizedName,
    params.branchId,
    normalizedName,
    params.chapterNo,
  )

  const sourcePriority: Record<'canonical' | 'alias_mapping' | 'alias', number> = {
    canonical: 0,
    alias_mapping: 1,
    alias: 2,
  }
  const matches = Array.from(rows.reduce<Map<string, {
    id: string
    canonicalName: string
    matchSource: 'canonical' | 'alias_mapping' | 'alias'
    userConfirmed: number
  }>>((acc, row) => {
    const existing = acc.get(row.id)
    if (!existing || sourcePriority[row.matchSource] < sourcePriority[existing.matchSource]) {
      acc.set(row.id, row)
    }
    return acc
  }, new Map()).values())

  if (!matches.length) {
    return { kind: 'unresolved' }
  }

  if (matches.length === 1) {
    return {
      kind: 'resolved',
      entityId: matches[0].id,
      canonicalName: matches[0].canonicalName,
      matchSource: matches[0].matchSource,
    }
  }

  const canonicalMatches = matches.filter((match) => match.matchSource === 'canonical')
  if (canonicalMatches.length === 1) {
    return {
      kind: 'resolved',
      entityId: canonicalMatches[0].id,
      canonicalName: canonicalMatches[0].canonicalName,
      matchSource: canonicalMatches[0].matchSource,
    }
  }

  const aliasMappingMatches = matches.filter((match) => match.matchSource === 'alias_mapping')
  if (aliasMappingMatches.length === 1) {
    return {
      kind: 'resolved',
      entityId: aliasMappingMatches[0].id,
      canonicalName: aliasMappingMatches[0].canonicalName,
      matchSource: aliasMappingMatches[0].matchSource,
    }
  }

  return { kind: 'ambiguous' }
}

function findResolvedCharacterEntityId(params: {
  branchId: string
  name: string
  chapterNo: number
}) {
  const resolution = resolveCharacterEntityByName(params)
  return resolution.kind === 'resolved' ? resolution.entityId : null
}

function ensureCharacterAliasRow(params: {
  entityId: string
  alias: string
  sourceChapter: number
}) {
  const existing = queryOne<{ id: string; sourceChapter: number | null }>(
    'SELECT id, sourceChapter FROM EntityAlias WHERE entityId = ? AND alias = ? LIMIT 1',
    params.entityId,
    params.alias,
  )

  if (existing?.id) {
    execute(
      'UPDATE EntityAlias SET sourceChapter = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      Math.min(existing.sourceChapter ?? params.sourceChapter, params.sourceChapter),
      existing.id,
    )
    return existing.id
  }

  const aliasId = uid('alias')
  execute(
    'INSERT INTO EntityAlias (id, entityId, alias, sourceChapter) VALUES (?, ?, ?, ?)',
    aliasId,
    params.entityId,
    params.alias,
    params.sourceChapter,
  )
  return aliasId
}

function ensureCharacterEntityForCanonicalName(params: {
  novelId: string
  branchId: string
  canonicalName: string
  chapterNo: number
  description?: string | null
  status?: string | null
}) {
  const normalizedName = normalizeCharacterMentionName(params.canonicalName)
  const resolution = resolveCharacterEntityByName({
    branchId: params.branchId,
    name: normalizedName,
    chapterNo: params.chapterNo,
  })

  if (resolution.kind === 'blocked' || resolution.kind === 'ambiguous') {
    return null
  }

  if (resolution.kind === 'resolved') {
    const existing = queryOne<{
      description: string | null
      firstSeenChapter: number | null
      lastSeenChapter: number | null
      importanceTier: CharacterImportanceTier | null
      userConfirmed: number
    }>(
      'SELECT description, firstSeenChapter, lastSeenChapter, importanceTier, userConfirmed FROM KnowledgeEntity WHERE id = ? LIMIT 1',
      resolution.entityId,
    )
    const existingFormalTier = isFormalCharacterImportanceTier(existing?.importanceTier) ? existing.importanceTier : null
    const nextImportanceTier = existing?.userConfirmed && existingFormalTier
      ? existingFormalTier
      : (existingFormalTier ?? chooseKnownFormalCharacterTierByName({
          branchId: params.branchId,
          name: normalizedName,
        }))
    if (!nextImportanceTier) return null
    execute(
      `
        UPDATE KnowledgeEntity
        SET description = ?,
            firstSeenChapter = ?,
            lastSeenChapter = ?,
            importanceTier = ?,
            status = COALESCE(?, status),
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      chooseConciseKnowledgeText(existing?.description, params.description ?? null) || null,
      Math.min(existing?.firstSeenChapter ?? params.chapterNo, params.chapterNo),
      Math.max(existing?.lastSeenChapter ?? params.chapterNo, params.chapterNo),
      nextImportanceTier,
      params.status ?? null,
      resolution.entityId,
    )
    return resolution.entityId
  }

  const inheritedImportanceTier = chooseKnownFormalCharacterTierByName({
    branchId: params.branchId,
    name: normalizedName,
  })
  if (!inheritedImportanceTier) {
    return null
  }
  const entityId = uid('entity')
  execute(
    `
      INSERT INTO KnowledgeEntity (
        id, novelId, branchId, entityType, canonicalName, description, firstSeenChapter, lastSeenChapter, importanceTier, status
      )
      VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?)
    `,
    entityId,
    params.novelId,
    params.branchId,
    normalizedName,
    params.description?.trim() || null,
    params.chapterNo,
    params.chapterNo,
    inheritedImportanceTier,
    params.status?.trim() || null,
  )
  return entityId
}

function claimBranchGlobalCharacterAlias(params: {
  novelId: string
  branchId: string
  alias: string
  entityId: string
  sourceChapter: number
  targetName: string
}): BatchAliasClaimResult {
  const normalizedAlias = normalizeCharacterMentionName(params.alias)
  if (!normalizedAlias || isBlockedCharacterMention(normalizedAlias)) {
    return { ownerEntityId: null, sourceAliasId: null, conflict: false }
  }

  const existingMapping = queryOne<{
    entityId: string
    canonicalName: string
  }>(
    `
      SELECT m.entityId AS entityId, e.canonicalName AS canonicalName
      FROM EntityAliasMapping m
      JOIN KnowledgeEntity e ON e.id = m.entityId
      WHERE m.branchId = ? AND m.alias = ?
      LIMIT 1
    `,
    params.branchId,
    normalizedAlias,
  )

  if (existingMapping?.entityId && existingMapping.entityId !== params.entityId) {
    const attemptedCanonicalName = queryOne<{ canonicalName: string | null }>(
      'SELECT canonicalName FROM KnowledgeEntity WHERE id = ? LIMIT 1',
      params.entityId,
    )?.canonicalName ?? params.targetName
    execute(
      `
        INSERT INTO EntityAliasConflictLog (
          id, novelId, branchId, alias, existingEntityId, attemptedEntityId,
          existingCanonicalName, attemptedCanonicalName, sourceChapter, detailsJson
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      uid('alias-conflict'),
      params.novelId,
      params.branchId,
      normalizedAlias,
      existingMapping.entityId,
      params.entityId,
      existingMapping.canonicalName,
      attemptedCanonicalName,
      params.sourceChapter,
      JSON.stringify({ target: params.targetName }),
    )
    return { ownerEntityId: existingMapping.entityId, sourceAliasId: null, conflict: true }
  }

  const sourceAliasId = ensureCharacterAliasRow({
    entityId: params.entityId,
    alias: normalizedAlias,
    sourceChapter: params.sourceChapter,
  })

  execute(
    `
      INSERT INTO EntityAliasMapping (id, novelId, branchId, alias, entityId, sourceAliasId, sourceChapter)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(branchId, alias) DO UPDATE SET
        sourceAliasId = COALESCE(EntityAliasMapping.sourceAliasId, excluded.sourceAliasId),
        sourceChapter = MIN(COALESCE(EntityAliasMapping.sourceChapter, excluded.sourceChapter), excluded.sourceChapter),
        updatedAt = CURRENT_TIMESTAMP
    `,
    uid('alias-mapping'),
    params.novelId,
    params.branchId,
    normalizedAlias,
    params.entityId,
    sourceAliasId,
    params.sourceChapter,
  )

  return { ownerEntityId: params.entityId, sourceAliasId, conflict: false }
}

function insertEntityMention(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  entityId: string | null
  mentionText: string
  resolutionKind: 'resolved' | 'ambiguous' | 'blocked' | 'unresolved'
  evidence?: { quote: string; lineStart: number; lineEnd: number } | null
}) {
  execute(
    `
      INSERT INTO EntityMention (
        id, novelId, branchId, chapterId, chapterNo, entityId, mentionText, resolutionKind, evidenceSpanId, evidenceQuote
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    uid('mention'),
    params.novelId,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    params.entityId,
    params.mentionText,
    params.resolutionKind,
    params.evidence ? findEvidenceSpanId(params.chapterId, params.evidence.lineStart, params.evidence.lineEnd) : null,
    params.evidence?.quote ?? null,
  )
}

function getOrCreateCharacterEntity(params: {
  novelId: string
  branchId: string
  name: string
  description: string
  status: string
  chapterNo: number
}) {
  return ensureCharacterEntityForCanonicalName({
    novelId: params.novelId,
    branchId: params.branchId,
    canonicalName: params.name,
    chapterNo: params.chapterNo,
    description: params.description,
    status: params.status,
  })
}

function upsertCharacterCandidateObservation(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  surfaceText: string
  observation: string
  evidence?: { quote: string; lineStart: number; lineEnd: number } | null
}) {
  const normalizedSurfaceText = normalizeCharacterMentionName(params.surfaceText)
  if (!normalizedSurfaceText || isBlockedCharacterMention(normalizedSurfaceText)) {
    return null
  }

  const observation = params.observation.trim()
  const evidenceQuote = params.evidence?.quote?.trim() || null
  const existing = queryOne<{
    id: string
    firstSeenChapter: number
    lastSeenChapter: number
    promotedEntityId: string | null
    mentionCount: number
    observationsJson: string | null
    promotionSummaryStatus: CandidatePromotionSummaryStatus
  }>(
    `
      SELECT id, first_seen_chapter AS firstSeenChapter, last_seen_chapter AS lastSeenChapter,
             promoted_entity_id AS promotedEntityId,
             mention_count AS mentionCount,
             observations_json AS observationsJson,
             promotion_summary_status AS promotionSummaryStatus
      FROM character_candidates
      WHERE novel_id = ? AND branch_id = ? AND surface_text = ?
      LIMIT 1
    `,
    params.novelId,
    params.branchId,
    normalizedSurfaceText,
  )

  const candidateId = existing?.id ?? uid('candidate')
  const observationsJson = serializeObservationSnapshots(existing?.observationsJson, {
    chapterNo: params.chapterNo,
    observation,
    evidenceQuote,
  })

  if (existing?.id) {
    execute(
      `
        UPDATE character_candidates
        SET first_seen_chapter = ?,
            last_seen_chapter = ?,
            mention_count = ?,
            observations_json = ?,
            display_name = ?,
            normalized_name = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      Math.min(existing.firstSeenChapter, params.chapterNo),
      Math.max(existing.lastSeenChapter, params.chapterNo),
      Math.max(1, existing.mentionCount + 1),
      observationsJson,
      normalizedSurfaceText,
      normalizedSurfaceText,
      candidateId,
    )
  } else {
    execute(
      `
        INSERT INTO character_candidates (
          id, novel_id, branch_id, surface_text, first_seen_chapter, last_seen_chapter,
          chapter_count, mention_count, observations_json, status, promoted_entity_id,
          merged_entity_id, display_name, normalized_name
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, 'collecting', NULL, NULL, ?, ?)
      `,
      candidateId,
      params.novelId,
      params.branchId,
      normalizedSurfaceText,
      params.chapterNo,
      params.chapterNo,
      observationsJson,
      normalizedSurfaceText,
      normalizedSurfaceText,
    )
  }

  execute(
    `
      INSERT INTO character_candidate_chapters (
        id, novel_id, branch_id, candidate_id, chapter_id, chapter_no, mention_count, best_observation, best_evidence
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(novel_id, branch_id, candidate_id, chapter_no) DO UPDATE SET
        mention_count = character_candidate_chapters.mention_count + excluded.mention_count,
        best_observation = COALESCE(excluded.best_observation, character_candidate_chapters.best_observation),
        best_evidence = COALESCE(excluded.best_evidence, character_candidate_chapters.best_evidence),
        chapter_id = COALESCE(excluded.chapter_id, character_candidate_chapters.chapter_id)
    `,
    uid('candidate-chapter'),
    params.novelId,
    params.branchId,
    candidateId,
    params.chapterId,
    params.chapterNo,
    1,
    observation || null,
    evidenceQuote,
  )

  const chapterCount = queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM character_candidate_chapters WHERE candidate_id = ?',
    candidateId,
  )?.count ?? 1
  execute(
    'UPDATE character_candidates SET chapter_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    chapterCount,
    candidateId,
  )

  if (!existing?.promotedEntityId && chapterCount >= CANDIDATE_PROMOTION_CHAPTER_THRESHOLD) {
    return promoteCharacterCandidate({
      novelId: params.novelId,
      branchId: params.branchId,
      candidateId,
      candidateName: normalizedSurfaceText,
    })
  }

  return null
}

function promoteCharacterCandidate(params: {
  novelId: string
  branchId: string
  candidateId: string
  candidateName: string
}): CharacterCandidatePromotion | null {
  const candidate = queryOne<{
    firstSeenChapter: number
    lastSeenChapter: number
    chapterCount: number
    promotedEntityId: string | null
  }>(
    `
      SELECT first_seen_chapter AS firstSeenChapter,
             last_seen_chapter AS lastSeenChapter,
             chapter_count AS chapterCount,
             promoted_entity_id AS promotedEntityId
      FROM character_candidates
      WHERE id = ?
      LIMIT 1
    `,
    params.candidateId,
  )

  if (!candidate || candidate.promotedEntityId || candidate.chapterCount < CANDIDATE_PROMOTION_CHAPTER_THRESHOLD) {
    return null
  }

  const fallbackDescription = queryOne<{ observation: string | null }>(
    `
      SELECT best_observation AS observation
      FROM character_candidate_chapters
      WHERE candidate_id = ?
      ORDER BY chapter_no DESC
      LIMIT 1
    `,
    params.candidateId,
  )?.observation?.trim() || null

  const entityId = upsertHanlpBootstrapCharacterEntity({
    novelId: params.novelId,
    branchId: params.branchId,
    name: params.candidateName,
    firstSeenChapter: candidate.firstSeenChapter,
    lastSeenChapter: candidate.lastSeenChapter,
    importanceTier: 'arc',
    status: 'candidate_promoted',
    description: fallbackDescription,
  })

  if (!entityId) {
    return null
  }

  execute(
    `
      UPDATE character_candidates
      SET promoted_entity_id = ?,
          status = 'promoted_pending_summary',
          promotion_summary_status = 'pending',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    entityId,
    params.candidateId,
  )

  return {
    candidateId: params.candidateId,
    entityId,
  }
}

function upsertCandidatePromotionSummaryArtifacts(params: {
  novelId: string
  branchId: string
  entityId: string
  summary: string
  descriptionDelta: string
  status: string
  profile: CharacterRoleCardProfile
}) {
  const existingEntity = queryOne<{ description: string | null }>(
    'SELECT description FROM KnowledgeEntity WHERE id = ? LIMIT 1',
    params.entityId,
  )

  execute(
    `
      UPDATE KnowledgeEntity
      SET description = ?,
          status = 'candidate_promoted',
          importanceTier = 'arc',
          updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    chooseConciseKnowledgeText(existingEntity?.description, params.summary) || params.summary,
    params.entityId,
  )

  const existingState = queryOne<{ id: string }>(
    `
      SELECT id
      FROM EntityState
      WHERE novelId = ? AND branchId = ? AND entityId = ? AND stateType = 'character_status' AND status = ?
      LIMIT 1
    `,
    params.novelId,
    params.branchId,
    params.entityId,
    CANDIDATE_PROMOTION_SUMMARY_STATUS,
  )

  if (existingState?.id) {
    execute(
      `
        UPDATE EntityState
        SET stateValue = ?,
            description = ?,
            validFromChapter = 0,
            validUntilChapter = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      params.status,
      params.descriptionDelta || params.summary,
      INF_CHAPTER,
      existingState.id,
    )
  } else {
    execute(
      `
        INSERT INTO EntityState (
          id, novelId, branchId, entityId, stateType, stateValue, description,
          sourceChapter, validFromChapter, validUntilChapter,
          evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
        )
        VALUES (?, ?, ?, ?, 'character_status', ?, ?, 0, 0, ?, NULL, NULL, 0.7, ?, 1)
      `,
      uid('entity-state'),
      params.novelId,
      params.branchId,
      params.entityId,
      params.status,
      params.descriptionDelta || params.summary,
      INF_CHAPTER,
      CANDIDATE_PROMOTION_SUMMARY_STATUS,
    )
  }

  const statusFactValueJson = JSON.stringify({ status: params.status, descriptionDelta: params.descriptionDelta || params.summary })
  const existingStatusFact = queryOne<{ id: string }>(
    `
      SELECT id
      FROM KnowledgeFact
      WHERE novelId = ? AND branchId = ? AND subjectEntityId = ? AND factType = 'character_status' AND predicate = 'status' AND status = ?
      LIMIT 1
    `,
    params.novelId,
    params.branchId,
    params.entityId,
    CANDIDATE_PROMOTION_SUMMARY_STATUS,
  )

  if (existingStatusFact?.id) {
    execute(
      `
        UPDATE KnowledgeFact
        SET valueJson = ?,
            sourceChapter = 0,
            validFromChapter = 0,
            validUntilChapter = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      statusFactValueJson,
      INF_CHAPTER,
      existingStatusFact.id,
    )
  } else {
    execute(
      `
        INSERT INTO KnowledgeFact (
          id, novelId, branchId, factType, subjectEntityId, predicate, valueJson,
          sourceChapter, validFromChapter, validUntilChapter, status
        )
        VALUES (?, ?, ?, 'character_status', ?, 'status', ?, 0, 0, ?, ?)
      `,
      uid('fact'),
      params.novelId,
      params.branchId,
      params.entityId,
      statusFactValueJson,
      INF_CHAPTER,
      CANDIDATE_PROMOTION_SUMMARY_STATUS,
    )
  }

  const profileValueJson = JSON.stringify({
    profile: params.profile,
    descriptionDelta: params.descriptionDelta || params.summary,
    summary: params.summary,
  })
  const existingProfileFact = queryOne<{ id: string }>(
    `
      SELECT id
      FROM KnowledgeFact
      WHERE novelId = ? AND branchId = ? AND subjectEntityId = ? AND factType = 'character_profile' AND predicate = 'role_card' AND status = ?
      LIMIT 1
    `,
    params.novelId,
    params.branchId,
    params.entityId,
    CANDIDATE_PROMOTION_SUMMARY_STATUS,
  )

  if (existingProfileFact?.id) {
    execute(
      `
        UPDATE KnowledgeFact
        SET valueJson = ?,
            sourceChapter = 0,
            validFromChapter = 0,
            validUntilChapter = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      profileValueJson,
      INF_CHAPTER,
      existingProfileFact.id,
    )
  } else {
    execute(
      `
        INSERT INTO KnowledgeFact (
          id, novelId, branchId, factType, subjectEntityId, predicate, valueJson,
          sourceChapter, validFromChapter, validUntilChapter, status
        )
        VALUES (?, ?, ?, 'character_profile', ?, 'role_card', ?, 0, 0, ?, ?)
      `,
      uid('fact-profile'),
      params.novelId,
      params.branchId,
      params.entityId,
      profileValueJson,
      INF_CHAPTER,
      CANDIDATE_PROMOTION_SUMMARY_STATUS,
    )
  }
}

async function finalizeCharacterCandidatePromotion(params: {
  novelId: string
  branchId: string
  promotion: CharacterCandidatePromotion
}) {
  const candidate = queryOne<{
    surfaceText: string
    firstSeenChapter: number
    lastSeenChapter: number
    chapterCount: number
    mentionCount: number
    promotedEntityId: string | null
    promotionSummaryStatus: CandidatePromotionSummaryStatus
  }>(
    `
      SELECT surface_text AS surfaceText,
             first_seen_chapter AS firstSeenChapter,
             last_seen_chapter AS lastSeenChapter,
             chapter_count AS chapterCount,
             mention_count AS mentionCount,
             promoted_entity_id AS promotedEntityId,
             promotion_summary_status AS promotionSummaryStatus
      FROM character_candidates
      WHERE id = ?
      LIMIT 1
    `,
    params.promotion.candidateId,
  )

  if (!candidate?.promotedEntityId || candidate.promotionSummaryStatus !== 'pending') {
    return
  }

  const observations = queryAll<{
    chapterNo: number
    mentionCount: number
    observation: string | null
    evidenceQuote: string | null
  }>(
    `
      SELECT chapter_no AS chapterNo,
             mention_count AS mentionCount,
             best_observation AS observation,
             best_evidence AS evidenceQuote
      FROM character_candidate_chapters
      WHERE candidate_id = ?
      ORDER BY chapter_no ASC
    `,
    params.promotion.candidateId,
  )

  const summary = await generateCandidatePromotionSummary({
    candidateName: candidate.surfaceText,
    firstSeenChapter: candidate.firstSeenChapter,
    lastSeenChapter: candidate.lastSeenChapter,
    chapterCount: candidate.chapterCount,
    mentionCount: candidate.mentionCount,
    observations,
  })

  await withKnowledgeWriteTransaction(params.novelId, async () => {
    const latest = queryOne<{ promotedEntityId: string | null; promotionSummaryStatus: CandidatePromotionSummaryStatus }>(
      `
        SELECT promoted_entity_id AS promotedEntityId,
               promotion_summary_status AS promotionSummaryStatus
        FROM character_candidates
        WHERE id = ?
        LIMIT 1
      `,
      params.promotion.candidateId,
    )

    if (!latest?.promotedEntityId || latest.promotionSummaryStatus !== 'pending') {
      return
    }

    upsertCandidatePromotionSummaryArtifacts({
      novelId: params.novelId,
      branchId: params.branchId,
      entityId: latest.promotedEntityId,
      summary: summary.summary,
      descriptionDelta: summary.descriptionDelta,
      status: summary.status,
      profile: summary.profile,
    })

    execute(
      `
        UPDATE character_candidates
        SET status = 'promoted',
            promotion_summary_status = 'completed',
            promotion_summary_generated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      params.promotion.candidateId,
    )
  })
}

function loadMergedCharacterProfileAtChapter(params: {
  novelId: string
  branchId: string
  entityId: string
  chapterNo: number
}) {
  const rows = queryAll<{ valueJson: string | null }>(
    `
      SELECT valueJson
      FROM KnowledgeFact
      WHERE novelId = ? AND branchId = ? AND subjectEntityId = ?
        AND factType = 'character_profile'
        AND validFromChapter <= ?
        AND validUntilChapter > ?
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY validFromChapter ASC, sourceChapter ASC
    `,
    params.novelId,
    params.branchId,
    params.entityId,
    params.chapterNo,
    params.chapterNo,
  )

  let profile: CharacterRoleCardProfile = {}
  for (const row of rows) {
    if (!row.valueJson) continue
    try {
      const parsed = JSON.parse(row.valueJson) as { profile?: unknown }
      profile = mergeCharacterRoleCardProfiles(profile, parsed.profile as CharacterRoleCardProfile)
    } catch {
    }
  }

  return profile
}

function insertFactEvidenceRows(params: {
  factId: string
  chapterId: string
  chapterNo: number
  evidence: Array<{ quote: string; lineStart: number; lineEnd: number }>
}) {
  for (const item of params.evidence) {
    execute(
      `
        INSERT INTO FactEvidence (id, factId, chapterId, chapterNo, lineStart, lineEnd, quote, evidenceSpanId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      uid('fact-evidence'),
      params.factId,
      params.chapterId,
      params.chapterNo,
      item.lineStart,
      item.lineEnd,
      item.quote,
      findEvidenceSpanId(params.chapterId, item.lineStart, item.lineEnd)
    )
  }
}

function hasCurrentProfileDetails(profile: CharacterRoleCardProfile | null | undefined) {
  return CHARACTER_ROLE_CARD_KEYS.some((key) => {
    const content = profile?.[key]?.content?.trim() || profile?.[key]?.summary?.trim()
    return Boolean(content && content !== '没有变化')
  })
}

function persistKnownCharacterUpdateArtifacts(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  entityId: string
  canonicalName: string
  originalSurfaceText: string
  item: ChapterKnowledgeExtraction['knownCharacterUpdates'][number]
}) {
  const existingEntity = queryOne<{
    description: string | null
    userConfirmed: number
    importanceTier: CharacterImportanceTier | null
  }>(
    'SELECT description, userConfirmed, importanceTier FROM KnowledgeEntity WHERE id = ? LIMIT 1',
    params.entityId,
  )
  const mergedProfile = mergeCharacterRoleCardProfiles(
    loadMergedCharacterProfileAtChapter({
      novelId: params.novelId,
      branchId: params.branchId,
      entityId: params.entityId,
      chapterNo: params.chapterNo,
    }),
    params.item.profile,
  )
  const mergedDescriptionDelta = buildCharacterDescriptionDelta(mergedProfile, params.item.descriptionDelta)

  if (!existingEntity?.userConfirmed || !existingEntity.description?.trim()) {
    execute(
      `
        UPDATE KnowledgeEntity
        SET description = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      chooseConciseKnowledgeText(existingEntity?.description, mergedDescriptionDelta || params.item.descriptionDelta) || null,
      params.entityId,
    )
  }

  for (const evidence of params.item.evidence) {
    execute(
      `
        INSERT INTO EntityAppearance (id, entityId, chapterId, chapterNo, lineStart, lineEnd, evidenceSpanId)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      uid('appearance'),
      params.entityId,
      params.chapterId,
      params.chapterNo,
      evidence.lineStart,
      evidence.lineEnd,
      findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd)
    )
  }

  if (!hasCharacterRoleCardProfile(params.item.profile) && !params.item.descriptionDelta.trim()) {
    return
  }

  const factId = uid('fact-profile')
  execute(
    `
      INSERT INTO KnowledgeFact (
        id, novelId, branchId, factType, subjectEntityId, predicate, valueJson,
        sourceChapter, validFromChapter, validUntilChapter
      )
      VALUES (?, ?, ?, 'character_profile', ?, 'role_card', ?, ?, ?, ?)
    `,
    factId,
    params.novelId,
    params.branchId,
    params.entityId,
    JSON.stringify({
      profile: params.item.profile,
      currentProfile: hasCurrentProfileDetails(mergedProfile) ? mergedProfile : undefined,
      descriptionDelta: mergedDescriptionDelta || params.item.descriptionDelta,
      originalSurfaceText: params.originalSurfaceText,
      canonicalName: params.canonicalName,
      importanceTier: existingEntity?.importanceTier ?? null,
    }),
    params.chapterNo,
    params.chapterNo,
    INF_CHAPTER,
  )

  insertFactEvidenceRows({
    factId,
    chapterId: params.chapterId,
    chapterNo: params.chapterNo,
    evidence: params.item.evidence,
  })
}

function applyKnownCharacterUpdate(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  item: ChapterKnowledgeExtraction['knownCharacterUpdates'][number]
  entityIdByName: Map<string, string>
}) {
  const normalizedName = normalizeCharacterMentionName(params.item.name)
  const primaryEvidence = params.item.evidence[0] ?? null
  const resolution = resolveCharacterEntityByName({
    branchId: params.branchId,
    name: normalizedName,
    chapterNo: params.chapterNo,
  })

  if (resolution.kind === 'blocked' || resolution.kind === 'ambiguous') {
    insertEntityMention({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      entityId: null,
      mentionText: normalizedName,
      resolutionKind: resolution.kind,
      evidence: primaryEvidence,
    })
    return
  }

  const entityId = resolution.kind === 'resolved'
    ? resolution.entityId
    : (params.entityIdByName.get(normalizedName) ?? getOrCreateCharacterEntity({
        novelId: params.novelId,
        branchId: params.branchId,
        name: normalizedName,
        description: buildCharacterDescriptionDelta(params.item.profile, params.item.descriptionDelta),
        status: 'known_character_update',
        chapterNo: params.chapterNo,
      }))

  if (!entityId) {
    insertEntityMention({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      entityId: null,
      mentionText: normalizedName,
      resolutionKind: 'unresolved',
      evidence: primaryEvidence,
    })
    return
  }

  const canonicalName = resolution.kind === 'resolved'
    ? resolution.canonicalName
    : normalizedName

  insertEntityMention({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapterId,
    chapterNo: params.chapterNo,
    entityId,
    mentionText: normalizedName,
    resolutionKind: 'resolved',
    evidence: primaryEvidence,
  })
  params.entityIdByName.set(normalizedName, entityId)
  params.entityIdByName.set(canonicalName, entityId)

  persistKnownCharacterUpdateArtifacts({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapterId,
    chapterNo: params.chapterNo,
    entityId,
    canonicalName,
    originalSurfaceText: normalizedName,
    item: params.item,
  })
}

function applyUnknownCharacterObservation(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  item: ChapterKnowledgeExtraction['unknownCharacterObservations'][number]
  entityIdByName: Map<string, string>
}) {
  const normalizedSurfaceText = normalizeCharacterMentionName(params.item.surfaceText)
  const primaryEvidence = params.item.evidence[0] ?? null
  const resolution = resolveCharacterEntityByName({
    branchId: params.branchId,
    name: normalizedSurfaceText,
    chapterNo: params.chapterNo,
  })

  if (resolution.kind === 'resolved') {
    insertEntityMention({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      entityId: resolution.entityId,
      mentionText: normalizedSurfaceText,
      resolutionKind: 'resolved',
      evidence: primaryEvidence,
    })
    params.entityIdByName.set(normalizedSurfaceText, resolution.entityId)
    return
  }

  if (resolution.kind === 'blocked' || resolution.kind === 'ambiguous') {
    insertEntityMention({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      entityId: null,
      mentionText: normalizedSurfaceText,
      resolutionKind: resolution.kind,
      evidence: primaryEvidence,
    })
    return
  }

  insertEntityMention({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapterId,
    chapterNo: params.chapterNo,
    entityId: null,
    mentionText: normalizedSurfaceText,
    resolutionKind: 'unresolved',
    evidence: primaryEvidence,
  })
  return upsertCharacterCandidateObservation({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapterId,
    chapterNo: params.chapterNo,
    surfaceText: normalizedSurfaceText,
    observation: params.item.observation,
    evidence: primaryEvidence,
  })
}

async function persistChapterExtraction(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  extraction: ChapterKnowledgeExtraction
}) {
  const entityIdByName = new Map<string, string>()
  const promotedCandidates = new Map<string, CharacterCandidatePromotion>()
  const hanlpWorldCategoryByTerm = loadHanlpWorldCategoryByTerm({
    branchId: params.branchId,
    chapterId: params.chapterId,
  })

  for (const item of params.extraction.characters) {
    const normalizedItemName = normalizeCharacterMentionName(item.name)
    const primaryEvidence = item.evidence[0] ?? null
    const resolution = resolveCharacterEntityByName({
      branchId: params.branchId,
      name: normalizedItemName,
      chapterNo: params.chapterNo,
    })

    if (resolution.kind === 'blocked' || resolution.kind === 'ambiguous') {
      insertEntityMention({
        novelId: params.novelId,
        branchId: params.branchId,
        chapterId: params.chapterId,
        chapterNo: params.chapterNo,
        entityId: null,
        mentionText: normalizedItemName,
        resolutionKind: resolution.kind,
        evidence: primaryEvidence,
      })
      continue
    }

    const entityId = await getOrCreateCharacterEntity({
      novelId: params.novelId,
      branchId: params.branchId,
      name: normalizedItemName,
      description: item.descriptionDelta,
      status: item.status,
      chapterNo: params.chapterNo,
    })
    if (!entityId) {
      insertEntityMention({
        novelId: params.novelId,
        branchId: params.branchId,
        chapterId: params.chapterId,
        chapterNo: params.chapterNo,
        entityId: null,
        mentionText: normalizedItemName,
        resolutionKind: 'unresolved',
        evidence: primaryEvidence,
      })
      continue
    }

    insertEntityMention({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      entityId,
      mentionText: normalizedItemName,
      resolutionKind: 'resolved',
      evidence: primaryEvidence,
    })

    entityIdByName.set(normalizedItemName, entityId)

    for (const alias of item.aliases) {
      const normalizedAlias = normalizeCharacterMentionName(alias)
      if (!normalizedAlias || isBlockedCharacterMention(normalizedAlias)) continue
      const claim = claimBranchGlobalCharacterAlias({
        novelId: params.novelId,
        branchId: params.branchId,
        alias: normalizedAlias,
        entityId,
        sourceChapter: params.chapterNo,
        targetName: normalizedItemName,
      })
      if (claim.ownerEntityId) {
        entityIdByName.set(normalizedAlias, claim.ownerEntityId)
      }
    }

    for (const evidence of item.evidence) {
      execute(
        `
          INSERT INTO EntityAppearance (id, entityId, chapterId, chapterNo, lineStart, lineEnd, evidenceSpanId)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        uid('appearance'),
        entityId,
        params.chapterId,
        params.chapterNo,
        evidence.lineStart,
        evidence.lineEnd,
        findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd)
      )
    }

    const primaryEvidenceSpanId = primaryEvidence
      ? findEvidenceSpanId(params.chapterId, primaryEvidence.lineStart, primaryEvidence.lineEnd)
      : null

    const activeEntityState = queryOne<{
      id: string
      stateValue: string
      status: string
    }>(
      `
        SELECT id, stateValue, status
        FROM EntityState
        WHERE novelId = ? AND branchId = ? AND entityId = ? AND stateType = 'character_status'
          AND validFromChapter <= ?
          AND validUntilChapter > ?
          AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ORDER BY CASE status WHEN 'user_confirmed' THEN 0 ELSE 1 END, sourceChapter DESC, confidence DESC
        LIMIT 1
      `,
      params.novelId,
      params.branchId,
      entityId,
      params.chapterNo,
      params.chapterNo,
    )

    let nextEntityStateStatus = 'ai_generated'
    let shouldInsertEntityState = true
    if (activeEntityState) {
      if (activeEntityState.stateValue === (item.status || 'unknown')) {
        shouldInsertEntityState = false
      } else if (activeEntityState.status === 'user_confirmed') {
        nextEntityStateStatus = 'conflicted'
      } else {
        execute(
          `
            UPDATE EntityState
            SET validUntilChapter = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          params.chapterNo,
          activeEntityState.id
        )
      }
    }

    if (shouldInsertEntityState) {
      execute(
        `
          INSERT INTO EntityState (
            id, novelId, branchId, entityId, stateType, stateValue, description,
            sourceChapter, validFromChapter, validUntilChapter,
            evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `,
        uid('entity-state'),
        params.novelId,
        params.branchId,
        entityId,
        'character_status',
        item.status || 'unknown',
        item.descriptionDelta || null,
        params.chapterNo,
        params.chapterNo,
        INF_CHAPTER,
        primaryEvidenceSpanId,
        primaryEvidence?.quote ?? null,
        0.7,
        nextEntityStateStatus
      )
    }

    execute(
      `
          INSERT INTO KnowledgeFact (
            id, novelId, branchId, factType, subjectEntityId, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter
          )
          VALUES (?, ?, ?, 'character_status', ?, 'status', ?, ?, ?, ?)
      `,
      uid('fact'),
      params.novelId,
      params.branchId,
      entityId,
      JSON.stringify({ status: item.status, descriptionDelta: item.descriptionDelta }),
      params.chapterNo,
      params.chapterNo,
      INF_CHAPTER
    )

    if (hasCharacterRoleCardProfile(item.profile)) {
      execute(
        `
          INSERT INTO KnowledgeFact (
            id, novelId, branchId, factType, subjectEntityId, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter
          )
          VALUES (?, ?, ?, 'character_profile', ?, 'role_card', ?, ?, ?, ?)
        `,
        uid('fact-profile'),
        params.novelId,
        params.branchId,
        entityId,
        JSON.stringify({
          profile: item.profile,
          descriptionDelta: buildCharacterDescriptionDelta(item.profile, item.descriptionDelta),
        }),
        params.chapterNo,
        params.chapterNo,
        INF_CHAPTER
      )
    }
  }

  for (const item of params.extraction.knownCharacterUpdates) {
    applyKnownCharacterUpdate({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      item,
      entityIdByName,
    })
  }

  for (const item of params.extraction.unknownCharacterObservations) {
    const promotion = applyUnknownCharacterObservation({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterId: params.chapterId,
      chapterNo: params.chapterNo,
      item,
      entityIdByName,
    })
    if (promotion) {
      promotedCandidates.set(promotion.candidateId, promotion)
    }
  }

  for (const relation of params.extraction.relations) {
    const normalizedSourceName = normalizeCharacterMentionName(relation.source)
    const normalizedTargetName = normalizeCharacterMentionName(relation.target)
    const sourceEntityId = entityIdByName.get(normalizedSourceName) ?? findResolvedCharacterEntityId({
      branchId: params.branchId,
      name: normalizedSourceName,
      chapterNo: params.chapterNo,
    })
    const targetEntityId = entityIdByName.get(normalizedTargetName) ?? findResolvedCharacterEntityId({
      branchId: params.branchId,
      name: normalizedTargetName,
      chapterNo: params.chapterNo,
    })
    if (!sourceEntityId || !targetEntityId) continue
    entityIdByName.set(normalizedSourceName, sourceEntityId)
    entityIdByName.set(normalizedTargetName, targetEntityId)
    const evidence = relation.evidence[0]
    const evidenceSpanId = evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null

    const existingRelation = queryOne<{
      id: string
      status: string | null
      polarity: string | null
      strength: number | null
      sourceChapter: number | null
      validFromChapter: number | null
      evidenceSpanId: string | null
    }>(
      `
        SELECT id, status, polarity, strength, sourceChapter, validFromChapter, evidenceSpanId
        FROM KnowledgeRelation
        WHERE novelId = ? AND branchId = ? AND sourceEntityId = ? AND targetEntityId = ? AND relationType = ?
          AND validFromChapter <= ?
          AND validUntilChapter > ?
          AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ORDER BY CASE status WHEN 'user_confirmed' THEN 0 ELSE 1 END, sourceChapter DESC
        LIMIT 1
      `,
      params.novelId,
      params.branchId,
      sourceEntityId,
      targetEntityId,
      relation.type,
      params.chapterNo,
      params.chapterNo
    )

    if (existingRelation) {
      if (existingRelation.status !== 'user_confirmed') {
        execute(
          `
            UPDATE KnowledgeRelation
            SET polarity = ?,
                strength = ?,
                sourceChapter = ?,
                validFromChapter = ?,
                evidenceSpanId = ?,
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          existingRelation.polarity && existingRelation.polarity !== 'neutral' ? existingRelation.polarity : relation.polarity,
          Math.max(existingRelation.strength ?? relation.strength, relation.strength),
          Math.max(existingRelation.sourceChapter ?? params.chapterNo, params.chapterNo),
          Math.min(existingRelation.validFromChapter ?? relation.validFromChapter, relation.validFromChapter),
          evidenceSpanId ?? existingRelation.evidenceSpanId,
          existingRelation.id
        )
      }
    } else {
      execute(
        `
          INSERT INTO KnowledgeRelation (
            id, novelId, branchId, sourceEntityId, targetEntityId, relationType, polarity, strength, sourceChapter, validFromChapter, validUntilChapter, evidenceSpanId
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        uid('relation'),
        params.novelId,
        params.branchId,
        sourceEntityId,
        targetEntityId,
        relation.type,
        relation.polarity,
        relation.strength,
        params.chapterNo,
        relation.validFromChapter,
        INF_CHAPTER,
        evidenceSpanId
      )
    }

    const existingLink = queryOne<{
      id: string
      status: string | null
      polarity: string | null
      strength: number | null
      sourceChapter: number | null
      validFromChapter: number | null
      evidenceSpanId: string | null
      evidenceQuote: string | null
      description: string | null
    }>(
      `
        SELECT id, status, polarity, strength, sourceChapter, validFromChapter, evidenceSpanId, evidenceQuote, description
        FROM EntityLink
        WHERE novelId = ? AND branchId = ? AND sourceEntityId = ? AND targetEntityId = ? AND linkType = ?
          AND validFromChapter <= ?
          AND validUntilChapter > ?
          AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
        ORDER BY CASE status WHEN 'user_confirmed' THEN 0 ELSE 1 END, sourceChapter DESC
        LIMIT 1
      `,
      params.novelId,
      params.branchId,
      sourceEntityId,
      targetEntityId,
      relation.type,
      params.chapterNo,
      params.chapterNo
    )

    if (existingLink) {
      if (existingLink.status !== 'user_confirmed') {
        execute(
          `
            UPDATE EntityLink
            SET label = ?,
                description = ?,
                polarity = ?,
                strength = ?,
                sourceChapter = ?,
                validFromChapter = ?,
                evidenceSpanId = ?,
                evidenceQuote = ?,
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          relation.type,
          chooseConciseKnowledgeText(existingLink.description, relation.change) || null,
          existingLink.polarity && existingLink.polarity !== 'neutral' ? existingLink.polarity : relation.polarity,
          Math.max(existingLink.strength ?? relation.strength, relation.strength),
          Math.max(existingLink.sourceChapter ?? params.chapterNo, params.chapterNo),
          Math.min(existingLink.validFromChapter ?? relation.validFromChapter, relation.validFromChapter),
          evidenceSpanId ?? existingLink.evidenceSpanId,
          evidence?.quote ?? existingLink.evidenceQuote,
          existingLink.id
        )
      }
      continue
    }

    execute(
      `
          INSERT INTO EntityLink (
            id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
            polarity, strength, weight, sourceChapter, validFromChapter, validUntilChapter,
            evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai_generated', 1)
        `,
      uid('entity-link'),
      params.novelId,
      params.branchId,
      sourceEntityId,
      targetEntityId,
      relation.type,
      relation.type,
      relation.change || null,
      relation.polarity,
        relation.strength,
          1,
          params.chapterNo,
          relation.validFromChapter,
          INF_CHAPTER,
          evidenceSpanId,
          evidence?.quote ?? null,
        0.7
    )
  }

  for (const event of params.extraction.events) {
    const evidence = event.evidence[0]
    const eventId = uid('event')

    execute(
      `
        INSERT INTO KnowledgeEvent (
          id, novelId, branchId, name, summary, eventType, chapterNo, lineStart, lineEnd, importance, consequences, evidenceSpanId
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      eventId,
      params.novelId,
      params.branchId,
      event.name,
      event.summary,
      event.eventType,
      params.chapterNo,
      evidence?.lineStart ?? null,
      evidence?.lineEnd ?? null,
      event.importance,
      event.consequences,
      evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null
    )

    for (const participant of event.participants) {
      const normalizedParticipantName = normalizeCharacterMentionName(participant.name)
      const entityId = entityIdByName.get(normalizedParticipantName) ?? findResolvedCharacterEntityId({
        branchId: params.branchId,
        name: normalizedParticipantName,
        chapterNo: params.chapterNo,
      })
      if (!entityId) continue
      entityIdByName.set(normalizedParticipantName, entityId)
      execute(
        'INSERT INTO EventParticipant (id, eventId, entityId, role) VALUES (?, ?, ?, ?)',
        uid('participant'),
        eventId,
        entityId,
        participant.role
      )
    }
  }

  for (const item of params.extraction.worldbuilding) {
    const evidence = item.evidence[0]
    const category = hanlpWorldCategoryByTerm.get(item.term.trim()) ?? item.category
    const existing = queryOne<{ id: string }>(
      'SELECT id FROM KnowledgeWorld WHERE branchId = ? AND term = ? AND category IS ?',
      params.branchId,
      item.term,
      category
    )

    if (existing) {
      const existingWorld = queryOne<{ status: string | null; definition: string | null }>(
        'SELECT status, definition FROM KnowledgeWorld WHERE id = ?',
        existing.id
      )
      if (existingWorld?.status === 'user_confirmed') {
        continue
      }
      execute(
        `
          UPDATE KnowledgeWorld
          SET definition = ?, validUntilChapter = ?, evidenceSpanId = ?, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        chooseConciseKnowledgeText(existingWorld?.definition, item.definition),
        INF_CHAPTER,
        evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null,
        existing.id
      )
      continue
    }

    execute(
        `
        INSERT INTO KnowledgeWorld (
          id, novelId, branchId, term, category, definition, firstSeenChapter, validFromChapter, validUntilChapter, evidenceSpanId
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      uid('world'),
      params.novelId,
      params.branchId,
      item.term,
      category,
      item.definition,
      params.chapterNo,
      params.chapterNo,
      INF_CHAPTER,
      evidence ? findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd) : null
    )
  }

  for (const thread of params.extraction.openThreads) {
    const factId = uid('fact-thread')
      execute(
        `
        INSERT INTO KnowledgeFact (id, novelId, branchId, factType, predicate, valueJson, sourceChapter, validFromChapter, validUntilChapter)
        VALUES (?, ?, ?, 'open_thread', ?, ?, ?, ?, ?)
      `,
      factId,
      params.novelId,
      params.branchId,
      thread.name,
      JSON.stringify({ description: thread.description }),
      params.chapterNo,
      params.chapterNo,
      INF_CHAPTER
    )

    const evidence = thread.evidence[0]
    if (evidence) {
      execute(
        `
          INSERT INTO FactEvidence (id, factId, chapterId, chapterNo, lineStart, lineEnd, quote, evidenceSpanId)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        uid('fact-evidence'),
        factId,
        params.chapterId,
        params.chapterNo,
        evidence.lineStart,
        evidence.lineEnd,
        evidence.quote,
        findEvidenceSpanId(params.chapterId, evidence.lineStart, evidence.lineEnd)
      )
    }
  }

  execute(
    `
      UPDATE KnowledgeChapter
      SET summary = ?, isDirty = 0, dirtyReason = NULL, knowledgeStatus = 'ready', updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    params.extraction.summary,
    params.chapterId
  )

  mergeDuplicateCharacterEntitiesForBranch({
    novelId: params.novelId,
    branchId: params.branchId,
  })

  return {
    promotedCandidates: [...promotedCandidates.values()],
  }
}

type RebuildKnowledgeForNovelParams = {
  novelId: string
  branchId?: string
  jobId?: string
  chapterRange?: KnowledgeRebuildChapterRange
  attemptId?: string | null
}

export async function startKnowledgeRebuildForNovel(params: { novelId: string; branchId?: string; chapterRange?: KnowledgeRebuildChapterRange }) {
  return runWithNovelDatabaseAccess(params.novelId, async () => {
    const branchId = params.branchId ?? getMainBranchId(params.novelId)
    const chapterRange = normalizeKnowledgeRebuildChapterRange(params.chapterRange)
    reconcileKnowledgeJobWatchdog({
      novelId: params.novelId,
      branchId,
      jobTypes: [MAIN_KNOWLEDGE_JOB_TYPE, RETRIEVAL_REBUILD_JOB_TYPE],
    })
    const activeRetrievalJob = queryOne<{ id: string }>(
      'SELECT id FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN (\'queued\', \'running\', \'paused\') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1',
      params.novelId,
      branchId,
      RETRIEVAL_REBUILD_JOB_TYPE,
    )
    if (activeRetrievalJob?.id) {
      abortKnowledgeJob(activeRetrievalJob.id)
    }
    const activeJob = queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN (\'queued\', \'running\', \'paused\') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1',
      params.novelId,
      branchId,
      MAIN_KNOWLEDGE_JOB_TYPE,
    )

    if (activeJob?.id) {
      if (activeJob.status === 'paused') {
        updateKnowledgeJob(activeJob.id, { status: 'queued', currentStep: progressMessage('progress.rebuildResumePrepare') })
        return { jobId: activeJob.id, outcome: 'queued' as KnowledgeRebuildStartOutcome }
      }

      return {
        jobId: activeJob.id,
        outcome: activeJob.status === 'running' ? 'running' as const : 'queued' as const,
      }
    }

    const job = await enqueueKnowledgeJob({
      novelId: params.novelId,
      branchId,
      jobType: MAIN_KNOWLEDGE_JOB_TYPE,
      currentStep: progressMessage('progress.rebuildPrepare'),
      payload: { branchId, chapterRange, rebuildStartChapter: chapterRange?.startChapter },
    })

    if (!job?.id) {
      throw new Error('Failed to create knowledge job')
    }

    return { jobId: job.id, outcome: 'queued' as const }
  })
}

export async function runStartedKnowledgeRebuildForNovel(params: { novelId: string; branchId?: string; jobId: string; attemptId?: string | null }) {
  return runWithNovelDatabaseAccess(params.novelId, async () => {
    if (activeKnowledgeRebuildRuns.has(params.jobId)) {
      return
    }

    let result: Awaited<ReturnType<typeof rebuildKnowledgeForNovel>> | null = null
    activeKnowledgeRebuildRuns.add(params.jobId)
    try {
      result = await rebuildKnowledgeForNovel(params)
    } finally {
      activeKnowledgeRebuildRuns.delete(params.jobId)
    }

    if (result?.outcome !== 'completed') {
      return
    }

    const state = getKnowledgeRebuildJobState(params.jobId)
    const retrievalJob = await startKnowledgeRetrievalRebuildForNovel({
      novelId: params.novelId,
      branchId: params.branchId,
      chapterRange: state?.payload.chapterRange,
    })
    await runStartedKnowledgeRetrievalRebuildForNovel({
      novelId: params.novelId,
      branchId: params.branchId,
      jobId: retrievalJob.jobId,
    })
  })
}

export async function rebuildKnowledgeForNovel(params: RebuildKnowledgeForNovelParams) {
  return runWithNovelDatabaseAccess(params.novelId, async () => {
  const branchId = params.branchId ?? getMainBranchId(params.novelId)
  reconcileKnowledgeJobWatchdog({
    novelId: params.novelId,
    branchId,
    jobTypes: [MAIN_KNOWLEDGE_JOB_TYPE],
  })
  const targetedJob = params.jobId
    ? queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM KnowledgeJob WHERE id = ? AND novelId = ? AND branchId = ? AND jobType = ?',
        params.jobId,
        params.novelId,
        branchId,
        MAIN_KNOWLEDGE_JOB_TYPE,
      )
    : null
  const activeJob = targetedJob ?? queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN (\'queued\', \'running\', \'paused\') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1',
    params.novelId,
    branchId,
    MAIN_KNOWLEDGE_JOB_TYPE,
  )

  if (params.jobId && !targetedJob?.id) {
    throw new Error('Knowledge job not found')
  }

  if (activeJob?.id) {
    if (params.jobId && activeJob.status !== 'queued') {
      if (activeJob.status === 'running') {
        return null
      }

      return { jobId: activeJob.id, outcome: getKnowledgeJobOutcome(activeJob.id) }
    }

    if (!params.jobId && activeJob.status === 'running') {
      await waitForKnowledgeJobCompletion(activeJob.id)
      return { jobId: activeJob.id, outcome: getKnowledgeJobOutcome(activeJob.id) }
    }

    if (!params.jobId && activeJob.status === 'paused') {
      return { jobId: activeJob.id, outcome: 'paused' as const }
    }
  }

  const job = activeJob?.id
    ? { id: activeJob.id }
    : await enqueueKnowledgeJob({
        novelId: params.novelId,
        branchId,
        jobType: MAIN_KNOWLEDGE_JOB_TYPE,
        currentStep: progressMessage('progress.rebuildPrepare'),
        payload: { branchId, chapterRange: normalizeKnowledgeRebuildChapterRange(params.chapterRange), rebuildStartChapter: normalizeKnowledgeRebuildChapterRange(params.chapterRange)?.startChapter },
      })

  if (!job?.id) {
    throw new Error('Failed to create knowledge job')
  }

  let claimedAttemptId: string | null = null
  try {
    let jobState = getKnowledgeRebuildJobState(job.id)
    const claimedProgress = Math.max(0.05, queryOne<{ progress: number }>('SELECT progress FROM KnowledgeJob WHERE id = ?', job.id)?.progress ?? 0)
    const claimedJob = await claimQueuedKnowledgeJob({
      jobId: job.id,
      currentStep: jobState?.phase === 'extract' ? progressMessage('progress.extract') : progressMessage('progress.rebuildResume'),
      progress: claimedProgress,
      expectedAttemptId: params.attemptId,
    })
    if (!claimedJob.claimed) {
      if (claimedJob.status === 'running') {
        if (params.jobId) return { jobId: job.id, outcome: 'running' as const }

        await waitForKnowledgeJobCompletion(job.id)
        return { jobId: job.id, outcome: getKnowledgeJobOutcome(job.id) }
      }

      return { jobId: job.id, outcome: getKnowledgeJobOutcome(job.id) }
    }

    if (!claimedJob.attemptId) {
      throw new Error('Claimed knowledge rebuild job is missing an attempt id')
    }

    claimedAttemptId = claimedJob.attemptId
    return await runKnowledgeJobWithAttempt(job.id, claimedAttemptId, async () => {
      const chapters = queryAll<KnowledgeChapterRow>(
        'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
        params.novelId,
        branchId
      )
      const defaultRebuildStartChapter = getRebuildStartChapter(chapters)
      const requestedChapterRange = normalizeKnowledgeRebuildChapterRange(params.chapterRange)
      const defaultChapterRange = resolveKnowledgeRebuildChapterRange({
        payload: {
          rebuildStartChapter: jobState?.payload.rebuildStartChapter ?? defaultRebuildStartChapter,
          chapterRange: jobState?.payload.chapterRange ?? requestedChapterRange,
        },
        defaultStartChapter: defaultRebuildStartChapter,
      })
      const defaultRebuildChapters = getRebuildChapters(chapters, defaultChapterRange)
      const hanlpBootstrapChapters = chapters.slice().sort((left, right) => left.chapterNo - right.chapterNo)
      if (!isKnowledgeRebuildJobStateInitialized(jobState)) {
        const chapterWeightsById = Object.fromEntries(defaultRebuildChapters.map((chapter) => [chapter.id, getChapterProgressWeight(chapter.rawText)]))
        const totalChapterWeight = defaultRebuildChapters.reduce((sum, chapter) => sum + (chapterWeightsById[chapter.id] ?? 0), 0)

          initializeKnowledgeRebuildJobState(job.id, {
            branchId,
            rebuildStartChapter: defaultChapterRange.startChapter,
            chapterRange: defaultChapterRange,
            phase: 'hanlp-bootstrap',
            inlineCleanupCompleted: false,
            pendingChapterIds: defaultRebuildChapters.map((chapter) => chapter.id),
            chapterWeightsById,
            totalChapterWeight,
            totalChapterCount: defaultRebuildChapters.length,
            processedChapterWeight: 0,
            extractedChapters: [],
            currentBatchChapters: [],
            extractionSettings: loadStoredAISettings().knowledgeExtraction,
            embeddingSettingsSnapshot: buildEmbeddingSettingsSnapshot(),
            indexProgress: undefined,
             hanlpBootstrap: createEmptyHanlpBootstrapState(hanlpBootstrapChapters.length),
             orderedAliasDiscoveries: [],
             appliedAliasDiscoveryCount: 0,
             stageStartedAtByKey: {
               'hanlp-bootstrap': new Date().toISOString(),
             },
          })
        jobState = getKnowledgeRebuildJobState(job.id)
      }

      updateKnowledgeJob(job.id, {
        currentStep: jobState?.phase === 'extract' ? progressMessage('progress.extract') : progressMessage('progress.rebuildResume'),
        progress: claimedProgress,
      })

      while (true) {
        assertKnowledgeRebuildContinues(job.id)
        jobState = getKnowledgeRebuildJobState(job.id)
        if (!jobState) {
          throw new Error('Knowledge rebuild job state is missing')
        }

        const currentJobState = jobState
        const rebuildChapterRange = resolveKnowledgeRebuildChapterRange({
          payload: currentJobState.payload,
          defaultStartChapter: defaultRebuildStartChapter,
        })

        if (currentJobState.phase === 'hanlp-bootstrap') {
          const currentChapters = queryAll<KnowledgeChapterRow>(
            'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
            params.novelId,
            branchId
          )
          const maxHanlpChapterNo = currentChapters[currentChapters.length - 1]?.chapterNo ?? 0
          const coverageMarker = getHanlpBootstrapCoverageMarker(params.novelId)
          if (coverageMarker?.validThroughChapterNo) {
            const coveredChapterIds = currentChapters
              .filter((chapter) => chapter.chapterNo <= coverageMarker.validThroughChapterNo)
              .map((chapter) => chapter.id)
            const currentHanlpState = currentJobState.payload.hanlpBootstrap ?? createEmptyHanlpBootstrapState(currentChapters.length)
            const hasSyncedCoverage = currentHanlpState.totalChapterCount === currentChapters.length
              && coveredChapterIds.every((chapterId) => currentHanlpState.completedChapterIds.includes(chapterId))
            if (!hasSyncedCoverage) {
              applyHanlpBootstrapCoverageToKnowledgeJob(job.id, currentChapters, coverageMarker.validThroughChapterNo)
              continue
            }
          }

          const hanlpState = currentJobState.payload.hanlpBootstrap ?? createEmptyHanlpBootstrapState(currentChapters.length)
          const remainingChapters = currentChapters
            .filter((chapter) => !hanlpState.completedChapterIds.includes(chapter.id))
            .sort((left, right) => left.chapterNo - right.chapterNo)

          if (!remainingChapters.length) {
            if (!hanlpState.initializedCharacterEntities) {
              updateKnowledgeJob(job.id, {
                currentStep: progressMessage('progress.hanlpInitialize'),
                progress: 0.08,
              })
              assertKnowledgeRebuildContinues(job.id)
              await initializeHanlpBootstrapCharacterEntities({
                novelId: params.novelId,
                branchId,
                status: 'hanlp_bootstrap',
              })
              markHanlpBootstrapCharacterInitializationCompleted(job.id)
              continue
            }

            upsertHanlpBootstrapCoverageMarker(params.novelId, maxHanlpChapterNo)
            updateKnowledgeRebuildJobTelemetry(job.id, {
              stageTimingsMs: {
                'hanlp-bootstrap': Math.max(0, Date.now() - parseStageStartedAt(currentJobState.payload.stageStartedAtByKey?.['hanlp-bootstrap'])),
              },
            })
            setKnowledgeRebuildJobPhase(job.id, 'extract')
            continue
          }

          const hanlpParallelism = getHanlpBootstrapParallelism()
          const hanlpBatch = remainingChapters.slice(0, Math.min(hanlpParallelism, remainingChapters.length))
          updateKnowledgeJob(job.id, {
            currentStep: progressMessage('progress.hanlpBatch', { remaining: remainingChapters.length, batch: hanlpBatch.length }),
            progress: hanlpState.totalChapterCount > 0 ? 0.01 + clampProgress(hanlpState.completedChapterCount / hanlpState.totalChapterCount) * 0.09 : 0.1,
          })

          const hanlpResults = await Promise.all(
            hanlpBatch.map(async (chapter) => {
              assertKnowledgeRebuildContinues(job.id)
              if (!chapterStillExists(chapter.id)) {
                return { chapter, skipped: true as const }
              }

              const result = await runHanlpBootstrapForChapter({
                novelId: params.novelId,
                branchId,
                chapterId: chapter.id,
                chapterNo: chapter.chapterNo,
                rawText: chapter.rawText,
              }, {
                knowledgeJobId: job.id,
              })

              return { chapter, source: result.source, skipped: false as const }
            })
          )

          for (const result of hanlpResults.sort((left, right) => left.chapter.chapterNo - right.chapter.chapterNo)) {
            if (result.skipped) continue
            completeHanlpBootstrapChapterInKnowledgeJob(job.id, result.chapter.id, result.source)
            upsertHanlpBootstrapCoverageMarker(params.novelId, result.chapter.chapterNo)
            const nextState = getKnowledgeRebuildJobState(job.id)
            updateKnowledgeJob(job.id, {
              currentStep: progressMessage('progress.hanlpChapter', { chapter: result.chapter.chapterNo }),
              progress: (nextState?.payload.hanlpBootstrap?.totalChapterCount ?? 0) > 0
                ? 0.01 + clampProgress((nextState?.payload.hanlpBootstrap?.completedChapterCount ?? 0) / Math.max(1, nextState?.payload.hanlpBootstrap?.totalChapterCount ?? 1)) * 0.09
                : 0.1,
            })
          }
          continue
        }

        if (currentJobState.phase === 'extract') {
          if (!currentJobState.payload.inlineCleanupCompleted) {
            updateKnowledgeJob(job.id, {
              currentStep: progressMessage('progress.publishPrepare'),
              progress: getKnowledgeStructuredWorkProgress(currentJobState),
            })
            markInlineKnowledgeCleanupCompleted(job.id)
            continue
          }

          const currentChapters = queryAll<KnowledgeChapterRow>(
          'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
            params.novelId,
            branchId
          )
          const remainingChapters = currentChapters
            .filter((chapter) => chapterIsInRebuildRange(chapter.chapterNo, rebuildChapterRange) && currentJobState.pendingChapterIds.includes(chapter.id))
            .sort((left, right) => left.chapterNo - right.chapterNo)

          if (!remainingChapters.length) {
            if (currentJobState.extractedChapters.length) {
              setKnowledgeRebuildJobPhase(job.id, 'batch-sync')
              continue
            }
            break
          }

          if (currentJobState.extractedChapters.length) {
            setKnowledgeRebuildJobPhase(job.id, 'batch-sync')
            continue
          }

          const extractionSettings = getKnowledgeExtractionSettingsSnapshot(currentJobState.payload)
          const configuredParallelism = getKnowledgeExtractionParallelism(extractionSettings)
          const extractionBatch = remainingChapters.slice(0, Math.min(configuredParallelism, remainingChapters.length))
          updateKnowledgeJob(job.id, {
            currentStep: progressMessage('progress.extractBatch', { remaining: remainingChapters.length, batch: extractionBatch.length, concurrency: configuredParallelism }),
            progress: getKnowledgeStructuredWorkProgress(currentJobState),
          })

          const extractedBatchChapters: KnowledgeRebuildPayloadChapter[] = []
          await Promise.all(
            extractionBatch.map(async (chapter) => {
              assertKnowledgeRebuildContinues(job.id)

              if (!chapterStillExists(chapter.id)) {
                assertKnowledgeRebuildContinues(job.id)
                removePendingChaptersFromKnowledgeJob(job.id, [chapter.id])
                return
              }

              try {
                await extractChapterCandidates({
                  novelId: params.novelId,
                  branchId,
                  chapter,
                  settings: extractionSettings,
                  assertCanContinue: () => assertKnowledgeRebuildContinues(job.id),
                })
                assertKnowledgeRebuildContinues(job.id)
                const extractedChapter = { chapterId: chapter.id, chapterNo: chapter.chapterNo }
                extractedBatchChapters.push(extractedChapter)
                completePendingChapterInKnowledgeJob(job.id, chapter.id, extractedChapter)
              } catch (error) {
                if (isKnowledgeRebuildControlError(error)) {
                  throw error
                }

                upsertChapterExtractionCandidate({
                  novelId: params.novelId,
                  branchId,
                  chapterId: chapter.id,
                    chapterNo: chapter.chapterNo,
                    chapterRevision: chapter.revision,
                    chapterSourceHash: buildChapterExtractionCandidateSourceHash({
                      chapterSourceHash: chapter.sourceHash,
                      settings: extractionSettings,
                    }),
                    extractionJson: '{}',
                    processingBatchId: null,
                    processingResultJson: null,
                    status: 'failed',
                    errorMessage: error instanceof Error ? error.message : `Chapter ${chapter.chapterNo} candidate extraction failed`,
                })
                assertKnowledgeRebuildContinues(job.id)
                completePendingChapterInKnowledgeJob(job.id, chapter.id)
              }

              updateKnowledgeJob(job.id, {
                currentStep: progressMessage('progress.extractChapter', { chapter: chapter.chapterNo }),
              })
            })
          )

          if (extractedBatchChapters.length) {
            setWriteQueueInKnowledgeJob(
              job.id,
              extractedBatchChapters.sort((left, right) => left.chapterNo - right.chapterNo),
            )
            setKnowledgeRebuildJobPhase(job.id, 'batch-sync')
          }
          continue
        }

        if (currentJobState.phase === 'batch-sync') {
          const currentChapters = queryAll<KnowledgeChapterRow>(
            'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
            params.novelId,
            branchId
          )
          const currentBatchChapters = currentJobState.extractedChapters
            .filter((chapter) => chapterStillExists(chapter.chapterId))
            .sort((left, right) => left.chapterNo - right.chapterNo)
          if (currentBatchChapters.length !== currentJobState.extractedChapters.length) {
            setWriteQueueInKnowledgeJob(job.id, currentBatchChapters)
            continue
          }
          if (!currentBatchChapters.length) {
            if (currentJobState.pendingChapterIds.length) {
              resetCurrentBatchAndReturnToExtract(job.id, currentJobState)
              continue
            }
            break
          }
          const extractionSettings = getKnowledgeExtractionSettingsSnapshot(currentJobState.payload)
          const orderedAliasDiscoveries = buildBatchAliasDiscoveryPlan({
            branchId,
            chapters: currentBatchChapters.map((chapter) => ({
              chapterId: chapter.chapterId,
              chapterNo: chapter.chapterNo,
              chapterSourceHash: buildChapterExtractionCandidateSourceHash({
                chapterSourceHash: currentChapters.find((item) => item.id === chapter.chapterId)?.sourceHash ?? '',
                settings: extractionSettings,
              }),
            })),
          })

          updateKnowledgeJob(job.id, {
            currentStep: progressMessage('progress.batchOrder'),
            progress: getKnowledgeStructuredWorkProgress(currentJobState),
          })
          const batchContext = buildChapterExtractionBatchProcessingContext({
            chapters: currentBatchChapters,
            aliasDiscoveries: orderedAliasDiscoveries,
          })
          const processingBatchId = createOrReuseChapterExtractionProcessingBatch({
            novelId: params.novelId,
            branchId,
            batchContext,
          })
          for (const queuedChapter of currentBatchChapters) {
            const currentChapter = currentChapters.find((item) => item.id === queuedChapter.chapterId)
            if (!currentChapter) continue
            assignChapterExtractionProcessingBatch({
              branchId,
              chapterId: queuedChapter.chapterId,
              chapterSourceHash: buildChapterExtractionCandidateSourceHash({
                chapterSourceHash: currentChapter.sourceHash,
                settings: extractionSettings,
              }),
              processingBatchId,
            })
          }
          setBatchAliasSyncPlanInKnowledgeJob({
            jobId: job.id,
            chapters: currentBatchChapters,
            orderedAliasDiscoveries,
          })
          applyOrderedBatchAliasDiscoveries({
            novelId: params.novelId,
            branchId,
            jobId: job.id,
          })
          const writeState = getKnowledgeRebuildJobState(job.id)
          if (!writeState) {
            throw new Error('Knowledge rebuild job state is missing before write')
          }
          setKnowledgeRebuildJobPhase(job.id, 'write', {
            currentStep: progressMessage('progress.writePrepare', { chapters: writeState.extractedChapters.length }),
            progress: getKnowledgeStructuredWorkProgress(writeState),
          })
          continue
        }

        if (currentJobState.phase === 'cleanup') {
          setKnowledgeRebuildJobPhase(job.id, 'hanlp-bootstrap')
          continue
        }

        if (currentJobState.phase === 'raw-embedding') {
          break
        }

        if (currentJobState.phase === 'write') {
          const currentChapters = queryAll<KnowledgeChapterRow>(
            'SELECT id, novelId, branchId, chapterNo, title, rawText, summary, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
            params.novelId,
            branchId
          )
          const chapterById = new Map(currentChapters.map((chapter) => [chapter.id, chapter]))
          const writeQueue = currentJobState.extractedChapters
            .filter((chapter) => chapterStillExists(chapter.chapterId))
            .sort((left, right) => left.chapterNo - right.chapterNo)

          if (writeQueue.length !== currentJobState.extractedChapters.length) {
            for (const chapter of currentJobState.extractedChapters) {
              if (!chapterStillExists(chapter.chapterId)) {
                assertKnowledgeRebuildContinues(job.id)
                removeExtractedChapterFromKnowledgeJob(job.id, chapter.chapterId)
              }
            }
            continue
          }

          if (!writeQueue.length) {
            if (currentJobState.pendingChapterIds.length) {
              resetCurrentBatchAndReturnToExtract(job.id, currentJobState)
              continue
            }
            break
          }

          const extractionSettings = getKnowledgeExtractionSettingsSnapshot(currentJobState.payload)
          const currentBatchChapters = getCurrentBatchChaptersForProcessing(currentJobState, writeQueue)
          const batchContext = buildChapterExtractionBatchProcessingContext({
            chapters: currentBatchChapters,
            aliasDiscoveries: currentJobState.payload.orderedAliasDiscoveries ?? [],
          })
          const candidateByChapterId = loadChapterExtractionCandidatesForBatch({
            branchId,
            chapters: currentBatchChapters.flatMap((batchChapter) => {
              const chapter = chapterById.get(batchChapter.chapterId)
              if (!chapter) return []
              return [{
                chapterId: chapter.id,
                chapterSourceHash: buildChapterExtractionCandidateSourceHash({
                  chapterSourceHash: chapter.sourceHash,
                  settings: extractionSettings,
                }),
              }]
            }),
          })

          for (const queuedChapter of writeQueue) {
            const chapter = chapterById.get(queuedChapter.chapterId)
            if (!chapter) {
              assertKnowledgeRebuildContinues(job.id)
              removeExtractedChapterFromKnowledgeJob(job.id, queuedChapter.chapterId)
              continue
            }

            updateKnowledgeJob(job.id, {
              currentStep: progressMessage('progress.writeChapter', { chapter: chapter.chapterNo }),
            })

            assertKnowledgeRebuildContinues(job.id)
            const candidate = candidateByChapterId.get(chapter.id) ?? null

            if (candidate?.status === 'persisted' && chapter.knowledgeStatus === 'ready' && chapter.isDirty === 0) {
              assertKnowledgeRebuildContinues(job.id)
              removeExtractedChapterFromKnowledgeJob(job.id, chapter.id)
              continue
            }

            if (!candidate || candidate.status === 'stale') {
              updateChapterKnowledgeStatus({
                chapterId: chapter.id,
                knowledgeStatus: 'stale',
                dirtyReason: candidate?.errorMessage ?? 'Chapter changed during rebuild before publish',
              })
              assertKnowledgeRebuildContinues(job.id)
              removeExtractedChapterFromKnowledgeJob(job.id, chapter.id)
              continue
            }

            if (candidate.status === 'failed') {
              updateChapterKnowledgeStatus({
                chapterId: chapter.id,
                knowledgeStatus: 'degraded',
                dirtyReason: candidate.errorMessage ?? 'Candidate unavailable for ordered apply',
              })
              assertKnowledgeRebuildContinues(job.id)
              removeExtractedChapterFromKnowledgeJob(job.id, chapter.id)
              continue
            }

            try {
              updateExistingChapterExtractionCandidate({
                candidateId: candidate.id,
                status: 'resolving',
                errorMessage: null,
              })

              const resolved = resolveChapterCandidate({
                candidate,
                storyState: '',
                batchContext,
              })
              updateExistingChapterExtractionCandidate({
                candidateId: candidate.id,
                status: 'resolving',
                errorMessage: null,
                processingResultJson: serializeChapterExtractionProcessingCache({
                  batchContext,
                  resolved,
                }),
              })
              await persistResolvedChapterKnowledge({
                novelId: params.novelId,
                branchId,
                chapterId: chapter.id,
                chapterNo: chapter.chapterNo,
                candidateId: candidate.id,
                resolved,
              })
              assertKnowledgeRebuildContinues(job.id)
            } catch (error) {
              if (isKnowledgeRebuildControlError(error)) {
                throw error
              }

              updateExistingChapterExtractionCandidate({
                candidateId: candidate.id,
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : `Chapter ${chapter.chapterNo} ordered apply failed`,
                processingBatchId: null,
                processingResultJson: null,
              })
              updateChapterKnowledgeStatus({
                chapterId: chapter.id,
                knowledgeStatus: 'degraded',
                dirtyReason: error instanceof Error ? error.message : 'Ordered apply failed',
              })
              assertKnowledgeRebuildContinues(job.id)
            }
            removeExtractedChapterFromKnowledgeJob(job.id, chapter.id)
          }
          continue
        }

      }

      assertKnowledgeRebuildContinues(job.id)
      const finalState = getKnowledgeRebuildJobState(job.id)
      if (finalState?.payload.phase === 'raw-embedding' || finalState?.payload.phase === 'index') {
        setKnowledgeRebuildJobPhase(job.id, 'write')
      }

      updateKnowledgeJob(job.id, { status: 'succeeded', currentStep: progressMessage('progress.completed'), progress: 1 })

      return { jobId: job.id, outcome: 'completed' as const }
    })
  } catch (error) {
    if (!claimedAttemptId) {
      throw error
    }

    if (error instanceof KnowledgeRebuildPausedError) {
      updateKnowledgeJob(job.id, { status: 'paused', currentStep: progressMessage('progress.paused') }, { expectedAttemptId: claimedAttemptId })
      return { jobId: job.id, outcome: 'paused' as const }
    }

    if (error instanceof KnowledgeRebuildAbortedError) {
      updateKnowledgeJob(job.id, {
        status: 'aborted',
        currentStep: null,
        progress: 0,
        payload: {
          branchId,
          phase: 'hanlp-bootstrap',
          currentChapterId: null,
          pendingChapterIds: [],
          chapterWeightsById: {},
          totalChapterWeight: 0,
          totalChapterCount: 0,
          processedChapterWeight: 0,
          extractedChapters: [],
          currentBatchChapters: [],
          extractionSettings: loadStoredAISettings().knowledgeExtraction,
          embeddingSettingsSnapshot: getOrCreateEmbeddingSettingsSnapshot({ branchId }),
          indexProgress: undefined,
           hanlpBootstrap: createEmptyHanlpBootstrapState(0),
           orderedAliasDiscoveries: [],
           appliedAliasDiscoveryCount: 0,
           stageStartedAtByKey: {},
         },
       }, { expectedAttemptId: claimedAttemptId })
      return { jobId: job.id, outcome: 'aborted' as const }
    }

    updateKnowledgeJob(job.id, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Knowledge rebuild failed',
    }, { expectedAttemptId: claimedAttemptId })
    throw error
  }
  })
}

export async function pauseKnowledgeRebuildForNovel(params: { novelId: string; branchId?: string }) {
  return runWithNovelDatabaseAccess(params.novelId, async () => {
    const branchId = params.branchId ?? getMainBranchId(params.novelId)
    const activeJob = findKnowledgeJobByTypes({
      novelId: params.novelId,
      branchId,
      jobTypes: [MAIN_KNOWLEDGE_JOB_TYPE, RETRIEVAL_REBUILD_JOB_TYPE],
      statuses: ['queued', 'running'],
    })

    if (!activeJob?.id) {
      return 'idle' as const
    }

    pauseKnowledgeJob(activeJob.id)
    return 'paused' as const
  })
}

export async function abortKnowledgeRebuildForNovel(params: { novelId: string; branchId?: string }) {
  return runWithNovelDatabaseAccess(params.novelId, async () => {
    const branchId = params.branchId ?? getMainBranchId(params.novelId)
    const activeJob = findKnowledgeJobByTypes({
      novelId: params.novelId,
      branchId,
      jobTypes: [MAIN_KNOWLEDGE_JOB_TYPE, RETRIEVAL_REBUILD_JOB_TYPE],
      statuses: ['queued', 'running', 'paused'],
    })

    if (!activeJob?.id) {
      return 'idle' as const
    }

    abortKnowledgeJob(activeJob.id)
    return 'aborted' as const
  })
}

async function abortKnowledgeRebuildForNovelUntilIdle(params: { novelId: string; branchId: string }) {
  await abortKnowledgeRebuildUntilIdle({
    novelId: params.novelId,
    branchId: params.branchId,
    abortAttempt: () => abortKnowledgeRebuildForNovel(params),
  })
}

export async function deleteKnowledgeGraphForNovel(params: { novelId: string; branchId?: string }) {
  return runWithNovelDatabaseAccess(params.novelId, async () => {
    const branchId = params.branchId ?? getMainBranchId(params.novelId)
    await abortKnowledgeRebuildForNovelUntilIdle({ novelId: params.novelId, branchId })
    await deleteBranchRetrievalIndex(params.novelId, branchId)
    await clearKnowledgeGraphData(params.novelId, branchId)
    return 'deleted' as const
  })
}

export const syncWorkspacePayloadToKnowledgeStore = createWorkspaceKnowledgeSync({
  abortKnowledgeRebuildUntilIdle: abortKnowledgeRebuildForNovelUntilIdle,
})

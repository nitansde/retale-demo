import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseAccess } from '@/lib/server/database-access'
import { safeParseJsonObject } from '@/lib/server/json-parse'
import { execute, queryAll, queryOne } from '@/lib/server/database-access'
import {
  createTaskWatchdogAttemptId,
  getTaskWatchdogAttemptId,
  mergeTaskWatchdogState,
  parseTaskWatchdogPayload,
} from '@/lib/server/task-watchdog-attempt'
import { normalizeWritingSkillCardIds } from '@/lib/writing-skill-selection'

export const RECOVERABLE_REWRITE_JOB_TYPE = 'rewrite_generation'

export const RECOVERABLE_REWRITE_ABORTED_STATUS = 'aborted'

const TERMINAL_REWRITE_JOB_STATUSES = new Set(['succeeded', 'failed', RECOVERABLE_REWRITE_ABORTED_STATUS])

export type RewriteResultPayload = {
  provider: string
  title: string
  summary: string
  content: string
  inputTokens: number | null
  outputTokens: number | null
  metadata: unknown
  presetCompat: unknown
}

export type RecoverableRewriteJobPayload = {
  request: Record<string, unknown>
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
  stream?: boolean
  result?: RewriteResultPayload
  error?: string
}

export type RecoverableRewriteJobRow = {
  id: string
  novelId: string
  branchId: string | null
  status: string
  progress: number
  currentStep: string | null
  payloadJson: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

const activeRewriteJobControllers = new Map<string, AbortController>()
const recoverableRewriteAttemptContext = new AsyncLocalStorage<Map<string, string>>()

type RecoverableRewriteDb = Pick<DatabaseAccess, 'execute' | 'queryAll' | 'queryOne'>

const defaultDb: RecoverableRewriteDb = { execute, queryAll, queryOne }

function parseJsonRecord(value: string | null) {
  return safeParseJsonObject(value)
}

function getCurrentRecoverableRewriteAttemptId(jobId: string) {
  return recoverableRewriteAttemptContext.getStore()?.get(jobId) ?? null
}

function getMergedRecoverableRewritePayload(currentPayloadJson: string | null, nextPayload: RecoverableRewriteJobPayload) {
  return {
    ...(parseJsonRecord(currentPayloadJson) ?? {}),
    ...nextPayload,
  }
}

function buildRecoverableRewriteAttemptPayload(currentPayloadJson: string | null, attemptId: string, updates: Record<string, unknown> = {}) {
  return mergeTaskWatchdogState(parseTaskWatchdogPayload(currentPayloadJson), {
    ...updates,
    attemptId,
  })
}

function normalizeTokenValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeRewriteResultPayload(value: unknown): RewriteResultPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const content = typeof record.content === 'string' ? record.content.trim() : ''
  if (!content) return null

  return {
    provider: typeof record.provider === 'string' ? record.provider : '',
    title: typeof record.title === 'string' ? record.title : '生成版本',
    summary: typeof record.summary === 'string' ? record.summary : '已保存版本。',
    content,
    inputTokens: normalizeTokenValue(record.inputTokens),
    outputTokens: normalizeTokenValue(record.outputTokens),
    metadata: record.metadata ?? null,
    presetCompat: record.presetCompat ?? null,
  }
}

export function normalizeRecoverableRewriteJobPayload(payloadJson: string | null): RecoverableRewriteJobPayload | null {
  const record = parseJsonRecord(payloadJson)
  if (!record) return null

  const request = record.request && typeof record.request === 'object' && !Array.isArray(record.request)
    ? record.request as Record<string, unknown>
    : null
  const panelRecord = record.panel && typeof record.panel === 'object' && !Array.isArray(record.panel)
    ? record.panel as Record<string, unknown>
    : null
  if (!request || !panelRecord) return null

  return {
    request,
    panel: {
      novelId: String(panelRecord.novelId ?? ''),
      branchId: String(panelRecord.branchId ?? ''),
      chapterId: String(panelRecord.chapterId ?? ''),
      selectedText: String(panelRecord.selectedText ?? ''),
      sourceText: String(panelRecord.sourceText ?? ''),
      sourceTextOverride: typeof panelRecord.sourceTextOverride === 'string' ? panelRecord.sourceTextOverride : null,
      userInstruction: String(panelRecord.userInstruction ?? ''),
      rewriteLaunchSource: typeof panelRecord.rewriteLaunchSource === 'string' ? panelRecord.rewriteLaunchSource : null,
      branchContextNodeId: typeof panelRecord.branchContextNodeId === 'string' ? panelRecord.branchContextNodeId : null,
      branchContextInclusion: typeof panelRecord.branchContextInclusion === 'string' ? panelRecord.branchContextInclusion : null,
      continueBlockId: typeof panelRecord.continueBlockId === 'string' ? panelRecord.continueBlockId : null,
      writingSkillCardIds: normalizeWritingSkillCardIds({
        writingSkillCardIds: panelRecord.writingSkillCardIds,
        writingSkillCardId: panelRecord.writingSkillCardId,
      }),
      writingSkillCardId: typeof panelRecord.writingSkillCardId === 'string' ? panelRecord.writingSkillCardId : null,
      writingSkillExampleCount: typeof panelRecord.writingSkillExampleCount === 'number' && Number.isFinite(panelRecord.writingSkillExampleCount)
        ? Math.floor(panelRecord.writingSkillExampleCount)
        : null,
      writingSkillSeed: typeof panelRecord.writingSkillSeed === 'number' && Number.isFinite(panelRecord.writingSkillSeed)
        ? Math.floor(panelRecord.writingSkillSeed)
        : null,
      createdAt: String(panelRecord.createdAt ?? ''),
    },
    stream: record.stream === true,
    result: normalizeRewriteResultPayload(record.result) ?? undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  }
}

export function readRecoverableRewriteJob(jobId: string, db: RecoverableRewriteDb = defaultDb) {
  return db.queryOne<RecoverableRewriteJobRow>(
    `SELECT id, novelId, branchId, status, progress, currentStep, payloadJson, errorMessage, createdAt, updatedAt
     FROM KnowledgeJob
     WHERE id = ? AND jobType = ?`,
    jobId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )
}

export function serializeRecoverableRewriteJob(row: RecoverableRewriteJobRow | null) {
  if (!row) return null
  const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
  if (!payload) return null

  return {
    jobId: row.id,
    status: row.status,
    progress: row.progress,
    currentStep: row.currentStep,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    panel: payload.panel,
    result: payload.result ?? null,
  }
}

export function updateRecoverableRewriteJob(jobId: string, params: {
  status: string
  progress: number
  currentStep: string | null
  payload: RecoverableRewriteJobPayload
  errorMessage?: string | null
  expectedAttemptId?: string | null
  db?: RecoverableRewriteDb
}) {
  const db = params.db ?? defaultDb
  const currentRow = db.queryOne<{ payloadJson: string | null }>(
    'SELECT payloadJson FROM KnowledgeJob WHERE id = ? AND jobType = ?',
    jobId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )
  const currentPayloadJson = currentRow?.payloadJson ?? null
  const expectedAttemptId = params.expectedAttemptId ?? getCurrentRecoverableRewriteAttemptId(jobId)
  const mergedPayload = getMergedRecoverableRewritePayload(currentPayloadJson, params.payload)
  const nextPayload = expectedAttemptId
    ? mergeTaskWatchdogState(mergedPayload, { attemptId: expectedAttemptId })
    : mergedPayload

  const querySuffix = expectedAttemptId
    ? ` AND json_extract(COALESCE(payloadJson, '{}'), '$.taskWatchdog.attemptId') = ?`
    : ''

  return db.execute(
    `UPDATE KnowledgeJob
      SET status = ?, progress = ?, currentStep = ?, payloadJson = ?, errorMessage = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ? AND jobType = ?${querySuffix}`,
    params.status,
    params.progress,
    params.currentStep,
    JSON.stringify(nextPayload),
    params.errorMessage ?? null,
    jobId,
    RECOVERABLE_REWRITE_JOB_TYPE,
    ...(expectedAttemptId ? [expectedAttemptId] : []),
  )
}

export function claimRecoverableRewriteJob(jobId: string, params: { progress: number; currentStep: string; db?: RecoverableRewriteDb }) {
  const db = params.db ?? defaultDb
  const currentRow = db.queryOne<{ payloadJson: string | null; status: string }>(
    'SELECT payloadJson, status FROM KnowledgeJob WHERE id = ? AND jobType = ?',
    jobId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )
  if (!currentRow || currentRow.status !== 'queued') {
    return { claimed: false as const, status: currentRow?.status ?? null, attemptId: null }
  }

  const attemptId = getTaskWatchdogAttemptId(parseTaskWatchdogPayload(currentRow.payloadJson)) ?? createTaskWatchdogAttemptId()
  const claimPayload = buildRecoverableRewriteAttemptPayload(currentRow.payloadJson, attemptId, {
    claimedAt: new Date().toISOString(),
    claimedBy: 'rewrite_runner',
  })
  const result = db.execute(
    `UPDATE KnowledgeJob
       SET status = 'running', progress = ?, currentStep = ?, payloadJson = ?, errorMessage = NULL, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND jobType = ? AND status = 'queued'`,
    params.progress,
    params.currentStep,
    JSON.stringify(claimPayload),
    jobId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )
  if (result.changes !== 1) {
    const nextRow = readRecoverableRewriteJob(jobId, db)
    return { claimed: false as const, status: nextRow?.status ?? null, attemptId: null }
  }

  return { claimed: true as const, status: 'running' as const, attemptId }
}

export async function runRecoverableRewriteJobWithAttempt<T>(jobId: string, attemptId: string, callback: () => Promise<T>) {
  const store = new Map(recoverableRewriteAttemptContext.getStore() ?? [])
  store.set(jobId, attemptId)
  return recoverableRewriteAttemptContext.run(store, callback)
}

export function findLatestRecoverableRewriteJob(params: { novelId: string; branchId?: string | null; chapterId?: string | null; db?: RecoverableRewriteDb }) {
  const db = params.db ?? defaultDb
  const rows = db.queryAll<RecoverableRewriteJobRow>(
    `SELECT id, novelId, branchId, status, progress, currentStep, payloadJson, errorMessage, createdAt, updatedAt
     FROM KnowledgeJob
     WHERE novelId = ? AND jobType = ? AND status != ?
     ORDER BY updatedAt DESC, createdAt DESC
     LIMIT 20`,
    params.novelId,
    RECOVERABLE_REWRITE_JOB_TYPE,
    RECOVERABLE_REWRITE_ABORTED_STATUS,
  )

  return rows.find((row) => {
    const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
    if (!payload) return false
    if (params.branchId && payload.panel.branchId !== params.branchId) return false
    if (params.chapterId && payload.panel.chapterId !== params.chapterId) return false
    return true
  }) ?? null
}

export function isRecoverableRewriteJobRestorable(status: string) {
  return status !== RECOVERABLE_REWRITE_ABORTED_STATUS && status !== 'failed'
}

export function isRecoverableRewriteJobAborted(jobId: string, db: RecoverableRewriteDb = defaultDb) {
  return readRecoverableRewriteJob(jobId, db)?.status === RECOVERABLE_REWRITE_ABORTED_STATUS
}

export function isRecoverableRewriteJobTerminal(status: string) {
  return TERMINAL_REWRITE_JOB_STATUSES.has(status)
}

export function createRecoverableRewriteAbortController(jobId: string) {
  const controller = new AbortController()
  activeRewriteJobControllers.set(jobId, controller)
  return controller
}

export function clearRecoverableRewriteAbortController(jobId: string, controller: AbortController) {
  if (activeRewriteJobControllers.get(jobId) === controller) {
    activeRewriteJobControllers.delete(jobId)
  }
}

export function abortRecoverableRewriteJob(jobId: string, message = '已中止生成', db: RecoverableRewriteDb = defaultDb) {
  const row = readRecoverableRewriteJob(jobId, db)
  if (!row) return null

  const controller = activeRewriteJobControllers.get(jobId)
  controller?.abort()

  if (isRecoverableRewriteJobTerminal(row.status)) {
    return serializeRecoverableRewriteJob(row)
  }

  const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
  if (!payload) return serializeRecoverableRewriteJob(row)
  const invalidatedAttemptId = createTaskWatchdogAttemptId()
  const payloadWithAttempt = {
    ...buildRecoverableRewriteAttemptPayload(row.payloadJson, invalidatedAttemptId, {
      lastActionAt: new Date().toISOString(),
      lastAction: 'aborted',
    }),
    ...payload,
    error: message,
  } satisfies RecoverableRewriteJobPayload & Record<string, unknown>

  updateRecoverableRewriteJob(jobId, {
    status: RECOVERABLE_REWRITE_ABORTED_STATUS,
    progress: 0,
    currentStep: message,
    payload: payloadWithAttempt,
    errorMessage: message,
    db,
  })

  return serializeRecoverableRewriteJob(readRecoverableRewriteJob(jobId, db))
}

function valueMatches(value: unknown, candidates: Set<string>) {
  return typeof value === 'string' && candidates.has(value)
}

function recoverableRewriteJobMatchesDeletedSource(payload: RecoverableRewriteJobPayload, params: {
  novelId: string
  branchId: string
  nodeId: string
  continueBlockId?: string | null
}) {
  if (payload.panel.novelId !== params.novelId || payload.panel.branchId !== params.branchId) return false
  const nodeIds = new Set([params.nodeId].filter(Boolean))
  const continueBlockIds = new Set([params.continueBlockId ?? ''].filter(Boolean))

  if (valueMatches(payload.panel.branchContextNodeId, nodeIds)) return true
  if (valueMatches(payload.request.branchContextNodeId, nodeIds)) return true
  if (valueMatches(payload.panel.continueBlockId, continueBlockIds)) return true
  if (valueMatches(payload.request.continueBlockId, continueBlockIds)) return true

  return false
}

export function abortRecoverableRewriteJobsForDeletedTimelineNode(params: {
  novelId: string
  branchId: string
  nodeId: string
  continueBlockId?: string | null
  db?: RecoverableRewriteDb
}) {
  const db = params.db ?? defaultDb
  const rows = db.queryAll<RecoverableRewriteJobRow>(
    `SELECT id, novelId, branchId, status, progress, currentStep, payloadJson, errorMessage, createdAt, updatedAt
     FROM KnowledgeJob
     WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN ('queued', 'running')
     ORDER BY updatedAt DESC, createdAt DESC
     LIMIT 100`,
    params.novelId,
    params.branchId,
    RECOVERABLE_REWRITE_JOB_TYPE,
  )

  const abortedJobIds: string[] = []
  for (const row of rows) {
    const payload = normalizeRecoverableRewriteJobPayload(row.payloadJson)
    if (!payload || !recoverableRewriteJobMatchesDeletedSource(payload, params)) continue
    abortRecoverableRewriteJob(row.id, '源续写块已删除，已自动清理孤儿生成任务', db)
    abortedJobIds.push(row.id)
  }

  return abortedJobIds
}

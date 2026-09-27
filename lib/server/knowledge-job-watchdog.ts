import { progressMessage } from '@/lib/i18n/progress-message'
import type { KnowledgeJobType } from '@/lib/server/knowledge-rebuild'
import type { DatabaseAccess } from '@/lib/server/database-access'
import { RECOVERABLE_REWRITE_JOB_TYPE } from '@/lib/server/recoverable-rewrite-jobs'
import { execute, queryAll, queryOne } from '@/lib/server/database-access'
import {
  createTaskWatchdogAttemptId,
  mergeTaskWatchdogState,
  parseTaskWatchdogPayload,
} from '@/lib/server/task-watchdog-attempt'

const DEFAULT_TASK_STALE_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_TASK_MAX_RETRIES = 1

export const KNOWLEDGE_JOB_WATCHDOG_SUPPORTED_JOB_TYPES = [
  'extract_chapter_knowledge',
  'rebuild_retrieval_index',
  RECOVERABLE_REWRITE_JOB_TYPE,
] as const

const KNOWLEDGE_JOB_WATCHDOG_RECONCILE_STATUSES = ['queued', 'running'] as const

export type KnowledgeJobWatchdogSupportedJobType = KnowledgeJobType | typeof RECOVERABLE_REWRITE_JOB_TYPE

type KnowledgeJobWatchdogActiveStatus = typeof KNOWLEDGE_JOB_WATCHDOG_RECONCILE_STATUSES[number]

type KnowledgeJobWatchdogRow = {
  id: string
  novelId: string
  branchId: string | null
  jobType: KnowledgeJobWatchdogSupportedJobType
  status: KnowledgeJobWatchdogActiveStatus | string
  payloadJson: string | null
  updatedAt: string
}

export type KnowledgeJobWatchdogAction = {
  jobId: string
  novelId: string
  branchId: string | null
  jobType: KnowledgeJobWatchdogSupportedJobType
  previousStatus: KnowledgeJobWatchdogActiveStatus
  nextStatus: 'queued' | 'failed'
  attemptCount: number
  maxRetries: number
  action: 'retried' | 'failed'
}

export type ReconcileKnowledgeJobWatchdogParams = {
  jobId?: string
  novelId?: string
  branchId?: string
  jobTypes?: readonly KnowledgeJobWatchdogSupportedJobType[]
  db?: Pick<DatabaseAccess, 'execute' | 'queryAll' | 'queryOne'>
}

const defaultDb: Pick<DatabaseAccess, 'execute' | 'queryAll' | 'queryOne'> = { execute, queryAll, queryOne }

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback
}

function parseSqliteUtcTimestamp(value: string) {
  const normalized = value.trim().replace(' ', 'T')
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`
  const parsed = Date.parse(withZone)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function normalizeAttemptCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function getWatchdogPayload(payloadJson: string | null) {
  return parseTaskWatchdogPayload(payloadJson)
}

function buildScopedKnowledgeJobWatchdogQuery(params: ReconcileKnowledgeJobWatchdogParams) {
  const jobTypes = params.jobTypes?.length
    ? params.jobTypes
    : KNOWLEDGE_JOB_WATCHDOG_SUPPORTED_JOB_TYPES

  const conditions = [
    `jobType IN (${jobTypes.map(() => '?').join(', ')})`,
    `status IN (${KNOWLEDGE_JOB_WATCHDOG_RECONCILE_STATUSES.map(() => '?').join(', ')})`,
  ]
  const values: string[] = [...jobTypes, ...KNOWLEDGE_JOB_WATCHDOG_RECONCILE_STATUSES]

  if (params.jobId) {
    conditions.push('id = ?')
    values.push(params.jobId)
  }
  if (params.novelId) {
    conditions.push('novelId = ?')
    values.push(params.novelId)
  }
  if (params.branchId) {
    conditions.push('branchId = ?')
    values.push(params.branchId)
  }

  return {
    sql: `
      SELECT id, novelId, branchId, jobType, status, payloadJson, updatedAt
      FROM KnowledgeJob
      WHERE ${conditions.join(' AND ')}
      ORDER BY updatedAt ASC, createdAt ASC
    `,
    values,
  }
}

function buildRetryCurrentStep(attemptCount: number, maxRetries: number) {
  return progressMessage('progress.retry', { attempt: attemptCount, maximum: maxRetries })
}

function buildRetryErrorMessage(staleTimeoutMs: number) {
  return `任务已超过 ${Math.max(1, Math.round(staleTimeoutMs / 60000))} 分钟无进度更新，已自动重新排队重试。`
}

function buildFailureCurrentStep(maxRetries: number) {
  return progressMessage('progress.retryExhausted', { maximum: maxRetries })
}

function buildFailureErrorMessage(staleTimeoutMs: number, maxRetries: number) {
  return `任务已超过 ${Math.max(1, Math.round(staleTimeoutMs / 60000))} 分钟无进度更新，重试 ${maxRetries} 次后仍未恢复，已标记失败。`
}

function isSupportedJobType(jobType: string): jobType is KnowledgeJobWatchdogSupportedJobType {
  return KNOWLEDGE_JOB_WATCHDOG_SUPPORTED_JOB_TYPES.includes(jobType as KnowledgeJobWatchdogSupportedJobType)
}

function isActiveStatus(status: string): status is KnowledgeJobWatchdogActiveStatus {
  return KNOWLEDGE_JOB_WATCHDOG_RECONCILE_STATUSES.includes(status as KnowledgeJobWatchdogActiveStatus)
}

function isStaleRow(updatedAt: string, staleTimeoutMs: number, nowMs: number) {
  const updatedAtMs = parseSqliteUtcTimestamp(updatedAt)
  if (!Number.isFinite(updatedAtMs)) {
    return false
  }

  return nowMs - updatedAtMs >= staleTimeoutMs
}

export function getKnowledgeJobWatchdogConfig() {
  return {
    staleTimeoutMs: parsePositiveIntegerEnv('RETALE_TASK_STALE_TIMEOUT_MS', DEFAULT_TASK_STALE_TIMEOUT_MS),
    maxRetries: parsePositiveIntegerEnv('RETALE_TASK_MAX_RETRIES', DEFAULT_TASK_MAX_RETRIES),
  }
}

export function reconcileKnowledgeJobWatchdog(params: ReconcileKnowledgeJobWatchdogParams = {}) {
  const db = params.db ?? defaultDb
  const config = getKnowledgeJobWatchdogConfig()
  const query = buildScopedKnowledgeJobWatchdogQuery(params)
  const rows = db.queryAll<KnowledgeJobWatchdogRow>(query.sql, ...query.values)
  const actions: KnowledgeJobWatchdogAction[] = []
  const nowMs = Date.now()

  for (const row of rows) {
    if (!isSupportedJobType(row.jobType) || !isActiveStatus(row.status)) {
      continue
    }
    if (!isStaleRow(row.updatedAt, config.staleTimeoutMs, nowMs)) {
      continue
    }

    const currentRow = db.queryOne<KnowledgeJobWatchdogRow>(
      `
        SELECT id, novelId, branchId, jobType, status, payloadJson, updatedAt
        FROM KnowledgeJob
        WHERE id = ?
      `,
      row.id,
    )

    if (!currentRow || !isSupportedJobType(currentRow.jobType) || !isActiveStatus(currentRow.status)) {
      continue
    }
    if (!isStaleRow(currentRow.updatedAt, config.staleTimeoutMs, Date.now())) {
      continue
    }

    const payload = getWatchdogPayload(currentRow.payloadJson)
    const attemptCount = normalizeAttemptCount(payload.taskWatchdog?.attemptCount) + 1
    const retriesRemain = attemptCount <= config.maxRetries
    const nextStatus = retriesRemain ? 'queued' : 'failed'
    const errorMessage = retriesRemain
      ? buildRetryErrorMessage(config.staleTimeoutMs)
      : buildFailureErrorMessage(config.staleTimeoutMs, config.maxRetries)
    const currentStep = retriesRemain
      ? buildRetryCurrentStep(attemptCount, config.maxRetries)
      : buildFailureCurrentStep(config.maxRetries)

    const nextAttemptId = createTaskWatchdogAttemptId()
    const nextPayload = mergeTaskWatchdogState(payload, {
      attemptCount,
      attemptId: nextAttemptId,
      maxRetries: config.maxRetries,
      staleTimeoutMs: config.staleTimeoutMs,
      lastActionAt: new Date().toISOString(),
      lastAction: retriesRemain ? 'retried' : 'failed',
      lastKnownStatus: currentRow.status,
      lastKnownUpdatedAt: currentRow.updatedAt,
      failureReason: 'timeout_no_progress',
    })

    const updateResult = db.execute(
      `UPDATE KnowledgeJob
       SET status = ?, currentStep = ?, errorMessage = ?, payloadJson = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND status = ? AND updatedAt = ?`,
      nextStatus,
      currentStep,
      errorMessage,
      JSON.stringify(nextPayload),
      currentRow.id,
      currentRow.status,
      currentRow.updatedAt,
    )

    if (updateResult.changes !== 1) {
      continue
    }

    actions.push({
      jobId: currentRow.id,
      novelId: currentRow.novelId,
      branchId: currentRow.branchId,
      jobType: currentRow.jobType,
      previousStatus: currentRow.status,
      nextStatus,
      attemptCount,
      maxRetries: config.maxRetries,
      action: retriesRemain ? 'retried' : 'failed',
    })
  }

  return actions
}

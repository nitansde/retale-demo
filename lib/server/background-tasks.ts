import type { KnowledgeJobType } from '@/lib/server/knowledge-rebuild'
import type { DatabaseAccess } from '@/lib/server/database-access'
import { reconcileKnowledgeJobWatchdog } from '@/lib/server/knowledge-job-watchdog'
import { abortRecoverableRewriteJob, RECOVERABLE_REWRITE_JOB_TYPE } from '@/lib/server/recoverable-rewrite-jobs'
import { execute, queryAll, queryOne } from '@/lib/server/database-access'

const ACTIVE_BACKGROUND_TASK_STATUSES = ['queued', 'running', 'paused'] as const
const ACTIVE_BACKGROUND_TASK_JOB_TYPES = [
  'extract_chapter_knowledge',
  'rebuild_retrieval_index',
  RECOVERABLE_REWRITE_JOB_TYPE,
] as const

export type BackgroundTaskJobType = KnowledgeJobType | typeof RECOVERABLE_REWRITE_JOB_TYPE
export type BackgroundTaskStatus = typeof ACTIVE_BACKGROUND_TASK_STATUSES[number]

type SupportedBackgroundTaskStatus = BackgroundTaskStatus | 'succeeded' | 'failed' | 'aborted'

export type ActiveBackgroundTask = {
  jobId: string
  novelId: string
  novelTitle: string
  branchId: string | null
  jobType: BackgroundTaskJobType
  status: BackgroundTaskStatus
  progress: number
  currentStep: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

type ActiveBackgroundTaskRow = ActiveBackgroundTask

type BackgroundTaskRow = {
  jobId: string
  jobType: string
  status: SupportedBackgroundTaskStatus | string
}

type BackgroundTaskDb = Pick<DatabaseAccess, 'execute' | 'queryAll' | 'queryOne'>

const defaultDb: BackgroundTaskDb = { execute, queryAll, queryOne }

export type AbortBackgroundTaskResult =
  | { ok: true; jobId: string; status: 'aborted'; outcome: 'aborted' }
  | { ok: false; statusCode: 400 | 404 | 409; error: string }

function isActiveBackgroundTaskStatus(status: string): status is BackgroundTaskStatus {
  return ACTIVE_BACKGROUND_TASK_STATUSES.includes(status as BackgroundTaskStatus)
}

function isSupportedBackgroundTaskJobType(jobType: string): jobType is BackgroundTaskJobType {
  return ACTIVE_BACKGROUND_TASK_JOB_TYPES.includes(jobType as BackgroundTaskJobType)
}

function persistAbortedBackgroundTask(jobId: string, db: BackgroundTaskDb = defaultDb) {
  const result = db.execute(
    `UPDATE KnowledgeJob
     SET status = 'aborted', progress = 0, currentStep = ?, errorMessage = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN (?, ?, ?)`,
    '已中止',
    '已中止',
    jobId,
    ...ACTIVE_BACKGROUND_TASK_STATUSES,
  )
  return result.changes === 1
}

function resolveAbortAfterConcurrentChange(jobId: string, db: BackgroundTaskDb = defaultDb): AbortBackgroundTaskResult {
  const row = db.queryOne<BackgroundTaskRow>(
    `SELECT id AS jobId, jobType, status
     FROM KnowledgeJob
     WHERE id = ?`,
    jobId,
  )

  if (!row) {
    return { ok: false, statusCode: 404, error: 'Background task not found' }
  }

  if (row.status === 'aborted') {
    return { ok: true, jobId, status: 'aborted', outcome: 'aborted' }
  }

  return { ok: false, statusCode: 409, error: `Background task in status ${row.status} cannot be aborted` }
}

export function listActiveBackgroundTasks(params: { novelId: string; db?: BackgroundTaskDb }) {
  const db = params.db ?? defaultDb
  reconcileKnowledgeJobWatchdog({ novelId: params.novelId, db })

  const jobTypePlaceholders = ACTIVE_BACKGROUND_TASK_JOB_TYPES.map(() => '?').join(', ')
  const statusPlaceholders = ACTIVE_BACKGROUND_TASK_STATUSES.map(() => '?').join(', ')

  const rows = db.queryAll<ActiveBackgroundTaskRow>(
    `
      SELECT
        job.id AS jobId,
        job.novelId AS novelId,
        COALESCE((SELECT title FROM NovelRecord WHERE id = job.novelId), job.novelId) AS novelTitle,
        job.branchId AS branchId,
        job.jobType AS jobType,
        job.status AS status,
        job.progress AS progress,
        job.currentStep AS currentStep,
        job.errorMessage AS errorMessage,
        job.createdAt AS createdAt,
        job.updatedAt AS updatedAt
      FROM KnowledgeJob job
      WHERE job.novelId = ?
        AND job.jobType IN (${jobTypePlaceholders})
        AND job.status IN (${statusPlaceholders})
      ORDER BY job.updatedAt DESC, job.createdAt DESC
    `,
    params.novelId,
    ...ACTIVE_BACKGROUND_TASK_JOB_TYPES,
    ...ACTIVE_BACKGROUND_TASK_STATUSES,
  )

  return rows.map((row) => ({
    jobId: String(row.jobId),
    novelId: String(row.novelId),
    novelTitle: String(row.novelTitle),
    branchId: row.branchId == null ? null : String(row.branchId),
    jobType: row.jobType,
    status: row.status,
    progress: Number(row.progress),
    currentStep: row.currentStep == null ? null : String(row.currentStep),
    errorMessage: row.errorMessage == null ? null : String(row.errorMessage),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }))
}

export function abortBackgroundTask(params: { jobId: string; novelId: string; db?: BackgroundTaskDb }): AbortBackgroundTaskResult {
  const db = params.db ?? defaultDb
  const normalizedJobId = params.jobId.trim()
  if (!normalizedJobId) {
    return { ok: false, statusCode: 400, error: 'jobId is required' }
  }

  const row = db.queryOne<BackgroundTaskRow>(
    `SELECT id AS jobId, jobType, status
     FROM KnowledgeJob
     WHERE id = ? AND novelId = ?`,
    normalizedJobId,
    params.novelId,
  )
  if (!row) {
    return { ok: false, statusCode: 404, error: 'Background task not found' }
  }

  if (!isSupportedBackgroundTaskJobType(row.jobType)) {
    return { ok: false, statusCode: 409, error: `Job type ${row.jobType} does not support abort` }
  }

  if (row.status === 'aborted') {
    return { ok: true, jobId: normalizedJobId, status: 'aborted', outcome: 'aborted' }
  }

  if (!isActiveBackgroundTaskStatus(row.status)) {
    return { ok: false, statusCode: 409, error: `Background task in status ${row.status} cannot be aborted` }
  }

  if (row.jobType === RECOVERABLE_REWRITE_JOB_TYPE) {
    abortRecoverableRewriteJob(normalizedJobId, '已中止', db)
    const rewrittenRow = db.queryOne<BackgroundTaskRow>(
      `SELECT id AS jobId, jobType, status
       FROM KnowledgeJob
       WHERE id = ? AND novelId = ?`,
       normalizedJobId,
       params.novelId,
     )
     if (rewrittenRow?.status !== 'aborted') {
       if (!persistAbortedBackgroundTask(normalizedJobId, db)) {
         return resolveAbortAfterConcurrentChange(normalizedJobId, db)
       }
     }
  } else {
    if (!persistAbortedBackgroundTask(normalizedJobId, db)) {
      return resolveAbortAfterConcurrentChange(normalizedJobId, db)
    }
  }

  return { ok: true, jobId: normalizedJobId, status: 'aborted', outcome: 'aborted' }
}

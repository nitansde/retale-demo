import type { LibraryKnowledgeStatus } from '@/lib/library-knowledge-status'
import type { DatabaseAccess } from '@/lib/server/database-access'

/** A lightweight mainline snapshot; never loads chapter text or vector data. */
export function readLibraryKnowledgeStatus(db: DatabaseAccess, novelId: string): LibraryKnowledgeStatus {
  const jobs = db.queryAll<{ status: string }>(
    `SELECT status FROM (
       SELECT job.status, ROW_NUMBER() OVER (
         PARTITION BY job.jobType ORDER BY job.createdAt DESC, job.rowid DESC
       ) AS rank
       FROM KnowledgeJob job
       WHERE job.novelId = ?
         AND (job.branchId IS NULL OR job.branchId IN (
           SELECT id FROM StoryBranch WHERE novelId = ? AND name = 'main'
         ))
         AND job.jobType IN ('extract_chapter_knowledge', 'rebuild_retrieval_index')
     ) WHERE rank = 1`,
    novelId, novelId,
  )
  if (jobs.some((job) => ['queued', 'running'].includes(job.status))) return 'building'
  if (jobs.some((job) => job.status === 'paused')) return 'paused'
  if (jobs.some((job) => job.status === 'failed')) return 'failed'

  // Join the current manuscript so unsynced or deleted chapters cannot imply readiness.
  const coverage = db.queryOne<{ total: number; ready: number }>(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN knowledge.knowledgeStatus = 'ready' AND knowledge.isDirty = 0
         THEN 1 ELSE 0 END), 0) AS ready
     FROM WorkspaceRuntimeChapter chapter
     LEFT JOIN KnowledgeChapter knowledge ON knowledge.id = chapter.id
       AND knowledge.novelId = chapter.novelId
       AND knowledge.branchId IN (SELECT id FROM StoryBranch WHERE novelId = ? AND name = 'main')
     WHERE chapter.workspaceStateId = 'singleton' AND chapter.novelId = ?
       AND chapter.parentChapterId IS NULL`,
    novelId, novelId,
  )
  if (!coverage?.ready) return 'missing'
  return coverage.ready === coverage.total ? 'ready' : 'partial'
}

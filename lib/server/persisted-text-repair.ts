import { randomUUID } from 'node:crypto'
import { createNovelDatabaseAccess, runWithNovelDatabaseAccess } from '@/lib/server/database-access'
import { getNovelRegistryMigrationStatus, validateNovelId } from '@/lib/server/db-resolver'
import { planPersistedTextRepair } from '@/lib/server/persisted-text-repair-plan'
import { readWorkspaceRuntimeSnapshotFromDb, loadWorkspaceKnowledgeSyncPayload } from '@/lib/server/workspace-resilience'
import { runWorkspaceMutation } from '@/lib/server/workspace-mutation'
import { claimPendingWorkspaceKnowledgeSync, completeWorkspaceKnowledgeSync, markWorkspaceKnowledgeSyncRequestedInDb } from '@/lib/server/persistence'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'

/** Explicit maintenance only: never invoked automatically on startup or ordinary reads. */
export async function repairPersistedEntityText(novelId: string, expectedRevision: number) {
  validateNovelId(novelId)
  const registry = getNovelRegistryMigrationStatus(novelId)
  if (!registry || registry.migrationStatus !== 'ready') throw new Error('The novel must have a ready registry entry before text repair')
  const db = createNovelDatabaseAccess(novelId)
  return runWithNovelDatabaseAccess(novelId, () => db.withTransaction(async () => {
    // Holding the SQLite write lock fences workers, workspace saves, and other CLI processes.
    const plan = planPersistedTextRepair(db, novelId)
    if (plan.workspaceRevision !== expectedRevision) throw new Error('Workspace revision changed; preview the repair again')
    if (plan.blockers.length) throw new Error(plan.blockers.join('\n'))
    if (!plan.repairs.length) return { ...plan, applied: false, knowledgeRebuildRequired: false }
    const snapshot = readWorkspaceRuntimeSnapshotFromDb(db, plan.workspaceStateId)
    if (!snapshot) throw new Error('Workspace runtime snapshot is unavailable')
    const countRepairs = new Map(plan.repairs.filter((repair) => repair.repairWordCount).map((repair) => [repair.chapterId, repair.derivedWordCount]))
    if (countRepairs.size) {
      await runWorkspaceMutation({
        kind: 'full-snapshot', novelId, workspaceStateId: plan.workspaceStateId,
        baseRevision: snapshot.revision, idempotencyKey: `entity-text-repair:${randomUUID()}`,
        backupReason: 'workspace-save', allowEmptyReset: false,
        payload: {
          ...snapshot.payload,
          localChapters: snapshot.payload.localChapters.map((chapter) => countRepairs.has(chapter.id)
            ? { ...chapter, wordCount: countRepairs.get(chapter.id)! }
            : chapter),
        },
      })
    } else {
      markWorkspaceKnowledgeSyncRequestedInDb(db, plan.workspaceStateId, snapshot.updatedAt)
    }
    const claim = await claimPendingWorkspaceKnowledgeSync(plan.workspaceStateId, { db })
    if (!claim) throw new Error('Could not claim the requested text repair sync')
    const payload = loadWorkspaceKnowledgeSyncPayload(plan.workspaceStateId, db)
    if (!payload) throw new Error('Workspace sync payload is unavailable')
    await syncWorkspacePayloadToKnowledgeStore({ ...payload, syncScope: 'target-novel' }, { db })
    if (!await completeWorkspaceKnowledgeSync(claim, { db })) throw new Error('Text repair sync lost its claim')
    const remaining = planPersistedTextRepair(db, novelId)
    if (remaining.repairs.length || remaining.blockers.length) throw new Error('Text repair verification failed; changes rolled back')
    return {
      ...plan, applied: true, workspaceRevision: remaining.workspaceRevision,
      knowledgeRebuildRequired: plan.repairs.some((repair) => repair.repairRawText),
    }
  }))
}

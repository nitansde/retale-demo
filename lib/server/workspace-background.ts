import { after } from 'next/server'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { syncWorkspacePayloadToKnowledgeStore } from '@/lib/server/knowledge-rebuild'
import type { WorkspaceKnowledgeSyncPayload } from '@/lib/server/knowledge-rebuild'
import {
  claimPendingWorkspaceKnowledgeSync,
  completeWorkspaceKnowledgeSync,
  failWorkspaceKnowledgeSync,
  resumePendingWorkspaceNovelCleanup,
  resumeWorkspaceNovelCleanup,
  workspaceKnowledgeSyncNeedsScheduling,
} from '@/lib/server/persistence'
import { loadWorkspaceKnowledgeSyncPayload } from '@/lib/server/workspace-resilience'

type BackgroundCallback = () => Promise<void>
type ScheduledKnowledgeSync = {
  wakeGeneration: number
  callback: BackgroundCallback
}

const scheduledKnowledgeSyncs = new Map<string, ScheduledKnowledgeSync>()
const scheduledNovelCleanups = new Map<string, BackgroundCallback>()
const timerFallbacks = new Set<ReturnType<typeof setTimeout>>()
let scheduledPendingCleanupScan: BackgroundCallback | null = null

function scheduleTimerFallback(callback: BackgroundCallback) {
  const timer = setTimeout(() => {
    timerFallbacks.delete(timer)
    void callback().catch((error) => {
      console.error('Workspace background task failed after timer fallback:', error)
    })
  }, 0)
  timerFallbacks.add(timer)
}

export function scheduleAfterResponse(callback: () => Promise<void>) {
  if (process.env.NODE_ENV === 'test') {
    scheduleTimerFallback(callback)
    return
  }

  try {
    after(callback)
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside a request scope')) {
      scheduleTimerFallback(callback)
      return
    }

    console.warn('Falling back to timer-based workspace sync scheduling', error)
    scheduleTimerFallback(callback)
  }
}

async function runPendingWorkspaceKnowledgeSync(novelId: string) {
  const workspaceDb = createNovelDatabaseAccess(novelId)

  while (true) {
    const claimed = await claimPendingWorkspaceKnowledgeSync('singleton', { db: workspaceDb })
    if (!claimed) return

    try {
      const payload = loadWorkspaceKnowledgeSyncPayload(claimed.workspaceStateId, workspaceDb)
      const scopedPayload = payload
        ? { ...payload, syncScope: 'target-novel' as const }
        : {
            localNovels: [],
            localChapters: [],
            currentNovelId: '',
            syncScope: 'target-novel' as const,
          } satisfies WorkspaceKnowledgeSyncPayload
      await syncWorkspacePayloadToKnowledgeStore(scopedPayload, { db: workspaceDb })
      await completeWorkspaceKnowledgeSync(claimed, { db: workspaceDb })
    } catch (error) {
      await failWorkspaceKnowledgeSync(
        claimed,
        error instanceof Error ? error.message : 'Unknown workspace knowledge sync failure',
        { db: workspaceDb },
      )
      console.error('Workspace knowledge sync failed after save:', error)
      return
    }
  }
}

export function scheduleWorkspaceKnowledgeSync(novelId: string) {
  const existing = scheduledKnowledgeSyncs.get(novelId)
  if (existing) {
    existing.wakeGeneration += 1
    return
  }

  const entry: ScheduledKnowledgeSync = { wakeGeneration: 1, callback: async () => {} }
  const callback = async () => {
    while (true) {
      const observedGeneration = entry.wakeGeneration
      try {
        await runPendingWorkspaceKnowledgeSync(novelId)
      } catch (error) {
        if (entry.wakeGeneration !== observedGeneration) continue
        if (scheduledKnowledgeSyncs.get(novelId) === entry) scheduledKnowledgeSyncs.delete(novelId)
        throw error
      }
      if (entry.wakeGeneration !== observedGeneration) continue
      if (scheduledKnowledgeSyncs.get(novelId) === entry) scheduledKnowledgeSyncs.delete(novelId)
      return
    }
  }
  entry.callback = callback
  scheduledKnowledgeSyncs.set(novelId, entry)
  scheduleAfterResponse(callback)
}

export function scheduleWorkspaceKnowledgeSyncRecovery(novelId: string) {
  const workspaceDb = createNovelDatabaseAccess(novelId)
  if (!workspaceKnowledgeSyncNeedsScheduling('singleton', { db: workspaceDb })) return false

  scheduleWorkspaceKnowledgeSync(novelId)
  return true
}

export function schedulePendingWorkspaceNovelCleanupScan() {
  if (scheduledPendingCleanupScan) return

  const callback = async () => {
    try {
      await resumePendingWorkspaceNovelCleanup()
    } catch (error) {
      console.error('Failed to scan pending quarantined novel cleanup:', error)
    } finally {
      if (scheduledPendingCleanupScan === callback) scheduledPendingCleanupScan = null
    }
  }
  scheduledPendingCleanupScan = callback
  scheduleAfterResponse(callback)
}

export function scheduleWorkspaceNovelCleanup(novelId: string) {
  if (scheduledNovelCleanups.has(novelId)) return

  const callback = async () => {
    try {
      await resumeWorkspaceNovelCleanup(novelId)
    } catch (error) {
      console.error('Failed to retry quarantined novel cleanup:', novelId, error)
    } finally {
      if (scheduledNovelCleanups.get(novelId) === callback) scheduledNovelCleanups.delete(novelId)
    }
  }
  scheduledNovelCleanups.set(novelId, callback)
  scheduleAfterResponse(callback)
}

export function resetWorkspaceBackgroundSchedulingForTests() {
  if (!process.env.VITEST) throw new Error('Workspace background scheduling can only be reset under Vitest')

  scheduledKnowledgeSyncs.clear()
  scheduledNovelCleanups.clear()
  scheduledPendingCleanupScan = null
  for (const timer of timerFallbacks) clearTimeout(timer)
  timerFallbacks.clear()
}

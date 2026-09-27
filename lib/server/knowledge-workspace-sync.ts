import type { Chapter, PersistedNovelState } from '@/lib/types'
import type { DatabaseAccess } from '@/lib/server/database-access'
import { bootstrapOutlineNodesForFutureMap } from '@/lib/server/outline-bootstrap'
import {
  ensureKnowledgeChapterDerivedArtifacts,
  getMainBranchId,
  hashContent,
  markKnowledgeStaleFromChapter,
  replaceKnowledgeChapterDerivedArtifacts,
} from '@/lib/server/knowledge-store'
import { deleteBranchRetrievalIndex } from '@/lib/server/retrieval-index'
import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/database-access'
import { getNovelRegistryMigrationStatus, NovelRegistryNotReadyError } from '@/lib/server/db-resolver'
import { htmlToPlainText } from '@/lib/utils'

type KnowledgeChapterRow = {
  id: string
  novelId: string
  branchId: string
  chapterNo: number
  title: string | null
  rawText: string
  revision: number
  sourceHash: string
}

export type WorkspaceKnowledgeSyncPayload = {
  localNovels?: Array<{ id: string; title: string; summary: string; tags: string[] }>
  localChapters?: Chapter[]
  localOutlines?: PersistedNovelState['localOutlines']
  localTimelineEvents?: PersistedNovelState['localTimelineEvents']
  currentNovelId?: string
  syncScope?: 'workspace' | 'target-novel'
}

type WorkspaceKnowledgeSyncDependencies = {
  abortKnowledgeRebuildUntilIdle: (params: { novelId: string; branchId: string }) => Promise<void>
}

type WorkspaceKnowledgeSyncContext = {
  db?: Pick<DatabaseAccess, 'execute' | 'queryAll' | 'queryOne' | 'withTransaction'>
}

function upsertNovelRecord(params: { novelId: string; title: string }, db: NonNullable<WorkspaceKnowledgeSyncContext['db']>) {
  db.execute(
    `
      INSERT INTO NovelRecord (id, title, sourceType)
      VALUES (?, ?, 'workspace')
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        sourceType = excluded.sourceType,
        updatedAt = CURRENT_TIMESTAMP
    `,
    params.novelId,
    params.title,
  )
}

function upsertStoryBranch(novelId: string, branchId: string, name: string, db: NonNullable<WorkspaceKnowledgeSyncContext['db']>) {
  db.execute(
    `
      INSERT INTO StoryBranch (id, novelId, name)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        novelId = excluded.novelId,
        name = excluded.name,
        updatedAt = CURRENT_TIMESTAMP
    `,
    branchId,
    novelId,
    name,
  )
}

async function deleteNovelProjectionArtifacts(novelId: string, branchId: string, db: NonNullable<WorkspaceKnowledgeSyncContext['db']>) {
  await db.withTransaction(async () => {
    db.execute(
      `
        DELETE FROM future_jump_revisions
        WHERE run_id IN (
          SELECT id FROM future_jump_runs
          WHERE base_branch_id = ?
             OR base_branch_id IN (SELECT id FROM StoryBranch WHERE novelId = ?)
        )
      `,
      branchId,
      novelId,
    )
    db.execute(
      `
        DELETE FROM future_jump_runs
        WHERE base_branch_id = ?
           OR base_branch_id IN (SELECT id FROM StoryBranch WHERE novelId = ?)
      `,
      branchId,
      novelId,
    )
    db.execute('DELETE FROM story_timeline_nodes WHERE novel_id = ?', novelId)
    db.execute('DELETE FROM what_if_sessions WHERE novel_id = ?', novelId)
    db.execute('DELETE FROM outline_node_chapters WHERE outline_node_id IN (SELECT id FROM outline_nodes WHERE novel_id = ?)', novelId)
    db.execute('DELETE FROM outline_nodes WHERE novel_id = ?', novelId)
    db.execute('DELETE FROM chapter_extraction_candidates WHERE novel_id = ?', novelId)
    db.execute(
      `
        DELETE FROM chapter_extraction_processing_batches
        WHERE novel_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM chapter_extraction_candidates candidate
            WHERE candidate.processing_batch_id = chapter_extraction_processing_batches.id
          )
      `,
      novelId,
    )
    db.execute('DELETE FROM KnowledgeJob WHERE novelId = ?', novelId)
    db.execute('DELETE FROM NovelRecord WHERE id = ?', novelId)
  })
}

function hasNonReadyNovelRegistry(novelId: string) {
  const registry = getNovelRegistryMigrationStatus(novelId)
  return Boolean(registry && registry.migrationStatus !== 'ready')
}

async function performWorkspacePayloadToKnowledgeStoreSync(
  payload: WorkspaceKnowledgeSyncPayload,
  dependencies: WorkspaceKnowledgeSyncDependencies,
  context: WorkspaceKnowledgeSyncContext = {},
) {
  const db = context.db ?? { execute, queryAll, queryOne, withTransaction }
  const novelMetaById = new Map((payload.localNovels ?? []).map((item) => [item.id, item]))
  const chapters = (payload.localChapters ?? [])
    .filter((chapter) => !chapter.parentChapterId)
    .slice()
    .sort((a, b) => a.order - b.order)

  const groupedByNovel = new Map<string, Chapter[]>()
  for (const chapter of chapters) {
    const current = groupedByNovel.get(chapter.novelId) ?? []
    current.push(chapter)
    groupedByNovel.set(chapter.novelId, current)
  }

  const desiredNovelIds = new Set(groupedByNovel.keys())
  const staleNovelIds = payload.syncScope === 'target-novel'
    ? []
    : db.queryAll<{ id: string }>('SELECT id FROM NovelRecord').filter((row) => !desiredNovelIds.has(row.id))

  if (staleNovelIds.length) {
    for (const novel of staleNovelIds) {
      const branchId = getMainBranchId(novel.id)
      if (hasNonReadyNovelRegistry(novel.id)) {
        await deleteNovelProjectionArtifacts(novel.id, branchId, db)
        continue
      }

      try {
        await dependencies.abortKnowledgeRebuildUntilIdle({ novelId: novel.id, branchId })
        await deleteBranchRetrievalIndex(novel.id, branchId)
      } catch (error) {
        if (error instanceof NovelRegistryNotReadyError && hasNonReadyNovelRegistry(novel.id)) {
          await deleteNovelProjectionArtifacts(novel.id, branchId, db)
          continue
        }
        throw error
      }
      await deleteNovelProjectionArtifacts(novel.id, branchId, db)
    }
  }

  if (!desiredNovelIds.size) {
    return
  }

  const orderedNovelIds = Array.from(groupedByNovel.keys()).sort((left, right) => {
    if (left === payload.currentNovelId) return -1
    if (right === payload.currentNovelId) return 1
    return 0
  })

  for (const novelId of orderedNovelIds) {
    const novelChapters = groupedByNovel.get(novelId) ?? []
    const branchId = getMainBranchId(novelId)
    const novelMeta = novelMetaById.get(novelId)
    await db.withTransaction(() => {
      upsertNovelRecord({
        novelId,
        title: novelMeta?.title?.trim() || novelChapters[0]?.title?.replace(/^第\s*[0-9一二三四五六七八九十百千零两]+\s*章\s*/, '') || novelId,
      }, db)
      upsertStoryBranch(novelId, branchId, 'main', db)
    })

    const existing = db.queryAll<KnowledgeChapterRow>(
      'SELECT id, novelId, branchId, chapterNo, title, rawText, revision, sourceHash FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? ORDER BY chapterNo ASC',
      novelId,
      branchId,
    )
    const desiredChapterIds = new Set(novelChapters.map((chapter) => chapter.id))
    const staleChapters = existing.filter((chapter) => !desiredChapterIds.has(chapter.id))
    const activeJob = db.queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM KnowledgeJob WHERE novelId = ? AND branchId = ? AND jobType = ? AND status IN (\'queued\', \'running\', \'paused\') ORDER BY updatedAt DESC, createdAt DESC LIMIT 1',
      novelId,
      branchId,
      'extract_chapter_knowledge',
    )

    if (staleChapters.length) {
      await db.withTransaction(async () => {
        for (const chapter of staleChapters) {
          db.execute('DELETE FROM KnowledgeChapter WHERE id = ?', chapter.id)
        }
      })
    }

    const existingById = new Map(existing.map((item) => [item.id, item]))

    let firstChangedChapterNo: number | null = null

    for (let index = 0; index < novelChapters.length; index += 1) {
      const chapter = novelChapters[index]
      const chapterNo = index + 1
      const rawText = htmlToPlainText(chapter.content)
      const sourceHash = hashContent(rawText)
      const current = existingById.get(chapter.id)

      if (!current) {
        await db.withTransaction(() => {
          db.execute(
            `
              INSERT INTO KnowledgeChapter (
                id, novelId, branchId, chapterNo, title, rawText, revision, isDirty, dirtyReason, sourceHash, knowledgeStatus
              )
              VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'Created from workspace sync', ?, 'stale')
            `,
            chapter.id,
            novelId,
            branchId,
            chapterNo,
            chapter.title,
            rawText,
            sourceHash,
          )
          replaceKnowledgeChapterDerivedArtifacts({
            id: chapter.id,
            novelId,
            branchId,
            chapterNo,
            rawText,
          }, db)
        })
        firstChangedChapterNo = firstChangedChapterNo === null ? chapterNo : Math.min(firstChangedChapterNo, chapterNo)
        continue
      }

      if (current.rawText === rawText && current.sourceHash === sourceHash && current.chapterNo === chapterNo && current.title === chapter.title) {
        await db.withTransaction(() => {
          ensureKnowledgeChapterDerivedArtifacts({
            id: current.id,
            novelId,
            branchId,
            chapterNo,
            rawText,
          }, db)
        })
        continue
      }

      await db.withTransaction(() => {
        db.execute(
          `
            UPDATE KnowledgeChapter
            SET chapterNo = ?, title = ?, rawText = ?, sourceHash = ?, revision = ?, isDirty = 1,
                dirtyReason = 'Updated from workspace sync', knowledgeStatus = 'stale', updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          chapterNo,
          chapter.title,
          rawText,
          sourceHash,
          current.sourceHash === sourceHash && current.rawText === rawText ? current.revision : current.revision + 1,
          chapter.id,
        )
        replaceKnowledgeChapterDerivedArtifacts({
          id: chapter.id,
          novelId,
          branchId,
          chapterNo,
          rawText,
        }, db)
      })
      firstChangedChapterNo = firstChangedChapterNo === null ? chapterNo : Math.min(firstChangedChapterNo, chapterNo)
    }

    const invalidationFromChapterNo = [
      firstChangedChapterNo,
      staleChapters.length ? Math.min(...staleChapters.map((chapter) => chapter.chapterNo)) : null,
    ].reduce<number | null>((current, value) => {
      if (value === null) return current
      if (current === null) return value
      return Math.min(current, value)
    }, null)

    if (staleChapters.length || firstChangedChapterNo !== null) {
      if (invalidationFromChapterNo !== null) {
        await markKnowledgeStaleFromChapter({
          novelId,
          branchId,
          fromChapterNo: invalidationFromChapterNo,
          db,
        })
      }

      if (activeJob?.id) {
        await dependencies.abortKnowledgeRebuildUntilIdle({ novelId, branchId })
      }
    }

    await bootstrapOutlineNodesForFutureMap({
      novelId,
      branchId,
      workspaceState: payload,
      db,
    })
  }
}

export function createWorkspaceKnowledgeSync(dependencies: WorkspaceKnowledgeSyncDependencies) {
  let workspaceKnowledgeSyncQueue: Promise<void> = Promise.resolve()

  return async function syncWorkspacePayloadToKnowledgeStore(payload: WorkspaceKnowledgeSyncPayload, context: WorkspaceKnowledgeSyncContext = {}) {
    const run = workspaceKnowledgeSyncQueue.then(() => performWorkspacePayloadToKnowledgeStoreSync(payload, dependencies, context))
    workspaceKnowledgeSyncQueue = run.catch(() => undefined)
    return run
  }
}

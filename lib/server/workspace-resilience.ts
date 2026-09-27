import {
  assertWorkspaceNovelReadyForWrite,
  publishWorkspaceNovelWriteTarget,
} from '@/lib/server/persistence'
import { safeParseJson as safeParseJsonValue } from '@/lib/server/json-parse'
import {
  createNovelDatabaseAccess,
  type DatabaseAccess,
  type SqlParam,
} from '@/lib/server/database-access'
import { resolveWorkspaceNovelId, scopeWorkspaceStateToNovel } from '@/lib/server/workspace-novel-scope'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'
import { countChineseFriendlyWords, plainTextLinesToHtml } from '@/lib/utils'
import type {
  Chapter,
  Character,
  CharacterRelation,
  LocalNovelMeta,
  OutlineItem,
  PersistedNovelState,
  TimelineEvent,
  WorldEntry,
} from '@/lib/types'

const WORKSPACE_ID = 'singleton'
export const WORKSPACE_RESET_HEADER = 'x-retale-workspace-reset'

type WorkspaceRecoveryDb = {
  execute: (sql: string, ...params: SqlParam[]) => unknown
  queryAll: <T>(sql: string, ...params: SqlParam[]) => T[]
  queryOne: <T>(sql: string, ...params: SqlParam[]) => T | null
  withTransaction?: <T>(callback: () => T | Promise<T>) => Promise<T>
}

function hasTransactionWrapper(db: WorkspaceRecoveryDb): db is WorkspaceRecoveryDb & { withTransaction: <T>(callback: () => T | Promise<T>) => Promise<T> } {
  return typeof db.withTransaction === 'function'
}

type WorkspaceRuntimeStateRow = {
  id: string
  revision: number
  localOutlinesJson: string
  localCharactersJson: string
  localCharacterRelationsJson: string
  localWorldEntriesJson: string
  localTimelineEventsJson: string
  rewriteCandidatesJson: string
  rewriteHistoryJson: string
  trajectoriesJson: string
  rewriteMode: string
  rewriteTone: string
  rewriteOutput: string
  rewriteScope: string
  thinkingLevel: string
  autoContinue: number
  keepCanon: number
  promptText: string
  selectedPresetId: string
  presetsJson: string
  constraintsJson: string
  updatedAt: string
}

type WorkspaceRuntimeNovelRow = {
  id: string
  title: string
  summary: string
  tagsJson: string
  sortOrder: number
}

type WorkspaceRuntimeChapterRow = {
  id: string
  novelId: string
  parentChapterId: string | null
  kind: string | null
  branchLabel: string | null
  title: string
  sortOrder: number
  contentHtml: string
  originalContentHtml: string | null
  status: string
  wordCount: number
  updatedAtLabel: string
  trajectoryJson: string
}

export type WorkspaceLibrarySummary = {
  id: string
  title: string
  summary: string
  tags: string[]
  updatedAt: string
  wordCount: number
  chapterCount: number
  firstChapterId: string | null
}

type WorkspaceRuntimeSaveResult = {
  updatedAt: string
}

export type WorkspaceRuntimeSnapshot = WorkspaceRuntimeSaveResult & {
  payload: PersistedNovelState
  revision: number
}

type CountRow = {
  count: number
}

type NovelRow = {
  id: string
  title: string
  updatedAt: string
}

type KnowledgeChapterRow = {
  id: string
  novelId: string
  chapterNo: number
  title: string | null
  rawText: string
  updatedAt: string
}

type WorkspaceStateRow = {
  id: string
  payload: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

type WorkspaceChapterPatchJournalRow = {
  committedRevision: number
  chapterId: string
  novelId: string
  contentHtml: string
  wordCount: number
  updatedAtLabel: string
}

function readWorkspacePatchJournalRevision(id: string, db: WorkspaceRecoveryDb) {
  return db.queryOne<{ revision: number | null }>(
    'SELECT MAX(committedRevision) AS revision FROM WorkspaceChapterPatchJournal WHERE workspaceStateId = ?',
    id,
  )?.revision ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function workspacePayloadHasLibraryContent(payload: unknown) {
  if (!isRecord(payload)) return false
  return (Array.isArray(payload.localNovels) && payload.localNovels.length > 0)
    || (Array.isArray(payload.localChapters) && payload.localChapters.length > 0)
}

function safeParseWorkspacePayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as Partial<PersistedNovelState>
    const normalized = normalizeWorkspaceState(parsed)
    return { ok: true as const, payload: normalized }
  } catch (error) {
    return { ok: false as const, error }
  }
}

function safeParseJson(value: string | null) {
  return safeParseJsonValue(value)
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readJsonArray(value: string | null) {
  const parsed = safeParseJson(value)
  return Array.isArray(parsed) ? parsed : []
}

function getCurrentWorkspaceDb(db?: WorkspaceRecoveryDb) {
  return db ?? null
}

function queryOneFromDb<T>(db: WorkspaceRecoveryDb | undefined, sql: string, ...params: SqlParam[]) {
  const targetDb = getCurrentWorkspaceDb(db)
  return targetDb ? targetDb.queryOne<T>(sql, ...params) : null
}

function queryAllFromDb<T>(db: WorkspaceRecoveryDb | undefined, sql: string, ...params: SqlParam[]) {
  const targetDb = getCurrentWorkspaceDb(db)
  return targetDb ? targetDb.queryAll<T>(sql, ...params) : [] as T[]
}

function executeOnDb(db: WorkspaceRecoveryDb | undefined, sql: string, ...params: SqlParam[]) {
  const targetDb = getCurrentWorkspaceDb(db)
  if (!targetDb) {
    throw new Error('No active novel database is available for workspace persistence')
  }

  return targetDb.execute(sql, ...params)
}

function findWorkspaceStateForRecovery(id: string, db?: WorkspaceRecoveryDb) {
  const targetDb = getCurrentWorkspaceDb(db)
  if (!targetDb) return null

  return targetDb.queryOne<WorkspaceStateRow>(
    'SELECT id, payload, revision, createdAt, updatedAt FROM WorkspaceState WHERE id = ?',
    id,
  )
}

function runtimeChapterToChapter(chapter: WorkspaceRuntimeChapterRow): Chapter {
  return {
    id: chapter.id,
    novelId: chapter.novelId,
    parentChapterId: chapter.parentChapterId ?? undefined,
    kind: (chapter.kind ?? undefined) as Chapter['kind'],
    branchLabel: chapter.branchLabel ?? undefined,
    title: chapter.title,
    order: chapter.sortOrder,
    content: chapter.contentHtml,
    originalContent: chapter.originalContentHtml ?? undefined,
    status: chapter.status as Chapter['status'],
    wordCount: chapter.wordCount,
    updatedAt: chapter.updatedAtLabel,
    trajectory: normalizeStringArray(readJsonArray(chapter.trajectoryJson)),
  }
}

export function readWorkspaceChapterBatchFromDb(db: DatabaseAccess, novelId: string, chapterIds: string[]) {
  // Read bodies and their revision in one statement so they describe the same snapshot.
  const rows = db.queryAll<WorkspaceRuntimeChapterRow & { revision: number }>(
    `SELECT c.*, s.revision
     FROM WorkspaceRuntimeChapter c
     JOIN WorkspaceRuntimeState s ON s.id = c.workspaceStateId
     WHERE c.workspaceStateId = ? AND c.novelId = ? AND c.id IN (${chapterIds.map(() => '?').join(',')})`,
    WORKSPACE_ID, novelId, ...chapterIds,
  )
  if (rows.length !== chapterIds.length) return null
  const chapters = new Map(rows.map((row) => [row.id, runtimeChapterToChapter(row)]))
  return { chapters: chapterIds.map((id) => chapters.get(id)!), workspaceRevision: rows[0].revision, revisionNovelId: novelId }
}

export function readWorkspaceRuntimeSnapshotFromDb(
  db: DatabaseAccess,
  id = WORKSPACE_ID,
): WorkspaceRuntimeSnapshot | null {
  const meta = db.queryOne<WorkspaceRuntimeStateRow>(
    `SELECT id, revision, localOutlinesJson, localCharactersJson, localCharacterRelationsJson,
            localWorldEntriesJson, localTimelineEventsJson, rewriteCandidatesJson, rewriteHistoryJson, trajectoriesJson,
            rewriteMode, rewriteTone, rewriteOutput, rewriteScope,
            thinkingLevel, autoContinue, keepCanon, promptText,
            selectedPresetId, presetsJson, constraintsJson,
            updatedAt
     FROM WorkspaceRuntimeState
     WHERE id = ?`,
    id,
  )
  const novels = db.queryAll<WorkspaceRuntimeNovelRow>(
    `SELECT id, title, summary, tagsJson, sortOrder
     FROM WorkspaceRuntimeNovel
     WHERE workspaceStateId = ?
     ORDER BY sortOrder ASC, id ASC`,
    id,
  )
  const chapters = db.queryAll<WorkspaceRuntimeChapterRow>(
    `SELECT id, novelId, parentChapterId, kind, branchLabel, title, sortOrder,
            contentHtml, originalContentHtml, status, wordCount, updatedAtLabel, trajectoryJson
     FROM WorkspaceRuntimeChapter
     WHERE workspaceStateId = ?
     ORDER BY novelId ASC, sortOrder ASC, id ASC`,
    id,
  )

  if (!meta && !novels.length && !chapters.length) {
    return null
  }

  const payload = normalizeWorkspaceState({
    ...createEmptyWorkspaceState(),
    localOutlines: readJsonArray(meta?.localOutlinesJson ?? '[]') as OutlineItem[],
    localCharacters: readJsonArray(meta?.localCharactersJson ?? '[]') as Character[],
    localCharacterRelations: readJsonArray(meta?.localCharacterRelationsJson ?? '[]') as CharacterRelation[],
    localWorldEntries: readJsonArray(meta?.localWorldEntriesJson ?? '[]') as WorldEntry[],
    localTimelineEvents: readJsonArray(meta?.localTimelineEventsJson ?? '[]') as TimelineEvent[],
    localNovels: novels.map((novel) => ({
      id: novel.id,
      title: novel.title,
      summary: novel.summary,
      tags: normalizeStringArray(readJsonArray(novel.tagsJson)),
    })),
    localChapters: chapters.map(runtimeChapterToChapter),
    rewriteCandidates: readJsonArray(meta?.rewriteCandidatesJson ?? '[]'),
    rewriteHistory: readJsonArray(meta?.rewriteHistoryJson ?? '[]'),
    trajectories: readJsonArray(meta?.trajectoriesJson ?? '[]'),
    rewriteMode: meta?.rewriteMode as PersistedNovelState['rewriteMode'] | undefined,
    rewriteTone: meta?.rewriteTone as PersistedNovelState['rewriteTone'] | undefined,
    rewriteOutput: meta?.rewriteOutput as PersistedNovelState['rewriteOutput'] | undefined,
    rewriteScope: meta?.rewriteScope as PersistedNovelState['rewriteScope'] | undefined,
    thinkingLevel: meta?.thinkingLevel as PersistedNovelState['thinkingLevel'] | undefined,
    autoContinue: Boolean(meta?.autoContinue ?? 1),
    keepCanon: Boolean(meta?.keepCanon ?? 1),
    promptText: meta?.promptText,
    selectedPresetId: meta?.selectedPresetId,
    presets: readJsonArray(meta?.presetsJson ?? '[]'),
    constraints: readJsonArray(meta?.constraintsJson ?? '[]'),
  })

  return {
    payload,
    revision: meta?.revision ?? 0,
    updatedAt: meta?.updatedAt ?? '',
  }
}

function readWorkspaceRuntimeState(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const targetDb = getCurrentWorkspaceDb(db)
  if (!targetDb) return null
  return readWorkspaceRuntimeSnapshotFromDb(targetDb as DatabaseAccess, id)?.payload ?? null
}

export function hasWorkspaceRuntimeState(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const targetDb = getCurrentWorkspaceDb(db)
  if (!targetDb) return false
  return targetDb.queryOne<{ present: number }>(
    'SELECT 1 AS present FROM WorkspaceRuntimeState WHERE id = ?',
    id,
  ) !== null
}

export function readWorkspaceLibrarySummary(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb): WorkspaceLibrarySummary | null {
  const targetDb = getCurrentWorkspaceDb(db)
  if (!targetDb) return null

  const novel = targetDb.queryOne<WorkspaceRuntimeNovelRow>(
    `SELECT id, title, summary, tagsJson, sortOrder
     FROM WorkspaceRuntimeNovel
     WHERE workspaceStateId = ?
     ORDER BY sortOrder ASC, id ASC
     LIMIT 1`,
    id,
  )
  if (!novel) return null

  const chapterSummary = targetDb.queryOne<{
    chapterCount: number
    wordCount: number
    firstChapterId: string | null
    updatedAt: string | null
  }>(
    `SELECT COUNT(*) AS chapterCount,
            COALESCE(SUM(wordCount), 0) AS wordCount,
            (
              SELECT id
              FROM WorkspaceRuntimeChapter
              WHERE workspaceStateId = ? AND novelId = ? AND parentChapterId IS NULL
              ORDER BY sortOrder ASC, id ASC
              LIMIT 1
            ) AS firstChapterId,
            (
              SELECT updatedAtLabel
              FROM WorkspaceRuntimeChapter
              WHERE workspaceStateId = ? AND novelId = ? AND parentChapterId IS NULL
              ORDER BY sortOrder ASC, id ASC
              LIMIT 1
            ) AS updatedAt
     FROM WorkspaceRuntimeChapter
     WHERE workspaceStateId = ? AND novelId = ? AND parentChapterId IS NULL`,
    id,
    novel.id,
    id,
    novel.id,
    id,
    novel.id,
  )

  return {
    id: novel.id,
    title: novel.title,
    summary: novel.summary,
    tags: normalizeStringArray(readJsonArray(novel.tagsJson)),
    updatedAt: chapterSummary?.updatedAt ?? '',
    wordCount: chapterSummary?.wordCount ?? 0,
    chapterCount: chapterSummary?.chapterCount ?? 0,
    firstChapterId: chapterSummary?.firstChapterId ?? null,
  }
}

export function loadWorkspaceKnowledgeSyncPayload(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const payload = readWorkspaceRuntimeState(id, db)
  if (!payload) return null
  return {
    localNovels: payload.localNovels,
    localChapters: payload.localChapters,
    localOutlines: payload.localOutlines,
    localTimelineEvents: payload.localTimelineEvents,
    currentNovelId: payload.currentNovelId,
  }
}

export function replaceWorkspaceRuntimeStateInDb(
  db: DatabaseAccess,
  payload: PersistedNovelState,
  revision: number,
  id = WORKSPACE_ID,
): WorkspaceRuntimeSaveResult {
  const normalized = normalizeWorkspaceState(payload)
  db.execute(
    `INSERT INTO WorkspaceRuntimeState (
       id, revision, localOutlinesJson, localCharactersJson, localCharacterRelationsJson,
       localWorldEntriesJson, localTimelineEventsJson, rewriteCandidatesJson, rewriteHistoryJson, trajectoriesJson,
       rewriteMode, rewriteTone, rewriteOutput, rewriteScope,
       thinkingLevel, autoContinue, keepCanon, promptText,
       selectedPresetId, presetsJson, constraintsJson
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       revision = excluded.revision,
       localOutlinesJson = excluded.localOutlinesJson,
       localCharactersJson = excluded.localCharactersJson,
       localCharacterRelationsJson = excluded.localCharacterRelationsJson,
       localWorldEntriesJson = excluded.localWorldEntriesJson,
       localTimelineEventsJson = excluded.localTimelineEventsJson,
       rewriteCandidatesJson = excluded.rewriteCandidatesJson,
       rewriteHistoryJson = excluded.rewriteHistoryJson,
       trajectoriesJson = excluded.trajectoriesJson,
       rewriteMode = excluded.rewriteMode,
       rewriteTone = excluded.rewriteTone,
       rewriteOutput = excluded.rewriteOutput,
       rewriteScope = excluded.rewriteScope,
       thinkingLevel = excluded.thinkingLevel,
       autoContinue = excluded.autoContinue,
       keepCanon = excluded.keepCanon,
       promptText = excluded.promptText,
       selectedPresetId = excluded.selectedPresetId,
       presetsJson = excluded.presetsJson,
       constraintsJson = excluded.constraintsJson,
       updatedAt = CURRENT_TIMESTAMP`,
    id,
    revision,
    JSON.stringify(normalized.localOutlines),
    JSON.stringify(normalized.localCharacters),
    JSON.stringify(normalized.localCharacterRelations),
    JSON.stringify(normalized.localWorldEntries),
    JSON.stringify(normalized.localTimelineEvents),
    JSON.stringify(normalized.rewriteCandidates),
    JSON.stringify(normalized.rewriteHistory),
    JSON.stringify(normalized.trajectories),
    normalized.rewriteMode,
    normalized.rewriteTone,
    normalized.rewriteOutput,
    normalized.rewriteScope,
    normalized.thinkingLevel,
    normalized.autoContinue ? 1 : 0,
    normalized.keepCanon ? 1 : 0,
    normalized.promptText,
    normalized.selectedPresetId,
    JSON.stringify(normalized.presets),
    JSON.stringify(normalized.constraints),
  )

  db.execute('DELETE FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ?', id)
  db.execute('DELETE FROM WorkspaceRuntimeNovel WHERE workspaceStateId = ?', id)

  normalized.localNovels.forEach((novel, index) => {
    db.execute(
      `INSERT INTO WorkspaceRuntimeNovel (workspaceStateId, id, title, summary, tagsJson, sortOrder)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      novel.id,
      novel.title,
      novel.summary,
      JSON.stringify(novel.tags ?? []),
      index,
    )
  })

  normalized.localChapters.forEach((chapter, index) => {
    db.execute(
      `INSERT INTO WorkspaceRuntimeChapter (
         workspaceStateId, id, novelId, parentChapterId, kind, branchLabel, title,
         sortOrder, contentHtml, originalContentHtml, status, wordCount, updatedAtLabel, trajectoryJson
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      chapter.id,
      chapter.novelId,
      chapter.parentChapterId ?? null,
      chapter.kind ?? null,
      chapter.branchLabel ?? null,
      chapter.title,
      Number.isFinite(chapter.order) ? chapter.order : index + 1,
      chapter.content,
      chapter.originalContent ?? null,
      chapter.status,
      chapter.wordCount,
      chapter.updatedAt,
      JSON.stringify(chapter.trajectory ?? []),
    )
  })

  const saved = db.queryOne<WorkspaceRuntimeSaveResult>(
    'SELECT updatedAt FROM WorkspaceRuntimeState WHERE id = ?',
    id,
  )
  if (!saved) {
    throw new Error('Failed to save workspace runtime state')
  }
  return saved
}

export async function persistWorkspaceRuntimeState(
  payload: PersistedNovelState,
  id = WORKSPACE_ID,
  db?: WorkspaceRecoveryDb,
): Promise<WorkspaceRuntimeSaveResult> {
  const normalized = normalizeWorkspaceState(payload)
  if (!db) {
    const targetNovelId = resolveWorkspaceNovelId(normalized)
    if (!targetNovelId) {
      throw new Error('Cannot persist workspace runtime state without a target novel')
    }

    const scopedPayload = scopeWorkspaceStateToNovel(normalized, targetNovelId)
    assertWorkspaceNovelReadyForWrite(targetNovelId)
    const targetDb = createNovelDatabaseAccess(targetNovelId)

    await publishWorkspaceNovelWriteTarget({
      novelId: targetNovelId,
      title: scopedPayload.localNovels[0]?.title ?? null,
    })

    return persistWorkspaceRuntimeState(scopedPayload, id, targetDb)
  }

  const existingRevision = (db as DatabaseAccess).queryOne<{ revision: number }>(
    'SELECT revision FROM WorkspaceRuntimeState WHERE id = ?',
    id,
  )?.revision ?? 0

  if (hasTransactionWrapper(db)) {
    return db.withTransaction(() => replaceWorkspaceRuntimeStateInDb(db as DatabaseAccess, normalized, existingRevision, id))
  }

  executeOnDb(db, 'BEGIN IMMEDIATE')
  try {
    const saved = replaceWorkspaceRuntimeStateInDb(db as DatabaseAccess, normalized, existingRevision, id)
    executeOnDb(db, 'COMMIT')
    return saved
  } catch (error) {
    try {
      executeOnDb(db, 'ROLLBACK')
    } catch (_rollbackError) {
      void _rollbackError
    }
    throw error
  }
}

async function persistWorkspaceRuntimeStateWithRevision(
  payload: PersistedNovelState,
  revision: number,
  id = WORKSPACE_ID,
  db?: WorkspaceRecoveryDb,
): Promise<WorkspaceRuntimeSaveResult> {
  const normalized = normalizeWorkspaceState(payload)
  const targetDb = getCurrentWorkspaceDb(db)
  if (!targetDb) {
    throw new Error('Cannot persist recovered workspace runtime state without a target novel database')
  }
  const save = () => replaceWorkspaceRuntimeStateInDb(targetDb as DatabaseAccess, normalized, revision, id)
  if (hasTransactionWrapper(targetDb)) return targetDb.withTransaction(save)

  executeOnDb(targetDb, 'BEGIN IMMEDIATE')
  try {
    const saved = save()
    executeOnDb(targetDb, 'COMMIT')
    return saved
  } catch (error) {
    try {
      executeOnDb(targetDb, 'ROLLBACK')
    } catch (_rollbackError) {
      void _rollbackError
    }
    throw error
  }
}

export function hasRecoverableKnowledgeWorkspaceSource(db?: WorkspaceRecoveryDb) {
  const novelCount = queryOneFromDb<CountRow>(db, 'SELECT COUNT(*) AS count FROM NovelRecord')?.count ?? 0
  const chapterCount = queryOneFromDb<CountRow>(db, 'SELECT COUNT(*) AS count FROM KnowledgeChapter')?.count ?? 0
  return novelCount > 0 && chapterCount > 0
}

function readRecoverableKnowledgeChapters(db?: WorkspaceRecoveryDb) {
  const mainBranchRows = queryAllFromDb<KnowledgeChapterRow>(
    db,
    `SELECT KnowledgeChapter.id, KnowledgeChapter.novelId, KnowledgeChapter.chapterNo,
            KnowledgeChapter.title, KnowledgeChapter.rawText, KnowledgeChapter.updatedAt
     FROM KnowledgeChapter
     INNER JOIN StoryBranch ON StoryBranch.id = KnowledgeChapter.branchId
     WHERE StoryBranch.name = 'main'
     ORDER BY KnowledgeChapter.novelId ASC, KnowledgeChapter.chapterNo ASC, KnowledgeChapter.id ASC`
  )

  if (mainBranchRows.length) return mainBranchRows

  return queryAllFromDb<KnowledgeChapterRow>(
    db,
    `SELECT id, novelId, chapterNo, title, rawText, updatedAt
     FROM KnowledgeChapter
     ORDER BY novelId ASC, chapterNo ASC, id ASC`
  )
}

export function recoverWorkspaceStateFromKnowledgeStore(db?: WorkspaceRecoveryDb) {
  const novels = queryAllFromDb<NovelRow>(db, 'SELECT id, title, updatedAt FROM NovelRecord ORDER BY updatedAt DESC, id ASC')
  const chapters = readRecoverableKnowledgeChapters(db)
  if (!novels.length || !chapters.length) return null

  const chapterCountByNovel = chapters.reduce((counts, chapter) => {
    counts.set(chapter.novelId, (counts.get(chapter.novelId) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  const localNovels: LocalNovelMeta[] = novels.map((novel) => ({
    id: novel.id,
    title: novel.title,
    summary: `从知识库自动修复，共 ${chapterCountByNovel.get(novel.id) ?? 0} 章。`,
    tags: ['恢复', '知识库'],
  }))

  const localChapters: Chapter[] = chapters.map((chapter) => {
    const contentText = chapter.rawText.trim() || '（本章暂无正文）'
    const content = plainTextLinesToHtml(contentText)
    return {
      id: chapter.id,
      novelId: chapter.novelId,
      title: chapter.title?.trim() || `第${chapter.chapterNo}章`,
      order: chapter.chapterNo,
      content,
      originalContent: content,
      status: 'draft',
      wordCount: countChineseFriendlyWords(contentText),
      updatedAt: chapter.updatedAt,
    }
  })

  const firstChapter = localChapters[0]
  return normalizeWorkspaceState({
    ...createEmptyWorkspaceState(),
    currentNovelId: firstChapter?.novelId ?? '',
    currentChapterId: firstChapter?.id ?? '',
    localNovels,
    localChapters,
    trajectories: firstChapter
      ? [{
        id: `traj_workspace_recovery_${Date.now()}`,
        chapterId: firstChapter.id,
        type: 'note',
        title: '自动修复工作区',
        detail: `从知识库恢复 ${localNovels.length} 本书、${localChapters.length} 章。`,
        createdAt: '刚刚 · 自动修复',
      }]
      : [],
  })
}

function readWorkspaceArtifactPayload(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  const existing = findWorkspaceStateForRecovery(id, db)
  if (!existing?.payload?.trim()) {
    return { ok: false as const, reason: 'missing' as const }
  }

  const parsed = safeParseWorkspacePayload(existing.payload)
  if (!parsed.ok) {
    return { ok: false as const, reason: 'invalid' as const, error: parsed.error }
  }

  const targetDb = getCurrentWorkspaceDb(db)
  if (!targetDb) return { ok: true as const, payload: parsed.payload, revision: existing.revision }
  const patches = targetDb.queryAll<WorkspaceChapterPatchJournalRow>(
    `SELECT committedRevision, chapterId, novelId, contentHtml, wordCount, updatedAtLabel
     FROM WorkspaceChapterPatchJournal
     WHERE workspaceStateId = ?
     ORDER BY committedRevision ASC`,
    id,
  )
  const localChapters = parsed.payload.localChapters.map((chapter) => {
    const latestPatch = patches.findLast((patch) => (
      patch.chapterId === chapter.id && patch.novelId === chapter.novelId
    ))
    return latestPatch
      ? {
          ...chapter,
          content: latestPatch.contentHtml,
          wordCount: latestPatch.wordCount,
          updatedAt: latestPatch.updatedAtLabel,
        }
      : chapter
  })
  return {
    ok: true as const,
    payload: patches.length ? normalizeWorkspaceState({ ...parsed.payload, localChapters }) : parsed.payload,
    revision: patches.at(-1)?.committedRevision ?? existing.revision,
  }
}

export async function loadWorkspacePayloadFromRuntimeOrRecovery(id = WORKSPACE_ID, db?: WorkspaceRecoveryDb) {
  return (await loadWorkspaceSnapshotFromRuntimeOrRecovery(id, db)).payload
}

export async function loadWorkspaceSnapshotFromRuntimeOrRecovery(
  id = WORKSPACE_ID,
  db?: WorkspaceRecoveryDb,
): Promise<WorkspaceRuntimeSnapshot> {
  const targetDb = getCurrentWorkspaceDb(db)
  const runtimeSnapshot = targetDb
    ? readWorkspaceRuntimeSnapshotFromDb(targetDb as DatabaseAccess, id)
    : null
  const journalRevision = targetDb ? readWorkspacePatchJournalRevision(id, targetDb) : null
  if (runtimeSnapshot && (journalRevision === null || journalRevision <= runtimeSnapshot.revision)) {
    return runtimeSnapshot
  }

  const artifact = readWorkspaceArtifactPayload(id, targetDb ?? db)
  if (artifact.ok && journalRevision !== null && journalRevision > (runtimeSnapshot?.revision ?? -1)) {
    await persistWorkspaceRuntimeStateWithRevision(artifact.payload, journalRevision, id, targetDb ?? db)
    const repairedSnapshot = targetDb
      ? readWorkspaceRuntimeSnapshotFromDb(targetDb as DatabaseAccess, id)
      : null
    if (repairedSnapshot) return repairedSnapshot
  }

  if (!runtimeSnapshot && artifact.ok && workspacePayloadHasLibraryContent(artifact.payload)) {
    await persistWorkspaceRuntimeStateWithRevision(artifact.payload, artifact.revision, id, targetDb ?? db)
    const restoredSnapshot = targetDb
      ? readWorkspaceRuntimeSnapshotFromDb(targetDb as DatabaseAccess, id)
      : null
    if (restoredSnapshot) return restoredSnapshot
  }

  const recovered = recoverWorkspaceStateFromKnowledgeStore(db)
  if (recovered) {
    await persistWorkspaceRuntimeState(recovered, id, db)
    const persistedSnapshot = targetDb
      ? readWorkspaceRuntimeSnapshotFromDb(targetDb as DatabaseAccess, id)
      : null
    if (persistedSnapshot) return persistedSnapshot
  }

  return {
    payload: recovered ?? createEmptyWorkspaceState(),
    revision: 0,
    updatedAt: '',
  }
}

export function isExplicitWorkspaceResetRequest(request: Request) {
  return request.headers.get(WORKSPACE_RESET_HEADER) === 'true'
}

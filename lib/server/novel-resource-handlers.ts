import { randomUUID } from 'node:crypto'
import { readLibraryKnowledgeStatus } from '@/lib/server/library-knowledge-status'
import { NextResponse } from 'next/server'
import {
  ApiRequestError,
  assertJsonMediaType,
  assertMultipartFormDataMediaType,
  assertWorkspaceSnapshotSemantics,
  createByteLimitedRequest,
  noStoreJson,
  readBoundedJsonObject,
} from '@/lib/server/api-route'
import {
  deleteWorkspaceNovel,
  listReadyWorkspaceNovelRegistry,
  readWorkspaceNovelLibraryMetadata,
  readWorkspaceNovelDeletionState,
  updateWorkspaceNovelLibraryMetadata,
  WorkspaceNovelDeletionError,
} from '@/lib/server/persistence'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import {
  hasWorkspaceRuntimeState,
  isExplicitWorkspaceResetRequest,
  loadWorkspacePayloadFromRuntimeOrRecovery,
  loadWorkspaceSnapshotFromRuntimeOrRecovery,
  readWorkspaceLibrarySummary,
  readWorkspaceChapterBatchFromDb,
} from '@/lib/server/workspace-resilience'
import { resolveWorkspaceNovelId, scopeWorkspaceStateToNovel } from '@/lib/server/workspace-novel-scope'
import { createEmptyWorkspaceState, normalizeWorkspaceState } from '@/lib/workspace-state'
import { runWorkspaceMutation, WorkspaceMutationError } from '@/lib/server/workspace-mutation'
import {
  schedulePendingWorkspaceNovelCleanupScan,
  scheduleWorkspaceKnowledgeSync,
  scheduleWorkspaceKnowledgeSyncRecovery,
  scheduleWorkspaceNovelCleanup,
} from '@/lib/server/workspace-background'
import {
  buildNovelCoverUrl,
  deleteNovelCoverFile,
  hasNovelCoverFile,
  MAX_NOVEL_COVER_BYTES,
  saveNovelCoverFile,
} from '@/lib/server/novel-cover'

const MAX_WORKSPACE_POST_BODY_BYTES = 16 * 1024 * 1024
const MAX_WORKSPACE_PATCH_BODY_BYTES = 4 * 1024 * 1024
const MAX_NOVEL_METADATA_BODY_BYTES = MAX_NOVEL_COVER_BYTES + 256 * 1024

function getNovelWorkspaceDb(novelId: string) {
  return createNovelDatabaseAccess(novelId)
}

function revisionResponse(payload: ReturnType<typeof normalizeWorkspaceState>, revision: number, revisionNovelId: string) {
  return noStoreJson(
    { ...payload, workspaceRevision: revision, revisionNovelId },
    { headers: {
      'X-Retale-Workspace-Revision': String(revision),
      'X-Retale-Revision-Novel-Id': revisionNovelId,
    } },
  )
}

function readRevisionContract(request: Request) {
  const idempotencyKey = request.headers.get('Idempotency-Key')
  const baseRevisionValue = request.headers.get('X-Retale-Base-Revision')
  const revisionNovelIdValue = request.headers.get('X-Retale-Revision-Novel-Id')
  if (idempotencyKey === null || baseRevisionValue === null || revisionNovelIdValue === null) {
    throw new WorkspaceMutationError(
      'invalid_mutation_contract',
      'Idempotency-Key, X-Retale-Base-Revision, and X-Retale-Revision-Novel-Id are required',
    )
  }
  if (!idempotencyKey.trim()) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'Idempotency-Key must be non-empty')
  }
  const revisionNovelId = revisionNovelIdValue.trim()
  if (!revisionNovelId) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'X-Retale-Revision-Novel-Id must be non-empty')
  }
  if (!/^\d+$/.test(baseRevisionValue)) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'X-Retale-Base-Revision must be a non-negative integer')
  }
  const baseRevision = Number(baseRevisionValue)
  if (!Number.isSafeInteger(baseRevision)) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'X-Retale-Base-Revision must be a safe non-negative integer')
  }
  return { idempotencyKey, baseRevision, revisionNovelId }
}

function readChapterPatchBody(payload: Record<string, unknown>) {
  if (typeof payload.novelId !== 'string') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'novelId must be a string')
  }
  if (typeof payload.chapterId !== 'string') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'chapterId must be a string')
  }
  if (typeof payload.content !== 'string') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'content must be a string')
  }
  if (typeof payload.wordCount !== 'number') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'wordCount must be a number')
  }
  if (!Number.isSafeInteger(payload.wordCount) || payload.wordCount < 0) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'wordCount must be a safe non-negative integer')
  }
  if (typeof payload.updatedAtLabel !== 'string') {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'updatedAtLabel must be a string')
  }
  if (payload.content.length > 1_000_000) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'content may contain at most 1000000 characters')
  }
  if (payload.updatedAtLabel.length > 128) {
    throw new WorkspaceMutationError('invalid_mutation_contract', 'updatedAtLabel may contain at most 128 characters')
  }
  return {
    novelId: payload.novelId,
    chapterId: payload.chapterId,
    content: payload.content,
    wordCount: payload.wordCount,
    updatedAtLabel: payload.updatedAtLabel,
  }
}

function mutationErrorResponse(error: WorkspaceMutationError) {
  if (error.code === 'invalid_mutation_contract') {
    return NextResponse.json({ ok: false, code: 'invalid_revision_contract', error: error.message }, { status: 422 })
  }
  const status = ['stale_revision', 'idempotency_key_reused', 'novel_not_ready', 'empty_overwrite_blocked'].includes(error.code)
    ? 409
    : ['novel_not_found', 'chapter_not_found'].includes(error.code) ? 404 : 500
  return NextResponse.json({
    ok: false,
    code: error.code,
    error: status === 500 ? 'Workspace persistence failed' : error.message,
    ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    ...(error.chapter === undefined ? {} : { chapter: error.chapter }),
  }, { status })
}

function mutationSuccessResponse(result: Awaited<ReturnType<typeof runWorkspaceMutation>>) {
  return NextResponse.json(result, { headers: {
    'X-Retale-Workspace-Revision': String(result.revision),
    'X-Retale-Revision-Novel-Id': result.novelId,
  } })
}

async function loadNovelLibrarySummaries() {
  const registryRows = listReadyWorkspaceNovelRegistry()
  const settledSummaries = await Promise.allSettled(
    registryRows.map(async (row) => {
      const workspaceDb = getNovelWorkspaceDb(row.novelId)
      if (!hasWorkspaceRuntimeState('singleton', workspaceDb)) {
        await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', workspaceDb)
      }
      scheduleWorkspaceKnowledgeSyncRecovery(row.novelId)
      const summary = readWorkspaceLibrarySummary('singleton', workspaceDb)
      if (!summary) return null
      return {
        ...summary,
        knowledgeStatus: readLibraryKnowledgeStatus(workspaceDb, row.novelId),
        title: row.title?.trim() || summary.title,
        author: row.author?.trim() || '',
        coverImage: await hasNovelCoverFile(row.novelId)
          ? buildNovelCoverUrl(row.novelId, row.updatedAt)
          : '',
      }
    })
  )
  const summaries = settledSummaries.flatMap((result, index) => {
    if (result.status === 'rejected') {
      console.warn('Skipping registry library summary for novel', registryRows[index]?.novelId, result.reason)
      return []
    }
    return result.value ? [result.value] : []
  })

  return {
    ok: true,
    novels: summaries,
  }
}

const MAX_NOVEL_TITLE_LENGTH = 200
const MAX_NOVEL_AUTHOR_LENGTH = 200

async function persistNovelTitle(novelId: string, title: string) {
  const snapshot = await loadWorkspaceSnapshotFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(novelId))
  const novel = snapshot.payload.localNovels.find((item) => item.id === novelId)
  if (!novel || novel.title === title) return

  const result = await runWorkspaceMutation({
    kind: 'full-snapshot',
    novelId,
    payload: stripBrowserSessionState(normalizeWorkspaceState({
      ...snapshot.payload,
      localNovels: snapshot.payload.localNovels.map((item) => item.id === novelId ? { ...item, title } : item),
    }), novelId),
    backupReason: 'workspace-save',
    allowEmptyReset: false,
    baseRevision: snapshot.revision,
    idempotencyKey: `novel-metadata-${randomUUID()}`,
  })
  if (result.shouldScheduleKnowledgeSync) scheduleWorkspaceKnowledgeSync(novelId)
}

async function persistNovelRecordMetadata(novelId: string, title: string, author: string) {
  const db = getNovelWorkspaceDb(novelId)
  await db.withTransaction(() => {
    db.execute(
      `INSERT INTO NovelRecord (id, title, author, sourceType)
       VALUES (?, ?, ?, 'workspace')
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         author = excluded.author,
         updatedAt = CURRENT_TIMESTAMP`,
      novelId,
      title,
      author || null,
    )
  })
}

export async function updateNovelLibraryMetadata(request: Request, novelId: string) {
  try {
    readWorkspaceNovelLibraryMetadata(novelId)
    assertMultipartFormDataMediaType(request)
    const limitedRequest = createByteLimitedRequest(
      request,
      MAX_NOVEL_METADATA_BODY_BYTES,
      'Novel metadata body exceeds the allowed size',
    )
    const formData = await limitedRequest.formData().catch(() => {
      throw new ApiRequestError(400, 'Invalid multipart form data')
    })
    const rawTitle = formData.get('title')
    const rawAuthor = formData.get('author')
    const rawRemoveCover = formData.get('removeCover')
    const rawCover = formData.get('cover')
    if (typeof rawTitle !== 'string' || typeof rawAuthor !== 'string') {
      return noStoreJson({ ok: false, error: 'title and author are required' }, { status: 400 })
    }
    const title = rawTitle.trim()
    const author = rawAuthor.trim()
    if (!title) {
      return noStoreJson({ ok: false, error: 'title is required' }, { status: 422 })
    }
    if (title.length > MAX_NOVEL_TITLE_LENGTH || author.length > MAX_NOVEL_AUTHOR_LENGTH) {
      return noStoreJson({ ok: false, error: 'Novel metadata exceeds the allowed length' }, { status: 422 })
    }
    const removeCover = rawRemoveCover === '1'
    if (rawRemoveCover !== null && rawRemoveCover !== '0' && rawRemoveCover !== '1') {
      return noStoreJson({ ok: false, error: 'removeCover must be 0 or 1' }, { status: 422 })
    }
    if (rawCover !== null && !(rawCover instanceof File)) {
      return noStoreJson({ ok: false, error: 'cover must be a file' }, { status: 400 })
    }
    const coverFile = rawCover instanceof File && rawCover.size > 0 ? rawCover : null
    if (coverFile && removeCover) {
      return noStoreJson({ ok: false, error: 'cover and removeCover cannot be submitted together' }, { status: 422 })
    }
    if (coverFile && coverFile.size > MAX_NOVEL_COVER_BYTES) {
      return noStoreJson({ ok: false, error: 'Novel cover exceeds 5 MiB' }, { status: 413 })
    }

    await persistNovelTitle(novelId, title)
    await updateWorkspaceNovelLibraryMetadata({ novelId, title, author })
    await persistNovelRecordMetadata(novelId, title, author).catch((error) => {
      console.warn('Novel metadata was saved, but the knowledge-store author mirror could not be updated.', error)
    })
    try {
      if (coverFile) await saveNovelCoverFile(novelId, coverFile)
      else if (removeCover) await deleteNovelCoverFile(novelId)
    } catch (error) {
      return noStoreJson({
        ok: false,
        error: error instanceof Error ? error.message : 'Invalid novel cover',
      }, { status: 422 })
    }
    return noStoreJson({
      ok: true,
      novel: {
        id: novelId,
        title,
        author,
        coverImage: await hasNovelCoverFile(novelId)
          ? buildNovelCoverUrl(novelId, Date.now().toString())
          : '',
      },
    })
  } catch (error) {
    if (error instanceof WorkspaceNovelDeletionError) {
      return noStoreJson({ ok: false, error: error.message }, { status: error.status })
    }
    if (error instanceof ApiRequestError) {
      return noStoreJson({ ok: false, error: error.message }, { status: error.status })
    }
    if (error instanceof WorkspaceMutationError) {
      return mutationErrorResponse(error)
    }
    console.error('Failed to update novel library metadata:', error)
    return noStoreJson({ ok: false, error: 'Failed to update novel metadata' }, { status: 500 })
  }
}

export async function getNovelCollection() {
  schedulePendingWorkspaceNovelCleanupScan()
  return noStoreJson(await loadNovelLibrarySummaries())
}

export async function getNovelResource(request: Request, novelId: string) {
  const searchParams = new URL(request.url).searchParams
  const deletionStatus = searchParams.get('deletionStatus')
  if (deletionStatus !== null) {
    if (deletionStatus !== '1') {
      return noStoreJson({ ok: false, error: 'deletionStatus must be 1' }, { status: 400 })
    }

    try {
      return noStoreJson({
        ok: true,
        novelId,
        deletionState: readWorkspaceNovelDeletionState(novelId),
      })
    } catch (error) {
      if (error instanceof WorkspaceNovelDeletionError) {
        return noStoreJson({ ok: false, error: error.message }, { status: error.status })
      }
      throw error
    }
  }

  schedulePendingWorkspaceNovelCleanupScan()

  try {
    const view = searchParams.get('view')
    if (view === 'chapter' || view === 'chapters') {
      const chapterIds = searchParams.getAll('chapterId')
      if (!chapterIds.length || chapterIds.length > (view === 'chapter' ? 1 : 8)
        || chapterIds.some((id) => !id.trim() || id.length > 200) || new Set(chapterIds).size !== chapterIds.length) {
        return noStoreJson({ ok: false, error: 'Provide between 1 and 8 unique chapter IDs (one for view=chapter)' }, { status: 400 })
      }
      const db = getNovelWorkspaceDb(novelId)
      if (!hasWorkspaceRuntimeState('singleton', db)) {
        await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', db)
      }
      const batch = readWorkspaceChapterBatchFromDb(db, novelId, chapterIds)
      if (!batch) return noStoreJson({ ok: false, error: 'Chapter not found' }, { status: 404 })
      return noStoreJson(view === 'chapter' ? {
        chapter: batch.chapters[0], workspaceRevision: batch.workspaceRevision, revisionNovelId: novelId,
      } : batch, { headers: {
        'X-Retale-Workspace-Revision': String(batch.workspaceRevision),
        'X-Retale-Revision-Novel-Id': novelId,
      } })
    }
    const snapshot = await loadWorkspaceSnapshotFromRuntimeOrRecovery('singleton', getNovelWorkspaceDb(novelId))
    scheduleWorkspaceKnowledgeSyncRecovery(novelId)
    return revisionResponse(snapshot.payload, snapshot.revision, novelId)
  } catch (error) {
    console.error('Failed to load novel resource:', error)
    return noStoreJson({ ok: false, error: 'Failed to load novel resource' }, { status: 500 })
  }
}

function stripBrowserSessionState(payload: ReturnType<typeof normalizeWorkspaceState>, novelId: string) {
  return scopeWorkspaceStateToNovel(normalizeWorkspaceState({
    ...payload,
    currentNovelId: novelId,
    currentChapterId: '',
    currentTab: 'editor',
    helperTab: 'ai',
    focusMode: false,
    selectionText: '',
    selectedParagraphIndex: 0,
    presetCompatSessionState: {},
    aiSettings: createEmptyWorkspaceState().aiSettings,
  }), novelId)
}

export async function saveNovelResource(request: Request, novelId: string) {
  try {
    assertJsonMediaType(request)
    const payload = await readBoundedJsonObject(request, MAX_WORKSPACE_POST_BODY_BYTES, 'Workspace JSON body exceeds 16 MiB')
    assertWorkspaceSnapshotSemantics(payload)

    const normalizedPayload = normalizeWorkspaceState(payload)
    const targetNovelId = resolveWorkspaceNovelId(normalizedPayload)
    if (targetNovelId !== novelId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'Novel resource path must match the persisted novel',
      )
    }
    const resourcePayload = stripBrowserSessionState(normalizedPayload, novelId)

    const revisionContract = readRevisionContract(request)
    if (revisionContract.revisionNovelId !== novelId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'X-Retale-Revision-Novel-Id must match the resolved workspace novel',
      )
    }
    const allowReset = isExplicitWorkspaceResetRequest(request)
    const result = await runWorkspaceMutation({
      kind: 'full-snapshot',
      novelId,
      payload: resourcePayload,
      backupReason: allowReset ? 'explicit-reset' : 'workspace-save',
      allowEmptyReset: allowReset,
      ...revisionContract,
    })
    if (result.shouldScheduleKnowledgeSync) {
      scheduleWorkspaceKnowledgeSync(novelId)
    }
    return mutationSuccessResponse(result)
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({
        ok: false,
        error: error.status === 400 ? '小说 JSON 无效，请刷新页面后重试。' : error.message,
      }, { status: error.status })
    }
    if (error instanceof WorkspaceMutationError) {
      return mutationErrorResponse(error)
    }
    console.error('Failed to save novel resource:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to save novel resource' },
      { status: 500 }
    )
  }
}

export async function patchChapterResource(request: Request, chapterId: string) {
  try {
    assertJsonMediaType(request)
    const payload = await readBoundedJsonObject(request, MAX_WORKSPACE_PATCH_BODY_BYTES, 'Workspace patch JSON body exceeds 4 MiB')

    const revisionContract = readRevisionContract(request)
    const patch = readChapterPatchBody(payload)
    if (patch.chapterId !== chapterId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'Chapter resource path must match chapterId',
      )
    }
    if (revisionContract.revisionNovelId !== patch.novelId) {
      throw new WorkspaceMutationError(
        'invalid_mutation_contract',
        'X-Retale-Revision-Novel-Id must match novelId',
      )
    }
    const result = await runWorkspaceMutation({
      kind: 'chapter-patch',
      ...patch,
      baseRevision: revisionContract.baseRevision,
      idempotencyKey: revisionContract.idempotencyKey,
    })
    if (result.shouldScheduleKnowledgeSync) {
      scheduleWorkspaceKnowledgeSync(result.novelId)
    }
    return mutationSuccessResponse(result)
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    if (error instanceof WorkspaceMutationError) {
      return mutationErrorResponse(error)
    }
    console.error('Failed to patch chapter resource:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to patch chapter resource' },
      { status: 500 },
    )
  }
}

export async function deleteNovelResource(request: Request, novelId: string) {
  try {
    const searchParams = new URL(request.url).searchParams
    const result = await deleteWorkspaceNovel({
      novelId,
      nextNovelId: searchParams.get('nextNovelId'),
    })
    if (result.cleanupPending) {
      scheduleWorkspaceNovelCleanup(result.deletedNovelId)
    }
    return NextResponse.json({ ok: true, ...result }, { status: result.cleanupPending ? 202 : 200 })
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    if (error instanceof WorkspaceNovelDeletionError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }

    console.error('Failed to permanently delete novel:', error)
    return NextResponse.json(
      { ok: false, error: 'Failed to permanently delete novel' },
      { status: 500 },
    )
  }
}

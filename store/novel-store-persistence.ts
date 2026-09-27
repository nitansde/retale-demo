import { normalizeAISettings } from '@/lib/ai-settings'
import { LIBRARY_KNOWLEDGE_STATUSES } from '@/lib/library-knowledge-status'
import { readBrowserWorkspaceSession, removeBrowserWorkspaceNovelSession } from '@/lib/browser-preferences'
import { requestClientGet } from '@/lib/client-request-broker'
import {
  fetchPresetCompatLibrary,
  importPresetCompatPayload,
  savePresetCompatLibrary as savePresetCompatLibraryToBackend,
} from '@/lib/preset-compat/client'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import { createUuid } from '@/lib/utils'
import type { Chapter, PersistedNovelState } from '@/lib/types'
import { classifyWorkspacePersistence } from '@/store/workspace-persistence-classifier'
import type {
  DeleteNovelFromBackendResult,
  DeleteNovelOutcome,
  LibrarySummary,
  NovelDeletionStatusObservation,
  NovelDeletionStatusResult,
  NovelStore,
  NovelStoreGet,
  NovelStoreSet,
  PresetCompatImportResult,
} from '@/store/novel-store-types'
import { WorkspaceSaveError as TypedWorkspaceSaveError } from '@/store/novel-store-types'

const WORKSPACE_RESTORE_TIMEOUT_MS = 15_000
const AI_SETTINGS_RESTORE_TIMEOUT_MS = 5_000
const WORKSPACE_MUTATION_TIMEOUT_MS = 15_000
// Fetch keepalive bodies share a roughly 64 KiB browser quota; leave room for request overhead.
const WORKSPACE_KEEPALIVE_BODY_LIMIT_BYTES = 60 * 1024
const NOVEL_DELETE_TIMEOUT_MS = 15_000
const NOVEL_DELETION_STATUS_RETRY_DELAYS_MS = [100, 250, 500] as const
const DEDUPED_CHAPTER_CONTENT_ENCODING = 'original-content-equals-content-v1'
let workspaceRestoreGeneration = 0
let activeWorkspaceRestoreController: AbortController | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]) {
  const actualKeys = Object.keys(value)
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => key in value)
}

function isWorkspaceResponse(value: unknown): value is Partial<PersistedNovelState> {
  if (!isRecord(value)) return false

  return Array.isArray(value.localNovels)
    && Array.isArray(value.localChapters)
    && Array.isArray(value.localOutlines)
    && Array.isArray(value.localCharacters)
    && Array.isArray(value.localCharacterRelations)
    && Array.isArray(value.localWorldEntries)
    && Array.isArray(value.localTimelineEvents)
    && Array.isArray(value.rewriteCandidates)
    && Array.isArray(value.rewriteHistory)
    && Array.isArray(value.trajectories)
}

function decodeWorkspaceChapterContent(value: unknown) {
  if (!isRecord(value) || value.chapterContentEncoding !== DEDUPED_CHAPTER_CONTENT_ENCODING) return value
  if (!Array.isArray(value.localChapters)) return value

  return {
    ...value,
    localChapters: value.localChapters.map((chapter) => {
      if (!isRecord(chapter) || chapter.contentLoaded === false || typeof chapter.content !== 'string' || chapter.originalContent !== undefined) {
        return chapter
      }
      return { ...chapter, originalContent: chapter.content }
    }),
  }
}

function applyBrowserSessionToWorkspace(workspace: PersistedNovelState, requestedNovelId?: string) {
  const session = readBrowserWorkspaceSession()
  const availableNovelIds = new Set([
    ...workspace.localNovels.map((novel) => novel.id),
    ...workspace.localChapters.map((chapter) => chapter.novelId),
  ])
  const currentNovelId = requestedNovelId && availableNovelIds.has(requestedNovelId)
    ? requestedNovelId
    : availableNovelIds.has(session.currentNovelId)
      ? session.currentNovelId
      : availableNovelIds.has(workspace.currentNovelId)
        ? workspace.currentNovelId
        : availableNovelIds.values().next().value ?? ''
  const chapters = workspace.localChapters
    .filter((chapter) => chapter.novelId === currentNovelId)
    .slice()
    .sort((left, right) => Number(Boolean(left.parentChapterId)) - Number(Boolean(right.parentChapterId)) || left.order - right.order || left.id.localeCompare(right.id))
  const sessionChapterId = session.currentChapterIds[currentNovelId]
  const currentChapterId = chapters.some((chapter) => chapter.id === sessionChapterId)
    ? sessionChapterId
    : chapters.some((chapter) => chapter.id === workspace.currentChapterId)
      ? workspace.currentChapterId
      : chapters[0]?.id ?? ''

  return {
    ...workspace,
    currentNovelId,
    currentChapterId,
    currentTab: session.currentTab,
    helperTab: session.helperTab,
    focusMode: session.focusMode,
    presetCompatSessionState: Object.prototype.hasOwnProperty.call(
      session.presetCompatSessionStates,
      currentNovelId,
    )
      ? session.presetCompatSessionStates[currentNovelId]!
      : workspace.presetCompatSessionState,
  }
}

function parseLibrarySummary(value: unknown): LibrarySummary | null {
  if (!isRecord(value)) return null
  const requiredKeys = ['id', 'title', 'summary', 'tags', 'updatedAt', 'wordCount', 'chapterCount', 'firstChapterId'] as const
  const allowedKeys = new Set([...requiredKeys, 'author', 'coverImage', 'knowledgeStatus'])
  if (!requiredKeys.every((key) => key in value) || Object.keys(value).some((key) => !allowedKeys.has(key))) return null
  if (typeof value.id !== 'string' || !value.id.trim()) return null
  if (typeof value.title !== 'string' || typeof value.summary !== 'string' || typeof value.updatedAt !== 'string') return null
  if (value.author !== undefined && typeof value.author !== 'string') return null
  if (value.coverImage !== undefined && typeof value.coverImage !== 'string') return null
  if (value.knowledgeStatus !== undefined && !LIBRARY_KNOWLEDGE_STATUSES.some((status) => status === value.knowledgeStatus)) return null
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string')) return null
  if (typeof value.wordCount !== 'number' || !Number.isFinite(value.wordCount) || !Number.isInteger(value.wordCount) || value.wordCount < 0) return null
  if (typeof value.chapterCount !== 'number' || !Number.isFinite(value.chapterCount) || !Number.isInteger(value.chapterCount) || value.chapterCount < 0) return null
  if (value.firstChapterId !== null && typeof value.firstChapterId !== 'string') return null

  return {
    id: value.id,
    title: value.title,
    author: value.author ?? '',
    coverImage: value.coverImage ?? '',
    knowledgeStatus: value.knowledgeStatus as LibrarySummary['knowledgeStatus'],
    summary: value.summary,
    tags: value.tags,
    updatedAt: value.updatedAt,
    wordCount: value.wordCount,
    chapterCount: value.chapterCount,
    firstChapterId: value.firstChapterId,
  }
}

function parseLibrarySummaryResponse(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'novels'])) return null
  if (value.ok !== true || !Array.isArray(value.novels)) return null
  const novels = value.novels.map(parseLibrarySummary)
  if (novels.some((novel) => novel === null)) return null
  return { novels: novels as LibrarySummary[] }
}

function parseDeletionStatusSuccess(value: unknown, novelId: string): NovelDeletionStatusObservation | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'novelId', 'deletionState'])) return null
  if (value.ok !== true || value.novelId !== novelId) return null
  if (value.deletionState !== 'ready' && value.deletionState !== 'deleting' && value.deletionState !== 'deleted') return null

  return {
    ok: true,
    novelId,
    deletionState: value.deletionState,
  }
}

function parseErrorResponse(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, ['ok', 'error'])) return null
  return value.ok === false && typeof value.error === 'string' ? value.error : null
}

async function fetchWithWorkspaceTimeout(
  url: string,
  timeoutMessage: string,
  signal?: AbortSignal,
  options: { dedupe?: boolean; cache?: RequestCache; timeoutMs?: number; priority?: RequestPriority } = {},
) {
  try {
    return await requestClientGet(url, {
      dedupe: options.dedupe,
      cache: options.cache,
      priority: options.priority,
      signal,
      timeoutMs: options.timeoutMs ?? WORKSPACE_RESTORE_TIMEOUT_MS,
      parse: async (response) => ({
        ok: response.ok,
        status: response.status,
        text: await response.text(),
        workspaceRevisionHeader: response.headers.get('X-Retale-Workspace-Revision'),
        revisionNovelIdHeader: response.headers.get('X-Retale-Revision-Novel-Id'),
      }),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(timeoutMessage)
    }
    throw error
  }
}

function parseWorkspaceResponseBody(response: Awaited<ReturnType<typeof fetchWithWorkspaceTimeout>>, invalidJsonMessage: string) {
  try {
    return JSON.parse(response.text) as unknown
  } catch {
    throw new Error(invalidJsonMessage)
  }
}

type WorkspaceRevisionAuthority = {
  workspaceRevision: number
  revisionNovelId: string
}

function parseSafeRevision(value: unknown) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const revision = Number(value)
  return Number.isSafeInteger(revision) ? revision : null
}

function parseRevisionOwner(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function parseWorkspaceRevisionAuthority(
  payload: unknown,
  response: Awaited<ReturnType<typeof fetchWithWorkspaceTimeout>>,
): WorkspaceRevisionAuthority | null {
  const bodyRevision = isRecord(payload) && 'workspaceRevision' in payload
    ? parseSafeRevision(payload.workspaceRevision)
    : null
  const bodyOwner = isRecord(payload) && 'revisionNovelId' in payload
    ? parseRevisionOwner(payload.revisionNovelId)
    : null
  const headerRevision = response.workspaceRevisionHeader === null
    ? null
    : parseSafeRevision(response.workspaceRevisionHeader)
  const headerOwner = response.revisionNovelIdHeader === null
    ? null
    : parseRevisionOwner(response.revisionNovelIdHeader)

  const bodyMetadataPresent = isRecord(payload)
    && ('workspaceRevision' in payload || 'revisionNovelId' in payload)
  const headerMetadataPresent = response.workspaceRevisionHeader !== null
    || response.revisionNovelIdHeader !== null
  if (bodyMetadataPresent && (bodyRevision === null || bodyOwner === null)) return null
  if (headerMetadataPresent && (headerRevision === null || headerOwner === null)) return null
  if (bodyRevision !== null && headerRevision !== null && bodyRevision !== headerRevision) return null
  if (bodyOwner !== null && headerOwner !== null && bodyOwner !== headerOwner) return null

  const workspaceRevision = bodyRevision ?? headerRevision
  const revisionNovelId = bodyOwner ?? headerOwner
  return workspaceRevision === null || revisionNovelId === null
    ? null
    : { workspaceRevision, revisionNovelId }
}

function parseMutationSuccess(response: Response, payload: unknown, expectedNovelId: string) {
  if (!response.ok || !isRecord(payload) || payload.ok !== true) return null
  const bodyRevision = parseSafeRevision(payload.revision)
  const bodyOwner = parseRevisionOwner(payload.novelId)
  const headerRevision = parseSafeRevision(response.headers.get('X-Retale-Workspace-Revision'))
  const headerOwner = parseRevisionOwner(response.headers.get('X-Retale-Revision-Novel-Id'))
  if (bodyRevision === null || bodyOwner === null || headerRevision === null || headerOwner === null) return null
  if (bodyRevision !== headerRevision || bodyOwner !== headerOwner || bodyOwner !== expectedNovelId) return null
  return { workspaceRevision: bodyRevision, revisionNovelId: bodyOwner }
}

function createRevisionHeaders(workspaceRevision: number, idempotencyKey: string, revisionOwner: string) {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    'X-Retale-Base-Revision': String(workspaceRevision),
    'X-Retale-Revision-Novel-Id': revisionOwner,
  }
}

type WorkspaceMutationMethod = 'PATCH' | 'POST'

type WorkspaceMutationEnvelope = {
  method: WorkspaceMutationMethod
  body: string
  idempotencyKey: string
  baseRevision: number
  capturedSnapshot: PersistedNovelState
  revisionOwner: string
  chapterId: string | null
  chapterFingerprint: string | null
}

type WorkspaceMutationResponse = {
  response: Response
  payload: unknown
}

function createChapterFingerprint(chapter: Chapter) {
  return JSON.stringify({
    content: chapter.content,
    wordCount: chapter.wordCount,
    updatedAt: chapter.updatedAt,
  })
}

function parseChapter(value: unknown): Chapter | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string'
    || typeof value.novelId !== 'string'
    || typeof value.title !== 'string'
    || typeof value.order !== 'number'
    || !Number.isFinite(value.order)
    || typeof value.content !== 'string'
    || (value.status !== 'draft' && value.status !== 'review' && value.status !== 'done')
    || typeof value.wordCount !== 'number'
    || !Number.isSafeInteger(value.wordCount)
    || value.wordCount < 0
    || typeof value.updatedAt !== 'string'
  ) return null
  if (value.originalContent !== undefined && typeof value.originalContent !== 'string') return null
  if (value.kind !== undefined && value.kind !== 'main' && value.kind !== 'branch') return null
  if (value.parentChapterId !== undefined && typeof value.parentChapterId !== 'string') return null
  if (value.branchLabel !== undefined && typeof value.branchLabel !== 'string') return null
  if (value.trajectory !== undefined && (!Array.isArray(value.trajectory) || value.trajectory.some((item) => typeof item !== 'string'))) return null

  return {
    id: value.id,
    novelId: value.novelId,
    title: value.title,
    order: value.order,
    content: value.content,
    ...(value.originalContent === undefined ? {} : { originalContent: value.originalContent }),
    status: value.status,
    wordCount: value.wordCount,
    updatedAt: value.updatedAt,
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    ...(value.parentChapterId === undefined ? {} : { parentChapterId: value.parentChapterId }),
    ...(value.branchLabel === undefined ? {} : { branchLabel: value.branchLabel }),
    ...(value.trajectory === undefined ? {} : { trajectory: value.trajectory }),
  }
}

function parseStaleRevisionPayload(payload: unknown, requireChapter: boolean) {
  if (!isRecord(payload) || payload.ok !== false || payload.code !== 'stale_revision' || typeof payload.error !== 'string') return null
  const currentRevision = parseSafeRevision(payload.currentRevision)
  if (currentRevision === null) return null
  if (!requireChapter) return { currentRevision, chapter: null }
  if (!('chapter' in payload)) return null
  const chapter = payload.chapter === null ? null : parseChapter(payload.chapter)
  if (payload.chapter !== null && chapter === null) return null
  return { currentRevision, chapter }
}

function replaceAcknowledgedChapter(
  baseline: PersistedNovelState,
  chapterId: string,
  authoritativeChapter: Chapter | null,
) {
  return {
    ...baseline,
    localChapters: authoritativeChapter
      ? baseline.localChapters.map((chapter) => chapter.id === chapterId ? authoritativeChapter : chapter)
      : baseline.localChapters.filter((chapter) => chapter.id !== chapterId),
  }
}

function getUtf8ByteLength(value: string) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength
  return value.length
}

function canUseWorkspaceMutationKeepalive(envelope: WorkspaceMutationEnvelope) {
  return getUtf8ByteLength(envelope.body) <= WORKSPACE_KEEPALIVE_BODY_LIMIT_BYTES
}

async function executeMutationEnvelope(
  envelope: WorkspaceMutationEnvelope,
  options: { lifecycle?: boolean } = {},
): Promise<WorkspaceMutationResponse> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), WORKSPACE_MUTATION_TIMEOUT_MS)
  try {
    const resourceUrl = envelope.method === 'PATCH' && envelope.chapterId
      ? `/api/chapters/${encodeURIComponent(envelope.chapterId)}`
      : `/api/novels/${encodeURIComponent(envelope.capturedSnapshot.currentNovelId)}`
    const response = await fetch(resourceUrl, {
      method: envelope.method,
      headers: createRevisionHeaders(envelope.baseRevision, envelope.idempotencyKey, envelope.revisionOwner),
      body: envelope.body,
      signal: controller.signal,
      keepalive: options.lifecycle === true && canUseWorkspaceMutationKeepalive(envelope),
    })
    const rawBody = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      if (response.ok) throw new TypedWorkspaceSaveError('invalid-response', 'Workspace save returned an invalid response')
      payload = null
    }
    return { response, payload }
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

function workspaceSaveFailure(code: ConstructorParameters<typeof TypedWorkspaceSaveError>[0], message: string) {
  return new TypedWorkspaceSaveError(code, message)
}

async function fetchNovelDeletionStatus(novelId: string): Promise<NovelDeletionStatusObservation> {
  const response = await fetchWithWorkspaceTimeout(
    `/api/novels/${encodeURIComponent(novelId)}?deletionStatus=1`,
    'Novel deletion status request timed out'
  )
  const payload = parseWorkspaceResponseBody(response, 'Workspace deletion status endpoint returned invalid JSON')

  if (!response.ok) {
    const message = parseErrorResponse(payload)
    if (message) throw new Error(message)
    throw new Error('Workspace deletion status endpoint returned an invalid error response')
  }

  const result = response.status === 200 ? parseDeletionStatusSuccess(payload, novelId) : null
  if (!result) {
    throw new Error('Workspace deletion status endpoint returned an invalid status response')
  }
  return result
}

export async function pollNovelDeletionStatus(novelId: string): Promise<NovelDeletionStatusResult> {
  let result = await fetchNovelDeletionStatus(novelId)
  if (result.deletionState !== 'deleting') {
    return {
      ok: true,
      novelId: result.novelId,
      deletionState: result.deletionState,
    }
  }

  for (const delayMs of NOVEL_DELETION_STATUS_RETRY_DELAYS_MS) {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs))
    result = await fetchNovelDeletionStatus(novelId)
    if (result.deletionState !== 'deleting') {
      return {
        ok: true,
        novelId: result.novelId,
        deletionState: result.deletionState,
      }
    }
  }

  throw new Error('Novel deletion status remained deleting after all reconciliation attempts')
}

export async function fetchAuthoritativeWorkspace(novelId: string, expectedRevision?: number | null): Promise<PersistedNovelState> {
  const response = await fetchWithWorkspaceTimeout(
    `/api/novels/${encodeURIComponent(novelId)}`,
    'Workspace reconciliation timed out',
    undefined,
    { cache: 'no-cache', timeoutMs: 120_000 },
  )
  const payload = decodeWorkspaceChapterContent(
    parseWorkspaceResponseBody(response, 'Workspace endpoint returned invalid JSON')
  )

  if (!response.ok) {
    const message = parseErrorResponse(payload)
    if (message) throw new Error(message)
    throw new Error('Workspace endpoint returned an invalid error response')
  }
  if (response.status !== 200 || !isWorkspaceResponse(payload)) {
    throw new Error('Workspace endpoint returned an invalid workspace')
  }
  if (expectedRevision !== undefined) {
    const authority = parseWorkspaceRevisionAuthority(payload, response)
    if (!authority || authority.revisionNovelId !== novelId || authority.workspaceRevision !== expectedRevision) {
      throw new Error('This novel changed on the server. Reopen it before exporting.')
    }
  }

  const workspace = normalizeWorkspaceState(payload)
  const targetPresent = workspace.localNovels.some((item) => item.id === novelId)
    || workspace.localChapters.some((item) => item.novelId === novelId)
  if (!targetPresent) {
    throw new Error('Targeted workspace did not represent the requested novel')
  }
  return workspace
}

function parseDeleteRejection(status: number, payload: unknown): DeleteNovelOutcome | null {
  if (status !== 400 && status !== 404 && status !== 409) return null
  if (!isRecord(payload) || payload.ok !== false || typeof payload.error !== 'string') return null
  if (Object.keys(payload).some((key) => key !== 'ok' && key !== 'error')) return null
  return { status: 'rejected', error: payload.error }
}

function validateDeleteSuccess(status: number, payload: unknown, novelId: string): DeleteNovelFromBackendResult | null {
  if ((status !== 200 && status !== 202) || !isRecord(payload) || payload.ok !== true) return null
  if (payload.deletedNovelId !== novelId) return null
  if (payload.nextNovelId !== null && typeof payload.nextNovelId !== 'string') return null
  if (payload.deletionState !== 'deleted' || typeof payload.cleanupPending !== 'boolean') return null
  if ((status === 202) !== payload.cleanupPending) return null

  return {
    ok: true,
    deletedNovelId: novelId,
    nextNovelId: payload.nextNovelId,
    deletionState: 'deleted',
    cleanupPending: payload.cleanupPending,
  }
}

export function getWorkspaceRestoreErrorMessage(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Workspace restore timed out'
  }

  return error instanceof Error ? error.message : 'Failed to restore workspace'
}

export function serializeState(state: PersistedNovelState): PersistedNovelState {
  return {
    currentNovelId: state.currentNovelId,
    currentChapterId: state.currentChapterId,
    currentTab: state.currentTab,
    helperTab: state.helperTab,
    localNovels: state.localNovels,
    localChapters: state.localChapters,
    localOutlines: state.localOutlines,
    localCharacters: state.localCharacters,
    localCharacterRelations: state.localCharacterRelations,
    localWorldEntries: state.localWorldEntries,
    localTimelineEvents: state.localTimelineEvents,
    rewriteCandidates: state.rewriteCandidates,
    rewriteHistory: state.rewriteHistory,
    trajectories: state.trajectories,
    rewriteMode: state.rewriteMode,
    rewriteTone: state.rewriteTone,
    rewriteOutput: state.rewriteOutput,
    rewriteScope: state.rewriteScope,
    selectionText: state.selectionText,
    selectedParagraphIndex: state.selectedParagraphIndex,
    thinkingLevel: state.thinkingLevel,
    autoContinue: state.autoContinue,
    keepCanon: state.keepCanon,
    promptText: state.promptText,
    selectedPresetId: state.selectedPresetId,
    presets: state.presets,
    constraints: state.constraints,
    focusMode: state.focusMode,
    presetCompatSessionState: state.presetCompatSessionState,
    aiSettings: state.aiSettings,
  }
}

function omitUnchangedChapterBodies(snapshot: PersistedNovelState, baseline: PersistedNovelState) {
  const stored = new Map(baseline.localChapters.map((chapter) => [chapter.id, chapter]))
  return {
    ...snapshot,
    localChapters: snapshot.localChapters.map((chapter) => {
      const previous = stored.get(chapter.id)
      if (!previous || previous.contentLoaded === false || previous.novelId !== chapter.novelId
        || previous.content !== chapter.content || previous.originalContent !== chapter.originalContent
        || previous.wordCount !== chapter.wordCount) return chapter
      // The revision contract lets the server preserve these bodies atomically.
      return { ...chapter, content: '', originalContent: undefined, contentLoaded: false as const }
    }),
  }
}

export function createPersistenceActions(
  set: NovelStoreSet,
  get: NovelStoreGet,
): Pick<NovelStore,
  'loadPresetCompatLibrary'
  | 'loadLibrarySummaries'
  | 'loadFromBackend'
  | 'ensureChapterContent'
  | 'prefetchChapterContent'
  | 'saveToBackend'
  | 'deleteNovelFromBackend'
  | 'savePresetCompatLibrary'
  | 'importPresetCompatPreset'
  | 'importPresetCompatRegexBundle'
> {
  let saveGeneration = 0
  let activeSaveCount = 0
  let latestSaveOutcomeGeneration = 0
  let latestAuthorityGeneration = 0
  let authorityEpoch = 0
  let librarySummaryGeneration = 0
  const chapterRequests = new Map<string, Promise<Chapter>>()

  const downloadChapters = async (chapterIds: string[], background: boolean, signal?: AbortSignal) => {
    const state = get()
    const revision = state.workspaceRevision
    const novelId = state.revisionNovelId
    const epoch = authorityEpoch
    if (revision === null || !novelId || state.currentNovelId !== novelId) throw new Error('Load this novel before opening a chapter')
    const query = new URLSearchParams({ view: background ? 'chapters' : 'chapter' })
    chapterIds.forEach((id) => query.append('chapterId', id))
    const response = await fetchWithWorkspaceTimeout(
      `/api/novels/${encodeURIComponent(novelId)}?${query}`,
      'Chapter download timed out', signal, { cache: 'no-cache', priority: background ? 'low' : 'high' },
    )
    const payload = parseWorkspaceResponseBody(response, 'Chapter endpoint returned invalid JSON')
    if (!response.ok || !isRecord(payload)) throw new Error('Failed to load chapter')
    const authority = parseWorkspaceRevisionAuthority(payload, response)
    const entries = background ? payload.chapters : [payload.chapter]
    if (!Array.isArray(entries) || entries.length !== chapterIds.length || !authority
      || authority.revisionNovelId !== novelId) throw new Error('Chapter endpoint returned invalid chapter authority')
    const chapters = entries.map(parseChapter)
    if (chapters.some((chapter, index) => !chapter || chapter.id !== chapterIds[index] || chapter.novelId !== novelId)
      || entries.some((chapter) => chapter.contentLoaded !== undefined)) throw new Error('Chapter endpoint returned invalid chapters')
    if (authority.workspaceRevision !== revision) throw new Error('This novel changed on the server. Reopen it to load the latest version.')
    if (signal?.aborted || get().currentNovelId !== novelId || get().revisionNovelId !== novelId
      || get().workspaceRevision !== revision || authorityEpoch !== epoch) {
      throw new Error('The workspace changed while the chapter was loading. Please try again.')
    }
    const loaded = new Map((chapters as Chapter[]).map((chapter) => [chapter.id, chapter]))
    const hydrate = (items: Chapter[]) => items.map((item) => {
      const chapter = loaded.get(item.id)
      if (!chapter || item.contentLoaded !== false) return item
      const hydrated = { ...item, content: chapter.content, originalContent: chapter.originalContent }
      delete hydrated.contentLoaded
      return hydrated
    })
    set((current) => ({
      localChapters: hydrate(current.localChapters),
      ...(current.lastAcknowledgedPersistedWorkspace ? {
        lastAcknowledgedPersistedWorkspace: {
          ...current.lastAcknowledgedPersistedWorkspace,
          localChapters: hydrate(current.lastAcknowledgedPersistedWorkspace.localChapters),
        },
      } : {}),
    }))
    return chapters as Chapter[]
  }

  const beginSave = () => {
    const generation = saveGeneration + 1
    saveGeneration = generation
    activeSaveCount += 1
    set({ isSaving: true })
    return generation
  }

  const finishSave = () => {
    activeSaveCount -= 1
    set({ isSaving: activeSaveCount > 0 })
  }

  const applySaveFailure = (generation: number, saveAuthorityEpoch: number, novelId: string) => {
    if (saveAuthorityEpoch < authorityEpoch) return
    if (generation < latestSaveOutcomeGeneration) return
    set((current) => {
      if (current.currentNovelId !== novelId) return current
      if (
        current.workspaceSaveConflict
        && (current.workspaceSaveFeedback?.kind === 'chapter-conflict'
          || current.workspaceSaveFeedback?.kind === 'structural-conflict')
      ) return current
      latestSaveOutcomeGeneration = generation
      return { workspaceSaveFeedback: { kind: 'save-failed' } }
    })
  }

  const applySaveSuccess = (
    generation: number,
    saveAuthorityEpoch: number,
    envelope: WorkspaceMutationEnvelope,
    acknowledgement: WorkspaceRevisionAuthority,
  ) => {
    set((current) => {
      const capturedSnapshot = envelope.capturedSnapshot
      if (current.currentNovelId !== capturedSnapshot.currentNovelId) return current

      if (envelope.revisionOwner !== acknowledgement.revisionNovelId
        || current.revisionNovelId !== acknowledgement.revisionNovelId
        || saveAuthorityEpoch !== authorityEpoch) return current
      const currentRevision = current.workspaceRevision
      if (currentRevision !== null && acknowledgement.workspaceRevision < currentRevision) return current
      const advancesAuthority = currentRevision === null
        || acknowledgement.workspaceRevision > currentRevision
        || generation >= latestAuthorityGeneration
      const mayClearConflict = generation >= latestSaveOutcomeGeneration
        && (!current.workspaceSaveConflict
          || acknowledgement.workspaceRevision >= current.workspaceSaveConflict.currentRevision)
      if (!advancesAuthority && !mayClearConflict) return current

      if (advancesAuthority) latestAuthorityGeneration = generation
      if (mayClearConflict) latestSaveOutcomeGeneration = generation
      const acknowledgedChapter = envelope.method === 'PATCH' && envelope.chapterId
        ? capturedSnapshot.localChapters.find((chapter) => chapter.id === envelope.chapterId) ?? null
        : null
      let acknowledgedWorkspace = acknowledgedChapter && current.lastAcknowledgedPersistedWorkspace
        ? replaceAcknowledgedChapter(
            current.lastAcknowledgedPersistedWorkspace,
            envelope.chapterId!,
            acknowledgedChapter,
          )
        : capturedSnapshot
      // A chapter may have been loaded while a structural save was in flight.
      acknowledgedWorkspace = {
        ...acknowledgedWorkspace,
        localChapters: acknowledgedWorkspace.localChapters.map((chapter) => {
          if (chapter.contentLoaded !== false) return chapter
          const loaded = current.lastAcknowledgedPersistedWorkspace?.localChapters.find((item) => item.id === chapter.id)
          if (!loaded || loaded.contentLoaded === false) return chapter
          const hydrated = { ...chapter, content: loaded.content, originalContent: loaded.originalContent }
          delete hydrated.contentLoaded
          return hydrated
        }),
      }
      return {
        ...(advancesAuthority ? {
          workspaceRevision: acknowledgement.workspaceRevision,
          revisionNovelId: acknowledgement.revisionNovelId,
          lastAcknowledgedPersistedWorkspace: acknowledgedWorkspace,
        } : {}),
        ...(mayClearConflict ? {
          workspaceSaveConflict: null,
          workspaceSaveFeedback: null,
        } : {}),
      }
    })
  }

  const applyStaleResult = (params: {
    generation: number
    saveAuthorityEpoch: number
    envelope: WorkspaceMutationEnvelope
    stale: { currentRevision: number; chapter: Chapter | null }
  }) => {
    set((current) => {
      if (
        params.saveAuthorityEpoch !== authorityEpoch
        || current.currentNovelId !== params.envelope.capturedSnapshot.currentNovelId
        || current.revisionNovelId !== params.envelope.revisionOwner
        || current.lastAcknowledgedPersistedWorkspace === null
      ) return current

      const currentRevision = current.workspaceRevision
      if (currentRevision !== null && params.stale.currentRevision < currentRevision) return current
      const advancesAuthority = currentRevision === null
        || params.stale.currentRevision > currentRevision
        || params.generation >= latestAuthorityGeneration
      const mayApplyConflict = params.generation >= latestSaveOutcomeGeneration
      if (!advancesAuthority && !mayApplyConflict) return current

      if (advancesAuthority) latestAuthorityGeneration = params.generation
      if (mayApplyConflict) {
        latestSaveOutcomeGeneration = params.generation
      }
      const isChapterConflict = params.envelope.method === 'PATCH'
        && params.envelope.chapterId !== null
        && params.envelope.chapterFingerprint !== null
      return {
        ...(advancesAuthority ? {
          workspaceRevision: params.stale.currentRevision,
          revisionNovelId: params.envelope.revisionOwner,
          lastAcknowledgedPersistedWorkspace: isChapterConflict
            ? replaceAcknowledgedChapter(
                current.lastAcknowledgedPersistedWorkspace,
                params.envelope.chapterId!,
                params.stale.chapter,
              )
            : current.lastAcknowledgedPersistedWorkspace,
        } : {}),
        ...(mayApplyConflict ? {
          workspaceSaveConflict: isChapterConflict ? {
            kind: 'chapter' as const,
            novelId: params.envelope.revisionOwner,
            chapterId: params.envelope.chapterId,
            rejectedChapterFingerprint: params.envelope.chapterFingerprint,
            currentRevision: params.stale.currentRevision,
          } : {
            kind: 'structural' as const,
            novelId: params.envelope.revisionOwner,
            chapterId: null,
            rejectedChapterFingerprint: null,
            currentRevision: params.stale.currentRevision,
          },
          workspaceSaveFeedback: {
            kind: isChapterConflict ? 'chapter-conflict' as const : 'structural-conflict' as const,
          },
        } : {}),
      }
    })
  }

  const importCompatPayload = async (
    kind: 'preset' | 'regex',
    params: Omit<Parameters<typeof importPresetCompatPayload>[0], 'kind'>
  ): Promise<PresetCompatImportResult> => {
    set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
    try {
      const result = await importPresetCompatPayload({ ...params, kind })
      set({
        presetCompatLibrary: result.library,
        presetCompatLibraryDirty: false,
        presetCompatLibraryLoading: false,
        presetCompatLibraryError: '',
      })
      return {
        importedIds: result.importedIds,
        warnings: result.warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to import preset compat ${kind === 'preset' ? 'preset' : 'regex bundle'}`
      set({
        presetCompatLibraryLoading: false,
        presetCompatLibraryError: message,
      })
      throw error
    }
  }

  return {
    ensureChapterContent: async (chapterId) => {
      const state = get()
      const existing = state.localChapters.find((chapter) => chapter.id === chapterId)
      if (!existing) throw new Error('Chapter not found')
      if (existing.contentLoaded !== false) return existing
      const revision = state.workspaceRevision
      const novelId = state.revisionNovelId
      const epoch = authorityEpoch
      if (revision === null || novelId !== existing.novelId) throw new Error('Load this novel before opening a chapter')
      const key = `${novelId}:${chapterId}:${revision}:${epoch}`
      const pending = chapterRequests.get(key)
      if (pending) return pending
      const request = (async () => {
        set({ chapterLoadError: '' })
        try {
          const chapters = await downloadChapters([chapterId], false)
          return chapters[0]
        } catch (error) {
          if (get().currentNovelId === novelId && get().currentChapterId === chapterId && authorityEpoch === epoch) {
            set({ chapterLoadError: error instanceof Error ? error.message : 'Failed to load chapter' })
          }
          throw error
        } finally {
          chapterRequests.delete(key)
        }
      })()
      chapterRequests.set(key, request)
      return request
    },
    prefetchChapterContent: async (signal) => {
      const state = get()
      if (signal.aborted || !state.backendLoaded || state.backendLoadError || state.isSaving
        || state.workspaceSaveConflict || state.isNovelDeletionPending || state.chapterLoadError
        || state.currentNovelId !== state.revisionNovelId) return false
      const chapters = state.localChapters.filter((chapter) => chapter.novelId === state.currentNovelId)
        .slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      const selectedIndex = chapters.findIndex((chapter) => chapter.id === state.currentChapterId)
      if (selectedIndex < 0 || chapters[selectedIndex].contentLoaded === false) return false
      // Warm the following chapters first, then wrap around to finish the novel.
      const ids = [...chapters.slice(selectedIndex + 1), ...chapters.slice(0, selectedIndex)]
        .filter((chapter) => chapter.contentLoaded === false).slice(0, 8).map((chapter) => chapter.id)
      if (!ids.length) return false
      await downloadChapters(ids, true, signal)
      return true
    },
    loadLibrarySummaries: async ({ fresh = false } = {}) => {
      const requestGeneration = librarySummaryGeneration + 1
      librarySummaryGeneration = requestGeneration
      const ownsRequest = () => librarySummaryGeneration === requestGeneration
      set({ librarySummariesError: '' })
      try {
        const response = await fetchWithWorkspaceTimeout(
          '/api/novels',
          'Library summary request timed out',
          undefined,
          { dedupe: !fresh },
        )
        const payload = parseWorkspaceResponseBody(response, 'Library summary endpoint returned invalid JSON')
        if (!response.ok) {
          const message = parseErrorResponse(payload)
          throw new Error(message || 'Failed to restore library summaries')
        }
        const result = response.status === 200 ? parseLibrarySummaryResponse(payload) : null
        if (!result) {
          throw new Error('Library summary endpoint returned an invalid response')
        }
        if (!ownsRequest()) return
        const browserSession = readBrowserWorkspaceSession()
        const currentStateNovelId = get().currentNovelId
        const currentNovelId = result.novels.some((novel) => novel.id === browserSession.currentNovelId)
          ? browserSession.currentNovelId
          : result.novels.some((novel) => novel.id === currentStateNovelId)
            ? currentStateNovelId
            : result.novels[0]?.id ?? ''
        set({
          librarySummaries: result.novels,
          librarySummariesLoaded: true,
          librarySummariesError: '',
          currentNovelId,
          isHydrated: true,
        })
      } catch (error) {
        const message = getWorkspaceRestoreErrorMessage(error)
        if (ownsRequest()) {
          set({
            librarySummariesLoaded: true,
            librarySummariesError: message,
            isHydrated: true,
          })
        }
        throw error
      }
    },
    loadPresetCompatLibrary: async () => {
      set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
      try {
        const library = await fetchPresetCompatLibrary()
        set({
          presetCompatLibrary: library,
          presetCompatLibraryDirty: false,
          presetCompatLibraryLoading: false,
          presetCompatLibraryError: '',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load preset compat library'
        set({
          presetCompatLibraryLoading: false,
          presetCompatLibraryError: message,
        })
        throw error
      }
    },
    loadFromBackend: async (novelId, chapterId) => {
      const restoreGeneration = workspaceRestoreGeneration + 1
      workspaceRestoreGeneration = restoreGeneration
      const ownsRestore = () => workspaceRestoreGeneration === restoreGeneration
      set({
        backendLoadError: '',
        backendLoaded: false,
        chapterLoadError: '',
      })
      authorityEpoch += 1
      activeWorkspaceRestoreController?.abort()
      const workspaceRestoreController = new AbortController()
      activeWorkspaceRestoreController = workspaceRestoreController

      try {
        const browserSession = readBrowserWorkspaceSession()
        let targetNovelId = novelId || browserSession.currentNovelId || get().currentNovelId
        if (!targetNovelId) {
          const libraryResponse = await fetchWithWorkspaceTimeout(
            '/api/novels',
            'Novel library restore timed out',
            workspaceRestoreController.signal,
          )
          const libraryPayload = parseWorkspaceResponseBody(libraryResponse, 'Novel library endpoint returned invalid JSON')
          if (!libraryResponse.ok) {
            const message = parseErrorResponse(libraryPayload)
            throw new Error(message || 'Failed to restore novel library')
          }
          const library = parseLibrarySummaryResponse(libraryPayload)
          if (!library) throw new Error('Novel library endpoint returned an invalid response')
          if (!ownsRestore()) return
          targetNovelId = library.novels[0]?.id ?? ''
          set({
            librarySummaries: library.novels,
            librarySummariesLoaded: true,
            librarySummariesError: '',
          })
          if (!targetNovelId) {
            set({
              currentNovelId: '',
              currentChapterId: '',
              isHydrated: true,
              backendLoaded: true,
              backendLoadError: '',
            })
            if (activeWorkspaceRestoreController === workspaceRestoreController) {
              activeWorkspaceRestoreController = null
            }
            return
          }
        }
        const preferredChapterId = chapterId ?? browserSession.currentChapterIds[targetNovelId]
          ?? get().librarySummaries.find((novel) => novel.id === targetNovelId)?.firstChapterId
        const workspaceQuery = new URLSearchParams({ view: 'workspace' })
        if (preferredChapterId) workspaceQuery.set('chapterId', preferredChapterId)
        const workspaceResponse = await fetchWithWorkspaceTimeout(
          `/api/novels/${encodeURIComponent(targetNovelId)}?${workspaceQuery}`,
          'Workspace restore timed out',
          workspaceRestoreController.signal,
          // Store the response, but validate it before establishing save authority.
          { cache: 'no-cache' },
        )
        if (!workspaceResponse.ok) {
          const error = (() => {
            try { return JSON.parse(workspaceResponse.text) as { error?: string } }
            catch { return null }
          })()
          throw new Error(error?.error || 'Failed to restore workspace')
        }

        const workspace = decodeWorkspaceChapterContent(
          parseWorkspaceResponseBody(workspaceResponse, 'Workspace endpoint returned invalid JSON')
        )
        if (!isWorkspaceResponse(workspace)) throw new Error('Workspace endpoint returned an invalid workspace')
        if (!ownsRestore()) return
        const normalizedWorkspace = serializeState(normalizeWorkspaceState(workspace))
        const browserWorkspace = applyBrowserSessionToWorkspace(normalizedWorkspace, targetNovelId)
        if (chapterId && browserWorkspace.localChapters.some((chapter) => chapter.id === chapterId)) {
          browserWorkspace.currentChapterId = chapterId
        }
        const revisionAuthority = parseWorkspaceRevisionAuthority(workspace, workspaceResponse)
        const targetPresent = normalizedWorkspace.localNovels.some((item) => item.id === targetNovelId)
          || normalizedWorkspace.localChapters.some((item) => item.novelId === targetNovelId)
        const authoritativeForWorkspace = revisionAuthority && (
          normalizedWorkspace.localNovels.some((item) => item.id === revisionAuthority.revisionNovelId)
          || normalizedWorkspace.localChapters.some((item) => item.novelId === revisionAuthority.revisionNovelId)
        )
        if (!revisionAuthority || revisionAuthority.revisionNovelId !== targetNovelId || !targetPresent) {
          throw new Error('Targeted workspace returned invalid revision authority')
        }

        if (authoritativeForWorkspace) authorityEpoch += 1
        set({
          ...browserWorkspace,
          workspaceRevision: authoritativeForWorkspace ? revisionAuthority.workspaceRevision : null,
          revisionNovelId: authoritativeForWorkspace ? revisionAuthority.revisionNovelId : '',
          lastAcknowledgedPersistedWorkspace: authoritativeForWorkspace ? normalizedWorkspace : null,
          workspaceSaveConflict: null,
          workspaceSaveFeedback: null,
          isHydrated: true,
          backendLoaded: true,
          backendLoadError: '',
          librarySummaries: get().librarySummaries.map((summary) => {
            const loadedNovel = normalizedWorkspace.localNovels.find((item) => item.id === summary.id)
            if (!loadedNovel) return summary
            const chapters = normalizedWorkspace.localChapters
              .filter((chapter) => chapter.novelId === summary.id && !chapter.parentChapterId)
              .slice()
              .sort((left, right) => left.order - right.order)
            return {
              ...summary,
              title: loadedNovel.title,
              summary: loadedNovel.summary,
              tags: loadedNovel.tags,
              updatedAt: chapters[0]?.updatedAt ?? summary.updatedAt,
              wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
              chapterCount: chapters.length,
              firstChapterId: chapters[0]?.id ?? null,
            }
          }),
        })
      } catch (error) {
        if (!ownsRestore()) return
        const message = getWorkspaceRestoreErrorMessage(error)
        console.error('Workspace restore failed:', error)
        set({
          backendLoaded: true,
          isHydrated: true,
          backendLoadError: message,
        })
        if (novelId) throw error
        return
      }

      const aiSettingsRefresh = requestClientGet('/api/settings/ai', {
        signal: workspaceRestoreController.signal,
        timeoutMs: AI_SETTINGS_RESTORE_TIMEOUT_MS,
        parse: async (response) => {
          if (!response.ok) {
            const error = await response.json().catch(() => null) as { error?: string } | null
            throw new Error(error?.error || 'Failed to load AI settings')
          }
          return response.json()
        },
      }).then((value) => {
        if (ownsRestore()) set({ aiSettings: normalizeAISettings(value) })
      }).catch((error) => {
        if (ownsRestore()) console.error('AI settings restore failed:', error)
      }).finally(() => {
        if (activeWorkspaceRestoreController === workspaceRestoreController) activeWorkspaceRestoreController = null
      })
      void aiSettingsRefresh
    },
    saveToBackend: async (options = {}) => {
      const state = get()
      const capturedSnapshot = serializeState(state)
      if (!capturedSnapshot.currentNovelId && capturedSnapshot.localNovels.length === 0 && capturedSnapshot.localChapters.length === 0) return
      if (!state.backendLoaded || state.backendLoadError
        || state.workspaceRevision === null
        || state.revisionNovelId !== capturedSnapshot.currentNovelId
        || state.lastAcknowledgedPersistedWorkspace === null
        || state.lastAcknowledgedPersistedWorkspace.currentNovelId !== capturedSnapshot.currentNovelId) {
        set({ workspaceSaveFeedback: { kind: 'save-failed' } })
        throw workspaceSaveFailure('authority-required', 'Load this novel before saving. Local edits have been preserved for reconciliation.')
      }
      const classification = classifyWorkspacePersistence(state.lastAcknowledgedPersistedWorkspace, capturedSnapshot)
      if (classification.kind === 'none') return
      const conflict = state.workspaceSaveConflict
      if (conflict) {
        const unchangedRejectedChapter = classification.kind === 'patch'
          && classification.chapter.id === conflict.chapterId
          && createChapterFingerprint(classification.chapter) === conflict.rejectedChapterFingerprint
        if (unchangedRejectedChapter) {
          throw workspaceSaveFailure('stale-revision', 'Workspace chapter conflict remains unresolved')
        }
        if (classification.kind !== 'patch' || classification.chapter.id !== conflict.chapterId) {
          set({ workspaceSaveFeedback: { kind: 'structural-conflict' } })
          throw workspaceSaveFailure('conflict-blocked', 'Workspace structural conflict requires reconciliation')
        }
      }

      const patchEligible = classification.kind === 'patch' && classification.chapter.contentLoaded !== false
      const method: WorkspaceMutationMethod = patchEligible ? 'PATCH' : 'POST'
      const idempotencyKey = createUuid()
      const baseRevision = state.workspaceRevision
      const patchBody = classification.kind === 'patch' ? {
        novelId: state.revisionNovelId,
        chapterId: classification.chapter.id,
        content: classification.chapter.content,
        wordCount: classification.chapter.wordCount,
        updatedAtLabel: classification.chapter.updatedAt,
      } : null
      const envelope: WorkspaceMutationEnvelope = {
        method,
        body: JSON.stringify(method === 'PATCH' ? patchBody : omitUnchangedChapterBodies(capturedSnapshot, state.lastAcknowledgedPersistedWorkspace)),
        idempotencyKey,
        baseRevision,
        capturedSnapshot,
        revisionOwner: state.revisionNovelId,
        chapterId: classification.kind === 'patch' ? classification.chapter.id : null,
        chapterFingerprint: classification.kind === 'patch' ? createChapterFingerprint(classification.chapter) : null,
      }
      const saveAuthorityEpoch = authorityEpoch
      const generation = beginSave()
      try {
        let result: WorkspaceMutationResponse
        try {
          result = await executeMutationEnvelope(envelope, options)
        } catch {
          try {
            result = await executeMutationEnvelope(envelope, options)
          } catch (retryError) {
            applySaveFailure(generation, saveAuthorityEpoch, capturedSnapshot.currentNovelId)
            if (retryError instanceof TypedWorkspaceSaveError && retryError.code === 'invalid-response') throw retryError
            throw workspaceSaveFailure('transport-indeterminate', 'Workspace save result could not be confirmed')
          }
        }

        if (
          result.response.ok
          && parseMutationSuccess(result.response, result.payload, envelope.revisionOwner) === null
        ) {
          try {
            result = await executeMutationEnvelope(envelope, options)
          } catch {
            applySaveFailure(generation, saveAuthorityEpoch, capturedSnapshot.currentNovelId)
            throw workspaceSaveFailure('transport-indeterminate', 'Workspace save result could not be confirmed')
          }
          if (
            !result.response.ok
            || parseMutationSuccess(result.response, result.payload, envelope.revisionOwner) === null
          ) {
            applySaveFailure(generation, saveAuthorityEpoch, capturedSnapshot.currentNovelId)
            throw workspaceSaveFailure('invalid-response', 'Workspace save returned an invalid revision acknowledgement')
          }
        }

        if (!result.response.ok) {
          const stale = parseStaleRevisionPayload(result.payload, envelope.method === 'PATCH')
          if (stale) {
            const isChapterConflict = envelope.method === 'PATCH'
              && envelope.chapterId !== null
              && envelope.chapterFingerprint !== null
            applyStaleResult({ generation, saveAuthorityEpoch, envelope, stale })
            if (isChapterConflict) {
              throw workspaceSaveFailure('stale-revision', 'Workspace chapter conflict requires reconciliation')
            }
            throw workspaceSaveFailure('conflict-blocked', 'Workspace structural conflict requires reconciliation')
          }
          applySaveFailure(generation, saveAuthorityEpoch, capturedSnapshot.currentNovelId)
          const message = isRecord(result.payload) && typeof result.payload.error === 'string'
            ? result.payload.error
            : 'Workspace save was rejected'
          throw workspaceSaveFailure('http-rejected', message)
        }

        const acknowledgement = parseMutationSuccess(result.response, result.payload, state.revisionNovelId)
        if (!acknowledgement) {
          applySaveFailure(generation, saveAuthorityEpoch, capturedSnapshot.currentNovelId)
          throw workspaceSaveFailure('invalid-response', 'Workspace save returned an invalid revision acknowledgement')
        }
        applySaveSuccess(generation, saveAuthorityEpoch, envelope, acknowledgement)
      } finally {
        finishSave()
      }
    },
    deleteNovelFromBackend: async (novelId) => {
      const query = new URLSearchParams()
      const nextNovelId = get().currentNovelId
      if (nextNovelId) {
        query.set('nextNovelId', nextNovelId)
      }

      const controller = new AbortController()
      const timeoutId = globalThis.setTimeout(() => controller.abort(), NOVEL_DELETE_TIMEOUT_MS)

      try {
        const suffix = query.size ? `?${query.toString()}` : ''
        const response = await fetch(`/api/novels/${encodeURIComponent(novelId)}${suffix}`, {
          method: 'DELETE',
          signal: controller.signal,
        })
        const rawBody = await response.text()
        let payload: unknown
        try {
          payload = JSON.parse(rawBody)
        } catch {
          return { status: 'indeterminate', error: 'Workspace endpoint returned invalid JSON' }
        }

        const rejection = parseDeleteRejection(response.status, payload)
        if (rejection) return rejection

        const result = validateDeleteSuccess(response.status, payload, novelId)
        if (result) {
          removeBrowserWorkspaceNovelSession(novelId)
          return { status: 'committed', result }
        }

        return { status: 'indeterminate', error: 'Workspace endpoint returned an invalid deletion response' }
      } catch (error) {
        const message = error instanceof Error && error.name === 'AbortError'
          ? 'Novel deletion timed out'
          : error instanceof Error
            ? error.message
            : 'Novel deletion failed before its result could be confirmed'
        return { status: 'indeterminate', error: message }
      } finally {
        globalThis.clearTimeout(timeoutId)
      }
    },
    savePresetCompatLibrary: async () => {
      const { presetCompatLibrary, presetCompatLibraryDirty } = get()
      if (!presetCompatLibraryDirty) return
      set({ presetCompatLibraryLoading: true, presetCompatLibraryError: '' })
      try {
        const result = await savePresetCompatLibraryToBackend(presetCompatLibrary)
        set({
          presetCompatLibrary: result.library,
          presetCompatLibraryDirty: false,
          presetCompatLibraryLoading: false,
          presetCompatLibraryError: '',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to save preset compat library'
        set({
          presetCompatLibraryLoading: false,
          presetCompatLibraryError: message,
        })
        throw error
      }
    },
    importPresetCompatPreset: async (params) => importCompatPayload('preset', params),
    importPresetCompatRegexBundle: async (params) => importCompatPayload('regex', params),
  }
}

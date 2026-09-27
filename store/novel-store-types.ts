import type { StoreApi } from 'zustand'
import type { LibraryKnowledgeStatus } from '@/lib/library-knowledge-status'
import type {
  AISettings,
  Chapter,
  Character,
  CharacterRelation,
  HelperTab,
  KnowledgeRebuildChapterRange,
  OutlineItem,
  OutlineType,
  PersistedNovelState,
  PresetCompatSessionPhase,
  PresetCompatSessionWorkspaceSelection,
  RewriteCandidate,
  RewriteConstraint,
  RewriteHistoryEntry,
  RewriteMode,
  RewriteOutput,
  RewritePreset,
  RewriteScope,
  RewriteTone,
  ThoughtLevel,
  TimelineEvent,
  WorldEntry,
  WorldEntryType,
  WorkspaceTab,
} from '@/lib/types'
import type { ImportPresetCompatPayloadParams } from '@/lib/preset-compat/client'
import type {
  PresetCompatBuiltinSystemPrompt,
  PresetCompatCreativeSurfaceId,
  PresetCompatLibrary,
  PresetCompatPresetRecord,
  PresetCompatPromptRule,
  PresetCompatRegexRecord,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'

export type GenerateRewriteParams = {
  prompt?: string
}

export type ImportPayload = Partial<PersistedNovelState>

export type KnowledgeProjectionPayload = Pick<
  PersistedNovelState,
  'localOutlines' | 'localCharacters' | 'localCharacterRelations' | 'localWorldEntries' | 'localTimelineEvents'
>

export type KnowledgeRebuildStatus = {
  jobId: string
  novelId: string
  jobType: 'extract_chapter_knowledge' | 'rebuild_retrieval_index'
  status: string
  errorMessage?: string | null
  progress: number
  currentStep: string | null
  createdAt: string
  updatedAt: string
  etaMinutes: number | null
  steps: Array<{
    key: 'hanlp-bootstrap' | 'extract' | 'batch-sync' | 'cleanup' | 'write' | 'raw-embedding' | 'index'
    label: string
    status: 'pending' | 'running' | 'paused' | 'completed'
    progress: number
    etaMinutes: number | null
    detail: string | null
  }>
  chapterRange?: KnowledgeRebuildChapterRange
  rawTextEmbeddingProgress?: number
  rawTextEmbeddingCacheHitRate?: number
  hanlpCacheStatus?: 'queued' | 'running' | 'paused' | 'ready' | 'empty'
  hanlpCacheHitRate?: number
  hanlpBootstrapProgress?: number
  hanlpBootstrapCompletedChapterCount?: number
  hanlpBootstrapTotalChapterCount?: number
  hanlpBootstrapCacheHitCount?: number
  hanlpBootstrapCacheMissCount?: number
  hanlpBootstrapInitializedCharacterEntities?: boolean
  hanlpSettingsSnapshot?: {
    hanlpScriptVersionHash: string
    hanlpModelOrConfigHash: string
    outputSchemaVersion: string
    pipelineVersion: string
  }
  stageTimingsMs?: Record<string, number>
  embeddingSettingsSnapshot?: {
    provider: string
    model: string
    embeddingBatchSize: number
  }
}

export type HanlpCacheSnapshot = {
  status: NonNullable<KnowledgeRebuildStatus['hanlpCacheStatus']>
  settingsSnapshot?: NonNullable<KnowledgeRebuildStatus['hanlpSettingsSnapshot']>
}

export type KnowledgeCoverageStatus = 'missing' | 'partial' | 'full'
export type RetrievalIndexCoverageStatus = KnowledgeCoverageStatus | 'pending'

export type KnowledgeChapterCoverageOverview = {
  status: KnowledgeCoverageStatus
  coveredChapterCount: number
  totalChapterCount: number
  validThroughChapterNo: number | null
}

export type RetrievalIndexCoverageOverview = {
  status: RetrievalIndexCoverageStatus
  indexedScopeCount: number
  chapterRange?: KnowledgeRebuildChapterRange
  task: KnowledgeRebuildStatus | null
}

export type KnowledgeStatusOverview = {
  knowledgeGraph: KnowledgeChapterCoverageOverview
  extractionCache: KnowledgeChapterCoverageOverview
  embeddingCache: KnowledgeChapterCoverageOverview & {
    provider: string | null
    model: string | null
  }
  retrievalIndex: RetrievalIndexCoverageOverview
}

export type KnowledgeActionOutcome = 'completed' | 'queued' | 'running' | 'paused' | 'aborted' | 'blocked' | 'deleted' | 'idle'

export type KnowledgeActionError = {
  code: 'active-rebuild'
  message: string
}

export type PresetCompatImportResult = {
  importedIds: string[]
  warnings: string[]
}

export type DeleteNovelFromBackendResult = {
  ok: true
  deletedNovelId: string
  nextNovelId: string | null
  deletionState: 'deleted'
  cleanupPending: boolean
}

export type DeleteNovelOutcome =
  | { status: 'committed'; result: DeleteNovelFromBackendResult }
  | { status: 'rejected'; error: string }
  | { status: 'indeterminate'; error: string }

export type NovelDeletionTransaction = {
  novelId: string
  before: PersistedNovelState
  optimistic: PersistedNovelState
  summary: LibrarySummary | null
}

export type NovelDeletionStatus = 'ready' | 'deleting' | 'deleted'

export type NovelDeletionStatusObservation = {
  ok: true
  novelId: string
  deletionState: NovelDeletionStatus
}

export type NovelDeletionStatusResult = Omit<NovelDeletionStatusObservation, 'deletionState'> & {
  deletionState: Exclude<NovelDeletionStatus, 'deleting'>
}

export type NovelDeletionReconciliationResult = 'deleted' | 'present'

export type WorkspaceSaveFeedback =
  | { kind: 'save-failed' }
  | { kind: 'chapter-conflict' }
  | { kind: 'structural-conflict' }

export type WorkspaceSaveConflict = {
  kind: 'chapter' | 'structural'
  novelId: string
  chapterId: string | null
  rejectedChapterFingerprint: string | null
  currentRevision: number
}

export type WorkspaceSaveErrorCode =
  | 'authority-required'
  | 'transport-indeterminate'
  | 'invalid-response'
  | 'http-rejected'
  | 'stale-revision'
  | 'conflict-blocked'

export class WorkspaceSaveError extends Error {
  readonly code: WorkspaceSaveErrorCode

  constructor(code: WorkspaceSaveErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceSaveError'
    this.code = code
  }
}

export type WorkspaceSaveOptions = {
  lifecycle?: boolean
}

export type KnowledgeProjectionResult = KnowledgeProjectionPayload & {
  knowledgeRebuildStatus: KnowledgeRebuildStatus | null
  hanlpCacheSnapshot: HanlpCacheSnapshot | null
  knowledgeStatusOverview: KnowledgeStatusOverview | null
  jobOutcome: KnowledgeActionOutcome | null
  actionError: KnowledgeActionError | null
}

export type LibrarySummary = {
  knowledgeStatus?: LibraryKnowledgeStatus
  id: string
  title: string
  author?: string
  coverImage?: string
  summary: string
  tags: string[]
  updatedAt: string
  wordCount: number
  chapterCount: number
  firstChapterId: string | null
}

export type NovelStore = PersistedNovelState & {
  persistRevision: number
  workspaceRevision: number | null
  revisionNovelId: string
  lastAcknowledgedPersistedWorkspace: PersistedNovelState | null
  workspaceSaveConflict: WorkspaceSaveConflict | null
  workspaceSaveFeedback: WorkspaceSaveFeedback | null
  isHydrated: boolean
  isSaving: boolean
  isNovelDeletionPending: boolean
  backendLoaded: boolean
  backendLoadError: string
  chapterLoadError: string
  librarySummaries: LibrarySummary[]
  librarySummariesLoaded: boolean
  librarySummariesError: string
  presetCompatLibrary: PresetCompatLibrary
  presetCompatLibraryDirty: boolean
  presetCompatLibraryLoading: boolean
  presetCompatLibraryError: string

  getNovels: () => LibrarySummary[]
  importNovelFromText: (input: { title: string; text: string; summary?: string }) => string | null
  setCurrentNovelId: (id: string) => void
  setCurrentChapterId: (id: string) => void
  setCurrentTab: (tab: WorkspaceTab) => void
  setHelperTab: (tab: HelperTab) => void
  updateChapterContent: (id: string, html: string, wordCount?: number) => void
  reorderChapters: (novelId: string, orderedIds: string[]) => void
  setRewriteMode: (mode: RewriteMode) => void
  setRewriteTone: (tone: RewriteTone) => void
  setRewriteOutput: (output: RewriteOutput) => void
  setRewriteScope: (scope: RewriteScope) => void
  setThinkingLevel: (level: ThoughtLevel) => void
  toggleAutoContinue: () => void
  toggleKeepCanon: () => void
  selectRewriteCandidate: (id: string) => void
  applyRewriteCandidate: (id: string) => void
  insertRewriteCandidate: (id: string) => void
  branchRewriteCandidate: (id: string) => void
  continueRewriteCandidate: (id: string) => void
  setSelectionText: (text: string) => void
  setSelectedParagraphIndex: (index: number | null) => void
  setPromptText: (text: string) => void
  addPreset: () => void
  selectPreset: (id: string) => void
  updatePresetPrompt: (id: string, prompt: string) => void
  updatePresetName: (id: string, name: string) => void
  toggleConstraint: (id: string) => void
  cycleConstraintStrength: (id: string) => void
  generateRewriteBatch: (params?: GenerateRewriteParams) => Promise<void>
  addChapterBranch: (sourceChapterId: string, title?: string, content?: string) => void
  createNewChapter: () => void
  toggleFocusMode: () => void
  exportWorkspace: () => Promise<string>
  importWorkspace: (payload: ImportPayload) => void
  resetWorkspace: () => void
  setPresetCompatSessionPhase: (
    selection: PresetCompatSessionWorkspaceSelection,
    surfaceId: PresetCompatSurfaceId,
    phase: PresetCompatSessionPhase,
    resetPending?: boolean
  ) => void
  clearPresetCompatSessionStateForSelection: (selection: PresetCompatSessionWorkspaceSelection) => void
  resetPresetCompatSessionStateForSelection: (
    selection: PresetCompatSessionWorkspaceSelection,
    surfaceIds: PresetCompatSurfaceId[],
    phase?: PresetCompatSessionPhase
  ) => void
  setHydrated: (value: boolean) => void
  loadLibrarySummaries: (options?: { fresh?: boolean }) => Promise<void>
  loadFromBackend: (novelId?: string, chapterId?: string) => Promise<void>
  ensureChapterContent: (chapterId: string) => Promise<Chapter>
  prefetchChapterContent: (signal: AbortSignal) => Promise<boolean>
  saveToBackend: (options?: WorkspaceSaveOptions) => Promise<void>
  deleteNovelFromBackend: (novelId: string) => Promise<DeleteNovelOutcome>
  reconcileNovelDeletionFromBackend: (transaction: NovelDeletionTransaction) => Promise<NovelDeletionReconciliationResult>
  beginNovelDeletion: (novelId: string) => NovelDeletionTransaction | null
  rollbackNovelDeletion: (transaction: NovelDeletionTransaction) => void
  snapshotPersistedState: () => PersistedNovelState
  restorePersistedState: (snapshot: PersistedNovelState) => void
  setNovelDeletionPending: (pending: boolean) => void
  reconcileNovelDeletion: (nextNovelId: string | null) => void
  loadPresetCompatLibrary: () => Promise<void>
  savePresetCompatLibrary: () => Promise<void>
  importPresetCompatPreset: (params: Omit<ImportPresetCompatPayloadParams, 'kind'>) => Promise<PresetCompatImportResult>
  importPresetCompatRegexBundle: (params: Omit<ImportPresetCompatPayloadParams, 'kind'>) => Promise<PresetCompatImportResult>
  bindPresetCompatPresetToSurface: (surfaceId: PresetCompatSurfaceId, presetId: string | null) => void
  bindPresetCompatPresetToNovel: (novelId: string, presetId: string | null) => void
  deletePresetCompatPreset: (presetId: string) => void
  attachPresetCompatStandaloneRegex: (presetId: string, regexId: string) => void
  detachPresetCompatStandaloneRegex: (presetId: string, regexId: string) => void
  updatePresetCompatPromptRule: (presetId: string, promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
  updatePresetCompatEmbeddedRegex: (presetId: string, regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  updatePresetCompatRuntimeSampler: (presetId: string, updates: Partial<PresetCompatPresetRecord['runtimeSampler']>) => void
  updatePresetCompatTransport: (presetId: string, updates: Partial<PresetCompatPresetRecord['transport']>) => void
  updatePresetCompatStandaloneRegex: (regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  updatePresetCompatBuiltinSystemPrompt: (surfaceId: PresetCompatCreativeSurfaceId, updates: Partial<Omit<PresetCompatBuiltinSystemPrompt, 'surfaceId'>>) => void
  exportPresetCompatPreset: (presetId: string) => string | null
  exportPresetCompatStandaloneRegexBundle: (regexIds?: string[]) => string
  addCharacter: (novelId: string, fields: { name: string; role: string; goal: string; trait: string; note: string }) => void
  updateCharacter: (id: string, fields: Partial<Omit<Character, 'id' | 'novelId'>>) => void
  deleteCharacter: (id: string) => void
  addOutlineItem: (novelId: string, fields: { title: string; type: OutlineType; summary: string; relatedChapterIds?: string[] }) => void
  updateOutlineItem: (id: string, fields: Partial<Omit<OutlineItem, 'id' | 'novelId'>>) => void
  deleteOutlineItem: (id: string) => void
  addCharacterRelation: (novelId: string, fields: Omit<CharacterRelation, 'id' | 'novelId'>) => void
  updateCharacterRelation: (id: string, fields: Partial<Omit<CharacterRelation, 'id' | 'novelId'>>) => void
  deleteCharacterRelation: (id: string) => void
  addWorldEntry: (novelId: string, fields: { title: string; type: WorldEntryType; content: string }) => void
  updateWorldEntry: (id: string, fields: Partial<Omit<WorldEntry, 'id' | 'novelId'>>) => void
  deleteWorldEntry: (id: string) => void
  addTimelineEvent: (novelId: string, fields: Omit<TimelineEvent, 'id' | 'novelId'>) => void
  updateTimelineEvent: (id: string, fields: Partial<Omit<TimelineEvent, 'id' | 'novelId'>>) => void
  deleteTimelineEvent: (id: string) => void
  deleteChapter: (chapterId: string) => void
  deleteNovel: (novelId: string) => void
  rebuildStoryKnowledge: (novelId?: string, options?: { chapterRange?: KnowledgeRebuildChapterRange }) => Promise<KnowledgeProjectionResult | null>
  rebuildStoryRetrievalIndex: (novelId?: string, options?: { chapterRange?: KnowledgeRebuildChapterRange }) => Promise<KnowledgeProjectionResult | null>
  pauseStoryKnowledgeRebuild: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  abortStoryKnowledgeRebuild: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  deleteStoryKnowledgeGraph: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  deleteStoryHanlpCache: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  deleteStoryExtractionCache: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  deleteStoryEmbeddingCache: (novelId?: string) => Promise<KnowledgeProjectionResult | null>
  refreshKnowledgeProjection: (novelId?: string, asOfChapter?: number, signal?: AbortSignal) => Promise<KnowledgeProjectionResult>
  setAISettings: (settings: AISettings) => void
  saveAISettings: () => Promise<void>
}

export type NovelStoreSet = StoreApi<NovelStore>['setState']
export type NovelStoreGet = StoreApi<NovelStore>['getState']

export type PersistedNovelStoreSet = (
  update: (state: NovelStore) => Partial<NovelStore> | NovelStore
) => void

const PERSISTED_NOVEL_STATE_KEYS = [
  'localNovels',
  'localChapters',
  'localOutlines',
  'localCharacters',
  'localCharacterRelations',
  'localWorldEntries',
  'localTimelineEvents',
  'rewriteCandidates',
  'rewriteHistory',
  'trajectories',
  'rewriteMode',
  'rewriteTone',
  'rewriteOutput',
  'rewriteScope',
  'selectionText',
  'selectedParagraphIndex',
  'thinkingLevel',
  'autoContinue',
  'keepCanon',
  'promptText',
  'selectedPresetId',
  'presets',
  'constraints',
  'presetCompatSessionState',
] as const satisfies ReadonlyArray<keyof PersistedNovelState>

export function createPersistedNovelStoreSet(set: NovelStoreSet): PersistedNovelStoreSet {
  return (update) => set((state) => {
    const nextState = update(state)
    if (nextState === state) return state

    const changed = PERSISTED_NOVEL_STATE_KEYS.some((key) => (
      key in nextState && !Object.is(state[key], nextState[key])
    ))
    if (!changed) return state

    return {
      ...nextState,
      persistRevision: state.persistRevision + 1,
    }
  })
}

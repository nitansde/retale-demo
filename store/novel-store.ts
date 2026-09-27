"use client"

import { create } from 'zustand'
import { normalizeAISettings } from '@/lib/ai-settings'
import { readBrowserWorkspaceSession, removeBrowserWorkspaceNovelSession, writeBrowserWorkspaceSession } from '@/lib/browser-preferences'
import {
  exportPresetCompatPresetJson,
  exportPresetCompatStandaloneRegexJson,
  fetchPresetCompatLibrary,
  importPresetCompatPayload,
  savePresetCompatLibrary as savePresetCompatLibraryToBackend,
} from '@/lib/preset-compat/client'
import type { ImportPresetCompatPayloadParams } from '@/lib/preset-compat/client'
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract'
import type {
  PresetCompatLibrary,
  PresetCompatBuiltinSystemPrompt,
  PresetCompatCreativeSurfaceId,
  PresetCompatPresetRecord,
  PresetCompatPromptRule,
  PresetCompatRegexRecord,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import { tm } from '@/lib/i18n/messages'
import {
  countChineseFriendlyWords,
  formatNowLabel,
  getParagraphsFromHtml,
  htmlToPlainText,
  plainTextToHtml,
  uid,
} from '@/lib/utils'
import { buildGenerationContext } from '@/lib/story-knowledge'
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
import {
  clearPresetCompatSessionStateForSelection,
  createEmptyWorkspaceState,
  normalizeWorkspaceState,
  resetPresetCompatSessionStateForSelection,
  setPresetCompatSessionEntry,
} from '@/lib/workspace-state'
import { createAISettingsActions } from '@/store/novel-store-ai'
import { createKnowledgeActions } from '@/store/novel-store-knowledge'
import {
  createPersistenceActions,
  fetchAuthoritativeWorkspace,
  pollNovelDeletionStatus,
  serializeState,
} from '@/store/novel-store-persistence'
import { createRewriteActions } from '@/store/novel-store-rewrite'
import type {
  GenerateRewriteParams,
  ImportPayload,
  KnowledgeProjectionResult,
  LibrarySummary,
  PresetCompatImportResult,
  DeleteNovelOutcome,
  NovelDeletionReconciliationResult,
  NovelDeletionTransaction,
  WorkspaceSaveConflict,
  WorkspaceSaveFeedback,
  WorkspaceSaveOptions,
} from '@/store/novel-store-types'
import { createPersistedNovelStoreSet } from '@/store/novel-store-types'

function collectChapterSubtreeIds(chapters: Chapter[], rootChapterId: string) {
  const collected = new Set<string>([rootChapterId])
  let added = true

  while (added) {
    added = false
    for (const chapter of chapters) {
      if (chapter.parentChapterId && collected.has(chapter.parentChapterId) && !collected.has(chapter.id)) {
        collected.add(chapter.id)
        added = true
      }
    }
  }

  return collected
}

function pickNextAvailableChapter(chapters: Chapter[], preferredNovelId?: string) {
  const sorted = chapters.slice().sort((left, right) => {
    const preferredDiff = Number(right.novelId === preferredNovelId) - Number(left.novelId === preferredNovelId)
    if (preferredDiff !== 0) return preferredDiff

    const mainDiff = Number(Boolean(left.parentChapterId)) - Number(Boolean(right.parentChapterId))
    if (mainDiff !== 0) return mainDiff

    if (left.novelId !== right.novelId) return left.novelId.localeCompare(right.novelId)
    if (left.order !== right.order) return left.order - right.order
    return left.id.localeCompare(right.id)
  })

  return sorted[0] ?? null
}

function buildStateAfterNovelDeletion(state: PersistedNovelState, novelId: string) {
  const remainingChapters = state.localChapters.filter((chapter) => chapter.novelId !== novelId)
  const removedChapters = state.localChapters.filter((chapter) => chapter.novelId === novelId)
  const remainingChapterIds = new Set(remainingChapters.map((chapter) => chapter.id))
  const nextCurrentChapter = state.currentNovelId === novelId
    ? pickNextAvailableChapter(remainingChapters)
    : remainingChapters.find((chapter) => chapter.id === state.currentChapterId) ?? pickNextAvailableChapter(remainingChapters, state.currentNovelId)
  const shouldResetChapterScopedState = !nextCurrentChapter || !remainingChapterIds.has(state.currentChapterId)

  const nextPresetCompatSessionState = removedChapters.reduce(
    (sessionState, chapter) => clearPresetCompatSessionStateForSelection(sessionState, {
      kind: 'chapter',
      chapterId: chapter.id,
    }),
    state.presetCompatSessionState
  )

  return {
    currentNovelId: nextCurrentChapter?.novelId ?? '',
    currentChapterId: nextCurrentChapter?.id ?? '',
    localNovels: state.localNovels.filter((item) => item.id !== novelId),
    localChapters: remainingChapters,
    localOutlines: state.localOutlines.filter((item) => item.novelId !== novelId),
    localCharacters: state.localCharacters.filter((item) => item.novelId !== novelId),
    localCharacterRelations: state.localCharacterRelations.filter((item) => item.novelId !== novelId),
    localWorldEntries: state.localWorldEntries.filter((item) => item.novelId !== novelId),
    localTimelineEvents: state.localTimelineEvents.filter((item) => item.novelId !== novelId),
    rewriteCandidates: shouldResetChapterScopedState ? [] : state.rewriteCandidates,
    rewriteHistory: state.rewriteHistory.filter((item) => remainingChapterIds.has(item.chapterId)),
    trajectories: state.trajectories.filter((item) => remainingChapterIds.has(item.chapterId)),
    selectionText: shouldResetChapterScopedState ? '' : state.selectionText,
    selectedParagraphIndex: shouldResetChapterScopedState ? null : state.selectedParagraphIndex,
    presetCompatSessionState: nextPresetCompatSessionState,
  }
}

function buildStateAfterChapterDeletion(state: PersistedNovelState, chapterId: string) {
  const targetChapter = state.localChapters.find((chapter) => chapter.id === chapterId)
  if (!targetChapter) {
    return state
  }

  const removedChapterIds = collectChapterSubtreeIds(state.localChapters, chapterId)
  const remainingChapters = state.localChapters.filter((chapter) => !removedChapterIds.has(chapter.id))

  if (!remainingChapters.some((chapter) => chapter.novelId === targetChapter.novelId)) {
    return {
      ...state,
      ...buildStateAfterNovelDeletion(state, targetChapter.novelId),
    }
  }

  const remainingChapterIds = new Set(remainingChapters.map((chapter) => chapter.id))
  const currentChapterRemoved = removedChapterIds.has(state.currentChapterId)
  const nextCurrentChapter = currentChapterRemoved
    ? pickNextAvailableChapter(remainingChapters, targetChapter.novelId)
    : remainingChapters.find((chapter) => chapter.id === state.currentChapterId) ?? pickNextAvailableChapter(remainingChapters, state.currentNovelId)

  const nextPresetCompatSessionState = Array.from(removedChapterIds).reduce(
    (sessionState, removedChapterId) => clearPresetCompatSessionStateForSelection(sessionState, {
      kind: 'chapter',
      chapterId: removedChapterId,
    }),
    state.presetCompatSessionState
  )

  return {
    currentNovelId: nextCurrentChapter?.novelId ?? '',
    currentChapterId: nextCurrentChapter?.id ?? '',
    localNovels: state.localNovels,
    localChapters: remainingChapters,
    localOutlines: state.localOutlines.map((item) => item.novelId === targetChapter.novelId
      ? { ...item, relatedChapterIds: item.relatedChapterIds.filter((id) => !removedChapterIds.has(id)) }
      : item),
    localCharacters: state.localCharacters,
    localCharacterRelations: state.localCharacterRelations.map((item) => item.novelId === targetChapter.novelId
      ? { ...item, chapterIds: item.chapterIds.filter((id) => !removedChapterIds.has(id)) }
      : item),
    localWorldEntries: state.localWorldEntries,
    localTimelineEvents: state.localTimelineEvents.map((item) => item.novelId === targetChapter.novelId
      ? { ...item, chapterIds: item.chapterIds.filter((id) => !removedChapterIds.has(id)) }
      : item),
    rewriteCandidates: currentChapterRemoved ? [] : state.rewriteCandidates,
    rewriteHistory: state.rewriteHistory.filter((item) => remainingChapterIds.has(item.chapterId)),
    trajectories: state.trajectories.filter((item) => remainingChapterIds.has(item.chapterId)),
    selectionText: currentChapterRemoved ? '' : state.selectionText,
    selectedParagraphIndex: currentChapterRemoved ? null : state.selectedParagraphIndex,
    presetCompatSessionState: nextPresetCompatSessionState,
  }
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function restoreRemovedRecords<T extends { id: string }>(
  current: T[],
  before: T[],
  optimistic: T[]
) {
  const optimisticIds = new Set(optimistic.map((item) => item.id))
  const removedIds = new Set(before.filter((item) => !optimisticIds.has(item.id)).map((item) => item.id))
  if (!removedIds.size) return current

  const currentById = new Map(current.map((item) => [item.id, item]))
  const beforeIds = new Set(before.map((item) => item.id))
  const restored = before.flatMap((item) => {
    const currentItem = currentById.get(item.id)
    if (currentItem) return [currentItem]
    return removedIds.has(item.id) ? [item] : []
  })

  return [...restored, ...current.filter((item) => !beforeIds.has(item.id))]
}

function restoreRemovedSessionEntries(
  current: PersistedNovelState['presetCompatSessionState'],
  before: PersistedNovelState['presetCompatSessionState'],
  optimistic: PersistedNovelState['presetCompatSessionState']
) {
  const restored = { ...current }
  for (const [key, entry] of Object.entries(before)) {
    if (!(key in optimistic) && !(key in current)) restored[key] = entry
  }
  return restored
}

function mergeAuthoritativeTargetRecords<T extends { id: string }>(
  current: T[],
  before: T[],
  authoritative: T[],
  isTarget: (item: T) => boolean
) {
  const currentById = new Map(current.map((item) => [item.id, item]))
  const beforeIds = new Set(before.map((item) => item.id))
  const authoritativeTarget = authoritative.filter(isTarget)
  const authoritativeTargetById = new Map(authoritativeTarget.map((item) => [item.id, item]))
  const merged = before.flatMap((item) => {
    if (isTarget(item)) {
      const authoritativeItem = authoritativeTargetById.get(item.id)
      return authoritativeItem ? [authoritativeItem] : []
    }

    const currentItem = currentById.get(item.id)
    return currentItem ? [currentItem] : []
  })

  merged.push(...authoritativeTarget.filter((item) => !beforeIds.has(item.id)))
  merged.push(...current.filter((item) => !beforeIds.has(item.id) && !isTarget(item)))
  return merged
}

function mergeAuthoritativeTargetSessionEntries(
  current: PersistedNovelState['presetCompatSessionState'],
  authoritative: PersistedNovelState['presetCompatSessionState'],
  targetChapterIds: Set<string>
) {
  const isTargetKey = (key: string) => Array.from(targetChapterIds).some((chapterId) =>
    key.startsWith(`chapter:${encodeURIComponent(chapterId)}::`)
  )
  const merged = Object.fromEntries(Object.entries(current).filter(([key]) => !isTargetKey(key)))
  for (const [key, entry] of Object.entries(authoritative)) {
    if (isTargetKey(key)) merged[key] = entry
  }
  return merged
}

function buildStateAfterAuthoritativeNovelDeletionReconciliation(
  current: PersistedNovelState,
  authoritative: PersistedNovelState,
  transaction: NovelDeletionTransaction
): { state: PersistedNovelState; result: NovelDeletionReconciliationResult } {
  const selectionUnchanged = current.currentNovelId === transaction.optimistic.currentNovelId
    && current.currentChapterId === transaction.optimistic.currentChapterId
  const selection = selectionUnchanged
    ? {
        currentNovelId: authoritative.currentNovelId,
        currentChapterId: authoritative.currentChapterId,
      }
    : {
        currentNovelId: current.currentNovelId,
        currentChapterId: current.currentChapterId,
      }

  const isTargetNovel = (item: { id: string }) => item.id === transaction.novelId
  const isTargetRecord = (item: { novelId: string }) => item.novelId === transaction.novelId
  const targetChapterIds = new Set([
    ...transaction.before.localChapters.filter(isTargetRecord).map((chapter) => chapter.id),
    ...authoritative.localChapters.filter(isTargetRecord).map((chapter) => chapter.id),
  ])
  const isTargetChapterRecord = (item: { chapterId: string }) => targetChapterIds.has(item.chapterId)

  return {
    state: {
      ...current,
      ...selection,
      localNovels: mergeAuthoritativeTargetRecords(current.localNovels, transaction.before.localNovels, authoritative.localNovels, isTargetNovel),
      localChapters: mergeAuthoritativeTargetRecords(current.localChapters, transaction.before.localChapters, authoritative.localChapters, isTargetRecord),
      localOutlines: mergeAuthoritativeTargetRecords(current.localOutlines, transaction.before.localOutlines, authoritative.localOutlines, isTargetRecord),
      localCharacters: mergeAuthoritativeTargetRecords(current.localCharacters, transaction.before.localCharacters, authoritative.localCharacters, isTargetRecord),
      localCharacterRelations: mergeAuthoritativeTargetRecords(current.localCharacterRelations, transaction.before.localCharacterRelations, authoritative.localCharacterRelations, isTargetRecord),
      localWorldEntries: mergeAuthoritativeTargetRecords(current.localWorldEntries, transaction.before.localWorldEntries, authoritative.localWorldEntries, isTargetRecord),
      localTimelineEvents: mergeAuthoritativeTargetRecords(current.localTimelineEvents, transaction.before.localTimelineEvents, authoritative.localTimelineEvents, isTargetRecord),
      rewriteCandidates: valuesEqual(current.rewriteCandidates, transaction.optimistic.rewriteCandidates)
        ? authoritative.rewriteCandidates
        : current.rewriteCandidates,
      rewriteHistory: mergeAuthoritativeTargetRecords(current.rewriteHistory, transaction.before.rewriteHistory, authoritative.rewriteHistory, isTargetChapterRecord),
      trajectories: mergeAuthoritativeTargetRecords(current.trajectories, transaction.before.trajectories, authoritative.trajectories, isTargetChapterRecord),
      selectionText: valuesEqual(current.selectionText, transaction.optimistic.selectionText)
        ? authoritative.selectionText
        : current.selectionText,
      selectedParagraphIndex: valuesEqual(current.selectedParagraphIndex, transaction.optimistic.selectedParagraphIndex)
        ? authoritative.selectedParagraphIndex
        : current.selectedParagraphIndex,
      presetCompatSessionState: mergeAuthoritativeTargetSessionEntries(current.presetCompatSessionState, authoritative.presetCompatSessionState, targetChapterIds),
    },
    result: 'present',
  }
}

function buildStateAfterRejectedNovelDeletion(
  current: PersistedNovelState,
  transaction: NovelDeletionTransaction
): PersistedNovelState {
  const { before, optimistic } = transaction
  return {
    ...current,
    currentNovelId: valuesEqual(current.currentNovelId, optimistic.currentNovelId) ? before.currentNovelId : current.currentNovelId,
    currentChapterId: valuesEqual(current.currentChapterId, optimistic.currentChapterId) ? before.currentChapterId : current.currentChapterId,
    localNovels: restoreRemovedRecords(current.localNovels, before.localNovels, optimistic.localNovels),
    localChapters: restoreRemovedRecords(current.localChapters, before.localChapters, optimistic.localChapters),
    localOutlines: restoreRemovedRecords(current.localOutlines, before.localOutlines, optimistic.localOutlines),
    localCharacters: restoreRemovedRecords(current.localCharacters, before.localCharacters, optimistic.localCharacters),
    localCharacterRelations: restoreRemovedRecords(current.localCharacterRelations, before.localCharacterRelations, optimistic.localCharacterRelations),
    localWorldEntries: restoreRemovedRecords(current.localWorldEntries, before.localWorldEntries, optimistic.localWorldEntries),
    localTimelineEvents: restoreRemovedRecords(current.localTimelineEvents, before.localTimelineEvents, optimistic.localTimelineEvents),
    rewriteCandidates: valuesEqual(current.rewriteCandidates, optimistic.rewriteCandidates) ? before.rewriteCandidates : current.rewriteCandidates,
    rewriteHistory: restoreRemovedRecords(current.rewriteHistory, before.rewriteHistory, optimistic.rewriteHistory),
    trajectories: restoreRemovedRecords(current.trajectories, before.trajectories, optimistic.trajectories),
    selectionText: valuesEqual(current.selectionText, optimistic.selectionText) ? before.selectionText : current.selectionText,
    selectedParagraphIndex: valuesEqual(current.selectedParagraphIndex, optimistic.selectedParagraphIndex) ? before.selectedParagraphIndex : current.selectedParagraphIndex,
    presetCompatSessionState: restoreRemovedSessionEntries(current.presetCompatSessionState, before.presetCompatSessionState, optimistic.presetCompatSessionState),
  }
}

type NovelStore = PersistedNovelState & {
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
  refreshKnowledgeProjection: (novelId?: string, asOfChapter?: number) => Promise<KnowledgeProjectionResult>

  setAISettings: (settings: AISettings) => void
  saveAISettings: () => Promise<void>
}

const initialState: PersistedNovelState = createEmptyWorkspaceState()

function buildLibrarySummary(state: PersistedNovelState, novelId: string): LibrarySummary | null {
  const chapters = state.localChapters
    .filter((chapter) => chapter.novelId === novelId && !chapter.parentChapterId)
    .slice()
    .sort((left, right) => left.order - right.order)
  const novelMeta = state.localNovels.find((item) => item.id === novelId)
  if (!novelMeta && !chapters.length) return null

  const firstChapterText = chapters[0] ? htmlToPlainText(chapters[0].content).replace(/\s+/g, ' ').trim() : ''
  return {
    id: novelId,
    title: novelMeta?.title ?? chapters[0]?.title?.replace(/^第\s*[0-9一二三四五六七八九十百千零两]+\s*章\s*/, '') ?? tm('store.inferredNovelTitle', { suffix: novelId.slice(-4) }),
    summary: novelMeta?.summary ?? (firstChapterText.slice(0, 120) || tm('store.newNovelSummary')),
    tags: novelMeta?.tags ?? [tm('store.importTag'), tm('store.importTxtTag')],
    updatedAt: chapters[0]?.updatedAt ?? formatNowLabel(),
    wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    chapterCount: chapters.length,
    firstChapterId: chapters[0]?.id ?? null,
  }
}

export const useNovelStore = create<NovelStore>((set, get) => {
  const setPersisted = createPersistedNovelStoreSet(set)
  let chapterIndexSource: Chapter[] | null = null
  let chapterIndexById = new Map<string, number>()

  const getChapterIndex = (chapters: Chapter[], chapterId: string) => {
    if (chapterIndexSource !== chapters) {
      chapterIndexById = new Map(chapters.map((chapter, index) => [chapter.id, index]))
      chapterIndexSource = chapters
    }
    return chapterIndexById.get(chapterId)
  }

  return {
  ...initialState,
  persistRevision: 0,
  workspaceRevision: null,
  revisionNovelId: '',
  lastAcknowledgedPersistedWorkspace: null,
  workspaceSaveConflict: null,
  workspaceSaveFeedback: null,
  isHydrated: false,
  isSaving: false,
  isNovelDeletionPending: false,
  backendLoaded: false,
  backendLoadError: '',
  chapterLoadError: '',
  librarySummaries: [],
  librarySummariesLoaded: false,
  librarySummariesError: '',
  presetCompatLibrary: createDefaultPresetCompatLibrary(),
  presetCompatLibraryDirty: false,
  presetCompatLibraryLoading: false,
  presetCompatLibraryError: '',

  getNovels: () => {
    const state = get()
    if (state.librarySummariesLoaded) {
      return state.librarySummaries
    }

    const novelIds = Array.from(new Set([
      ...state.localNovels.map((novel) => novel.id),
      ...state.localChapters.map((chapter) => chapter.novelId),
    ]))

    return novelIds.flatMap((novelId) => {
      const summary = buildLibrarySummary(state, novelId)
      return summary ? [summary] : []
    })
  },
  importNovelFromText: ({ title, text, summary }) => {
    const state = get()
    const cleanTitle = title.trim() || tm('store.importNovelTitle', { count: state.localNovels.length + 1 })
    const cleanText = text.trim()
    if (!cleanText) return null

    const novelId = uid('novel')
    const chapterRegex = /(第\s*[0-9一二三四五六七八九十百千零两]+\s*章[^\n]*)/g
    const parts = cleanText.split(chapterRegex).map((item) => item.trim()).filter(Boolean)

    const importedChapters: Chapter[] = []

    if (parts.length >= 2) {
      for (let i = 0; i < parts.length; i += 2) {
        const heading = parts[i]
        const body = parts[i + 1] ?? ''
        if (!heading) continue
        const contentText = body.trim() || tm('store.importEmptyChapterBody')
        importedChapters.push({
          id: uid('ch'),
          novelId,
          title: heading,
          order: importedChapters.length + 1,
          content: plainTextToHtml(contentText),
          originalContent: plainTextToHtml(contentText),
          status: 'draft',
          wordCount: countChineseFriendlyWords(contentText),
          updatedAt: tm('store.importUpdatedAt', { time: formatNowLabel() }),
          trajectory: [tm('store.importTrajectory')],
        })
      }
    }

    if (!importedChapters.length) {
      importedChapters.push({
        id: uid('ch'),
        novelId,
        title: tm('store.importFallbackChapterTitle'),
        order: 1,
        content: plainTextToHtml(cleanText),
        originalContent: plainTextToHtml(cleanText),
        status: 'draft',
        wordCount: countChineseFriendlyWords(cleanText),
        updatedAt: tm('store.importUpdatedAt', { time: formatNowLabel() }),
        trajectory: [tm('store.importTrajectory')],
      })
    }

    setPersisted(() => ({
      currentNovelId: novelId,
      currentChapterId: importedChapters[0].id,
      currentTab: 'editor',
      localNovels: [
        ...state.localNovels,
        {
          id: novelId,
          title: cleanTitle,
          summary: summary?.trim() || tm('store.importNovelSummary', { count: importedChapters.length }),
          tags: [tm('store.importTag'), tm('store.importTxtTag')],
        },
      ],
      localChapters: [...state.localChapters, ...importedChapters],
      trajectories: [
        {
          id: uid('traj'),
          chapterId: importedChapters[0].id,
          type: 'note',
          title: tm('store.importTrajectoryTitle', { title: cleanTitle }),
          detail: summary?.trim() || tm('store.importTrajectoryDetail', { count: importedChapters.length }),
          createdAt: formatNowLabel(),
        },
        ...state.trajectories,
      ],
    }))

    return novelId
  },
  setHydrated: (value) => set({ isHydrated: value }),
  setCurrentNovelId: (id) => set((state) => {
    const chapters = state.localChapters
      .filter((chapter) => chapter.novelId === id)
      .slice()
      .sort((left, right) => Number(Boolean(left.parentChapterId)) - Number(Boolean(right.parentChapterId)) || left.order - right.order || left.id.localeCompare(right.id))
    const currentChapterBelongsToNovel = chapters.some((chapter) => chapter.id === state.currentChapterId)
    const rememberedChapterId = readBrowserWorkspaceSession().currentChapterIds[id]
    const rememberedChapter = chapters.find((chapter) => chapter.id === rememberedChapterId)
    return {
      currentNovelId: id,
      ...(state.currentNovelId !== id ? { backendLoaded: false, workspaceRevision: null, revisionNovelId: '', lastAcknowledgedPersistedWorkspace: null } : {}),
      currentChapterId: currentChapterBelongsToNovel
        ? state.currentChapterId
        : rememberedChapter?.id ?? chapters[0]?.id ?? '',
    }
  }),
  setCurrentChapterId: (id) => set((state) => state.currentChapterId === id ? state : { currentChapterId: id, chapterLoadError: '' }),
  setCurrentTab: (tab) => set((state) => state.currentTab === tab ? state : { currentTab: tab }),
  setHelperTab: (tab) => set((state) => state.helperTab === tab ? state : { helperTab: tab }),
  updateChapterContent: (id, html, wordCount) =>
    setPersisted((state) => {
      const chapterIndex = getChapterIndex(state.localChapters, id)
      if (chapterIndex === undefined) return state
      const chapter = state.localChapters[chapterIndex]
      if (chapter?.contentLoaded === false) throw new Error('Load this chapter before editing it')
      if (!chapter || chapter.content === html) return state
      const nextChapters = state.localChapters.slice()
      nextChapters[chapterIndex] = {
        ...chapter,
        content: html,
        wordCount: wordCount ?? countChineseFriendlyWords(htmlToPlainText(html)),
        updatedAt: tm('store.editedUpdatedAt', { time: formatNowLabel() }),
      }
      return {
        localChapters: nextChapters,
      }
    }),
  reorderChapters: (novelId, orderedIds) =>
    setPersisted((state) => {
      const targetMap = new Map(orderedIds.map((id, index) => [id, index + 1]))
      return {
        localChapters: state.localChapters.map((chapter) =>
          chapter.novelId === novelId && !chapter.parentChapterId && targetMap.has(chapter.id)
            ? { ...chapter, order: targetMap.get(chapter.id)! }
            : chapter
        ),
      }
    }),
  setRewriteMode: (mode) => setPersisted((state) => state.rewriteMode === mode ? state : { rewriteMode: mode }),
  setRewriteTone: (tone) => setPersisted((state) => state.rewriteTone === tone ? state : { rewriteTone: tone }),
  setRewriteOutput: (output) => setPersisted((state) => state.rewriteOutput === output ? state : { rewriteOutput: output }),
  setRewriteScope: (scope) => setPersisted((state) => state.rewriteScope === scope ? state : { rewriteScope: scope }),
  setThinkingLevel: (level) => setPersisted((state) => state.thinkingLevel === level ? state : { thinkingLevel: level }),
  toggleAutoContinue: () => setPersisted((state) => ({ autoContinue: !state.autoContinue })),
  toggleKeepCanon: () => setPersisted((state) => ({ keepCanon: !state.keepCanon })),
  setSelectionText: (text) => setPersisted((state) => state.selectionText === text ? state : { selectionText: text }),
  setSelectedParagraphIndex: (index) => setPersisted((state) => state.selectedParagraphIndex === index ? state : { selectedParagraphIndex: index }),
  setPromptText: (text) => setPersisted((state) => state.promptText === text ? state : { promptText: text }),
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  addCharacter: (novelId, fields) =>
    setPersisted((state) => ({
      localCharacters: [...state.localCharacters, { ...fields, id: uid('char'), novelId }],
    })),
  updateCharacter: (id, fields) =>
    setPersisted((state) => ({
      localCharacters: state.localCharacters.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteCharacter: (id) =>
    setPersisted((state) => ({
      localCharacters: state.localCharacters.filter((item) => item.id !== id),
    })),
  addOutlineItem: (novelId, { relatedChapterIds, ...fields }) =>
    setPersisted((state) => ({
      localOutlines: [...state.localOutlines, { ...fields, relatedChapterIds: relatedChapterIds ?? [], id: uid('outline'), novelId }],
    })),
  updateOutlineItem: (id, fields) =>
    setPersisted((state) => ({
      localOutlines: state.localOutlines.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteOutlineItem: (id) =>
    setPersisted((state) => ({
      localOutlines: state.localOutlines.filter((item) => item.id !== id),
    })),
  addCharacterRelation: (novelId, fields) =>
    setPersisted((state) => ({
      localCharacterRelations: [...state.localCharacterRelations, { ...fields, id: uid('rel'), novelId }],
    })),
  updateCharacterRelation: (id, fields) =>
    setPersisted((state) => ({
      localCharacterRelations: state.localCharacterRelations.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteCharacterRelation: (id) =>
    setPersisted((state) => ({
      localCharacterRelations: state.localCharacterRelations.filter((item) => item.id !== id),
    })),
  addWorldEntry: (novelId, fields) =>
    setPersisted((state) => ({
      localWorldEntries: [...state.localWorldEntries, { ...fields, id: uid('wld'), novelId }],
    })),
  updateWorldEntry: (id, fields) =>
    setPersisted((state) => ({
      localWorldEntries: state.localWorldEntries.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteWorldEntry: (id) =>
    setPersisted((state) => ({
      localWorldEntries: state.localWorldEntries.filter((item) => item.id !== id),
    })),
  addTimelineEvent: (novelId, fields) =>
    setPersisted((state) => ({
      localTimelineEvents: [...state.localTimelineEvents, { ...fields, id: uid('timeline'), novelId }],
    })),
  updateTimelineEvent: (id, fields) =>
    setPersisted((state) => ({
      localTimelineEvents: state.localTimelineEvents.map((item) => (item.id === id ? { ...item, ...fields } : item)),
    })),
  deleteTimelineEvent: (id) =>
    setPersisted((state) => ({
      localTimelineEvents: state.localTimelineEvents.filter((item) => item.id !== id),
    })),
  deleteChapter: (chapterId) =>
    setPersisted((state) => buildStateAfterChapterDeletion(state, chapterId)),
  deleteNovel: (novelId) => {
    setPersisted((state) => ({
      ...buildStateAfterNovelDeletion(state, novelId),
      librarySummaries: state.librarySummaries.filter((summary) => summary.id !== novelId),
    }))
    removeBrowserWorkspaceNovelSession(novelId)
  },
  beginNovelDeletion: (novelId) => {
    let transaction: NovelDeletionTransaction | null = null
    setPersisted((state) => {
      const before = serializeState(state)
      const summary = state.librarySummaries.find((item) => item.id === novelId) ?? null
      if (!summary && !before.localNovels.some((item) => item.id === novelId) && !before.localChapters.some((item) => item.novelId === novelId)) {
        return state
      }
      const optimistic = {
        ...before,
        ...buildStateAfterNovelDeletion(before, novelId),
      }
      transaction = { novelId, before, optimistic, summary }
      return {
        ...optimistic,
        librarySummaries: state.librarySummaries.filter((summary) => summary.id !== novelId),
      }
    })
    return transaction
  },
  rollbackNovelDeletion: (transaction) => set((state) => {
    const restored = buildStateAfterRejectedNovelDeletion(serializeState(state), transaction)
    const restoredSummary = buildLibrarySummary(restored, transaction.novelId) ?? transaction.summary
    return {
      ...restored,
      librarySummaries: restoredSummary
        ? [...state.librarySummaries.filter((summary) => summary.id !== transaction.novelId), restoredSummary]
        : state.librarySummaries,
    }
  }),
  reconcileNovelDeletionFromBackend: async (transaction) => {
    try {
      const status = await pollNovelDeletionStatus(transaction.novelId)
      if (status.deletionState === 'deleted') {
        removeBrowserWorkspaceNovelSession(transaction.novelId)
        return 'deleted'
      }

      const authoritative = await fetchAuthoritativeWorkspace(transaction.novelId)
      let result: NovelDeletionReconciliationResult = 'present'
      set((state) => {
        const reconciliation = buildStateAfterAuthoritativeNovelDeletionReconciliation(
          serializeState(state),
          authoritative,
          transaction
        )
        const restoredSummary = buildLibrarySummary(reconciliation.state, transaction.novelId) ?? transaction.summary
        result = reconciliation.result
        return {
          ...reconciliation.state,
          librarySummaries: restoredSummary
            ? [...state.librarySummaries.filter((summary) => summary.id !== transaction.novelId), restoredSummary]
            : state.librarySummaries,
        }
      })
      return result
    } catch (error) {
      const restoredSummary = transaction.summary
      if (restoredSummary) {
        set((state) => ({
          librarySummaries: [
            ...state.librarySummaries.filter((summary) => summary.id !== transaction.novelId),
            restoredSummary,
          ],
        }))
      }
      throw error
    }
  },
  snapshotPersistedState: () => serializeState(get()),
  restorePersistedState: (snapshot) => set((state) => ({
    ...snapshot,
    ...(state.currentNovelId !== snapshot.currentNovelId ? { workspaceRevision: null, revisionNovelId: '', lastAcknowledgedPersistedWorkspace: null, backendLoaded: false } : {}),
    workspaceSaveConflict: null,
    workspaceSaveFeedback: null,
  })),
  setNovelDeletionPending: (pending) => set({ isNovelDeletionPending: pending }),
  reconcileNovelDeletion: (nextNovelId) => set((state) => {
    if (nextNovelId === null) {
      return {
        currentNovelId: '',
        currentChapterId: '',
      }
    }

    const activeChapter = state.currentNovelId === nextNovelId
      ? state.localChapters.find((chapter) => chapter.id === state.currentChapterId && chapter.novelId === nextNovelId)
      : null
    const nextChapter = activeChapter ?? pickNextAvailableChapter(
      state.localChapters.filter((chapter) => chapter.novelId === nextNovelId),
      nextNovelId
    )

    const nextState = {
      currentNovelId: nextChapter?.novelId ?? nextNovelId,
      currentChapterId: nextChapter?.id ?? '',
    }
    // The library may reconcile to a survivor that is not loaded in the
    // single-novel workspace store. Persist that explicit selection so the
    // next workspace restore opens the survivor instead of losing it.
    const session = readBrowserWorkspaceSession()
    writeBrowserWorkspaceSession({ ...session, currentNovelId: nextState.currentNovelId })
    return nextState
  }),
  ...createKnowledgeActions(set, setPersisted, get),
  ...createAISettingsActions(set, get),
  selectRewriteCandidate: (id) =>
    setPersisted((state) => ({
      rewriteCandidates: state.rewriteCandidates.map((item) => ({ ...item, selected: item.id === id })),
    })),
  applyRewriteCandidate: (id) =>
    setPersisted((state) => {
      const candidate = state.rewriteCandidates.find((item) => item.id === id)
      const chapter = state.localChapters.find((item) => item.id === state.currentChapterId)
      if (chapter?.contentLoaded === false) throw new Error('Load this chapter before applying a rewrite')
      if (!candidate || !chapter) return state
      return {
        currentTab: 'editor',
        trajectories: [
           { id: uid('traj'), chapterId: chapter.id, type: 'apply', title: tm('store.applyTrajectoryTitle', { title: candidate.title }), detail: state.rewriteScope === 'chapter' ? tm('store.applyTrajectoryDetailChapter') : tm('store.applyTrajectoryDetailSelection'), createdAt: formatNowLabel() },
          ...state.trajectories,
        ],
        localChapters: state.localChapters.map((item) =>
          item.id === chapter.id
            ? { ...item, originalContent: item.originalContent ?? item.content, content: plainTextToHtml(candidate.content), wordCount: countChineseFriendlyWords(candidate.content), updatedAt: tm('store.appliedRewriteUpdatedAt', { time: formatNowLabel() }) }
            : item
        ),
        rewriteCandidates: state.rewriteCandidates.map((item) => ({ ...item, selected: item.id === id })),
      }
    }),
  insertRewriteCandidate: (id) =>
    setPersisted((state) => {
      const candidate = state.rewriteCandidates.find((item) => item.id === id)
      const chapter = state.localChapters.find((item) => item.id === state.currentChapterId)
      if (chapter?.contentLoaded === false) throw new Error('Load this chapter before inserting a rewrite')
      if (!candidate || !chapter) return state
      const nextText = `${htmlToPlainText(chapter.content)}\n\n${candidate.content}`
      return {
        currentTab: 'editor',
        trajectories: [
           { id: uid('traj'), chapterId: chapter.id, type: 'insert', title: tm('store.insertTrajectoryTitle', { title: candidate.title }), detail: tm('store.insertTrajectoryDetail'), createdAt: formatNowLabel() },
          ...state.trajectories,
        ],
        localChapters: state.localChapters.map((item) =>
          item.id === chapter.id ? { ...item, content: plainTextToHtml(nextText), wordCount: countChineseFriendlyWords(nextText), updatedAt: tm('store.insertedCandidateUpdatedAt', { time: formatNowLabel() }) } : item
        ),
      }
    }),
  branchRewriteCandidate: (id) => {
    const state = get()
    const candidate = state.rewriteCandidates.find((item) => item.id === id)
    if (!candidate) return
    get().addChapterBranch(state.currentChapterId, tm('store.branchSuffix', { title: candidate.title }), candidate.content)
  },
  continueRewriteCandidate: (id) =>
    setPersisted((state) => {
      const candidate = state.rewriteCandidates.find((item) => item.id === id)
      const chapter = state.localChapters.find((item) => item.id === state.currentChapterId)
      if (!candidate || !chapter) return state
      const continued: RewriteCandidate = { ...candidate, id: uid('cand-cont'), title: tm('store.continueTitle', { title: candidate.title }), summary: tm('store.continueSummary'), content: `${candidate.content}\n\n${tm('store.continueSampleEnding')}`, createdAt: formatNowLabel(), selected: true }
      return {
        rewriteCandidates: [continued, ...state.rewriteCandidates.map((item) => ({ ...item, selected: item.id === continued.id }))],
        trajectories: [
          { id: uid('traj'), chapterId: chapter.id, type: 'continue', title: tm('store.continueTrajectoryTitle', { title: candidate.title }), detail: tm('store.continueTrajectoryDetail'), createdAt: formatNowLabel() },
          ...state.trajectories,
        ],
      }
    }),
  addPreset: () => setPersisted((state) => {
    const preset: RewritePreset = { id: uid('preset'), name: tm('store.customPresetName', { count: state.presets.length + 1 }), mode: state.rewriteMode, tone: state.rewriteTone, prompt: state.promptText }
    return { presets: [preset, ...state.presets], selectedPresetId: preset.id }
  }),
  selectPreset: (id) => setPersisted((state) => {
    const preset = state.presets.find((item) => item.id === id)
    if (!preset) return state
    return { selectedPresetId: id, rewriteMode: preset.mode, rewriteTone: preset.tone, promptText: preset.prompt }
  }),
  updatePresetPrompt: (id, prompt) => setPersisted((state) => ({ presets: state.presets.map((preset) => (preset.id === id ? { ...preset, prompt } : preset)) })),
  updatePresetName: (id, name) => setPersisted((state) => ({ presets: state.presets.map((preset) => (preset.id === id ? { ...preset, name } : preset)) })),
  toggleConstraint: (id) => setPersisted((state) => ({ constraints: state.constraints.map((constraint) => constraint.id === id ? { ...constraint, enabled: !constraint.enabled } : constraint) })),
  cycleConstraintStrength: (id) => setPersisted((state) => ({ constraints: state.constraints.map((constraint) => {
    if (constraint.id !== id) return constraint
    const next: Record<RewriteConstraint['strength'], RewriteConstraint['strength']> = { off: 'soft', soft: 'strict', strict: 'off' }
    return { ...constraint, strength: next[constraint.strength] }
  }) })),
  ...createRewriteActions(setPersisted, get),
  addChapterBranch: (sourceChapterId, title, content) => setPersisted((state) => {
    const sourceChapter = state.localChapters.find((chapter) => chapter.id === sourceChapterId)
    if (sourceChapter?.contentLoaded === false) throw new Error('Load this chapter before creating a branch')
    if (!sourceChapter) return state
    const branchId = uid('branch')
    const branchNumber = state.localChapters.filter((chapter) => chapter.parentChapterId === sourceChapterId).length + 1
    const nextText = content ?? htmlToPlainText(sourceChapter.content)
    const nextChapter: Chapter = { ...sourceChapter, id: branchId, title: title ?? tm('store.branchTitleFallback', { title: sourceChapter.title, count: branchNumber }), content: plainTextToHtml(nextText), originalContent: sourceChapter.content, kind: 'branch', parentChapterId: sourceChapterId, branchLabel: `B${branchNumber}`, order: sourceChapter.order + branchNumber / 10, status: 'draft', updatedAt: tm('store.branchUpdatedAt', { time: formatNowLabel() }), wordCount: countChineseFriendlyWords(nextText), trajectory: [...(sourceChapter.trajectory ?? []), tm('store.branchTrajectory')] }
    return { currentChapterId: branchId, currentTab: 'editor', localChapters: [...state.localChapters, nextChapter], trajectories: [{ id: uid('traj'), chapterId: branchId, type: 'branch', title: tm('store.branchCreateTitle', { label: nextChapter.branchLabel ?? `B${branchNumber}` }), detail: tm('store.branchCreateDetail', { title: sourceChapter.title }), createdAt: formatNowLabel() }, ...state.trajectories] }
  }),
  createNewChapter: () => setPersisted((state) => {
    if (!state.currentNovelId) return state
    const mainlineChapters = state.localChapters.filter((chapter) => chapter.novelId === state.currentNovelId && !chapter.parentChapterId)
    const nextChapter: Chapter = { id: uid('ch'), novelId: state.currentNovelId, title: tm('store.newChapterTitle', { count: mainlineChapters.length + 1 }), order: mainlineChapters.length + 1, content: tm('store.newChapterBody'), originalContent: tm('store.newChapterBody'), status: 'draft', wordCount: 10, updatedAt: tm('store.newChapterUpdatedAt', { time: formatNowLabel() }), trajectory: [tm('store.newChapterTrajectory')] }
    return { currentChapterId: nextChapter.id, currentTab: 'editor', localChapters: [...state.localChapters, nextChapter] }
  }),
  exportWorkspace: async () => {
    const state = get()
    const snapshot = serializeState(state)
    if (!snapshot.localChapters.some((chapter) => chapter.contentLoaded === false)) return JSON.stringify(snapshot, null, 2)
    const full = await fetchAuthoritativeWorkspace(state.currentNovelId, state.workspaceRevision)
    // Export merges only missing text; unsaved local edits remain in the export.
    const chapters = new Map(full.localChapters.map((chapter) => [chapter.id, chapter]))
    return JSON.stringify({
      ...snapshot,
      localChapters: snapshot.localChapters.map((chapter) => {
        if (chapter.contentLoaded !== false) return chapter
        const stored = chapters.get(chapter.id)
        if (!stored) throw new Error('A chapter was deleted on the server. Reopen the novel before exporting.')
        const loaded = { ...chapter, content: stored.content, originalContent: stored.originalContent }
        delete loaded.contentLoaded
        return loaded
      }),
    }, null, 2)
  },
  importWorkspace: (payload) => setPersisted((state) => normalizeWorkspaceState({
    ...serializeState(state),
    ...payload,
  })),
  resetWorkspace: () => {
    setPersisted((state) => ({
      ...initialState,
      workspaceSaveConflict: null,
      workspaceSaveFeedback: null,
      presetCompatLibrary: state.presetCompatLibrary,
      presetCompatLibraryLoading: state.presetCompatLibraryLoading,
      presetCompatLibraryError: state.presetCompatLibraryError,
    }))
    set({
      currentNovelId: '',
      currentChapterId: '',
      currentTab: initialState.currentTab,
      helperTab: initialState.helperTab,
      focusMode: initialState.focusMode,
    })
  },
  setPresetCompatSessionPhase: (selection, surfaceId, phase, resetPending = false) => set((state) => {
    const presetCompatSessionState = setPresetCompatSessionEntry(
      state.presetCompatSessionState,
      selection,
      surfaceId,
      phase,
      resetPending
    )
    return presetCompatSessionState === state.presetCompatSessionState
      ? state
      : { presetCompatSessionState }
  }),
  clearPresetCompatSessionStateForSelection: (selection) => set((state) => {
    const presetCompatSessionState = clearPresetCompatSessionStateForSelection(state.presetCompatSessionState, selection)
    return presetCompatSessionState === state.presetCompatSessionState
      ? state
      : { presetCompatSessionState }
  }),
  resetPresetCompatSessionStateForSelection: (selection, surfaceIds, phase = 'new_chat') => set((state) => {
    const presetCompatSessionState = resetPresetCompatSessionStateForSelection(
      state.presetCompatSessionState,
      selection,
      surfaceIds,
      phase
    )
    return presetCompatSessionState === state.presetCompatSessionState
      ? state
      : { presetCompatSessionState }
  }),
  ...createPersistenceActions(set, get),
  bindPresetCompatPresetToSurface: (surfaceId, presetId) => set((state) => {
    const binding = state.presetCompatLibrary.surfaceBindings[surfaceId]
    if (!binding) {
      return state
    }

    if (presetId !== null && !state.presetCompatLibrary.presets[presetId]) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        surfaceBindings: {
          ...state.presetCompatLibrary.surfaceBindings,
          [surfaceId]: {
            ...binding,
            presetId,
            enabled: presetId === null ? binding.enabled : true,
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  bindPresetCompatPresetToNovel: (novelId, presetId) => set((state) => {
    if (!novelId.trim()) return state
    if (presetId !== null && !state.presetCompatLibrary.presets[presetId]) {
      return { presetCompatLibraryError: 'preset_not_found' }
    }
    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        novelRewritePresetIds: { ...state.presetCompatLibrary.novelRewritePresetIds, [novelId]: presetId },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  deletePresetCompatPreset: (presetId) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    const nextPresets = { ...state.presetCompatLibrary.presets }
    delete nextPresets[presetId]

    const nextSurfaceBindings = Object.fromEntries(
      Object.entries(state.presetCompatLibrary.surfaceBindings).map(([surfaceId, binding]) => [
        surfaceId,
        binding.presetId === presetId
          ? {
              ...binding,
              presetId: null,
              enabled: false,
            }
          : binding,
      ])
    ) as typeof state.presetCompatLibrary.surfaceBindings

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: nextPresets,
        surfaceBindings: nextSurfaceBindings,
        novelRewritePresetIds: Object.fromEntries(Object.entries(state.presetCompatLibrary.novelRewritePresetIds ?? {}).map(([novelId, id]) => [novelId, id === presetId ? null : id])),
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  attachPresetCompatStandaloneRegex: (presetId, regexId) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    const regexRecord = state.presetCompatLibrary.standaloneRegexes[regexId]
    if (!preset || !regexRecord) {
      return {
        presetCompatLibraryError: !preset ? 'preset_not_found' : 'standalone_regex_not_found',
      }
    }

    if (preset.attachedStandaloneRegexIds.includes(regexId)) {
      return {
        presetCompatLibraryError: '',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            attachedStandaloneRegexIds: [...preset.attachedStandaloneRegexIds, regexId],
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  detachPresetCompatStandaloneRegex: (presetId, regexId) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            attachedStandaloneRegexIds: preset.attachedStandaloneRegexIds.filter((id) => id !== regexId),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatPromptRule: (presetId, promptRuleId, updates) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            promptRules: preset.promptRules.map((promptRule) =>
              promptRule.id === promptRuleId ? { ...promptRule, ...updates } : promptRule
            ),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatEmbeddedRegex: (presetId, regexId, updates) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            embeddedRegexes: preset.embeddedRegexes.map((regexRecord) =>
              regexRecord.id === regexId ? { ...regexRecord, ...updates } : regexRecord
            ),
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatRuntimeSampler: (presetId, updates) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            runtimeSampler: {
              ...preset.runtimeSampler,
              ...updates,
            },
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatTransport: (presetId, updates) => set((state) => {
    const preset = state.presetCompatLibrary.presets[presetId]
    if (!preset) {
      return {
        presetCompatLibraryError: 'preset_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        presets: {
          ...state.presetCompatLibrary.presets,
          [presetId]: {
            ...preset,
            transport: {
              ...preset.transport,
              ...updates,
            },
            updatedAt: new Date().toISOString(),
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatStandaloneRegex: (regexId, updates) => set((state) => {
    const regexRecord = state.presetCompatLibrary.standaloneRegexes[regexId]
    if (!regexRecord) {
      return {
        presetCompatLibraryError: 'standalone_regex_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        standaloneRegexes: {
          ...state.presetCompatLibrary.standaloneRegexes,
          [regexId]: {
            ...regexRecord,
            ...updates,
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  updatePresetCompatBuiltinSystemPrompt: (surfaceId, updates) => set((state) => {
    const rule = state.presetCompatLibrary.builtinSystemPrompts[surfaceId]
    if (!rule) {
      return {
        presetCompatLibraryError: 'builtin_system_prompt_not_found',
      }
    }

    return {
      presetCompatLibrary: {
        ...state.presetCompatLibrary,
        builtinSystemPrompts: {
          ...state.presetCompatLibrary.builtinSystemPrompts,
          [surfaceId]: {
            ...rule,
            ...updates,
            surfaceId,
          },
        },
      },
      presetCompatLibraryDirty: true,
      presetCompatLibraryError: '',
    }
  }),
  exportPresetCompatPreset: (presetId) => {
    const preset = get().presetCompatLibrary.presets[presetId]
    return preset ? exportPresetCompatPresetJson(get().presetCompatLibrary, presetId) : null
  },
  exportPresetCompatStandaloneRegexBundle: (regexIds) => exportPresetCompatStandaloneRegexJson(get().presetCompatLibrary, regexIds),
  }
})

useNovelStore.subscribe((state, previous) => {
  if (
    state.currentNovelId === previous.currentNovelId
    && state.currentChapterId === previous.currentChapterId
    && state.currentTab === previous.currentTab
    && state.helperTab === previous.helperTab
    && state.focusMode === previous.focusMode
    && state.presetCompatSessionState === previous.presetCompatSessionState
    && state.localNovels === previous.localNovels
  ) return

  // Library hydration has no workspace yet. Do not replace saved preferences
  // with defaults or pair the new novel with the previous novel's chapter.
  const currentNovelLoaded = state.localNovels.some((novel) => novel.id === state.currentNovelId)
    || state.localChapters.some((chapter) => chapter.novelId === state.currentNovelId)
  if (state.currentNovelId && !currentNovelLoaded) return

  const stored = readBrowserWorkspaceSession()
  // Only one novel is loaded at a time; unloaded novels still own their bookmarks.
  // Confirmed novel deletion removes its session explicitly.
  const currentChapterIds = { ...stored.currentChapterIds }
  if (state.localChapters.some((chapter) => chapter.id === state.currentChapterId && chapter.novelId === state.currentNovelId)) {
    currentChapterIds[state.currentNovelId] = state.currentChapterId
  }
  const presetCompatSessionStates = { ...stored.presetCompatSessionStates }
  if (currentNovelLoaded) {
    presetCompatSessionStates[state.currentNovelId] = state.presetCompatSessionState
  }

  writeBrowserWorkspaceSession({
    currentNovelId: state.currentNovelId,
    currentChapterIds,
    currentTab: state.currentTab,
    helperTab: state.helperTab,
    focusMode: state.focusMode,
    presetCompatSessionStates,
  })
})

"use client"

import { useEffect, useEffectEvent, useRef, type ReactNode, type SetStateAction } from 'react'
import { useNovelStore } from '@/store/novel-store'
import type { GraphEdgeEditDraft, GenerationContextBuildData, GraphReviewControls } from '@/components/graph/types'
import { WorkspaceKnowledgeControls } from '@/components/workspace/WorkspaceKnowledgeControls'
import { WorkspaceSelectionActions } from '@/components/workspace/WorkspaceSelectionActions'
import type { SelectionNovelStudioCoreState } from '@/components/workspace/use-selection-novel-studio-core'
import {
  AI_SCENARIO_META,
  buildContinueBlockLineageRequestContext,
  callAbortRecoverableRewriteJobApi,
  callCreateContinueBlockApi,
  callCreateRecoverableRewriteJobApi,
  callCreateRoleplaySessionApi,
  callCreateWhatIfSessionApi,
  callDeleteStoryTimelineNodeApi,
  callGenerationContextApi,
  callGetRecoverableRewriteJobApi,
  callGraphEdgeConfirmApi,
  callGraphEdgeEditApi,
  callGraphEdgeRejectApi,
  callGraphSubgraphApi,
  callRegenerateContinueBlockApi,
  createOptimisticContinueBlockTimelineNode,
  DEFAULT_GRAPH_REVIEW_CONTROLS,
  DEFAULT_REWRITE_PROMPT,
  removeDeletedStoryTimelineNode,
  resolveChapterListTargetForAnchorVisibility,
  resolveContinueBlockSelectionAfterSave,
  resolveGraphSelection,
  resolveKnowledgeRebuildFailureMessage,
  type RecoverableRewriteJob,
  type OllamaModelOption,
  type OpenAICompatibleModelOption,
  toContinueBranchSelection,
  toGenerationContextOperationType,
  toPresetCompatSessionSurfaceId,
  upsertOptimisticContinueBlockTimelineNode,
  type FutureMapLaunchState,
} from '@/components/workspace/selection-novel-studio-helpers'
import {
  resolveBranchTimelineSelection,
  resolveSelectionAfterDeletedBranchNode,
  toChapterTimelineSelection,
} from '@/components/workspace/workspace-selection'
import type { AIScenarioKey, AISettings, Chapter } from '@/lib/types'
import { useI18n } from '@/lib/i18n/provider'
import { plainTextToHtml } from '@/lib/utils'
import type { FutureJumpMutationResponse, StoryTimelineBranchNode, WhatIfSessionDetail } from '@/lib/story-branch-types'
import type { FutureJumpContinueContext } from '@/components/future-jump/FutureJumpView'
import type { WorkspaceActionMode } from '@/components/workspace/use-workspace-chapter-selection'
import type { NovelStore } from '@/store/novel-store-types'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import { writeTextToClipboard } from '@/lib/browser-clipboard'
import {
  createWritingSkillRuntimeSeed,
  isWritingSkillPromptBlockId,
  normalizeWritingSkillCardIds,
  readWritingSkillCardIdFromPromptBlockId,
} from '@/lib/writing-skill-selection'

type ViewModelState = {
  activeWorkspaceSelection: ReturnType<typeof toChapterTimelineSelection> | Exclude<SelectionNovelStudioCoreState['workspaceSelection'], null>
  selectedTimelineNode: StoryTimelineBranchNode | null
  selectedContinueBlockNode: StoryTimelineBranchNode | null
  selectedContinueBlockFutureMapLaunch: FutureMapLaunchState | null
  selectedTimelineDisplayLabel: string
  selectedTimelineInstructionText: string
}

type Params = {
  core: SelectionNovelStudioCoreState
  viewModel: ViewModelState
  loadFromBackend: () => Promise<unknown>
  saveToBackend: () => Promise<unknown>
  deleteNovelFromBackend: NovelStore['deleteNovelFromBackend']
  reconcileNovelDeletionFromBackend: NovelStore['reconcileNovelDeletionFromBackend']
  isNovelDeletionPending: boolean
  beginNovelDeletion: NovelStore['beginNovelDeletion']
  rollbackNovelDeletion: NovelStore['rollbackNovelDeletion']
  setNovelDeletionPending: NovelStore['setNovelDeletionPending']
  reconcileNovelDeletion: NovelStore['reconcileNovelDeletion']
  localChapters: Chapter[]
  deleteChapter: (chapterId: string) => void
  deleteNovel: (novelId: string) => void
  saveAISettings: () => Promise<unknown>
  savePresetCompatLibrary: () => Promise<unknown>
  rebuildStoryKnowledge: NovelStore['rebuildStoryKnowledge']
  rebuildStoryRetrievalIndex: NovelStore['rebuildStoryRetrievalIndex']
  pauseStoryKnowledgeRebuild: NovelStore['pauseStoryKnowledgeRebuild']
  abortStoryKnowledgeRebuild: NovelStore['abortStoryKnowledgeRebuild']
  deleteStoryKnowledgeGraph: NovelStore['deleteStoryKnowledgeGraph']
  deleteStoryHanlpCache: NovelStore['deleteStoryHanlpCache']
  deleteStoryExtractionCache: NovelStore['deleteStoryExtractionCache']
  deleteStoryEmbeddingCache: NovelStore['deleteStoryEmbeddingCache']
  setPresetCompatSessionPhase: NovelStore['setPresetCompatSessionPhase']
  setCurrentChapterId: (chapterId: string) => void
  updateChapterContent: (chapterId: string, content: string) => void
}

export function useSelectionNovelStudioActions({ core, viewModel, loadFromBackend, saveToBackend, deleteNovelFromBackend, reconcileNovelDeletionFromBackend, isNovelDeletionPending, beginNovelDeletion, rollbackNovelDeletion, setNovelDeletionPending, reconcileNovelDeletion, localChapters, deleteChapter, deleteNovel, saveAISettings, savePresetCompatLibrary, rebuildStoryKnowledge, rebuildStoryRetrievalIndex, pauseStoryKnowledgeRebuild, abortStoryKnowledgeRebuild, deleteStoryKnowledgeGraph, deleteStoryHanlpCache, deleteStoryExtractionCache, deleteStoryEmbeddingCache, setPresetCompatSessionPhase, setCurrentChapterId, updateChapterContent }: Params) {
  const { locale, t } = useI18n()
  const { activeWorkspaceSelection, selectedTimelineNode, selectedContinueBlockNode, selectedContinueBlockFutureMapLaunch, selectedTimelineDisplayLabel, selectedTimelineInstructionText } = viewModel
  const ollamaModelRequestControllersRef = useRef<Record<AIScenarioKey, AbortController | null>>({ rewrite: null, knowledgeExtraction: null, embeddings: null })
  const openAICompatibleModelRequestControllersRef = useRef<Record<AIScenarioKey, AbortController | null>>({ rewrite: null, knowledgeExtraction: null, embeddings: null })
  const novelDeletionInFlightRef = useRef(false)
  const whatIfCreateInFlightRef = useRef(false)
  const authoredHistoryContextRef = useRef<ReturnType<typeof buildContinueBlockLineageRequestContext>>({})
  const rewriteCreateRequestSequenceRef = useRef(0)
  const contextPreviewInputsKeyRef = useRef<string | null>(null)
  const contextPreviewRequestSequenceRef = useRef(0)
  const contextPreviewPromiseRef = useRef<Promise<GenerationContextBuildData | null> | null>(null)
  const rewritePollInFlightRef = useRef<Promise<void> | null>(null)
  const recoverableRestoreAbortControllerRef = useRef<AbortController | null>(null)
  const recoverablePollAbortControllerRef = useRef<AbortController | null>(null)
  const currentNovelId = core.currentNovelId
  const currentBranchId = core.storyTimelineBranchId
  const currentChapterId = core.currentChapter?.id ?? ''

  const recoverableRewriteJobMatchesContext = (job: RecoverableRewriteJob, novelId: string, branchId: string, chapterId: string) => (
    job.panel.novelId === novelId
    && job.panel.branchId === branchId
    && job.panel.chapterId === chapterId
  )

  useEffect(() => () => {
    for (const controller of Object.values(ollamaModelRequestControllersRef.current)) controller?.abort()
    for (const controller of Object.values(openAICompatibleModelRequestControllersRef.current)) controller?.abort()
    recoverableRestoreAbortControllerRef.current?.abort()
    recoverablePollAbortControllerRef.current?.abort()
    ollamaModelRequestControllersRef.current = { rewrite: null, knowledgeExtraction: null, embeddings: null }
    openAICompatibleModelRequestControllersRef.current = { rewrite: null, knowledgeExtraction: null, embeddings: null }
  }, [])

  const setSilentRecoverableRewriteFailure = (message: string, expectedJobId?: string) => {
    core.setRewriteFlow((current) => {
      if (expectedJobId && current.jobId !== expectedJobId) return current
      if (!expectedJobId && !current.jobId && core.activeMode !== 'rewrite') return current
      return {
        ...current,
        loading: false,
        error: message,
        jobStatus: 'failed',
        jobCurrentStep: null,
      }
    })
    core.setRewriteState((current) => (
      current.loading || core.activeMode === 'rewrite'
        ? { ...current, loading: false, error: message }
        : current
    ))
  }

  const getWritingHistoryContext = () => {
    const context = buildContinueBlockLineageRequestContext(core.activeContinueBlockRewriteContext)
    if (context.branchContextNodeId || core.rewriteLaunchSource === 'chapter') return context
    return authoredHistoryContextRef.current
  }

  const performContextPreview = async (
    mode: WorkspaceActionMode,
    instructionOverride?: string,
    selectionOverride?: string,
    options?: {
      preserveDisabledBlocks?: boolean
      excludedGraphEdgeIds?: string[]
      excludedEvidenceIds?: string[]
      branchContextNodeId?: string
      branchContextInclusion?: 'ancestors_only' | 'include_selected'
      omitSelectedText?: boolean
      sourceText?: string
      writingSkillCardIds?: string[]
      writingSkillExampleCount?: number
      writingSkillSeed?: number
    },
  ) => {
    if (!core.currentChapter) return null
    const sourceChapter = core.currentChapter.parentChapterId ? core.parentChapter ?? null : core.currentChapter
    if (!sourceChapter) return core.setContextPreviewError(t('workspace.chapterGraph.noInheritedParent')), null
    const targetSelection = ((selectionOverride ?? core.lockedSelectionText) || core.selectionText).trim()
    if (!targetSelection) return null
    const requestSequence = contextPreviewRequestSequenceRef.current + 1
    contextPreviewRequestSequenceRef.current = requestSequence
    contextPreviewInputsKeyRef.current = promptInputsKey
    core.setContextPreviewLoading(true)
    core.setContextPreviewError('')
    try {
      const lineageContext = getWritingHistoryContext()
      const omitSelectedText = options?.omitSelectedText ?? (mode === 'rewrite' && lineageContext.omitSelectedText)
      const branchContext = mode === 'rewrite' ? { branchContextNodeId: options?.branchContextNodeId ?? lineageContext.branchContextNodeId, branchContextInclusion: options?.branchContextInclusion ?? lineageContext.branchContextInclusion } : {}
      const writingSkillCardIds = mode === 'rewrite'
        ? options?.writingSkillCardIds ?? core.selectedWritingSkillCardIds
        : []
      const writingSkillContext = mode === 'rewrite'
        ? {
            writingSkillCardIds,
            writingSkillCardId: writingSkillCardIds[0],
            writingSkillExampleCount: options?.writingSkillExampleCount ?? core.writingSkillExampleCount,
            writingSkillSeed: options?.writingSkillSeed ?? core.writingSkillSeed,
          }
        : {}
      const sourceText = mode === 'rewrite'
        ? options?.sourceText ?? (core.rewriteSourceTextOverride.trim() || core.chapterText)
        : core.chapterText
      const data = await callGenerationContextApi({ novelId: core.currentNovelId, branchId: core.storyTimelineBranchId, chapterId: sourceChapter.id, selectedText: omitSelectedText ? '' : targetSelection, sourceText, contextSnapshotId: core.generationContext?.contextSnapshotId ?? undefined, disabledBlockIds: options?.preserveDisabledBlocks ? core.disabledContextBlockIds : [], presetCompatRuntimeContext: core.buildPresetCompatRuntimeContext('rewrite'), scope: 'chapter', mode: 'heavy', tone: 'dramatic', operationType: toGenerationContextOperationType(mode), userInstruction: instructionOverride ?? core.getInstructionForMode(mode), excludedGraphEdgeIds: options?.excludedGraphEdgeIds ?? core.excludedGraphEdgeIds, excludedEvidenceIds: options?.excludedEvidenceIds ?? core.excludedEvidenceIds, ...branchContext, ...writingSkillContext })
      if (contextPreviewRequestSequenceRef.current !== requestSequence) return null
      if (!data.ok || !data.graphContext || !data.promptBlocks || !data.lanceEvidence) throw new Error(data.error || t('workspace.action.contextPreviewFailed'))
      const nextContext = { ...(data as GenerationContextBuildData), sourceMeta: core.currentChapter.parentChapterId ? { mode: 'inherited-parent', chapterId: sourceChapter.id, chapterNo: sourceChapter.order, chapterTitle: sourceChapter.title } : { mode: 'direct', chapterId: sourceChapter.id, chapterNo: sourceChapter.order, chapterTitle: sourceChapter.title } } satisfies GenerationContextBuildData
      core.setGenerationContext(nextContext)
      core.setGraphContext(nextContext.graphContext)
      core.setGraphSelection((current) => resolveGraphSelection(nextContext.graphContext, current))
      core.setDisabledContextBlockIds((current) => options?.preserveDisabledBlocks ? current : [])
      core.setGraphMutationError('')
      return nextContext
    } catch (error) {
      if (contextPreviewRequestSequenceRef.current !== requestSequence) return null
      core.setGenerationContext(null)
      core.setGraphContext(null)
      core.setGraphSelection(null)
      core.setContextPreviewError(resolveWorkspaceUserFacingError('context-preview', error, locale))
      return null
    } finally {
      if (contextPreviewRequestSequenceRef.current === requestSequence) core.setContextPreviewLoading(false)
    }
  }

  const loadContextPreview = (
    ...args: Parameters<typeof performContextPreview>
  ): Promise<GenerationContextBuildData | null> => {
    const promise = performContextPreview(...args)
    contextPreviewPromiseRef.current = promise
    void promise.finally(() => {
      if (contextPreviewPromiseRef.current === promise) contextPreviewPromiseRef.current = null
    })
    return promise
  }

  // Launch effects replace the task state before previewing it. Read the
  // committed state in the deferred callback, not the previous task's closure.
  const previewReopenedRewrite = useEffectEvent(() => {
    if (core.activeMode === 'rewrite') void loadContextPreview('rewrite')
  })

  useEffect(() => {
    if (!core.pendingWhatIfRewriteLaunch || !core.currentChapter || core.currentChapter.id !== core.pendingWhatIfRewriteLaunch.targetChapterId) return
    const { detail, variant } = core.pendingWhatIfRewriteLaunch
    const historyNodeId = core.resolvedStoryTimeline.branchNodes.find((node) => node.whatIfSessionId === detail.id)?.id
      ?? (activeWorkspaceSelection.kind === 'what_if' && activeWorkspaceSelection.sessionId === detail.id ? activeWorkspaceSelection.nodeId : null)
    authoredHistoryContextRef.current = historyNodeId ? { branchContextNodeId: historyNodeId, branchContextInclusion: variant === 'continue' ? 'include_selected' : 'ancestors_only', omitSelectedText: variant === 'continue' } : {}
    const rewritePrompt = variant === 'regenerate' ? detail.premise.trim() : DEFAULT_REWRITE_PROMPT
    core.setSelectionText(detail.selectedText); core.setLockedSelectionText(detail.selectedText); core.setToolbarPos(null); core.setGenerationContext(null); core.setGraphContext(null); core.setContextPreviewError(''); core.setGraphReviewControls(DEFAULT_GRAPH_REVIEW_CONTROLS); core.setContextPanelOpen(false); core.setGraphSelection(null); core.setDisabledContextBlockIds([]); core.setExcludedGraphEdgeIds([]); core.setExcludedEvidenceIds([]); core.setGraphMutationPendingId(null); core.setGraphMutationError(''); core.setRewritePrompt(rewritePrompt); core.setRewriteLaunchSource('what_if'); core.setRewriteSourceTextOverride(detail.generatedText); core.setRewriteState({ loading: false, result: detail.generatedText, error: '' }); core.setRewriteFlow({ loading: false, error: '', provider: 'what-if-session', candidates: [{ title: variant === 'continue' ? t('workspace.action.currentBranchVersion') : t('workspace.action.currentWhatIfVersion'), summary: variant === 'continue' ? t('workspace.action.whatIfContinueSummary') : t('workspace.action.whatIfRegenerateSummary'), content: detail.generatedText, inputTokens: detail.inputTokens ?? null, outputTokens: detail.outputTokens ?? null }], selectedIndex: 0, jobId: null, jobStatus: null, jobCurrentStep: null }); core.setActiveMode('rewrite'); core.setPendingWhatIfRewriteLaunch(null)
    core.setActiveContinueBlockRewriteContext(null)
    core.setActiveFutureJumpRewriteContext(null)
    window.setTimeout(previewReopenedRewrite, 0)
  }, [core.pendingWhatIfRewriteLaunch, core.currentChapter])

  useEffect(() => {
    if (!core.pendingFutureJumpRewriteLaunch || !core.currentChapter || core.currentChapter.id !== core.pendingFutureJumpRewriteLaunch.targetChapterId) return
    const { detail, selectedText, originalText } = core.pendingFutureJumpRewriteLaunch
    const historyNodeId = detail.timelineNodeId ?? core.resolvedStoryTimeline.branchNodes.find((node) => node.futureJumpRunId === detail.id)?.id
    authoredHistoryContextRef.current = historyNodeId ? { branchContextNodeId: historyNodeId, branchContextInclusion: 'include_selected', omitSelectedText: true } : {}
    core.setSelectionText(selectedText); core.setLockedSelectionText(selectedText); core.setToolbarPos(null); core.setGenerationContext(null); core.setGraphContext(null); core.setContextPreviewError(''); core.setGraphReviewControls(DEFAULT_GRAPH_REVIEW_CONTROLS); core.setContextPanelOpen(false); core.setGraphSelection(null); core.setDisabledContextBlockIds([]); core.setExcludedGraphEdgeIds([]); core.setExcludedEvidenceIds([]); core.setGraphMutationPendingId(null); core.setGraphMutationError(''); core.setRewritePrompt(DEFAULT_REWRITE_PROMPT); core.setRewriteLaunchSource('future_jump'); core.setRewriteSourceTextOverride(originalText); core.setRewriteState({ loading: false, result: originalText, error: '' }); core.setRewriteFlow({ loading: false, error: '', provider: 'future-jump-run', candidates: [{ title: t('workspace.action.currentFutureVersion'), summary: t('workspace.action.currentFutureSummary'), content: originalText, inputTokens: detail.inputTokens ?? null, outputTokens: detail.outputTokens ?? null }], selectedIndex: 0, jobId: null, jobStatus: null, jobCurrentStep: null }); core.setActiveFutureJumpRewriteContext(core.pendingFutureJumpRewriteLaunch); core.setActiveContinueBlockRewriteContext(null); core.setActiveMode('rewrite'); core.setPendingFutureJumpRewriteLaunch(null)
    window.setTimeout(previewReopenedRewrite, 0)
  }, [core.pendingFutureJumpRewriteLaunch, core.currentChapter])

  useEffect(() => {
    if (!core.pendingContinueBlockRewriteLaunch || !core.currentChapter || core.currentChapter.id !== core.pendingContinueBlockRewriteLaunch.targetChapterId) return
    const launch = core.pendingContinueBlockRewriteLaunch
    const isContinue = launch.variant === 'continue'
    const targetText = isContinue ? launch.latestText.trim() || launch.selectedText : launch.selectedText
    const instruction = launch.userInstruction.trim()
    core.setSelectionText(targetText)
    core.setLockedSelectionText(targetText)
    core.setToolbarPos(null)
    core.setGenerationContext(null)
    core.setGraphContext(null)
    core.setContextPreviewError('')
    core.setGraphReviewControls(DEFAULT_GRAPH_REVIEW_CONTROLS)
    core.setContextPanelOpen(false)
    core.setGraphSelection(null)
    core.setDisabledContextBlockIds([])
    core.setExcludedGraphEdgeIds([])
    core.setExcludedEvidenceIds([])
    core.setGraphMutationPendingId(null)
    core.setGraphMutationError('')
    core.setRewritePrompt(instruction)
    core.setRewriteLaunchSource('continue_block')
    core.setRewriteSourceTextOverride(launch.latestText)
    core.setSelectedWritingSkillCardIds(launch.writingSkillCardIds)
    core.setWritingSkillExampleCount(launch.writingSkillExampleCount)
    core.setWritingSkillSeed(launch.writingSkillSeed)
    core.setRewriteState({ loading: false, result: launch.latestText, error: '' })
    core.setRewriteFlow({
      loading: false,
      error: '',
      provider: 'continue-block-reader',
      candidates: [{
        title: launch.variant === 'continue' ? t('workspace.action.currentContinueBlockVersion') : t('workspace.action.currentPendingRegenerateVersion'),
        summary: launch.variant === 'continue' ? t('workspace.action.continueBlockContinueSummary') : t('workspace.action.continueBlockRegenerateSummary'),
        content: launch.latestText,
        inputTokens: launch.inputTokens ?? null,
        outputTokens: launch.outputTokens ?? null,
      }],
      selectedIndex: 0,
      jobId: null,
      jobStatus: null,
      jobCurrentStep: null,
    })
    core.setActiveFutureJumpRewriteContext(null)
    core.setActiveContinueBlockRewriteContext(launch)
    core.setActiveMode('rewrite')
    core.setPendingContinueBlockRewriteLaunch(null)
    window.setTimeout(previewReopenedRewrite, 0)
  }, [core.pendingContinueBlockRewriteLaunch, core.currentChapter])

  const syncGraphReview = async (nextControls: GraphReviewControls, fallbackContext?: GenerationContextBuildData | null) => {
    const sourceContext = fallbackContext ?? core.generationContext
    if (!sourceContext?.graphContext.seedEntities.length || !core.currentNovelId) return core.setGraphReviewControls(nextControls)
    const params = new URLSearchParams({ novelId: core.currentNovelId, branchId: sourceContext.branchId, chapterNo: String(sourceContext.chapterNo), hops: String(nextControls.maxHops), includeLowConfidence: String(!nextControls.hideLowConfidence), confirmedOnly: String(nextControls.confirmedOnly), entityId: sourceContext.graphContext.seedEntities.map((node) => node.id).join(',') })
    core.setGraphReviewLoading(true); core.setContextPreviewError(''); core.setGraphReviewControls(nextControls)
    try {
      const data = await callGraphSubgraphApi(`/api/graph/subgraph?${params.toString()}`)
      if (!data.ok || !data.nodes || !data.edges || !data.seedEntities || !data.status) throw new Error(data.error || t('workspace.action.graphAssemblyFailed'))
      const nextGraphContext: GenerationContextBuildData['graphContext'] = { seedEntities: data.seedEntities, nodes: data.nodes, edges: data.edges, contextText: data.contextText ?? '', warnings: data.warnings ?? [], tokenEstimate: data.tokenEstimate ?? 0, status: data.status }
      core.setGraphContext(nextGraphContext)
      core.setGraphSelection((current) => resolveGraphSelection(nextGraphContext, current))
    } catch (error) {
      core.setContextPreviewError(resolveWorkspaceUserFacingError('graph-assembly', error, locale))
    } finally {
      core.setGraphReviewLoading(false)
    }
  }

  const openActionMode = async (mode: WorkspaceActionMode) => {
    core.flushEditorBuffer()
    const nextSelection = core.selectionText.trim()
    if (!nextSelection || !core.currentChapter) return
    if (mode === 'roleplay') {
      if (!core.currentNovelId) return
      core.invalidateRecoverableRewriteOwnership()
      const currentBranchId = core.storyTimelineData?.branchId ?? `${core.currentNovelId}:main`
      core.setRoleplaySessionStarting(true); core.setSaveContinueBlockError('')
      try {
        const selectionPreview = nextSelection.length > 48 ? `${nextSelection.slice(0, 48)}…` : nextSelection
        const result = await callCreateRoleplaySessionApi({ novelId: core.currentNovelId, branchId: currentBranchId, title: `RP · ${core.currentChapter.title}`, subtitle: t('workspace.action.roleplaySubtitle', { text: selectionPreview }), sourceChapterId: core.currentChapter.id, sourceChapterNo: core.currentChapter.order, sourceChapterTitle: core.currentChapter.title, sourceTimelineNodeId: null, sourceTimelineNodeType: 'chapter', sourceSelectedText: nextSelection, sourceTextSnapshot: core.chapterText, sourceSelectedLineStart: null, sourceSelectedLineEnd: null })
        const refreshed = await core.loadStoryTimeline()
        core.setWorkspaceSelection(resolveBranchTimelineSelection({ kind: 'roleplay_session', nodeId: result.timelineNodeId, roleplaySessionId: result.sessionId, anchorChapterNo: core.currentChapter.order }, refreshed?.branchNodes ?? []))
        core.setCenterPaneView('body'); core.setLeftPanelOpen(false); core.setToolbarPos(null); core.setSelectionText(''); core.setLockedSelectionText(''); window.scrollTo({ top: 0, behavior: 'auto' })
      } catch (error) {
        const message = resolveWorkspaceUserFacingError('roleplay-session-create', error, locale)
        core.setSaveContinueBlockError(message); core.setToast(message, 'error'); window.setTimeout(() => core.setToast(''), 2400)
      } finally {
        core.setRoleplaySessionStarting(false)
      }
      return
    }
    core.invalidateRecoverableRewriteOwnership()
    setPresetCompatSessionPhase(core.workspaceSelection ?? toChapterTimelineSelection(core.currentChapter), toPresetCompatSessionSurfaceId(mode), 'new_chat')
    core.setLockedSelectionText(nextSelection); core.setToolbarPos(null); core.setGenerationContext(null); core.setGraphContext(null); core.setContextPreviewError(''); core.setGraphReviewControls(DEFAULT_GRAPH_REVIEW_CONTROLS); core.setGraphSelection(null); core.setDisabledContextBlockIds([]); core.setExcludedGraphEdgeIds([]); core.setExcludedEvidenceIds([]); core.setGraphMutationPendingId(null); core.setGraphMutationError('')
    if (mode === 'rewrite') { core.setRewriteLaunchSource('chapter'); core.setRewriteSourceTextOverride(''); core.setRewriteFlow({ loading: false, error: '', provider: '', candidates: [], selectedIndex: 0, jobId: null, jobStatus: null, jobCurrentStep: null }) }
    core.setActiveMode(mode)
    window.setTimeout(() => { void loadContextPreview(mode) }, 0)
  }

  const handleRefreshContextReview = async (options?: { excludedGraphEdgeIds?: string[]; excludedEvidenceIds?: string[]; preserveDisabledBlocks?: boolean }) => {
    if (!core.activeMode) return
    const nextContext = await loadContextPreview(core.activeMode, undefined, undefined, { preserveDisabledBlocks: options?.preserveDisabledBlocks ?? true, excludedGraphEdgeIds: options?.excludedGraphEdgeIds, excludedEvidenceIds: options?.excludedEvidenceIds })
    if (!nextContext) return
    if (core.graphReviewControls.maxHops !== DEFAULT_GRAPH_REVIEW_CONTROLS.maxHops || core.graphReviewControls.hideLowConfidence !== DEFAULT_GRAPH_REVIEW_CONTROLS.hideLowConfidence || core.graphReviewControls.confirmedOnly !== DEFAULT_GRAPH_REVIEW_CONTROLS.confirmedOnly) await syncGraphReview(core.graphReviewControls, nextContext)
  }

  const handleExcludedGenerationContextChange = async (next: { excludedGraphEdgeIds: string[]; excludedEvidenceIds: string[] }) => {
    core.setExcludedGraphEdgeIds(next.excludedGraphEdgeIds); core.setExcludedEvidenceIds(next.excludedEvidenceIds)
    await handleRefreshContextReview({ excludedGraphEdgeIds: next.excludedGraphEdgeIds, excludedEvidenceIds: next.excludedEvidenceIds, preserveDisabledBlocks: true })
  }

  const handleGraphEdgeMutation = async (edgeId: string, request: () => Promise<{ ok?: boolean; error?: string }>) => {
    core.setGraphMutationPendingId(edgeId); core.setGraphMutationError('')
    try { const result = await request(); if (!result.ok) throw new Error(result.error || t('workspace.action.graphRelationUpdateFailed')); await handleRefreshContextReview({ preserveDisabledBlocks: true }) } catch (error) { core.setGraphMutationError(resolveWorkspaceUserFacingError('graph-relation-update', error, locale)) } finally { core.setGraphMutationPendingId(null) }
  }

  const handleGraphControlChange = async (nextControls: GraphReviewControls) => {
    if (nextControls.maxHops === core.graphReviewControls.maxHops && nextControls.hideLowConfidence === core.graphReviewControls.hideLowConfidence && nextControls.confirmedOnly === core.graphReviewControls.confirmedOnly) return core.setGraphReviewControls(nextControls)
    await syncGraphReview(nextControls)
  }

  const copyText = async (mode: 'rewrite' | 'roleplay', text: string) => {
    if (!text) return
    await writeTextToClipboard(text)
    core.setCopied(mode)
    window.setTimeout(() => core.setCopied(null), 1500)
  }

  const applyFullChapter = (text: string) => {
    if (!core.currentChapter || !text.trim()) return
    core.flushEditorBuffer()
    updateChapterContent(core.currentChapter.id, plainTextToHtml(text.trim()))
    if (core.editorRef.current) core.editorRef.current.innerText = text.trim()
    core.setToast(t('workspace.action.appliedToBody')); window.setTimeout(() => core.setToast(''), 1800); core.closePanel()
  }

  const saveSettings = async () => {
    try {
      await saveAISettings()
      await core.refreshCurrentFullKnowledgeProjection()
      core.setSettingsOpen(false)
      core.setToast(t('aiSettings.saved'), 'success')
      window.setTimeout(() => core.setToast(''), 2000)
    } catch (error) {
      core.setToast(t('aiSettings.saveFailed'), 'error')
      window.setTimeout(() => core.setToast(''), 2400)
      throw error
    }
  }
  async function loadOllamaModels(scenario: AIScenarioKey, baseUrl?: string) {
    ollamaModelRequestControllersRef.current[scenario]?.abort()
    const controller = new AbortController()
    ollamaModelRequestControllersRef.current[scenario] = controller
    const purpose = AI_SCENARIO_META[scenario].ollamaPurpose
    core.setOllamaModelsLoading((current) => ({ ...current, [scenario]: true }))
    core.setOllamaModelsError((current) => ({ ...current, [scenario]: '' }))
    try {
      const query = new URLSearchParams({ purpose })
      if (baseUrl?.trim()) query.set('baseUrl', baseUrl.trim())
      const response = await fetch(`/api/settings/ai/ollama-models?${query.toString()}`, { cache: 'no-store', signal: controller.signal })
      const data = (await response.json()) as { ok?: boolean; error?: string; models?: OllamaModelOption[] }
      if (ollamaModelRequestControllersRef.current[scenario] !== controller) return
      if (!response.ok || !data.ok) throw new Error(data.error || (purpose === 'embedding' ? t('workspace.action.loadLocalOllamaEmbeddingModelsFailed') : t('workspace.action.loadLocalOllamaTextModelsFailed')))
      core.setOllamaModelsByScenario((current) => ({ ...current, [scenario]: data.models ?? [] }))
    } catch (error) {
      if (controller.signal.aborted || ollamaModelRequestControllersRef.current[scenario] !== controller) return
      core.setOllamaModelsByScenario((current) => ({ ...current, [scenario]: [] }))
      core.setOllamaModelsError((current) => ({ ...current, [scenario]: resolveWorkspaceUserFacingError('ollama-model-load', error, locale) }))
    } finally {
      if (ollamaModelRequestControllersRef.current[scenario] === controller) {
        ollamaModelRequestControllersRef.current[scenario] = null
        core.setOllamaModelsLoading((current) => ({ ...current, [scenario]: false }))
      }
    }
  }

  async function loadOpenAICompatibleModels(scenario: AIScenarioKey, baseUrl?: string, apiKey?: string) {
    openAICompatibleModelRequestControllersRef.current[scenario]?.abort()
    const controller = new AbortController()
    openAICompatibleModelRequestControllersRef.current[scenario] = controller
    const trimmedBaseUrl = baseUrl?.trim() ?? ''
    if (!trimmedBaseUrl) {
      openAICompatibleModelRequestControllersRef.current[scenario] = null
      core.setOpenAICompatibleModelsByScenario((current) => ({ ...current, [scenario]: [] }))
      core.setOpenAICompatibleModelsLoading((current) => ({ ...current, [scenario]: false }))
      return
    }
    core.setOpenAICompatibleModelsLoading((current) => ({ ...current, [scenario]: true }))
    try {
      const response = await fetch('/api/settings/ai/openai-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: trimmedBaseUrl, apiKey: apiKey?.trim() ?? '', scenario }),
        signal: controller.signal,
      })
      const data = (await response.json()) as { ok?: boolean; models?: OpenAICompatibleModelOption[] }
      if (openAICompatibleModelRequestControllersRef.current[scenario] !== controller) return
      if (!response.ok || !data.ok) return core.setOpenAICompatibleModelsByScenario((current) => ({ ...current, [scenario]: [] }))
      core.setOpenAICompatibleModelsByScenario((current) => ({ ...current, [scenario]: data.models ?? [] }))
    } catch {
      if (controller.signal.aborted || openAICompatibleModelRequestControllersRef.current[scenario] !== controller) return
      core.setOpenAICompatibleModelsByScenario((current) => ({ ...current, [scenario]: [] }))
    } finally {
      if (openAICompatibleModelRequestControllersRef.current[scenario] === controller) {
        openAICompatibleModelRequestControllersRef.current[scenario] = null
        core.setOpenAICompatibleModelsLoading((current) => ({ ...current, [scenario]: false }))
      }
    }
  }

  const handleDeleteChapter = async (chapter: Chapter) => { const branchCount = localChapters.filter((item) => item.parentChapterId === chapter.id).length; const prompt = chapter.parentChapterId ? t('workspace.action.deleteChapterConfirm', { title: chapter.title }) : branchCount > 0 ? t('workspace.action.deleteChapterWithBranchesConfirm', { title: chapter.title, count: branchCount }) : t('workspace.action.deleteChapterConfirm', { title: chapter.title }); if (!window.confirm(prompt)) return; core.flushEditorBuffer(); deleteChapter(chapter.id); try { await saveToBackend(); core.setToast(t('workspace.action.chapterDeleted', { title: chapter.title })); window.setTimeout(() => core.setToast(''), 1800) } catch { await loadFromBackend(); core.setToast(t('workspace.action.chapterDeleteFailed', { title: chapter.title }), 'error'); window.setTimeout(() => core.setToast(''), 2400) } }
  const handleTimelineDeleteChapter = (chapterId: string) => { const targetChapter = core.sortedChapters.find((chapter) => chapter.id === chapterId); if (targetChapter) void handleDeleteChapter(targetChapter) }
  const handleDeleteBranchNode = async (targetNode: StoryTimelineBranchNode) => { if (!core.currentNovelId || core.deletingBranchNodeId || !core.currentChapter) return; const directChildCount = core.resolvedStoryTimeline.branchNodes.filter((node) => node.parentNodeId === targetNode.id).length; const promotedChildrenMessage = directChildCount > 0 ? t('workspace.action.branchDeletePromoteChildren', { count: directChildCount }) : t('workspace.action.branchDeleteNoImpact'); const branchKindLabel = t(targetNode.nodeType === 'rewrite' ? 'workspace.timeline.branchKind.rewrite' : targetNode.nodeType === 'continue_block' ? 'workspace.timeline.branchKind.continueBlock' : targetNode.nodeType === 'what_if' ? 'workspace.timeline.branchKind.whatIf' : targetNode.nodeType === 'roleplay_session' ? 'workspace.timeline.branchKind.roleplaySession' : 'workspace.timeline.branchKind.futureJump'); if (!window.confirm(t('workspace.action.branchDeleteConfirm', { kind: branchKindLabel, title: targetNode.title, detail: promotedChildrenMessage }))) return; const previousSelection = core.workspaceSelection ?? toChapterTimelineSelection(core.currentChapter); core.setDeletingBranchNodeId(targetNode.id); try { await callDeleteStoryTimelineNodeApi(targetNode.id, core.currentNovelId, core.storyTimelineBranchId); const optimisticTimeline = removeDeletedStoryTimelineNode(core.resolvedStoryTimeline, targetNode); core.setStoryTimelineData((current) => current ? removeDeletedStoryTimelineNode(current, targetNode) : current); const nextSelection = resolveSelectionAfterDeletedBranchNode({ deletedNode: targetNode, previousSelection, currentChapter: core.currentChapter, chapters: core.sortedChapters, branchNodes: optimisticTimeline.branchNodes }) ?? toChapterTimelineSelection(core.currentChapter); if (previousSelection.kind !== 'chapter' && previousSelection.nodeId === targetNode.id) core.handleTimelineSelection(nextSelection, 'replace'); core.setToast(t('workspace.action.branchDeleted', { title: targetNode.title })); window.setTimeout(() => core.setToast(''), 2000); void core.loadStoryTimeline() } catch (error) { const message = resolveWorkspaceUserFacingError('timeline-node-delete', error, locale); core.setToast(message, 'error'); window.setTimeout(() => core.setToast(''), 2400) } finally { core.setDeletingBranchNodeId(null) } }
  const handleDeleteNovel = async () => { if (!core.currentNovelId || isNovelDeletionPending || novelDeletionInFlightRef.current) return; const novelId = core.currentNovelId; const title = core.currentNovelMeta?.title ?? t('workspace.action.currentNovelFallback'); if (!window.confirm(t('library.deleteConfirm', { title }))) return; core.flushEditorBuffer(); novelDeletionInFlightRef.current = true; setNovelDeletionPending(true); const transaction = beginNovelDeletion(novelId); if (!transaction) { setNovelDeletionPending(false); novelDeletionInFlightRef.current = false; return } try { const outcome = await deleteNovelFromBackend(novelId); if (outcome.status === 'committed') { reconcileNovelDeletion(outcome.result.nextNovelId); core.setToast(t('library.deleted', { title })); window.setTimeout(() => core.setToast(''), 1800) } else if (outcome.status === 'rejected') { rollbackNovelDeletion(transaction); core.setToast(t('library.deleteFailed', { title }), 'error'); window.setTimeout(() => core.setToast(''), 2400) } else { try { const reconciliation = await reconcileNovelDeletionFromBackend(transaction); const targetPresent = reconciliation === 'present'; core.setToast(t(targetPresent ? 'library.deleteFailedAuthoritative' : 'library.deleted', { title }), targetPresent ? 'error' : 'success'); window.setTimeout(() => core.setToast(''), targetPresent ? 2400 : 1800) } catch { core.setToast(t('library.deleteReconcileFailed', { title }), 'error'); window.setTimeout(() => core.setToast(''), 2600) } } } finally { setNovelDeletionPending(false); novelDeletionInFlightRef.current = false } }
  const handleRebuildKnowledge = async () => { if (!core.currentNovelId || core.knowledgeRebuilding || core.knowledgeActionLoading) return; core.setKnowledgeRebuilding(true); try { const result = await rebuildStoryKnowledge(core.currentNovelId, { chapterRange: core.selectedKnowledgeRebuildChapterRange }); if (!result) return; core.setKnowledgeRebuildStatus(result.knowledgeRebuildStatus); core.setHanlpCacheSnapshot(result.hanlpCacheSnapshot); if (result.knowledgeStatusOverview) core.setKnowledgeStatusOverview(result.knowledgeStatusOverview); if (result.knowledgeRebuildStatus?.jobId && (result.knowledgeRebuildStatus.status === 'queued' || result.knowledgeRebuildStatus.status === 'running' || result.knowledgeRebuildStatus.status === 'paused')) core.lastActiveKnowledgeJobIdRef.current = result.knowledgeRebuildStatus.jobId; else core.lastActiveKnowledgeJobIdRef.current = null; if (result.jobOutcome === 'paused') core.showKnowledgeToast(t('workspace.action.knowledgePaused'), 1800, 'info'); else if (result.jobOutcome === 'aborted') { core.lastActiveKnowledgeJobIdRef.current = null; core.setKnowledgeRebuildStatus(null); core.showKnowledgeToast(t('workspace.action.knowledgeAborted'), 1800, 'info') } else if (result.jobOutcome === 'completed') core.showKnowledgeToast(t('workspace.action.knowledgeUpdatedRange', { range: core.selectedKnowledgeRebuildChapterRangeLabel })); else if (result.knowledgeRebuildStatus?.status === 'failed') core.showKnowledgeToast(resolveWorkspaceUserFacingError('knowledge-rebuild', resolveKnowledgeRebuildFailureMessage(result.knowledgeRebuildStatus), locale), 2600, 'error') } catch (error) { core.showKnowledgeToast(resolveWorkspaceUserFacingError('knowledge-rebuild', error, locale), 2200, 'error') } finally { core.setKnowledgeRebuilding(false) } }
  const handleRebuildRetrievalIndex = async () => { if (!core.currentNovelId || core.knowledgeRebuilding || core.knowledgeActionLoading || core.knowledgeRebuildBusy) return; core.setKnowledgeActionLoading('rebuild-retrieval-index'); try { const result = await rebuildStoryRetrievalIndex(core.currentNovelId, { chapterRange: core.selectedKnowledgeRebuildChapterRange }); if (!result) return; core.setKnowledgeRebuildStatus(result.knowledgeRebuildStatus); core.setHanlpCacheSnapshot(result.hanlpCacheSnapshot); if (result.knowledgeStatusOverview) core.setKnowledgeStatusOverview(result.knowledgeStatusOverview); if (result.knowledgeRebuildStatus?.jobId && (result.knowledgeRebuildStatus.status === 'queued' || result.knowledgeRebuildStatus.status === 'running' || result.knowledgeRebuildStatus.status === 'paused')) core.lastActiveKnowledgeJobIdRef.current = result.knowledgeRebuildStatus.jobId; else core.lastActiveKnowledgeJobIdRef.current = null; if (result.jobOutcome === 'completed') core.showKnowledgeToast(t('workspace.action.retrievalUpdatedRange', { range: core.selectedKnowledgeRebuildChapterRangeLabel })); else if (result.knowledgeRebuildStatus?.status === 'paused') core.showKnowledgeToast(t('workspace.action.retrievalPaused'), 1800, 'info'); else if (result.knowledgeRebuildStatus?.status === 'failed') core.showKnowledgeToast(resolveWorkspaceUserFacingError('retrieval-index-rebuild', resolveKnowledgeRebuildFailureMessage(result.knowledgeRebuildStatus), locale), 2600, 'error'); else core.showKnowledgeToast(t('workspace.action.retrievalStarted'), 1800, 'info') } catch (error) { core.showKnowledgeToast(resolveWorkspaceUserFacingError('retrieval-index-rebuild', error, locale), 2200, 'error') } finally { core.setKnowledgeActionLoading(null) } }
  const handlePauseKnowledge = async () => { if (!core.currentNovelId || !core.currentKnowledgeJobActive || core.knowledgeActionLoading) return; core.setKnowledgeActionLoading('pause'); try { const result = await pauseStoryKnowledgeRebuild(core.currentNovelId); if (!result) return; core.setKnowledgeRebuildStatus(result.knowledgeRebuildStatus); core.setHanlpCacheSnapshot(result.hanlpCacheSnapshot); core.setKnowledgeStatusOverview(result.knowledgeStatusOverview); if (result.knowledgeRebuildStatus?.jobId && (result.knowledgeRebuildStatus.status === 'queued' || result.knowledgeRebuildStatus.status === 'running' || result.knowledgeRebuildStatus.status === 'paused')) core.lastActiveKnowledgeJobIdRef.current = result.knowledgeRebuildStatus.jobId; const activeJobLabel = result.knowledgeRebuildStatus?.jobType === 'rebuild_retrieval_index' ? t('workspace.action.retrievalJobLabel') : t('workspace.action.knowledgeJobLabel'); core.showKnowledgeToast(result.jobOutcome === 'paused' ? t('workspace.action.jobPaused', { label: activeJobLabel }) : t('workspace.action.noRunningKnowledgeJob'), 1800, 'info') } catch (error) { core.showKnowledgeToast(resolveWorkspaceUserFacingError('knowledge-pause', error, locale), 2200, 'error') } finally { core.setKnowledgeActionLoading(null) } }
  const handleAbortKnowledge = async () => { if (!core.currentNovelId || (!core.currentKnowledgeJobBusy && !core.knowledgeRebuilding) || core.knowledgeActionLoading) return; core.setKnowledgeActionLoading('abort'); try { const result = await abortStoryKnowledgeRebuild(core.currentNovelId); if (!result) return; core.lastActiveKnowledgeJobIdRef.current = null; core.setKnowledgeRebuildStatus(result.knowledgeRebuildStatus); core.setHanlpCacheSnapshot(result.hanlpCacheSnapshot); if (result.knowledgeStatusOverview) core.setKnowledgeStatusOverview(result.knowledgeStatusOverview); core.setKnowledgeRebuilding(false); const activeJobLabel = result.knowledgeRebuildStatus?.jobType === 'rebuild_retrieval_index' ? t('workspace.action.retrievalJobLabel') : t('workspace.action.knowledgeJobLabel'); core.showKnowledgeToast(result.jobOutcome === 'aborted' ? t('workspace.action.jobAborted', { label: activeJobLabel }) : t('workspace.action.noAbortableKnowledgeJob'), 1800, 'info') } catch (error) { core.showKnowledgeToast(resolveWorkspaceUserFacingError('knowledge-abort', error, locale), 2200, 'error') } finally { core.setKnowledgeActionLoading(null) } }
  const handleDeleteKnowledgeGraph = async () => { if (!core.currentNovelId || core.knowledgeActionLoading) return; core.setKnowledgeActionLoading('delete'); try { const result = await deleteStoryKnowledgeGraph(core.currentNovelId); if (!result) return; core.lastActiveKnowledgeJobIdRef.current = null; core.setKnowledgeRebuildStatus(result.knowledgeRebuildStatus); core.setHanlpCacheSnapshot(result.hanlpCacheSnapshot); core.setKnowledgeStatusOverview(result.knowledgeStatusOverview); core.setKnowledgeRebuilding(false); core.setConfirmDeleteKnowledge(false); core.showKnowledgeToast(result.jobOutcome === 'deleted' ? t('workspace.action.knowledgeGraphDeleted') : t('workspace.action.knowledgeGraphUnchanged'), 2000, result.jobOutcome === 'deleted' ? 'success' : 'info') } catch (error) { core.showKnowledgeToast(resolveWorkspaceUserFacingError('knowledge-graph-delete', error, locale), 2200, 'error') } finally { core.setKnowledgeActionLoading(null) } }
  const handleDeleteHanlpCache = async () => { if (!core.currentNovelId || core.knowledgeActionLoading) return; core.setKnowledgeActionLoading('delete-hanlp-cache'); try { const result = await deleteStoryHanlpCache(core.currentNovelId); if (!result) return; core.setKnowledgeRebuildStatus(result.knowledgeRebuildStatus); core.setHanlpCacheSnapshot(result.hanlpCacheSnapshot); core.setKnowledgeStatusOverview(result.knowledgeStatusOverview); core.setConfirmDeleteHanlpCache(false); if (result.actionError?.message) return core.showKnowledgeToast(resolveWorkspaceUserFacingError('hanlp-cache-delete', result.actionError.message, locale), 2600, 'error'); core.showKnowledgeToast(result.jobOutcome === 'deleted' ? t('workspace.action.hanlpCacheDeleted') : t('workspace.action.noHanlpCache'), 2200, result.jobOutcome === 'deleted' ? 'success' : 'info') } catch (error) { core.showKnowledgeToast(resolveWorkspaceUserFacingError('hanlp-cache-delete', error, locale), 2600, 'error') } finally { core.setKnowledgeActionLoading(null) } }
  const handleDeleteExtractionCache = async () => { if (!core.currentNovelId || core.knowledgeActionLoading) return; core.setKnowledgeActionLoading('delete-extraction-cache'); try { const result = await deleteStoryExtractionCache(core.currentNovelId); if (!result) return; core.setKnowledgeRebuildStatus(result.knowledgeRebuildStatus); core.setHanlpCacheSnapshot(result.hanlpCacheSnapshot); core.setKnowledgeStatusOverview(result.knowledgeStatusOverview); core.setConfirmDeleteExtractionCache(false); if (result.actionError?.message) return core.showKnowledgeToast(resolveWorkspaceUserFacingError('extraction-cache-delete', result.actionError.message, locale), 2600, 'error'); core.showKnowledgeToast(result.jobOutcome === 'deleted' ? t('workspace.action.extractionCacheDeleted') : t('workspace.action.noExtractionCache'), 2200, result.jobOutcome === 'deleted' ? 'success' : 'info') } catch (error) { core.showKnowledgeToast(resolveWorkspaceUserFacingError('extraction-cache-delete', error, locale), 2600, 'error') } finally { core.setKnowledgeActionLoading(null) } }
  const handleDeleteEmbeddingCache = async () => { if (!core.currentNovelId || core.knowledgeActionLoading) return; core.setKnowledgeActionLoading('delete-embedding-cache'); try { const result = await deleteStoryEmbeddingCache(core.currentNovelId); if (!result) return; core.setKnowledgeRebuildStatus(result.knowledgeRebuildStatus); core.setHanlpCacheSnapshot(result.hanlpCacheSnapshot); core.setKnowledgeStatusOverview(result.knowledgeStatusOverview); core.setConfirmDeleteEmbeddingCache(false); if (result.actionError?.message) return core.showKnowledgeToast(resolveWorkspaceUserFacingError('embedding-cache-delete', result.actionError.message, locale), 2600, 'error'); core.showKnowledgeToast(result.jobOutcome === 'deleted' ? t('workspace.action.embeddingCacheDeleted') : t('workspace.action.noEmbeddingCache'), 2200, result.jobOutcome === 'deleted' ? 'success' : 'info') } catch (error) { core.showKnowledgeToast(resolveWorkspaceUserFacingError('embedding-cache-delete', error, locale), 2600, 'error') } finally { core.setKnowledgeActionLoading(null) } }
  const handleRewrite = async () => {
    const flushedEditor = core.flushEditorBuffer()
    const targetSelection = core.lockedSelectionText.trim() || core.selectionText.trim()
    if (!core.currentNovelId || !core.currentChapter || !targetSelection) return
    const requestSequence = rewriteCreateRequestSequenceRef.current + 1
    rewriteCreateRequestSequenceRef.current = requestSequence
    const ownershipGeneration = core.rewritePanelOwnershipGenerationRef.current
    const contextKey = core.recoverableRewriteContextKeyRef.current
    const novelId = core.currentNovelId
    const branchId = core.storyTimelineBranchId
    const chapterId = core.currentChapter.id
    const ownsRequest = () => (
      rewriteCreateRequestSequenceRef.current === requestSequence
      && core.rewritePanelOwnershipGenerationRef.current === ownershipGeneration
      && core.recoverableRewriteContextKeyRef.current === contextKey
    )
    core.ownedRecoverableRewriteJobIdRef.current = null
    core.setRewriteState({ loading: true, result: '', error: '' })
    core.setRewriteFlow((current) => ({ ...current, loading: true, error: '', provider: 'recoverable-rewrite-job', candidates: [], selectedIndex: 0, jobId: null, jobStatus: 'queued', jobCurrentStep: t('workspace.action.creatingRecoverableRewriteJob') }))
    try {
      await savePresetCompatLibrary()
      if (!ownsRequest()) return
      const continueBlockRequestContext = getWritingHistoryContext()
      const sourceText = core.rewriteSourceTextOverride.trim() || flushedEditor?.plainText || core.chapterText
      let contextForGeneration = core.generationContext
      if (!contextForGeneration && !contextPreviewPromiseRef.current) {
        contextForGeneration = await loadContextPreview('rewrite', core.rewritePrompt, undefined, {
          ...continueBlockRequestContext,
          sourceText,
        })
      }
      if (!ownsRequest()) return
      const job = await callCreateRecoverableRewriteJobApi({ novelId, branchId, chapterId, selectedText: continueBlockRequestContext.omitSelectedText ? '' : targetSelection, sourceText, contextSnapshotId: contextForGeneration?.contextSnapshotId ?? undefined, operationType: 'rewrite', userInstruction: core.rewritePrompt, disabledBlockIds: core.disabledContextBlockIds, excludedGraphEdgeIds: core.excludedGraphEdgeIds, excludedEvidenceIds: core.excludedEvidenceIds, branchContextNodeId: continueBlockRequestContext.branchContextNodeId, branchContextInclusion: continueBlockRequestContext.branchContextInclusion, continueBlockId: continueBlockRequestContext.continueBlockId, presetCompatRuntimeContext: core.buildPresetCompatRuntimeContext('rewrite'), scope: 'chapter', mode: 'heavy', tone: 'dramatic', rewriteLaunchSource: core.rewriteLaunchSource, rewriteSourceTextOverride: core.rewriteSourceTextOverride, writingSkillCardIds: core.selectedWritingSkillCardIds, writingSkillCardId: core.selectedWritingSkillCardIds[0] || undefined, writingSkillExampleCount: core.writingSkillExampleCount, writingSkillSeed: core.writingSkillSeed })
      if (!ownsRequest() || !recoverableRewriteJobMatchesContext(job, novelId, branchId, chapterId)) return
      core.ownedRecoverableRewriteJobIdRef.current = job.jobId
      core.syncRewriteJobFromRecoverableJob(job)
    } catch (error) {
      if (!ownsRequest()) return
      const message = resolveWorkspaceUserFacingError('rewrite-create', error, locale)
      core.setRewriteState({ loading: false, result: '', error: message })
      core.setRewriteFlow((current) => ({ ...current, loading: false, error: message, candidates: [], jobId: null, jobStatus: 'failed', jobCurrentStep: null }))
    }
  }
  const handleAbortRewriteGeneration = async () => {
    const jobId = core.rewriteFlow.jobId
    if (!jobId || !core.currentNovelId || !core.currentChapter || !core.rewriteFlow.loading || core.ownedRecoverableRewriteJobIdRef.current !== jobId) return
    const ownershipGeneration = core.rewritePanelOwnershipGenerationRef.current
    const contextKey = core.recoverableRewriteContextKeyRef.current
    const novelId = core.currentNovelId
    const branchId = core.storyTimelineBranchId
    const chapterId = core.currentChapter.id
    const ownsAbort = () => (
      core.rewritePanelOwnershipGenerationRef.current === ownershipGeneration
      && core.recoverableRewriteContextKeyRef.current === contextKey
      && core.ownedRecoverableRewriteJobIdRef.current === jobId
    )
    core.setRewriteFlow((current) => ({ ...current, loading: false, error: '', jobStatus: 'aborted', jobCurrentStep: t('workspace.action.rewriteAbortedStatus') }))
    core.setRewriteState((current) => ({ ...current, loading: false, error: '' }))
    try {
      const job = await callAbortRecoverableRewriteJobApi({ jobId, novelId, branchId, chapterId })
      if (!ownsAbort() || (job && (job.jobId !== jobId || !recoverableRewriteJobMatchesContext(job, novelId, branchId, chapterId)))) return
      if (job) core.syncRewriteJobFromRecoverableJob(job)
      core.setToast(t('workspace.action.rewriteAbortedToast'), 'info')
      window.setTimeout(() => core.setToast(''), 1800)
    } catch (error) {
      if (!ownsAbort()) return
      const message = resolveWorkspaceUserFacingError('rewrite-abort', error, locale)
      core.setRewriteFlow((current) => current.jobId === jobId ? { ...current, loading: false, error: message, jobStatus: 'failed', jobCurrentStep: null } : current)
      core.setRewriteState((current) => ({ ...current, loading: false, error: message }))
    }
  }
  useEffect(() => {
    if (!currentNovelId || !currentChapterId) return
    if (
      core.pendingWhatIfRewriteLaunch
      || core.pendingFutureJumpRewriteLaunch
      || core.pendingContinueBlockRewriteLaunch
      || (core.activeMode === 'rewrite' && core.rewriteLaunchSource !== 'chapter')
    ) return
    let cancelled = false
    recoverableRestoreAbortControllerRef.current?.abort()
    const controller = new AbortController()
    recoverableRestoreAbortControllerRef.current = controller
    const hydrationGeneration = core.recoverablePanelHydrationGenerationRef.current
    const restoreLatestRecoverableRewriteJob = async () => {
      try {
        const job = await callGetRecoverableRewriteJobApi({ novelId: currentNovelId, branchId: currentBranchId, chapterId: currentChapterId, signal: controller.signal })
        if (!job || cancelled || core.recoverablePanelHydrationGenerationRef.current !== hydrationGeneration) return
        if (!recoverableRewriteJobMatchesContext(job, currentNovelId, currentBranchId, currentChapterId)) return
        const hasRecoverableResult = Boolean(job.result?.content?.trim())
        const shouldApply = job.status === 'queued' || job.status === 'running' || (job.status === 'succeeded' && hasRecoverableResult)
        if (!shouldApply) return
        core.ownedRecoverableRewriteJobIdRef.current = job.jobId
        core.setActiveMode('rewrite')
        core.hydrateRewritePanelFromRecoverableJob(job)
        core.syncRewriteJobFromRecoverableJob(job)
      } catch (error) {
        if (cancelled || core.recoverablePanelHydrationGenerationRef.current !== hydrationGeneration) return
        const message = resolveWorkspaceUserFacingError('rewrite-restore', error, locale)
        setSilentRecoverableRewriteFailure(message)
      }
    }
    void restoreLatestRecoverableRewriteJob()
    return () => {
      cancelled = true
      controller.abort()
      if (recoverableRestoreAbortControllerRef.current === controller) recoverableRestoreAbortControllerRef.current = null
    }
  }, [currentBranchId, currentChapterId, currentNovelId, locale])
  useEffect(() => {
    if (core.activeMode !== 'rewrite' || !core.rewriteFlow.jobId || !currentNovelId || !currentChapterId) return
    if (core.rewriteFlow.jobStatus !== 'queued' && core.rewriteFlow.jobStatus !== 'running') return
    const activeJobId = core.rewriteFlow.jobId
    if (core.ownedRecoverableRewriteJobIdRef.current !== activeJobId) return
    const ownershipGeneration = core.rewritePanelOwnershipGenerationRef.current
    const contextKey = core.recoverableRewriteContextKeyRef.current
    const novelId = currentNovelId
    const branchId = currentBranchId
    const chapterId = currentChapterId
    let cancelled = false
    let timeoutId: number | null = null
    const ownsPoll = () => (
      !cancelled
      && core.rewritePanelOwnershipGenerationRef.current === ownershipGeneration
      && core.recoverableRewriteContextKeyRef.current === contextKey
      && core.ownedRecoverableRewriteJobIdRef.current === activeJobId
    )
    const scheduleNextPoll = () => {
      if (!ownsPoll()) return
      timeoutId = window.setTimeout(() => {
        timeoutId = null
        void pollOnce()
      }, 1500)
    }
    const pollOnce = async () => {
      if (!ownsPoll()) return
      const existingRequest = rewritePollInFlightRef.current
      if (existingRequest) {
        await existingRequest
        if (ownsPoll()) scheduleNextPoll()
        return
      }
      const request = (async () => {
        recoverablePollAbortControllerRef.current?.abort()
        const controller = new AbortController()
        recoverablePollAbortControllerRef.current = controller
        try {
          const job = await callGetRecoverableRewriteJobApi({ jobId: activeJobId, novelId, branchId, chapterId, signal: controller.signal })
          if (!ownsPoll()) return
          if (!job || job.jobId !== activeJobId || !recoverableRewriteJobMatchesContext(job, novelId, branchId, chapterId)) {
            scheduleNextPoll()
            return
          }
          core.syncRewriteJobFromRecoverableJob(job)
          if (job.status === 'queued' || job.status === 'running') scheduleNextPoll()
        } catch (error) {
          if (!ownsPoll()) return
          const message = resolveWorkspaceUserFacingError('rewrite-refresh', error, locale)
          core.setRewriteFlow((current) => current.jobId === activeJobId ? { ...current, error: message } : current)
          core.setRewriteState((current) => ({ ...current, error: message }))
          scheduleNextPoll()
        } finally {
          if (recoverablePollAbortControllerRef.current === controller) recoverablePollAbortControllerRef.current = null
        }
      })()
      rewritePollInFlightRef.current = request
      try {
        await request
      } finally {
        if (rewritePollInFlightRef.current === request) rewritePollInFlightRef.current = null
      }
    }
    scheduleNextPoll()
    return () => {
      cancelled = true
      recoverablePollAbortControllerRef.current?.abort()
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [core.activeMode, core.rewriteFlow.jobId, core.rewriteFlow.jobStatus, core.syncRewriteJobFromRecoverableJob, currentBranchId, currentChapterId, currentNovelId, locale])
  const presetRevision = useNovelStore((state) => state.presetCompatLibrary.revision)
  const promptInputsKey = JSON.stringify([core.rewritePrompt, core.disabledContextBlockIds, presetRevision, core.buildPresetCompatRuntimeContext('rewrite')])
  const refreshPromptForChangedInputs = useEffectEvent(() => {
    if (core.activeMode !== 'rewrite' || !core.contextPanelOpen || !core.generationContext || contextPreviewInputsKeyRef.current === promptInputsKey) return
    void loadContextPreview('rewrite', undefined, undefined, { preserveDisabledBlocks: true })
  })
  useEffect(() => {
    const timer = setTimeout(refreshPromptForChangedInputs, 250)
    return () => clearTimeout(timer)
  }, [promptInputsKey, core.contextPanelOpen, core.generationContext])

  const handleRewritePromptChange = (value: SetStateAction<string>) => {
    core.invalidateRecoverablePanelHydration()
    core.setRewritePrompt(value)
  }
  const handleWritingSkillSelectionChange = (nextCardIds: string[]) => {
    const normalizedCardIds = normalizeWritingSkillCardIds({ writingSkillCardIds: nextCardIds })
    const nextSeed = !core.selectedWritingSkillCardIds.length && normalizedCardIds.length
      ? createWritingSkillRuntimeSeed()
      : core.writingSkillSeed
    core.invalidateRecoverablePanelHydration()
    core.setSelectedWritingSkillCardIds(normalizedCardIds)
    core.setWritingSkillSeed(nextSeed)
    const selectedCardIdSet = new Set(normalizedCardIds)
    core.setDisabledContextBlockIds((current) => current.filter((blockId) => {
      if (!isWritingSkillPromptBlockId(blockId)) return true
      const cardId = readWritingSkillCardIdFromPromptBlockId(blockId)
      return Boolean(cardId && selectedCardIdSet.has(cardId))
    }))
    window.setTimeout(() => {
      void loadContextPreview('rewrite', undefined, undefined, {
        preserveDisabledBlocks: true,
        writingSkillCardIds: normalizedCardIds,
        writingSkillExampleCount: core.writingSkillExampleCount,
        writingSkillSeed: nextSeed,
      })
    }, 0)
  }
  const handleWritingSkillExampleCountChange = (nextCount: number) => {
    core.invalidateRecoverablePanelHydration()
    core.setWritingSkillExampleCount(nextCount)
    window.setTimeout(() => {
      void loadContextPreview('rewrite', undefined, undefined, {
        preserveDisabledBlocks: true,
        writingSkillCardIds: core.selectedWritingSkillCardIds,
        writingSkillExampleCount: nextCount,
        writingSkillSeed: core.writingSkillSeed,
      })
    }, 0)
  }
  const handleSaveContinueBlock = async () => {
    const flushedEditor = core.flushEditorBuffer()
    const targetSelection = core.lockedSelectionText.trim() || core.selectionText.trim()
    const selectedCandidate = core.selectedRewriteCandidate?.content?.trim() || ''
    const continueCtx = core.activeContinueBlockRewriteContext
    const originalText = continueCtx?.originalText?.trim()
      || core.activeFutureJumpRewriteContext?.originalText.trim()
      || core.rewriteSourceTextOverride.trim()
      || flushedEditor?.plainText
      || core.chapterText
    if (!core.currentNovelId || !core.currentChapter || !targetSelection || !selectedCandidate || core.saveContinueBlockPending) return

    const parentTimelineNodeId = core.rewriteLaunchSource === 'continue_block'
      ? continueCtx?.nodeId ?? (activeWorkspaceSelection.kind === 'chapter' ? null : activeWorkspaceSelection.nodeId)
      : core.rewriteLaunchSource === 'future_jump'
        ? core.activeFutureJumpRewriteContext?.parentTimelineNodeId ?? (activeWorkspaceSelection.kind === 'chapter' ? null : activeWorkspaceSelection.nodeId)
        : activeWorkspaceSelection.kind === 'chapter'
          ? null
          : activeWorkspaceSelection.nodeId
    const persistedWritingSkillCardIds = core.selectedWritingSkillCardIds.filter(
      (cardId) => !core.disabledContextBlockIds.includes(`writing-skill:${cardId}`),
    )

    core.setSaveContinueBlockPending(true)
    core.setSaveContinueBlockError('')
    try {
      const isContinueBlockRegenerate = core.rewriteLaunchSource === 'continue_block' && continueCtx?.variant === 'regenerate'
      const createUserInstruction = core.rewritePrompt.trim()
        || core.activeFutureJumpRewriteContext?.userInstruction.trim()
        || t('workspace.action.saveCurrentRewriteResult')
      const sharedSkillConfig = {
        writingSkillCardIds: persistedWritingSkillCardIds,
        writingSkillExampleCount: core.writingSkillExampleCount,
      }
      const result = isContinueBlockRegenerate
        ? await callRegenerateContinueBlockApi({
            novelId: core.currentNovelId,
            branchId: core.storyTimelineBranchId,
            continueBlockId: continueCtx!.continueBlockId,
            selectedText: targetSelection,
            originalText,
            generatedText: selectedCandidate,
            inputTokens: core.selectedRewriteCandidate?.inputTokens ?? null,
            outputTokens: core.selectedRewriteCandidate?.outputTokens ?? null,
            userInstruction: core.rewritePrompt.trim() || continueCtx!.userInstruction.trim() || t('workspace.action.regenerateCurrentContinueBlock'),
            titleHint: core.selectedRewriteCandidate?.title?.trim() || core.rewritePrompt.trim().slice(0, 24),
            subtitleHint: core.selectedRewriteCandidate?.summary?.trim() || null,
            ...sharedSkillConfig,
          })
        : await callCreateContinueBlockApi({
            novelId: core.currentNovelId,
            branchId: core.storyTimelineBranchId,
            sourceChapterNo: core.currentChapter.order,
            parentTimelineNodeId,
            selectedText: targetSelection,
            originalText,
            generatedText: selectedCandidate,
            inputTokens: core.selectedRewriteCandidate?.inputTokens ?? null,
            outputTokens: core.selectedRewriteCandidate?.outputTokens ?? null,
            userInstruction: createUserInstruction,
            titleHint: core.selectedRewriteCandidate?.title?.trim() || core.rewritePrompt.trim().slice(0, 24),
            subtitleHint: core.selectedRewriteCandidate?.summary?.trim() || null,
            ...sharedSkillConfig,
          })
      const existingRegenerateNode = isContinueBlockRegenerate
        ? core.storyTimelineData?.branchNodes.find((node) => node.id === continueCtx?.nodeId || node.continueBlockId === continueCtx?.continueBlockId) ?? null
        : null
      const refreshedRegenerateNode = existingRegenerateNode
        ? {
            ...existingRegenerateNode,
            id: result.timelineNodeId,
            nodeType: result.nodeType,
            continueBlockId: result.continueBlockId,
            title: result.title,
            subtitle: result.subtitle,
            readableLabel: result.readableLabel,
            readableLineageLabel: result.readableLineageLabel,
            currentText: result.generatedText,
            latestText: result.generatedText,
            latestRevisionNo: result.latestRevisionNo,
            inputTokens: core.selectedRewriteCandidate?.inputTokens ?? existingRegenerateNode.inputTokens,
            outputTokens: core.selectedRewriteCandidate?.outputTokens ?? existingRegenerateNode.outputTokens,
            userInstruction: createUserInstruction,
            selectedText: targetSelection,
            originalText,
            writingSkillCardIds: result.writingSkillCardIds,
            writingSkillExampleCount: result.writingSkillExampleCount,
            status: 'revised',
          } satisfies StoryTimelineBranchNode
        : null
      const optimisticNode = refreshedRegenerateNode ?? createOptimisticContinueBlockTimelineNode({
        result,
        storyTimeline: core.storyTimelineData,
        parentTimelineNodeId,
        sourceChapterNo: core.currentChapter.order,
        selectedText: targetSelection,
        originalText,
        generatedText: result.generatedText,
        inputTokens: core.selectedRewriteCandidate?.inputTokens ?? null,
        outputTokens: core.selectedRewriteCandidate?.outputTokens ?? null,
        userInstruction: createUserInstruction,
      })
      if (optimisticNode) {
        core.setStoryTimelineData((current) => upsertOptimisticContinueBlockTimelineNode(current, optimisticNode, {
          novelId: core.currentNovelId,
          branchId: core.storyTimelineBranchId,
          chapters: current?.chapters ?? core.resolvedStoryTimeline.chapters,
        }))
        core.setChapterListState((current) => {
          const storedTarget = current[core.currentNovelId] ?? core.chapterListTarget
          const nextTarget = resolveChapterListTargetForAnchorVisibility({
            anchorChapterNo: optimisticNode.anchorChapterNo,
            currentTarget: Math.max(storedTarget, core.chapterListTarget),
            sortedChapters: core.sortedChapters,
          })
          if (nextTarget <= storedTarget) return current
          return { ...current, [core.currentNovelId]: nextTarget }
        })
      }
      core.closePanel()
      core.setCenterPaneView('body')
      core.setWorkspaceSelection(resolveContinueBlockSelectionAfterSave({
        matchingNode: optimisticNode,
        result,
        fallbackAnchorChapterNo: core.currentChapter.order,
        parentTimelineNodeId,
      }))
      core.setLeftPanelOpen(false)
      core.setToast(isContinueBlockRegenerate
        ? t('workspace.action.continueBlockUpdated', { title: result.title })
        : t('workspace.action.continueBlockCreated', { title: result.title }))
      window.setTimeout(() => core.setToast(''), 2200)
      void core.loadStoryTimeline()
    } catch (error) {
      const message = resolveWorkspaceUserFacingError('continue-block-save', error, locale)
      core.setSaveContinueBlockError(message)
      core.setToast(message, 'error')
      window.setTimeout(() => core.setToast(''), 2400)
    } finally {
      core.setSaveContinueBlockPending(false)
    }
  }
  const handleCreateWhatIf = async () => {
    const targetSelection = core.lockedSelectionText.trim() || core.selectionText.trim()
    const selectedCandidate = core.selectedRewriteCandidate?.content?.trim() || ''
    if (
      !core.currentNovelId
      || !core.currentChapter
      || !targetSelection
      || !selectedCandidate
      || core.saveContinueBlockPending
      || whatIfCreateInFlightRef.current
    ) return
  
    whatIfCreateInFlightRef.current = true
    core.setSaveContinueBlockPending(true)
    core.setSaveContinueBlockError('')
    try {
      const result = await callCreateWhatIfSessionApi({
        novelId: core.currentNovelId,
        branchId: core.generationContext?.branchId ?? `${core.currentNovelId}:main`,
        sourceChapterNo: core.currentChapter.order,
        selectedText: targetSelection,
        originalText: core.chapterText,
        generatedText: selectedCandidate,
        inputTokens: core.selectedRewriteCandidate?.inputTokens ?? null,
        outputTokens: core.selectedRewriteCandidate?.outputTokens ?? null,
        userInstruction: core.rewritePrompt.trim(),
        titleHint: core.rewritePrompt.trim().slice(0, 24),
      })
      const refreshed = await core.loadStoryTimeline()
      core.closePanel()
      core.setWorkspaceSelection(resolveBranchTimelineSelection({
        kind: 'what_if',
        nodeId: result.timelineNodeId,
        sessionId: result.sessionId,
        anchorChapterNo: core.currentChapter.order,
      }, refreshed?.branchNodes ?? []))
      core.setLeftPanelOpen(false)
      core.setToast(t('workspace.action.whatIfCreated', { title: result.title }))
      window.setTimeout(() => core.setToast(''), 2200)
    } catch (error) {
      const message = resolveWorkspaceUserFacingError('what-if-create', error, locale)
      core.setSaveContinueBlockError(message)
      core.setToast(message, 'error')
      window.setTimeout(() => core.setToast(''), 2400)
    } finally {
      whatIfCreateInFlightRef.current = false
      core.setSaveContinueBlockPending(false)
    }
  }

  const openChapterWorkspace = (chapter: Chapter) => { core.flushEditorBuffer(); core.handleTimelineSelection(toChapterTimelineSelection(chapter)); core.setCenterPaneView('body') }
  const reopenWhatIfRewriteFlow = (detail: WhatIfSessionDetail, variant: 'regenerate' | 'continue') => { const sourceChapter = core.resolveSourceChapter({ chapterId: null, chapterNo: detail.sourceChapterNo }); if (!sourceChapter) { core.setToast(t('workspace.action.reopenWhatIfMissingChapter', { chapter: detail.sourceChapterNo }), 'warning'); return window.setTimeout(() => core.setToast(''), 2400) } core.invalidateRecoverableRewriteOwnership(); core.setCenterPaneView('body'); core.setLeftPanelOpen(false); setPresetCompatSessionPhase({ kind: 'what_if', nodeId: activeWorkspaceSelection.kind === 'what_if' ? activeWorkspaceSelection.nodeId : `what-if:${detail.id}`, sessionId: detail.id, anchorChapterNo: detail.sourceChapterNo }, 'rewrite', variant === 'continue' ? 'continue' : 'new_chat', variant !== 'continue'); core.setPendingWhatIfRewriteLaunch({ detail, targetChapterId: sourceChapter.id, variant }); core.flushEditorBuffer(); setCurrentChapterId(sourceChapter.id) }
  const launchFutureMapFromWhatIf = (detail: WhatIfSessionDetail) => { const sourceChapter = core.resolveSourceChapter({ chapterId: null, chapterNo: detail.sourceChapterNo }); core.setFutureMapLaunch({ novelId: detail.novelId, branchId: detail.baseBranchId, sourceContext: { nodeId: activeWorkspaceSelection.kind === 'what_if' ? activeWorkspaceSelection.nodeId : null, nodeType: 'what_if', chapterId: sourceChapter?.id ?? null, chapterNo: detail.sourceChapterNo, whatIfSessionId: detail.id }, title: detail.title, parentTimelineNodeId: activeWorkspaceSelection.kind === 'what_if' ? activeWorkspaceSelection.nodeId : null }) }
  const handleFutureJumpCreated = async (result: FutureJumpMutationResponse, context: { sourceChapterNo: number; targetChapterNo: number }) => { if (!result.timelineNodeId) throw new Error(t('workspace.action.futureJumpTimelineNodeMissing')); core.setFutureMapLaunch(null); const refreshed = await core.loadStoryTimeline(); core.setWorkspaceSelection(resolveBranchTimelineSelection({ kind: 'future_jump', nodeId: result.timelineNodeId, runId: result.runId, sourceChapterNo: context.sourceChapterNo, targetChapterNo: context.targetChapterNo }, refreshed?.branchNodes ?? [])); core.setLeftPanelOpen(false) }
  const reopenFutureJumpRewriteFlow = (context: FutureJumpContinueContext) => { const targetChapter = core.resolveSourceChapter({ chapterId: context.targetChapter?.chapterId ?? null, chapterNo: context.targetChapter?.chapterNo ?? context.detail.targetChapterNo }); if (!targetChapter) { core.setToast(t('workspace.action.reopenFutureJumpMissingChapter', { chapter: context.detail.targetChapterNo }), 'warning'); return window.setTimeout(() => core.setToast(''), 2400) } core.invalidateRecoverableRewriteOwnership(); const targetTitle = context.targetChapter?.chapterTitle?.trim() || context.targetEvent?.title?.trim() || t('workspace.action.futureJumpTargetFallback', { chapter: context.detail.targetChapterNo }); const selectedText = context.detail.generatedTargetText.trim(); const userInstruction = [context.detail.userDirection.trim() ? t('workspace.action.originalDirection', { text: context.detail.userDirection.trim() }) : '', t('workspace.action.targetFutureNode', { title: targetTitle }), t('workspace.action.latestBridgeSummary', { text: context.detail.bridgeSummary }), t('workspace.action.futureJumpContinueInstruction')].filter(Boolean).join('\n\n'); core.setCenterPaneView('body'); core.setLeftPanelOpen(false); setPresetCompatSessionPhase({ kind: 'future_jump', nodeId: activeWorkspaceSelection.kind === 'future_jump' ? activeWorkspaceSelection.nodeId : `future-jump:${context.detail.id}`, runId: context.detail.id, sourceChapterNo: context.detail.sourceChapterNo, targetChapterNo: context.detail.targetChapterNo }, 'rewrite', 'continue'); core.setPendingFutureJumpRewriteLaunch({ detail: context.detail, targetChapterId: targetChapter.id, targetTitle, parentTimelineNodeId: context.detail.timelineNodeId, selectedText, originalText: selectedText, userInstruction, inputTokens: context.detail.inputTokens ?? null, outputTokens: context.detail.outputTokens ?? null }); core.flushEditorBuffer(); setCurrentChapterId(targetChapter.id) }
  const reopenContinueBlockRewriteFlow = (variant: 'continue' | 'regenerate') => {
    if (
      (activeWorkspaceSelection.kind !== 'rewrite' && activeWorkspaceSelection.kind !== 'continue_block')
      || !selectedContinueBlockNode?.continueBlockId
    ) return
    const anchorChapter = core.resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.anchorChapterNo })
    if (!anchorChapter) {
      core.setToast(t('workspace.action.reopenContinueBlockMissingChapter', { chapter: activeWorkspaceSelection.anchorChapterNo }), 'warning')
      return window.setTimeout(() => core.setToast(''), 2400)
    }

    const activeCardIds = new Set(core.writingSkillCards.map((card) => card.id))
    const persistedWritingSkillCardIds = normalizeWritingSkillCardIds({
      writingSkillCardIds: selectedContinueBlockNode.writingSkillCardIds,
    })
    const inheritedWritingSkillCardIds = core.writingSkillCardsLoading
      ? persistedWritingSkillCardIds
      : persistedWritingSkillCardIds.filter((cardId) => activeCardIds.has(cardId))
    const inheritedExampleCount = selectedContinueBlockNode.writingSkillExampleCount ?? core.writingSkillExampleCount
    const taskSeed = createWritingSkillRuntimeSeed()

    core.invalidateRecoverableRewriteOwnership()
    core.setCenterPaneView('body')
    core.setLeftPanelOpen(false)
    setPresetCompatSessionPhase(
      toContinueBranchSelection(activeWorkspaceSelection),
      'rewrite',
      variant === 'continue' ? 'continue' : 'new_chat',
      variant !== 'continue',
    )
    core.setPendingContinueBlockRewriteLaunch({
      continueBlockId: activeWorkspaceSelection.continueBlockId,
      nodeId: activeWorkspaceSelection.nodeId,
      anchorChapterNo: activeWorkspaceSelection.anchorChapterNo,
      latestText: selectedContinueBlockNode.latestText?.trim() || '',
      userInstruction: selectedContinueBlockNode.userInstruction?.trim() || '',
      selectedText: selectedContinueBlockNode.selectedText?.trim() || selectedContinueBlockNode.latestText?.trim() || '',
      originalText: selectedContinueBlockNode.originalText?.trim() || selectedContinueBlockNode.latestText?.trim() || '',
      title: selectedContinueBlockNode.title,
      subtitle: selectedContinueBlockNode.subtitle ?? null,
      inputTokens: selectedContinueBlockNode.inputTokens ?? null,
      outputTokens: selectedContinueBlockNode.outputTokens ?? null,
      writingSkillCardIds: inheritedWritingSkillCardIds,
      writingSkillExampleCount: inheritedExampleCount,
      writingSkillSeed: taskSeed,
      targetChapterId: anchorChapter.id,
      variant,
    })
    core.flushEditorBuffer()
    setCurrentChapterId(anchorChapter.id)
  }

  const renderSelectionActions = (revisionSelector?: ReactNode) => <WorkspaceSelectionActions revisionSelector={revisionSelector} selection={activeWorkspaceSelection} selectedTimelineDisplayLabel={selectedTimelineDisplayLabel} selectedTimelineNodeTitle={selectedTimelineNode?.title ?? null} selectedTimelineInstructionText={selectedTimelineInstructionText} selectionText={core.selectionText} activeMode={core.activeMode} roleplaySessionStarting={core.roleplaySessionStarting} hasFutureMapLaunch={Boolean(selectedContinueBlockFutureMapLaunch)} onClearSelection={() => { window.getSelection()?.removeAllRanges(); core.setSelectionText(''); core.setToolbarPos(null) }} onOpenActionMode={(mode) => { void openActionMode(mode) }} onReopenContinueBlockRewriteFlow={reopenContinueBlockRewriteFlow} onOpenContinueBlockFutureJump={() => { if (selectedContinueBlockFutureMapLaunch) core.setFutureMapLaunch(selectedContinueBlockFutureMapLaunch) }} onOpenAnchorChapter={() => { if (activeWorkspaceSelection.kind === 'chapter' || activeWorkspaceSelection.kind === 'future_jump') return; const anchorChapter = core.resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.anchorChapterNo }); if (anchorChapter) openChapterWorkspace(anchorChapter) }} onOpenFutureJumpSourceChapter={() => { if (activeWorkspaceSelection.kind !== 'future_jump') return; const sourceChapter = core.resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.sourceChapterNo }); if (sourceChapter) openChapterWorkspace(sourceChapter) }} onOpenFutureJumpTargetChapter={() => { if (activeWorkspaceSelection.kind !== 'future_jump') return; const targetChapter = core.resolveSourceChapter({ chapterId: null, chapterNo: activeWorkspaceSelection.targetChapterNo }); if (targetChapter) openChapterWorkspace(targetChapter) }} />
  const selectionActions = renderSelectionActions()
  const knowledgeControls = <WorkspaceKnowledgeControls knowledgeRebuilding={core.knowledgeRebuilding} knowledgeRebuildActive={core.knowledgeRebuildActive} knowledgeActionLoading={core.knowledgeActionLoading} knowledgeRebuildPaused={core.knowledgeRebuildPaused} knowledgeRebuildFailed={core.knowledgeRebuildFailed} knowledgeRebuildRangeMode={core.knowledgeRebuildRangeMode} knowledgeRebuildFirstChapterCount={core.knowledgeRebuildFirstChapterCount} knowledgeRebuildStartChapter={core.knowledgeRebuildStartChapter} knowledgeRebuildEndChapter={core.knowledgeRebuildEndChapter} selectedKnowledgeRebuildChapterRangeLabel={core.selectedKnowledgeRebuildChapterRangeLabel} knowledgeStatusOverview={core.knowledgeStatusOverview} currentKnowledgeJobBusy={core.currentKnowledgeJobBusy} knowledgeGraphOverview={core.knowledgeGraphOverview} extractionCacheOverview={core.extractionCacheOverview} embeddingCacheOverview={core.embeddingCacheOverview} retrievalIndexOverview={core.retrievalIndexOverview} retrievalIndexStatusLine={core.retrievalIndexStatusLine} retrievalTaskStatus={core.retrievalTaskStatus} retrievalTaskStatusLabel={core.retrievalTaskStatusLabel} retrievalTaskPhaseLabel={core.retrievalTaskPhaseLabel} retrievalControlsState={core.retrievalControlsState} mainKnowledgeRebuildStatus={core.mainKnowledgeRebuildStatus} knowledgeRebuildFailureMessage={core.knowledgeRebuildFailureMessage} knowledgeRebuildEtaMinutes={core.knowledgeRebuildEtaMinutes} hanlpBootstrapStatusLine={core.hanlpBootstrapStatusLine} hanlpBootstrapCompletedChapterCount={core.hanlpBootstrapCompletedChapterCount} hanlpBootstrapTotalChapterCount={core.hanlpBootstrapTotalChapterCount} hanlpCacheStatusLabel={core.hanlpCacheStatusLabel} hanlpBootstrapCacheHitRatePercent={core.hanlpBootstrapCacheHitRatePercent} hanlpBootstrapPhaseLabel={core.hanlpBootstrapPhaseLabel} hanlpBootstrapEtaLabel={core.hanlpBootstrapEtaLabel} hanlpBootstrapTimingLabel={core.hanlpBootstrapTimingLabel} hanlpSettingsLine={core.hanlpSettingsLine} rawTextEmbeddingStatusLine={core.rawTextEmbeddingStatusLine} rawTextEmbeddingActive={core.rawTextEmbeddingActive} rawTextEmbeddingPhaseBadge={core.rawTextEmbeddingPhaseBadge} rawTextEmbeddingCacheHitRatePercent={core.rawTextEmbeddingCacheHitRatePercent} rawTextEmbeddingTimingLabel={core.rawTextEmbeddingTimingLabel} rawTextEmbeddingSettingsLine={core.rawTextEmbeddingSettingsLine} knowledgeRebuildSteps={core.knowledgeRebuildSteps} currentKnowledgeRunningStepKey={core.currentKnowledgeRunningStepKey} confirmDeleteHanlpCache={core.confirmDeleteHanlpCache} confirmDeleteExtractionCache={core.confirmDeleteExtractionCache} confirmDeleteEmbeddingCache={core.confirmDeleteEmbeddingCache} confirmDeleteKnowledge={core.confirmDeleteKnowledge} hanlpCacheDeleteState={core.hanlpCacheDeleteState} extractionCacheDeleteState={core.extractionCacheDeleteState} embeddingCacheDeleteState={core.embeddingCacheDeleteState} onRebuildKnowledge={() => { void handleRebuildKnowledge() }} onPauseKnowledge={() => { void handlePauseKnowledge() }} onAbortKnowledge={() => { void handleAbortKnowledge() }} onRebuildRetrievalIndex={() => { void handleRebuildRetrievalIndex() }} onSetKnowledgeRebuildRangeMode={core.setKnowledgeRebuildRangeMode} onSetKnowledgeRebuildFirstChapterCount={core.setKnowledgeRebuildFirstChapterCount} onSetKnowledgeRebuildStartChapter={core.setKnowledgeRebuildStartChapter} onSetKnowledgeRebuildEndChapter={core.setKnowledgeRebuildEndChapter} onToggleConfirmDeleteHanlpCache={() => core.setConfirmDeleteHanlpCache((current) => !current)} onToggleConfirmDeleteExtractionCache={() => core.setConfirmDeleteExtractionCache((current) => !current)} onToggleConfirmDeleteEmbeddingCache={() => core.setConfirmDeleteEmbeddingCache((current) => !current)} onToggleConfirmDeleteKnowledge={() => core.setConfirmDeleteKnowledge((current) => !current)} onCancelDeleteHanlpCache={() => core.setConfirmDeleteHanlpCache(false)} onCancelDeleteExtractionCache={() => core.setConfirmDeleteExtractionCache(false)} onCancelDeleteEmbeddingCache={() => core.setConfirmDeleteEmbeddingCache(false)} onCancelDeleteKnowledge={() => core.setConfirmDeleteKnowledge(false)} onDeleteHanlpCache={() => { void handleDeleteHanlpCache() }} onDeleteExtractionCache={() => { void handleDeleteExtractionCache() }} onDeleteEmbeddingCache={() => { void handleDeleteEmbeddingCache() }} onDeleteKnowledgeGraph={() => { void handleDeleteKnowledgeGraph() }} />

  return { openActionMode, handleRefreshContextReview, handleExcludedGenerationContextChange, handleConfirmGraphEdge: async (edgeId: string) => handleGraphEdgeMutation(edgeId, () => callGraphEdgeConfirmApi(edgeId, core.currentNovelId)), handleRejectGraphEdge: async (edgeId: string) => handleGraphEdgeMutation(edgeId, () => callGraphEdgeRejectApi(edgeId, core.currentNovelId)), handleSaveGraphEdgeEdit: async (edgeId: string, draft: GraphEdgeEditDraft) => handleGraphEdgeMutation(edgeId, () => callGraphEdgeEditApi(edgeId, core.currentNovelId, { linkType: draft.linkType.trim(), label: draft.label.trim() || null, description: draft.description.trim() || null, polarity: draft.polarity || null, strength: draft.strength, validFromChapter: draft.validFromChapter, validUntilChapter: draft.validUntilChapter.trim() ? Number(draft.validUntilChapter.trim()) : null, includeByDefault: draft.includeByDefault })), handleGraphControlChange, copyText, applyFullChapter, saveSettings, loadOllamaModels, loadOpenAICompatibleModels, handleDeleteNovel, handleDeleteChapter, handleTimelineDeleteChapter, handleDeleteBranchNode, handleRewritePromptChange, handleWritingSkillSelectionChange, handleWritingSkillExampleCountChange, handleRewrite, handleAbortRewriteGeneration, handleSaveContinueBlock, handleCreateWhatIf, reopenWhatIfRewriteFlow, launchFutureMapFromWhatIf, handleFutureJumpCreated, reopenFutureJumpRewriteFlow, reopenContinueBlockRewriteFlow, selectionActions, renderSelectionActions, knowledgeControls }
}

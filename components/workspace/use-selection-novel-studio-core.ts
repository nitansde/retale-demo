"use client"

import { formatProgressMessage, isRawEmbeddingProgress } from '@/lib/i18n/progress-message'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { NoticeVariant } from '@/components/ui/Notice'
import { createChapterEditorBuffer } from '@/components/workspace/chapter-editor-buffer'
import { useChapterReaderMode } from '@/components/workspace/use-chapter-reader-mode'
import { Building2, Globe, LoaderCircle, MapPin, ScrollText, Users } from 'lucide-react'
import {
  type PendingSourceJump,
  useWorkspaceChapterSelection,
  type WorkspaceActionMode,
  type WorkspaceFloatingPosition,
} from '@/components/workspace/use-workspace-chapter-selection'
import { type WorkspaceRefTab, useWorkspacePaneState } from '@/components/workspace/use-workspace-pane-state'
import { useDesktopWorkspaceLayout } from '@/components/workspace/use-desktop-workspace-layout'
import {
  readWorkspaceSelectionFromSearchParams,
  resolveWorkspaceSelection,
  toChapterTimelineSelection,
  writeWorkspaceSelectionToSearchParams,
} from '@/components/workspace/workspace-selection'
import { normalizeAISettings } from '@/lib/ai-settings'
import {
  canRestoreChapterDraftWithoutConflict,
  clearAcknowledgedChapterDrafts,
  readChapterDraft,
  removeChapterDraft,
  writeChapterDraft,
} from '@/lib/chapter-draft-cache'
import { useI18n } from '@/lib/i18n/provider'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import type { WritingSkillCard } from '@/lib/writing-skill-types'
import { WRITING_SKILL_DEFAULTS } from '@/lib/writing-skill-defaults'
import {
  createWritingSkillRuntimeSeed,
  normalizeWritingSkillCardIds,
} from '@/lib/writing-skill-selection'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import { createPresetCompatSessionStateKey } from '@/lib/workspace-state'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import {
  AI_SCENARIO_META,
  getAIScenarioMeta,
  buildChapterLineExcerpt,
  callChapterGraphContextApi,
  CHAPTER_PAGE_SIZE,
  DEFAULT_GRAPH_REVIEW_CONTROLS,
  DEFAULT_REWRITE_PROMPT,
  extractSelection,
  filterWorkspaceVisibleCharacters,
  findSourceBlock,
  formatEmbeddingProviderLabel,
  formatKnowledgeCoverageBadge,
  formatKnowledgeCoverageDetail,
  formatKnowledgeEtaLabel,
  formatKnowledgeJobStatusLabel,
  formatKnowledgeRebuildChapterRangeLabel,
  formatStageDuration,
  formatRetrievalIndexDetail,
  GenerationState,
  groupWorldEntriesForWorkspaceRail,
  HANLP_BOOTSTRAP_STAGE_KEY,
  HANLP_CACHE_STATUS_LABELS,
  HanlpCacheSnapshot,
  KnowledgeActionLoading,
  KnowledgeRebuildRangeMode,
  KnowledgeRebuildStatus,
  KnowledgeStatusOverview,
  normalizeKnowledgeRebuildChapterRangeInput,
  normalizeSourceSearchText,
  OllamaModelOption,
  OpenAICompatibleModelOption,
  OUTLINE_TYPE_LABELS,
  PendingContinueBlockRewriteLaunch,
  PendingFutureJumpRewriteLaunch,
  PendingWhatIfRewriteLaunch,
  RAW_TEXT_PRECOMPUTE_STAGE_KEY,
  RecoverableRewriteJob,
  resolveCacheDeleteState,
  resolveCurrentNodeMetrics,
  resolveGraphSelection,
  resolveHanlpCacheDeleteState,
  resolveKnowledgeJobPhaseLabel,
  resolveKnowledgeRebuildFailureMessage,
  resolveRetrievalTaskControlsState,
  RewriteFlowState,
  RewriteLaunchSource,
  shouldLoadWorkspaceFromBackendOnMount,
  sortCharactersForWorkspaceRail,
  FutureMapLaunchState,
  TOOLBAR_EDGE_PADDING,
  TOOLBAR_OFFSET_Y,
  toPresetCompatSessionSurfaceId,
  toProgressPercent,
  toRewriteCandidateFromRecoverableResult,
} from '@/components/workspace/selection-novel-studio-helpers'
import type {
  ChapterGraphContextData,
  GenerationContextBuildData,
  GraphReviewControls,
  GraphSelection,
} from '@/components/graph/types'
import type { GraphEdge } from '@/lib/server/graph-types'
import { countChineseFriendlyWords, htmlToPlainText } from '@/lib/utils'
import type {
  ChapterTimelineItem,
  StoryTimelineResponse,
  TimelineSelection,
} from '@/lib/story-branch-types'
import type {
  AIProvider,
  AISettings,
  AIScenarioKey,
  Chapter,
  Character,
  OutlineItem,
  TimelineEvent,
  WorldEntry,
} from '@/lib/types'
import type { KnowledgeProjectionResult, WorkspaceSaveFeedback, WorkspaceSaveOptions } from '@/store/novel-store-types'
import { requestClientGet } from '@/lib/client-request-broker'

type SelectionNovelStudioCoreParams = {
  loadFromBackend: () => Promise<unknown>
  saveToBackend: (options?: WorkspaceSaveOptions) => Promise<unknown>
  isNovelDeletionPending: boolean
  backendLoaded: boolean
  currentNovelId: string
  localNovels: Array<{ id: string; title: string }>
  localChapters: Chapter[]
  currentChapterId: string
  setCurrentChapterId: (chapterId: string) => void
  updateChapterContent: (chapterId: string, content: string, wordCount?: number) => void
  aiSettings: AISettings | undefined
  setAISettings: (settings: AISettings) => void
  refreshKnowledgeProjection: (novelId: string, asOfChapter?: number, signal?: AbortSignal) => Promise<KnowledgeProjectionResult>
  clearPresetCompatSessionStateForSelection: (selection: TimelineSelection) => void
  resetPresetCompatSessionStateForSelection: (selection: TimelineSelection, surfaces: PresetCompatSurfaceId[]) => void
  presetCompatSessionState: Record<string, { phase?: string | null } | undefined>
  localCharacters: Character[]
  localWorldEntries: WorldEntry[]
  localTimelineEvents: TimelineEvent[]
  localOutlines: OutlineItem[]
  autosaveTarget: string
  readAutosaveTarget?: () => string
  workspaceSaveFeedback: WorkspaceSaveFeedback | null
}

type TimelineSelectionOptions = {
  preserveRecoverableRewriteOwnership?: boolean
}

type RestoreWorkspaceSelectionOptions = {
  preserveRecoverableRewriteOwnershipForCurrentChapter?: boolean
}

type WorkspaceSelectionHistoryMode = 'push' | 'replace' | 'none'
const MAX_NAVIGATION_SAVE_PASSES = 8
const MAX_LIFECYCLE_SAVE_PASSES = 2

function clampToolbarPosition(position: WorkspaceFloatingPosition, toolbar: HTMLElement | null) {
  if (!toolbar) return position
  const rect = toolbar.getBoundingClientRect()
  const top = Math.min(Math.max(position.top, TOOLBAR_EDGE_PADDING), window.innerHeight - rect.height - TOOLBAR_EDGE_PADDING)
  const left = Math.min(Math.max(position.left, rect.width / 2 + TOOLBAR_EDGE_PADDING), window.innerWidth - rect.width / 2 - TOOLBAR_EDGE_PADDING)
  return top === position.top && left === position.left ? position : { top, left }
}

export function resolveSelectedKnowledgeProjectionChapterOrder(params: {
  currentChapterId: string
  localChapters: Chapter[]
  workspaceSelection: TimelineSelection | null
  timelineNodeById: Map<string, StoryTimelineResponse['branchNodes'][number]>
}): number | undefined {
  const { currentChapterId, localChapters, workspaceSelection, timelineNodeById } = params

  if (workspaceSelection?.kind === 'chapter') {
    return localChapters.find((chapter) => chapter.id === workspaceSelection.chapterId)?.order ?? workspaceSelection.chapterNo
  }

  if (workspaceSelection) {
    const selectedTimelineNode = timelineNodeById.get(workspaceSelection.nodeId)
    const sourceChapterNo = selectedTimelineNode?.sourceChapterNo ?? selectedTimelineNode?.anchorChapterNo
    if (typeof sourceChapterNo === 'number' && Number.isFinite(sourceChapterNo)) {
      return sourceChapterNo
    }

    if (workspaceSelection.kind === 'future_jump') {
      return workspaceSelection.sourceChapterNo
    }

    return workspaceSelection.anchorChapterNo
  }

  return localChapters.find((chapter) => chapter.id === currentChapterId)?.order
}

export function mergeKnowledgeStatusOverview(
  current: KnowledgeStatusOverview | null,
  incoming: KnowledgeStatusOverview | null | undefined
): KnowledgeStatusOverview | null {
  if (!incoming) return current
  if (!current) return incoming

  const currentEmbedding = current.embeddingCache
  const incomingEmbedding = incoming.embeddingCache
  const embeddingGenerationChanged = currentEmbedding.provider !== incomingEmbedding.provider
    || currentEmbedding.model !== incomingEmbedding.model
    || currentEmbedding.totalChapterCount !== incomingEmbedding.totalChapterCount
  const incomingClearsCoverage = incomingEmbedding.status === 'missing'
    || incomingEmbedding.coveredChapterCount === 0

  return {
    knowledgeGraph: incoming.knowledgeGraph,
    extractionCache: incoming.extractionCache,
    embeddingCache: embeddingGenerationChanged || incomingClearsCoverage
      ? incomingEmbedding
      : currentEmbedding,
    retrievalIndex: incoming.retrievalIndex,
  }
}

export function resolveReferenceResourcesVisible(desktop: boolean, matchMediaAvailable: boolean, referencePanelOpen: boolean) {
  return desktop || !matchMediaAvailable || referencePanelOpen
}

export function isReferenceMatchMediaAvailable() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

export function useSelectionNovelStudioCore(params: SelectionNovelStudioCoreParams) {
  const { locale, t } = useI18n()
  const backendLoaded = params.backendLoaded
  const updateChapterContent = params.updateChapterContent
  const scenarioMeta = getAIScenarioMeta(locale)
  const router = useRouter()
  const desktopWorkspaceLayout = useDesktopWorkspaceLayout()
  const {
    leftPanelOpen,
    setLeftPanelOpen,
    referencePanelOpen,
    setReferencePanelOpen,
    knowledgePanelOpen,
    setKnowledgePanelOpen,
    chapterListState,
    setChapterListState,
    centerPaneView,
    setCenterPaneView,
    refTab,
    setRefTab,
    settingsOpen,
    setSettingsOpen,
    confirmDeleteKnowledge,
    setConfirmDeleteKnowledge,
  } = useWorkspacePaneState()
  const referenceResourcesVisible = resolveReferenceResourcesVisible(
    desktopWorkspaceLayout,
    isReferenceMatchMediaAvailable(),
    referencePanelOpen,
  )
  const [selectionText, setSelectionText] = useState('')
  const [lockedSelectionText, setLockedSelectionText] = useState('')
  const [toolbarPos, setToolbarPos] = useState<WorkspaceFloatingPosition | null>(null)
  const [activeMode, setActiveMode] = useState<WorkspaceActionMode | null>(null)
  const [rewritePrompt, setRewritePrompt] = useState(t('workspace.rewrite.defaultPrompt'))
  const [rewriteState, setRewriteState] = useState<GenerationState>({ loading: false, result: '', error: '' })
  const [rewriteFlow, setRewriteFlow] = useState<RewriteFlowState>({
    loading: false,
    error: '',
    provider: '',
    candidates: [],
    selectedIndex: 0,
    jobId: null,
    jobStatus: null,
    jobCurrentStep: null,
  })
  const [writingSkillCards, setWritingSkillCards] = useState<WritingSkillCard[]>([])
  const [writingSkillCardsLoading, setWritingSkillCardsLoading] = useState(true)
  const [writingSkillCardsError, setWritingSkillCardsError] = useState('')
  const [selectedWritingSkillCardIds, setSelectedWritingSkillCardIds] = useState<string[]>([])
  const [writingSkillExampleCount, setWritingSkillExampleCount] = useState<number>(WRITING_SKILL_DEFAULTS.defaultRuntimeExampleCount)
  const [writingSkillSeed, setWritingSkillSeed] = useState(1)
  const [generationContext, setGenerationContext] = useState<GenerationContextBuildData | null>(null)
  const [graphContext, setGraphContext] = useState<GenerationContextBuildData['graphContext'] | null>(null)
  const [contextPreviewLoading, setContextPreviewLoading] = useState(false)
  const [contextPreviewError, setContextPreviewError] = useState('')
  const [graphReviewLoading, setGraphReviewLoading] = useState(false)
  const [currentBranchMetricsOverride, setCurrentBranchMetricsOverride] = useState<{
    nodeId: string
    currentText: string
    inputTokens: number | null
    outputTokens: number | null
  } | null>(null)
  const continueBlockMetricsNodeIdRef = useRef<string | null>(null)
  const whatIfMetricsNodeIdRef = useRef<string | null>(null)
  const futureJumpMetricsNodeIdRef = useRef<string | null>(null)
  const updateBranchMetricsOverride = useCallback((nodeId: string, metrics: {
    currentText: string
    inputTokens: number | null
    outputTokens: number | null
  }) => {
    setCurrentBranchMetricsOverride((current) => {
      if (
        current?.nodeId === nodeId
        && current.currentText === metrics.currentText
        && current.inputTokens === metrics.inputTokens
        && current.outputTokens === metrics.outputTokens
      ) {
        return current
      }

      return { nodeId, ...metrics }
    })
  }, [])
  const handleWhatIfMetricsChange = useCallback((metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => {
    const nodeId = whatIfMetricsNodeIdRef.current
    if (!nodeId) return
    updateBranchMetricsOverride(nodeId, metrics)
  }, [updateBranchMetricsOverride])
  const handleContinueBlockMetricsChange = useCallback((metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => {
    const nodeId = continueBlockMetricsNodeIdRef.current
    if (!nodeId) return
    updateBranchMetricsOverride(nodeId, metrics)
  }, [updateBranchMetricsOverride])
  const handleFutureJumpMetricsChange = useCallback((metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => {
    const nodeId = futureJumpMetricsNodeIdRef.current
    if (!nodeId) return
    updateBranchMetricsOverride(nodeId, metrics)
  }, [updateBranchMetricsOverride])
  const [graphReviewControls, setGraphReviewControls] = useState<GraphReviewControls>(DEFAULT_GRAPH_REVIEW_CONTROLS)
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [graphSelection, setGraphSelection] = useState<GraphSelection>(null)
  const [disabledContextBlockIds, setDisabledContextBlockIds] = useState<string[]>([])
  const [excludedGraphEdgeIds, setExcludedGraphEdgeIds] = useState<string[]>([])
  const [excludedEvidenceIds, setExcludedEvidenceIds] = useState<string[]>([])
  const [graphMutationPendingId, setGraphMutationPendingId] = useState<string | null>(null)
  const [graphMutationError, setGraphMutationError] = useState('')
  const [chapterGraphData, setChapterGraphData] = useState<ChapterGraphContextData | null>(null)
  const [chapterGraphLoading, setChapterGraphLoading] = useState(false)
  const [chapterGraphError, setChapterGraphError] = useState('')
  const [chapterGraphControls, setChapterGraphControls] = useState<GraphReviewControls>(DEFAULT_GRAPH_REVIEW_CONTROLS)
  const [chapterGraphSelection, setChapterGraphSelection] = useState<GraphSelection>(null)
  const [pendingSourceJump, setPendingSourceJump] = useState<PendingSourceJump | null>(null)
  const [workspaceSelection, setWorkspaceSelection] = useState<TimelineSelection | null>(null)
  const workspaceSelectionRef = useRef<TimelineSelection | null>(null)
  const [storyTimelineData, setStoryTimelineData] = useState<StoryTimelineResponse | null>(null)
  const [storyTimelineError, setStoryTimelineError] = useState('')
  const [copied, setCopied] = useState<'rewrite' | 'roleplay' | null>(null)
  const [toast, setToastMessage] = useState('')
  const [toastVariant, setToastVariant] = useState<NoticeVariant>('success')
  const [saveContinueBlockPending, setSaveContinueBlockPending] = useState(false)
  const [saveContinueBlockError, setSaveContinueBlockError] = useState('')
  const [roleplaySessionStarting, setRoleplaySessionStarting] = useState(false)
  const [deletingBranchNodeId, setDeletingBranchNodeId] = useState<string | null>(null)
  const [pendingWhatIfRewriteLaunch, setPendingWhatIfRewriteLaunch] = useState<PendingWhatIfRewriteLaunch | null>(null)
  const [pendingFutureJumpRewriteLaunch, setPendingFutureJumpRewriteLaunch] = useState<PendingFutureJumpRewriteLaunch | null>(null)
  const [pendingContinueBlockRewriteLaunch, setPendingContinueBlockRewriteLaunch] = useState<PendingContinueBlockRewriteLaunch | null>(null)
  const [activeFutureJumpRewriteContext, setActiveFutureJumpRewriteContext] = useState<PendingFutureJumpRewriteLaunch | null>(null)
  const [activeContinueBlockRewriteContext, setActiveContinueBlockRewriteContext] = useState<PendingContinueBlockRewriteLaunch | null>(null)
  const [rewriteLaunchSource, setRewriteLaunchSource] = useState<RewriteLaunchSource>('chapter')
  const [rewriteSourceTextOverride, setRewriteSourceTextOverride] = useState('')
  const [futureMapLaunch, setFutureMapLaunch] = useState<FutureMapLaunchState | null>(null)
  const [knowledgeRebuilding, setKnowledgeRebuilding] = useState(false)
  const [presetCompatLibraryOpen, setPresetCompatLibraryOpen] = useState(false)
  const [knowledgeRebuildStatus, setKnowledgeRebuildStatus] = useState<KnowledgeRebuildStatus | null>(null)
  const latestKnowledgeRebuildStatusRef = useRef<KnowledgeRebuildStatus | null>(null)
  const knowledgePollInFlightRef = useRef<Promise<void> | null>(null)
  const [hanlpCacheSnapshot, setHanlpCacheSnapshot] = useState<HanlpCacheSnapshot | null>(null)
  const [knowledgeStatusOverview, setKnowledgeStatusOverview] = useState<KnowledgeStatusOverview | null>(null)
  const [knowledgeActionLoading, setKnowledgeActionLoading] = useState<KnowledgeActionLoading>(null)
  const [confirmDeleteHanlpCache, setConfirmDeleteHanlpCache] = useState(false)
  const [confirmDeleteExtractionCache, setConfirmDeleteExtractionCache] = useState(false)
  const [confirmDeleteEmbeddingCache, setConfirmDeleteEmbeddingCache] = useState(false)
  const [knowledgeRebuildRangeMode, setKnowledgeRebuildRangeMode] = useState<KnowledgeRebuildRangeMode>('all')
  const [knowledgeRebuildFirstChapterCount, setKnowledgeRebuildFirstChapterCount] = useState('5')
  const [knowledgeRebuildStartChapter, setKnowledgeRebuildStartChapter] = useState('1')
  const [knowledgeRebuildEndChapter, setKnowledgeRebuildEndChapter] = useState('5')
  const [ollamaModelsByScenario, setOllamaModelsByScenario] = useState<Record<AIScenarioKey, OllamaModelOption[]>>({ rewrite: [], knowledgeExtraction: [], embeddings: [] })
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState<Record<AIScenarioKey, boolean>>({ rewrite: false, knowledgeExtraction: false, embeddings: false })
  const [ollamaModelsError, setOllamaModelsError] = useState<Record<AIScenarioKey, string>>({ rewrite: '', knowledgeExtraction: '', embeddings: '' })
  const [openAICompatibleModelsByScenario, setOpenAICompatibleModelsByScenario] = useState<Record<AIScenarioKey, OpenAICompatibleModelOption[]>>({ rewrite: [], knowledgeExtraction: [], embeddings: [] })
  const [openAICompatibleModelsLoading, setOpenAICompatibleModelsLoading] = useState<Record<AIScenarioKey, boolean>>({ rewrite: false, knowledgeExtraction: false, embeddings: false })
  const [editState, setEditState] = useState<{ type: 'char' | 'outline' | 'world' | 'relation' | 'timeline' | null; id: string | null; form: Record<string, string> }>({ type: null, id: null, form: {} })
  const knowledgePanelReadOnly = true

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/writing-skills?status=ACTIVE', { cache: 'no-store' })
        const data = await response.json() as { ok?: boolean; cards?: WritingSkillCard[]; error?: string }
        if (!response.ok || !data.ok) throw new Error(data.error || 'Failed to load writing skill cards')
        if (cancelled) return
        const cards = data.cards ?? []
        setWritingSkillCards(cards)
        setWritingSkillCardsError('')
        const availableCardIds = new Set(cards.map((card) => card.id))
        setSelectedWritingSkillCardIds((current) => current.filter((cardId) => availableCardIds.has(cardId)))
      } catch (error) {
        if (cancelled) return
        setWritingSkillCards([])
        setWritingSkillCardsError(error instanceof Error ? error.message : 'Failed to load writing skill cards')
      } finally {
        if (!cancelled) setWritingSkillCardsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    workspaceSelectionRef.current = workspaceSelection
  }, [workspaceSelection])

  const editorRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveLatestSignatureRef = useRef(params.autosaveTarget)
  const autosaveLastSavedSignatureRef = useRef<string | null>(null)
  const autosaveFailedSignatureRef = useRef<string | null>(null)
  const autosaveInFlightRef = useRef<{ promise: Promise<boolean> } | null>(null)
  const autosaveMountedRef = useRef(false)
  const autosaveDrainRef = useRef<() => void>(() => undefined)
  const autosaveUnmountSaveRef = useRef<() => Promise<boolean>>(async () => true)
  const autosaveSaveToBackendRef = useRef(params.saveToBackend)
  const novelDeletionPendingRef = useRef(params.isNovelDeletionPending)
  const backendLoadedRef = useRef(params.backendLoaded)
  const currentNovelIdRef = useRef(params.currentNovelId)
  const latestLocalChaptersRef = useRef(params.localChapters)
  const chapterDraftFlushRef = useRef<() => void>(() => undefined)
  const fullKnowledgeProjectionRequestGenerationRef = useRef(0)
  const knowledgeProjectionNovelIdRef = useRef(params.currentNovelId)
  const hydratedRef = useRef(false)
  const workspaceSelectionHydratedRef = useRef(false)
  const workspaceSelectionHistoryModeRef = useRef<WorkspaceSelectionHistoryMode>('replace')
  const editorChapterIdRef = useRef(params.currentChapterId)
  const [editorBuffer] = useState(() => createChapterEditorBuffer({
    delayMs: 300,
    commit: ({ chapterId, html, plainText }) => {
      params.updateChapterContent(chapterId, html, countChineseFriendlyWords(plainText))
    },
  }))
  const editorBufferRef = useRef(editorBuffer)
  const lastActiveKnowledgeJobIdRef = useRef<string | null>(null)
  const openAICompatibleModelsRequestRef = useRef<Record<AIScenarioKey, number>>({ rewrite: 0, knowledgeExtraction: 0, embeddings: 0 })
  const chapterGraphRequestRef = useRef(0)
  const chapterGraphScopeRef = useRef('')
  const storyTimelineRequestRef = useRef(0)
  const storyTimelineAbortControllerRef = useRef<AbortController | null>(null)
  const fullKnowledgeProjectionAbortControllerRef = useRef<AbortController | null>(null)
  const recoverablePanelHydrationGenerationRef = useRef(0)
  const rewritePanelOwnershipGenerationRef = useRef(0)
  const ownedRecoverableRewriteJobIdRef = useRef<string | null>(null)
  const resolvedAISettings = useMemo(() => normalizeAISettings(params.aiSettings), [params.aiSettings])

  useLayoutEffect(() => {
    editorBuffer.setCommit(({ chapterId, html, plainText }) => {
      params.updateChapterContent(chapterId, html, countChineseFriendlyWords(plainText))
    })
  }, [editorBuffer, params.updateChapterContent])

  const flushEditorBuffer = useCallback(() => {
    return editorBufferRef.current.flush()
  }, [])

  useLayoutEffect(() => {
    if (editorChapterIdRef.current !== params.currentChapterId) {
      flushEditorBuffer()
      editorChapterIdRef.current = params.currentChapterId
    }
  }, [flushEditorBuffer, params.currentChapterId])

  const invalidateRecoverablePanelHydration = useCallback(() => {
    recoverablePanelHydrationGenerationRef.current += 1
  }, [])

  const invalidateRecoverableRewriteOwnership = useCallback(() => {
    recoverablePanelHydrationGenerationRef.current += 1
    rewritePanelOwnershipGenerationRef.current += 1
    ownedRecoverableRewriteJobIdRef.current = null
  }, [])

  const applyFullKnowledgeProjectionResult = useCallback((projection: KnowledgeProjectionResult) => {
    latestKnowledgeRebuildStatusRef.current = projection.knowledgeRebuildStatus
    setKnowledgeRebuildStatus(projection.knowledgeRebuildStatus)
    setHanlpCacheSnapshot(projection.hanlpCacheSnapshot)
    setKnowledgeStatusOverview(projection.knowledgeStatusOverview)
  }, [])

  const updateAISettings = useCallback((updater: (current: AISettings) => AISettings) => {
    params.setAISettings(normalizeAISettings(updater(resolvedAISettings)))
  }, [params.setAISettings, resolvedAISettings])

  const updateScenarioProvider = useCallback((scenario: AIScenarioKey, provider: AIProvider) => {
    updateAISettings((current) => ({ ...current, [scenario]: { ...current[scenario], provider } }))
  }, [updateAISettings])

  const updateScenarioOpenAIField = useCallback((scenario: AIScenarioKey, field: 'baseUrl' | 'apiKey' | 'model', value: string) => {
    updateAISettings((current) => ({
      ...current,
      [scenario]: {
        ...current[scenario],
        openAICompatible: {
          ...current[scenario].openAICompatible,
          [field]: value,
          ...(field === 'apiKey' && value.trim() ? { apiKeyConfigured: true } : {}),
        },
      },
    }))
  }, [updateAISettings])

  const updateScenarioOllamaField = useCallback((scenario: AIScenarioKey, field: 'baseUrl' | 'model', value: string) => {
    updateAISettings((current) => ({
      ...current,
      [scenario]: {
        ...current[scenario],
        ollama: { ...current[scenario].ollama, [field]: value },
      },
    }))
  }, [updateAISettings])

  const updateKnowledgeExtractionParallelism = useCallback((provider: AIProvider, value: string) => {
    updateAISettings((current) => {
      const parsed = Number.parseInt(value, 10)
      const nextParallelism = Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : provider === 'openai-compatible' ? 5 : 1
      return {
        ...current,
        knowledgeExtraction: {
          ...current.knowledgeExtraction,
          [provider === 'openai-compatible' ? 'openAICompatible' : 'ollama']: {
            ...current.knowledgeExtraction[provider === 'openai-compatible' ? 'openAICompatible' : 'ollama'],
            parallelism: nextParallelism,
          },
        },
      }
    })
  }, [updateAISettings])

  const updateEmbeddingBatchSize = useCallback((value: string) => {
    updateAISettings((current) => {
      const parsed = Number.parseInt(value, 10)
      const nextEmbeddingBatchSize = Number.isFinite(parsed) ? Math.max(1, Math.min(128, parsed)) : 16
      return { ...current, embeddings: { ...current.embeddings, embeddingBatchSize: nextEmbeddingBatchSize } }
    })
  }, [updateAISettings])

  const applyLocalEmbeddingSettings = useCallback((settings: { baseUrl: string; apiKey: string; model: string }) => {
    updateAISettings((current) => ({
      ...current,
      embeddings: {
        ...current.embeddings,
        provider: 'openai-compatible',
        openAICompatible: {
          ...current.embeddings.openAICompatible,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          apiKeyConfigured: true,
          model: settings.model,
          configured: true,
        },
      },
    }))
  }, [updateAISettings])

  const setToast = useCallback((message: string, variant: NoticeVariant = 'success') => {
    setToastMessage(message)
    setToastVariant(variant)
  }, [])

  const showKnowledgeToast = useCallback((message: string, duration = 1800, variant: NoticeVariant = 'success') => {
    setToast(message, variant)
    window.setTimeout(() => setToast(''), duration)
  }, [setToast])

  useEffect(() => {
    autosaveLatestSignatureRef.current = params.autosaveTarget
    autosaveSaveToBackendRef.current = params.saveToBackend
    novelDeletionPendingRef.current = params.isNovelDeletionPending
    backendLoadedRef.current = params.backendLoaded
    currentNovelIdRef.current = params.currentNovelId
    latestLocalChaptersRef.current = params.localChapters
  }, [params.autosaveTarget, params.backendLoaded, params.currentNovelId, params.isNovelDeletionPending, params.localChapters, params.saveToBackend])

  const scheduleAutosaveDrain = useCallback((delay: number) => {
    if (!autosaveMountedRef.current || novelDeletionPendingRef.current) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      autosaveDrainRef.current()
    }, delay)
  }, [])

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = null
  }, [])

  const runAutosave = useCallback((targetSignature: string, options: { force?: boolean; retryFailed?: boolean; lifecycle?: boolean } = {}) => {
    const existing = autosaveInFlightRef.current
    if (existing) return existing.promise
    if (novelDeletionPendingRef.current) return Promise.resolve(false)
    if (!options.force && targetSignature === autosaveLastSavedSignatureRef.current) return Promise.resolve(true)
    if (!options.retryFailed && targetSignature === autosaveFailedSignatureRef.current) return Promise.resolve(false)

    const capturedChapters = latestLocalChaptersRef.current
    const savePromise = Promise.resolve().then(() => autosaveSaveToBackendRef.current(
      options.lifecycle ? { lifecycle: true } : undefined,
    ))
      .then(() => {
        clearAcknowledgedChapterDrafts(capturedChapters)
        autosaveLastSavedSignatureRef.current = targetSignature
        if (autosaveFailedSignatureRef.current === targetSignature) {
          autosaveFailedSignatureRef.current = null
        }
        return true
      })
      .catch(() => {
        if (autosaveLatestSignatureRef.current === targetSignature) {
          autosaveFailedSignatureRef.current = targetSignature
        }
        return false
      })
      .finally(() => {
        if (autosaveInFlightRef.current?.promise === savePromise) {
          autosaveInFlightRef.current = null
        }
        if (!autosaveMountedRef.current || novelDeletionPendingRef.current) return
        const latestSignature = autosaveLatestSignatureRef.current
        if (
          latestSignature === autosaveLastSavedSignatureRef.current
          || latestSignature === autosaveFailedSignatureRef.current
        ) return
        scheduleAutosaveDrain(400)
      })
    autosaveInFlightRef.current = { promise: savePromise }
    return savePromise
  }, [scheduleAutosaveDrain])

  const drainAutosave = useCallback(() => {
    if (!autosaveMountedRef.current || autosaveInFlightRef.current || novelDeletionPendingRef.current) return
    const targetSignature = autosaveLatestSignatureRef.current
    if (
      targetSignature === autosaveLastSavedSignatureRef.current
      || targetSignature === autosaveFailedSignatureRef.current
    ) return

    void runAutosave(targetSignature)
  }, [runAutosave])

  const flushAndSaveWorkspace = useCallback(async (showFailure: boolean, lifecycle = false) => {
    clearAutosaveTimer()
    if (!backendLoadedRef.current || !currentNovelIdRef.current) return true
    const maximumPasses = showFailure ? MAX_NAVIGATION_SAVE_PASSES : MAX_LIFECYCLE_SAVE_PASSES
    for (let pass = 0; pass < maximumPasses; pass += 1) {
      chapterDraftFlushRef.current()
      const flushedEditor = Boolean(flushEditorBuffer())
      const postFlushSignature = params.readAutosaveTarget?.() ?? autosaveLatestSignatureRef.current
      autosaveLatestSignatureRef.current = postFlushSignature
      const previousSave = autosaveInFlightRef.current
      if (previousSave) await previousSave.promise
      if (novelDeletionPendingRef.current) return false

      const latestSignature = postFlushSignature
      const needsSave = flushedEditor
        || latestSignature !== autosaveLastSavedSignatureRef.current
        || latestSignature === autosaveFailedSignatureRef.current
      if (needsSave) {
        const saved = await runAutosave(latestSignature, {
          force: flushedEditor,
          retryFailed: true,
          lifecycle,
        })
        if (!saved) {
          if (showFailure) setToast(t('workspace.persistence.saveFailed'), 'error')
          return false
        }
      }

      const stableSignature = params.readAutosaveTarget?.() ?? autosaveLatestSignatureRef.current
      if (editorBufferRef.current.getBuffered() === null && stableSignature === latestSignature) return true
    }
    if (showFailure) setToast(t('workspace.persistence.saveFailed'), 'error')
    return false
  }, [clearAutosaveTimer, flushEditorBuffer, params.readAutosaveTarget, runAutosave, setToast, t])

  const saveWorkspaceBeforeNavigation = useCallback(() => flushAndSaveWorkspace(true), [flushAndSaveWorkspace])

  useLayoutEffect(() => {
    autosaveUnmountSaveRef.current = () => flushAndSaveWorkspace(false, true)
  }, [flushAndSaveWorkspace])

  useEffect(() => {
    autosaveDrainRef.current = drainAutosave
  }, [drainAutosave])

  useEffect(() => {
    autosaveMountedRef.current = true
    return () => {
      autosaveMountedRef.current = false
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
      void autosaveUnmountSaveRef.current().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!shouldLoadWorkspaceFromBackendOnMount(params.backendLoaded)) return
    params.loadFromBackend().catch(() => undefined)
  }, [params.backendLoaded, params.loadFromBackend])

  useEffect(() => {
    if (params.backendLoaded && !params.isNovelDeletionPending && params.localChapters.length === 0) {
      router.push('/library')
    }
  }, [params.backendLoaded, params.isNovelDeletionPending, params.localChapters.length, router])

  useEffect(() => {
    if (!params.backendLoaded) return
    if (!hydratedRef.current) {
      hydratedRef.current = true
      autosaveLastSavedSignatureRef.current = params.autosaveTarget
      return
    }
    if (params.isNovelDeletionPending) {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
      return
    }
    if (
      autosaveFailedSignatureRef.current !== null
      && params.autosaveTarget !== autosaveFailedSignatureRef.current
    ) {
      autosaveFailedSignatureRef.current = null
    }
    if (
      params.autosaveTarget === autosaveLastSavedSignatureRef.current
      || params.autosaveTarget === autosaveFailedSignatureRef.current
    ) return
    scheduleAutosaveDrain(1200)
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [params.autosaveTarget, params.backendLoaded, params.isNovelDeletionPending, scheduleAutosaveDrain])

  const getKnowledgePollDelay = useCallback((status: KnowledgeRebuildStatus | null, actionLoading: KnowledgeActionLoading) => {
    if (actionLoading) return 1_200
    if (status?.status === 'queued' || status?.status === 'running') return 1_500
    if (status?.status === 'paused') return 3_500
    return null
  }, [])

  const currentNovelMeta = useMemo(() => params.localNovels.find((novel) => novel.id === params.currentNovelId) ?? null, [params.localNovels, params.currentNovelId])

  const {
    sortedChapters,
    currentChapter,
    parentChapter,
    graphSourceMeta,
    selectChapter,
    resolveSourceChapter,
    jumpToGraphSource,
  } = useWorkspaceChapterSelection({
    localChapters: params.localChapters,
    currentNovelId: params.currentNovelId,
    currentChapterId: params.currentChapterId,
    setCurrentChapterId: params.setCurrentChapterId,
    flushEditorBuffer,
    setCenterPaneView,
    setPendingSourceJump,
    setLeftPanelOpen,
    resetControls: {
      defaultGraphReviewControls: DEFAULT_GRAPH_REVIEW_CONTROLS,
      resetPresetCompatSessionStateForChapter: (chapter) => {
        params.resetPresetCompatSessionStateForSelection(toChapterTimelineSelection(chapter), ['rewrite', 'future_jump', 'roleplay'])
      },
      setSelectionText,
      setLockedSelectionText,
      setGenerationContext,
      setGraphContext,
      setContextPreviewError,
      setGraphReviewControls,
      setGraphSelection,
      setDisabledContextBlockIds,
      setExcludedGraphEdgeIds,
      setExcludedEvidenceIds,
      setGraphMutationPendingId,
      setGraphMutationError,
      setToolbarPos,
      setActiveMode,
    },
  })
  const hasWorkspaceContent = params.localChapters.length > 0
  const pendingChapterDraftRef = useRef<{
    novelId: string
    chapterId: string
    baseContent: string
    content: string
    wordCount: number
    savedAt: number
  } | null>(null)
  const chapterDraftWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chapterDraftRecoveryAttemptRef = useRef(new Set<string>())

  const flushChapterDraftCache = useCallback(() => {
    if (chapterDraftWriteTimerRef.current) clearTimeout(chapterDraftWriteTimerRef.current)
    chapterDraftWriteTimerRef.current = null
    const pending = pendingChapterDraftRef.current
    pendingChapterDraftRef.current = null
    if (!pending || !writeChapterDraft(pending)) return
    chapterDraftRecoveryAttemptRef.current.add(`${pending.novelId}\u0000${pending.chapterId}\u0000${pending.savedAt}`)
  }, [])

  useLayoutEffect(() => {
    chapterDraftFlushRef.current = flushChapterDraftCache
  }, [flushChapterDraftCache])

  const scheduleChapterDraftCache = useCallback((chapter: Chapter, content: string, plainText: string) => {
    pendingChapterDraftRef.current = {
      novelId: chapter.novelId,
      chapterId: chapter.id,
      baseContent: chapter.content,
      content,
      wordCount: countChineseFriendlyWords(plainText),
      savedAt: Date.now(),
    }
    if (chapterDraftWriteTimerRef.current) clearTimeout(chapterDraftWriteTimerRef.current)
    chapterDraftWriteTimerRef.current = setTimeout(flushChapterDraftCache, 180)
  }, [flushChapterDraftCache])

  useLayoutEffect(() => () => {
    flushChapterDraftCache()
  }, [currentChapter?.id, flushChapterDraftCache])

  useEffect(() => {
    if (!backendLoaded || !currentChapter || currentChapter.contentLoaded === false) return
    const draft = readChapterDraft(currentChapter.novelId, currentChapter.id)
    if (!draft) return
    const attemptKey = `${draft.novelId}\u0000${draft.chapterId}\u0000${draft.savedAt}`
    if (chapterDraftRecoveryAttemptRef.current.has(attemptKey)) return
    chapterDraftRecoveryAttemptRef.current.add(attemptKey)

    if (draft.content === currentChapter.content) {
      removeChapterDraft(draft.novelId, draft.chapterId)
      return
    }

    const shouldRestore = canRestoreChapterDraftWithoutConflict(draft, currentChapter.content)
      || window.confirm(t('workspace.persistence.localDraftConflictConfirm'))
    if (!shouldRestore) {
      removeChapterDraft(draft.novelId, draft.chapterId)
      return
    }

    const restoreTimer = window.setTimeout(() => {
      updateChapterContent(currentChapter.id, draft.content, draft.wordCount)
      setToast(t('workspace.persistence.localDraftRecovered'), 'warning')
    }, 0)
    return () => window.clearTimeout(restoreTimer)
  }, [backendLoaded, currentChapter, setToast, t, updateChapterContent])

  const mainlineChapters = useMemo(() => sortedChapters.filter((chapter) => !chapter.parentChapterId), [sortedChapters])
  const selectedKnowledgeRebuildChapterRange = useMemo(() => normalizeKnowledgeRebuildChapterRangeInput({
    mode: knowledgeRebuildRangeMode,
    firstChapterCount: knowledgeRebuildFirstChapterCount,
    startChapter: knowledgeRebuildStartChapter,
    endChapter: knowledgeRebuildEndChapter,
    maxChapterCount: mainlineChapters.length,
  }), [knowledgeRebuildEndChapter, knowledgeRebuildFirstChapterCount, knowledgeRebuildRangeMode, knowledgeRebuildStartChapter, mainlineChapters.length])
  const selectedKnowledgeRebuildChapterRangeLabel = useMemo(() => formatKnowledgeRebuildChapterRangeLabel(selectedKnowledgeRebuildChapterRange), [selectedKnowledgeRebuildChapterRange])
  const branchChaptersByParentId = useMemo(() => {
    const grouped = new Map<string, Chapter[]>()
    for (const chapter of sortedChapters) {
      if (!chapter.parentChapterId) continue
      const current = grouped.get(chapter.parentChapterId) ?? []
      current.push(chapter)
      grouped.set(chapter.parentChapterId, current)
    }
    return grouped
  }, [sortedChapters])
  const storyTimelineBranchId = params.currentNovelId ? `${params.currentNovelId}:main` : ''
  const recoverableRewriteContextKey = `${params.currentNovelId}\u0000${storyTimelineBranchId}\u0000${currentChapter?.id ?? ''}`
  const recoverableRewriteContextKeyRef = useRef(recoverableRewriteContextKey)
  const previousRecoverableRewriteContextKeyRef = useRef(recoverableRewriteContextKey)
  useLayoutEffect(() => {
    const previousKey = previousRecoverableRewriteContextKeyRef.current
    recoverableRewriteContextKeyRef.current = recoverableRewriteContextKey
    previousRecoverableRewriteContextKeyRef.current = recoverableRewriteContextKey
    if (previousKey !== recoverableRewriteContextKey) {
      invalidateRecoverableRewriteOwnership()
    }
  }, [invalidateRecoverableRewriteOwnership, recoverableRewriteContextKey])
  const fallbackStoryTimeline = useMemo<StoryTimelineResponse>(() => ({
    novelId: params.currentNovelId,
    branchId: storyTimelineBranchId,
    chapters: mainlineChapters.map<ChapterTimelineItem>((chapter) => ({ type: 'chapter', chapterNo: chapter.order, chapterId: chapter.id, title: chapter.title, wordCount: chapter.wordCount })),
    branchNodes: [],
    edges: [],
  }), [params.currentNovelId, mainlineChapters, storyTimelineBranchId])
  const resolvedStoryTimeline = storyTimelineData?.novelId === params.currentNovelId ? storyTimelineData : fallbackStoryTimeline
  const timelineChapterById = useMemo(() => new Map(resolvedStoryTimeline.chapters.map((chapter) => [chapter.chapterId, chapter] as const)), [resolvedStoryTimeline.chapters])
  const timelineNodeById = useMemo(() => new Map(resolvedStoryTimeline.branchNodes.map((node) => [node.id, node] as const)), [resolvedStoryTimeline.branchNodes])
  const selectedKnowledgeStatusChapterOrder = useMemo(() => resolveSelectedKnowledgeProjectionChapterOrder({
    currentChapterId: params.currentChapterId,
    localChapters: params.localChapters,
    workspaceSelection,
    timelineNodeById,
  }), [params.currentChapterId, params.localChapters, timelineNodeById, workspaceSelection])

  const refreshCurrentFullKnowledgeProjection = useCallback(async (isRequestRelevant?: () => boolean) => {
    const novelId = params.currentNovelId
    if (!novelId) return
    const selectedChapterOrder = selectedKnowledgeStatusChapterOrder
    const requestGeneration = fullKnowledgeProjectionRequestGenerationRef.current + 1
    fullKnowledgeProjectionRequestGenerationRef.current = requestGeneration
    fullKnowledgeProjectionAbortControllerRef.current?.abort()
    const controller = new AbortController()
    fullKnowledgeProjectionAbortControllerRef.current = controller
    const refreshedProjection = await params.refreshKnowledgeProjection(novelId, selectedChapterOrder, controller.signal)
    if (
      (!isRequestRelevant || isRequestRelevant())
      && fullKnowledgeProjectionRequestGenerationRef.current === requestGeneration
      && knowledgeProjectionNovelIdRef.current === novelId
    ) {
      applyFullKnowledgeProjectionResult(refreshedProjection)
    }
    if (fullKnowledgeProjectionAbortControllerRef.current === controller) fullKnowledgeProjectionAbortControllerRef.current = null
  }, [applyFullKnowledgeProjectionResult, params.currentNovelId, params.refreshKnowledgeProjection, selectedKnowledgeStatusChapterOrder])
  const knowledgePollCallbacksRef = useRef({
    locale,
    refreshCurrentFullKnowledgeProjection,
    showKnowledgeToast,
    t,
  })
  useEffect(() => {
    knowledgePollCallbacksRef.current = {
      locale,
      refreshCurrentFullKnowledgeProjection,
      showKnowledgeToast,
      t,
    }
  }, [locale, refreshCurrentFullKnowledgeProjection, showKnowledgeToast, t])

  useEffect(() => {
    if (knowledgeProjectionNovelIdRef.current === params.currentNovelId) return
    knowledgeProjectionNovelIdRef.current = params.currentNovelId
    fullKnowledgeProjectionRequestGenerationRef.current += 1
    latestKnowledgeRebuildStatusRef.current = null
    lastActiveKnowledgeJobIdRef.current = null
    setKnowledgeRebuildStatus(null)
    setHanlpCacheSnapshot(null)
    setKnowledgeStatusOverview(null)
  }, [params.currentNovelId])

  useEffect(() => {
    latestKnowledgeRebuildStatusRef.current = knowledgeRebuildStatus
  }, [knowledgeRebuildStatus])

  useEffect(() => {
    if (!params.currentNovelId) {
      latestKnowledgeRebuildStatusRef.current = null
      lastActiveKnowledgeJobIdRef.current = null
      const resetTimer = window.setTimeout(() => {
        setConfirmDeleteKnowledge(false)
        setConfirmDeleteHanlpCache(false)
        setConfirmDeleteExtractionCache(false)
        setConfirmDeleteEmbeddingCache(false)
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    const confirmResetTimer = window.setTimeout(() => {
      setConfirmDeleteKnowledge(false)
      setConfirmDeleteHanlpCache(false)
      setConfirmDeleteExtractionCache(false)
      setConfirmDeleteEmbeddingCache(false)
    }, 0)

    let cancelled = false
    let pollTimerId: number | null = null
    let pollAbortController: AbortController | null = null

    const scheduleNextPoll = (delay: number | null) => {
      if (cancelled || delay === null) return
      pollTimerId = window.setTimeout(() => {
        void syncRebuildStatus()
      }, delay)
    }

    const scheduleRetry = () => {
      const latestStatus = latestKnowledgeRebuildStatusRef.current?.novelId === params.currentNovelId
        ? latestKnowledgeRebuildStatusRef.current
        : null
      scheduleNextPoll(getKnowledgePollDelay(latestStatus, knowledgeActionLoading) ?? 1_500)
    }

    const syncRebuildStatus = async () => {
      const previousRequest = knowledgePollInFlightRef.current
      if (previousRequest) {
        await previousRequest
      }
      if (cancelled) return

      const requestAbortController = new AbortController()
      pollAbortController = requestAbortController
      const request = (async () => {
        try {
          const searchParams = new URLSearchParams({ novelId: params.currentNovelId })
          searchParams.set('statusOnly', '1')
          const selectedChapterOrder = selectedKnowledgeStatusChapterOrder
          if (typeof selectedChapterOrder === 'number' && Number.isFinite(selectedChapterOrder) && selectedChapterOrder >= 1) {
            searchParams.set('asOfChapter', String(selectedChapterOrder))
          }

          const data = await requestClientGet(`/api/knowledge-view?${searchParams.toString()}`, {
            signal: requestAbortController.signal,
            parse: async (response) => {
              const payload = (await response.json()) as {
                ok?: boolean
                knowledgeRebuildStatus?: KnowledgeRebuildStatus | null
                hanlpCacheSnapshot?: HanlpCacheSnapshot | null
                knowledgeStatusOverview?: KnowledgeStatusOverview | null
              }
              return { response, payload }
            },
          })

          if (cancelled) return
          if (!data.response.ok || !data.payload.ok) {
            scheduleRetry()
            return
          }

          const nextStatus = data.payload.knowledgeRebuildStatus ?? null
          setHanlpCacheSnapshot(data.payload.hanlpCacheSnapshot ?? null)
          setKnowledgeStatusOverview((current) => mergeKnowledgeStatusOverview(current, data.payload.knowledgeStatusOverview))
          const hadActiveJob = Boolean(lastActiveKnowledgeJobIdRef.current)
          const failureMessage = resolveKnowledgeRebuildFailureMessage(nextStatus)

          latestKnowledgeRebuildStatusRef.current = nextStatus
          setKnowledgeRebuildStatus(nextStatus)

          if (nextStatus?.jobId && (nextStatus.status === 'queued' || nextStatus.status === 'running' || nextStatus.status === 'paused')) {
            lastActiveKnowledgeJobIdRef.current = nextStatus.jobId
            scheduleNextPoll(getKnowledgePollDelay(nextStatus, knowledgeActionLoading))
            return
          }

          if (nextStatus?.status === 'failed') {
            lastActiveKnowledgeJobIdRef.current = null
            if (hadActiveJob && !cancelled) {
              const callbacks = knowledgePollCallbacksRef.current
              callbacks.showKnowledgeToast(resolveWorkspaceUserFacingError('knowledge-rebuild', failureMessage, callbacks.locale), 2600, 'error')
            }
            return
          }

          if (hadActiveJob) {
            lastActiveKnowledgeJobIdRef.current = null
            const callbacks = knowledgePollCallbacksRef.current
            await callbacks.refreshCurrentFullKnowledgeProjection(() => !cancelled)
            if (!cancelled && !knowledgeRebuilding && !knowledgeActionLoading) {
              callbacks.showKnowledgeToast(callbacks.t('workspace.knowledge.updated'))
            }
            return
          }

          const idleDelay = getKnowledgePollDelay(nextStatus, knowledgeActionLoading)
          if (idleDelay !== null) {
            scheduleNextPoll(idleDelay)
          }
        } catch {
          if (!cancelled) {
            scheduleRetry()
          }
        }
      })()

      knowledgePollInFlightRef.current = request
      await request
      if (pollAbortController === requestAbortController) {
        pollAbortController = null
      }
      if (knowledgePollInFlightRef.current === request) {
        knowledgePollInFlightRef.current = null
      }
    }

    void syncRebuildStatus()

    return () => {
      cancelled = true
      pollAbortController?.abort()
      window.clearTimeout(confirmResetTimer)
      if (pollTimerId !== null) {
        window.clearTimeout(pollTimerId)
      }
    }
  }, [getKnowledgePollDelay, params.currentNovelId, knowledgeActionLoading, knowledgeRebuilding, selectedKnowledgeStatusChapterOrder, setConfirmDeleteKnowledge])

  const handleTimelineSelection = useCallback((
    selection: TimelineSelection,
    historyMode: WorkspaceSelectionHistoryMode = 'push',
    selectChapterSelection = true,
    options: TimelineSelectionOptions = {},
  ) => {
    if (currentChapter) {
      params.clearPresetCompatSessionStateForSelection(workspaceSelection ?? toChapterTimelineSelection(currentChapter))
    }
    setLeftPanelOpen(false)
    if (!options.preserveRecoverableRewriteOwnership) invalidateRecoverableRewriteOwnership()
    workspaceSelectionHistoryModeRef.current = historyMode
    setWorkspaceSelection(selection)
    if (!options.preserveRecoverableRewriteOwnership) setActiveMode(null)
    setToolbarPos(null)
    if (selection.kind === 'chapter' && selectChapterSelection) {
      const selectedChapter = sortedChapters.find((chapter) => chapter.id === selection.chapterId)
      if (selectedChapter) {
        selectChapter(selectedChapter)
        return
      }
    }
  }, [currentChapter, invalidateRecoverableRewriteOwnership, params.clearPresetCompatSessionStateForSelection, selectChapter, sortedChapters, workspaceSelection])

  const restoreWorkspaceSelectionFromLocation = useCallback((
    historyMode: Exclude<WorkspaceSelectionHistoryMode, 'push'>,
    options: RestoreWorkspaceSelectionOptions = {},
  ) => {
    if (!currentChapter) return

    const currentUrl = new URL(window.location.href)
    const requestedSelection = readWorkspaceSelectionFromSearchParams(currentUrl.searchParams)
    let resolvedSelection: TimelineSelection
    let selectedChapter = currentChapter

    if (requestedSelection?.kind === 'chapter') {
      const requestedChapter = resolveSourceChapter({
        chapterId: requestedSelection.chapterId,
        chapterNo: requestedSelection.chapterNo,
      })
      if (requestedChapter) {
        selectedChapter = requestedChapter
      }
      resolvedSelection = toChapterTimelineSelection(selectedChapter)
    } else {
      resolvedSelection = resolveWorkspaceSelection({
        currentSelection: requestedSelection,
        currentChapter,
        branchNodes: resolvedStoryTimeline.branchNodes,
      }) ?? toChapterTimelineSelection(currentChapter)

      if (resolvedSelection.kind !== 'chapter') {
        const selectedNodeId = resolvedSelection.nodeId
        const selectedNode = resolvedStoryTimeline.branchNodes.find((node) => node.id === selectedNodeId)
        const sourceChapterNo = selectedNode?.sourceChapterNo ?? selectedNode?.anchorChapterNo ?? null
        const sourceChapter = resolveSourceChapter({ chapterId: null, chapterNo: sourceChapterNo })
        if (sourceChapter) {
          selectedChapter = sourceChapter
        }
      }
    }

    if (selectedChapter.id !== params.currentChapterId) {
      selectChapter(selectedChapter)
    }

    const canonicalSearch = writeWorkspaceSelectionToSearchParams(currentUrl.searchParams, resolvedSelection).toString()
    const resolvedHistoryMode = historyMode === 'none' && canonicalSearch === currentUrl.searchParams.toString()
      ? 'none'
      : 'replace'
    const preserveRecoverableRewriteOwnership = options.preserveRecoverableRewriteOwnershipForCurrentChapter === true
      && (requestedSelection === null || requestedSelection.kind === 'chapter')
      && resolvedSelection.kind === 'chapter'
      && resolvedSelection.chapterId === currentChapter.id
    handleTimelineSelection(resolvedSelection, resolvedHistoryMode, false, { preserveRecoverableRewriteOwnership })
  }, [currentChapter, handleTimelineSelection, params.currentChapterId, resolveSourceChapter, resolvedStoryTimeline.branchNodes, selectChapter])

  useEffect(() => {
    if (!referenceResourcesVisible) return
    if (knowledgeRebuilding || knowledgeActionLoading || !params.backendLoaded || !params.currentNovelId || typeof selectedKnowledgeStatusChapterOrder !== 'number' || !Number.isFinite(selectedKnowledgeStatusChapterOrder)) return
    let cancelled = false
    const requestGeneration = fullKnowledgeProjectionRequestGenerationRef.current + 1
    fullKnowledgeProjectionRequestGenerationRef.current = requestGeneration
    const timer = window.setTimeout(() => {
      fullKnowledgeProjectionAbortControllerRef.current?.abort()
      const controller = new AbortController()
      fullKnowledgeProjectionAbortControllerRef.current = controller
      void params.refreshKnowledgeProjection(params.currentNovelId, selectedKnowledgeStatusChapterOrder, controller.signal)
        .then((result) => {
          if (!cancelled && fullKnowledgeProjectionRequestGenerationRef.current === requestGeneration) {
            applyFullKnowledgeProjectionResult(result)
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (fullKnowledgeProjectionAbortControllerRef.current === controller) fullKnowledgeProjectionAbortControllerRef.current = null
        })
    }, 0)
    return () => {
      cancelled = true
      fullKnowledgeProjectionAbortControllerRef.current?.abort()
      window.clearTimeout(timer)
      if (fullKnowledgeProjectionRequestGenerationRef.current === requestGeneration) {
        fullKnowledgeProjectionRequestGenerationRef.current += 1
      }
    }
  }, [applyFullKnowledgeProjectionResult, knowledgeActionLoading, knowledgeRebuilding, params.backendLoaded, params.currentNovelId, params.refreshKnowledgeProjection, referenceResourcesVisible, selectedKnowledgeStatusChapterOrder])

  useEffect(() => {
    workspaceSelectionHydratedRef.current = false
    invalidateRecoverablePanelHydration()
  }, [params.currentNovelId])

  useEffect(() => {
    if (!params.backendLoaded || !currentChapter || workspaceSelectionHydratedRef.current) return
    const requestedSelection = readWorkspaceSelectionFromSearchParams(new URLSearchParams(window.location.search))
    if (requestedSelection && requestedSelection.kind !== 'chapter' && !storyTimelineData) return
    const restoreTimer = window.setTimeout(() => {
      if (workspaceSelectionHydratedRef.current) return
      workspaceSelectionHydratedRef.current = true
      restoreWorkspaceSelectionFromLocation('replace', {
        preserveRecoverableRewriteOwnershipForCurrentChapter: true,
      })
    }, 0)
    return () => window.clearTimeout(restoreTimer)
  }, [params.backendLoaded, currentChapter, restoreWorkspaceSelectionFromLocation, storyTimelineData])

  useEffect(() => {
    const handlePopState = () => {
      if (!params.backendLoaded || !workspaceSelectionHydratedRef.current) return
      restoreWorkspaceSelectionFromLocation('none')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [params.backendLoaded, restoreWorkspaceSelectionFromLocation])

  useEffect(() => {
    if (!params.backendLoaded || !currentChapter || !workspaceSelection || !workspaceSelectionHydratedRef.current) return
    const historyMode = workspaceSelectionHistoryModeRef.current
    workspaceSelectionHistoryModeRef.current = 'replace'
    if (historyMode === 'none') return
    const currentUrl = new URL(window.location.href)
    const currentSearch = currentUrl.searchParams.toString()
    const nextSearchParams = writeWorkspaceSelectionToSearchParams(currentUrl.searchParams, workspaceSelection ?? toChapterTimelineSelection(currentChapter))
    const nextSearch = nextSearchParams.toString()
    if (nextSearch === currentSearch) return
    const nextUrl = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ''}${currentUrl.hash}`
    window.history[historyMode === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', nextUrl)
  }, [params.backendLoaded, currentChapter, workspaceSelection])

  useEffect(() => {
    if (!workspaceSelectionRef.current) return
    workspaceSelectionHistoryModeRef.current = 'replace'
    setWorkspaceSelection((current) => resolveWorkspaceSelection({ currentSelection: current, currentChapter, branchNodes: resolvedStoryTimeline.branchNodes }))
  }, [currentChapter, resolvedStoryTimeline.branchNodes])

  const loadStoryTimeline = useCallback(async () => {
    if (!params.currentNovelId) {
      setStoryTimelineData(null)
      setStoryTimelineError('')
      return null
    }
    const requestId = storyTimelineRequestRef.current + 1
    storyTimelineRequestRef.current = requestId
    storyTimelineAbortControllerRef.current?.abort()
    const controller = new AbortController()
    storyTimelineAbortControllerRef.current = controller
    try {
      const searchParams = new URLSearchParams({ novelId: params.currentNovelId, branchId: storyTimelineBranchId })
      const result = await requestClientGet(`/api/story-timeline?${searchParams.toString()}`, {
        signal: controller.signal,
        parse: async (response) => ({ response, data: await response.json().catch(() => null) as (StoryTimelineResponse & { error?: string }) | null }),
      })
      if (storyTimelineRequestRef.current !== requestId) return null
      if (!result.response.ok || !result.data) {
        setStoryTimelineData(null)
        setStoryTimelineError(resolveWorkspaceUserFacingError('story-timeline-load', result.data?.error, locale))
        return null
      }
      setStoryTimelineData(result.data)
      setStoryTimelineError('')
      return result.data
    } catch (error) {
      if (storyTimelineRequestRef.current !== requestId) return null
      setStoryTimelineData(null)
      setStoryTimelineError(resolveWorkspaceUserFacingError('story-timeline-load', error, locale))
      return null
    } finally {
      if (storyTimelineAbortControllerRef.current === controller) storyTimelineAbortControllerRef.current = null
    }
  }, [locale, params.currentNovelId, storyTimelineBranchId])

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadStoryTimeline()
    }, 0)
    return () => window.clearTimeout(loadTimer)
  }, [loadStoryTimeline])

  const chapterListLimit = chapterListState[params.currentNovelId] ?? CHAPTER_PAGE_SIZE
  const chapterIndex = useMemo(() => (currentChapter ? sortedChapters.findIndex((chapter) => chapter.id === currentChapter.id) : -1), [currentChapter, sortedChapters])
  const chapterListTarget = useMemo(() => {
    if (chapterListLimit > CHAPTER_PAGE_SIZE) return chapterListLimit
    if (chapterIndex < 0) return CHAPTER_PAGE_SIZE
    if (chapterIndex >= CHAPTER_PAGE_SIZE - 10) {
      return Math.min(sortedChapters.length, Math.max(CHAPTER_PAGE_SIZE, chapterIndex + 20))
    }
    return CHAPTER_PAGE_SIZE
  }, [chapterIndex, chapterListLimit, sortedChapters.length])
  const chapterText = currentChapter ? htmlToPlainText(currentChapter.content) : ''
  const resolveEdgeSourceJumpTarget = (edge: GraphEdge) => {
    const location = edge.evidenceLocation
    if (!location) return null
    const targetChapter = resolveSourceChapter({ chapterNo: location.chapterNo })
    if (!targetChapter) return null
    return {
      chapterId: targetChapter.id,
      chapterNo: targetChapter.order,
      lineStart: location.lineStart ?? null,
      lineEnd: location.lineEnd ?? null,
      searchText: normalizeSourceSearchText(edge.evidenceQuote ?? buildChapterLineExcerpt(targetChapter, location.lineStart ?? null, location.lineEnd ?? null)),
    } satisfies PendingSourceJump
  }
  const resolveEvidenceSourceJumpTarget = (item: GenerationContextBuildData['lanceEvidence'][number]) => {
    const targetChapter = resolveSourceChapter({ chapterId: item.chapterId, chapterNo: item.chapterNo })
    if (!targetChapter) return null
    return { chapterId: targetChapter.id, chapterNo: targetChapter.order, lineStart: item.lineStart, lineEnd: item.lineEnd, searchText: normalizeSourceSearchText(item.text || buildChapterLineExcerpt(targetChapter, item.lineStart, item.lineEnd)) } satisfies PendingSourceJump
  }
  const mainKnowledgeRebuildStatus = useMemo(() => {
    if (knowledgeRebuildStatus?.jobType !== 'extract_chapter_knowledge') return null
    return knowledgeRebuildStatus.status === 'queued'
      || knowledgeRebuildStatus.status === 'running'
      || knowledgeRebuildStatus.status === 'paused'
      || knowledgeRebuildStatus.status === 'failed'
      ? knowledgeRebuildStatus
      : null
  }, [knowledgeRebuildStatus])
  const currentKnowledgeJobActive = knowledgeRebuildStatus?.status === 'running' || knowledgeRebuildStatus?.status === 'queued'
  const currentKnowledgeJobBusy = currentKnowledgeJobActive || knowledgeRebuildStatus?.status === 'paused'
  const knowledgeRebuildEtaMinutes = useMemo(() => mainKnowledgeRebuildStatus?.etaMinutes ?? null, [mainKnowledgeRebuildStatus])
  const knowledgeRebuildSteps = useMemo(() => mainKnowledgeRebuildStatus?.steps ?? [], [mainKnowledgeRebuildStatus])
  const knowledgeRebuildFailed = mainKnowledgeRebuildStatus?.status === 'failed'
  const knowledgeRebuildPaused = mainKnowledgeRebuildStatus?.status === 'paused'
  const knowledgeRebuildActive = mainKnowledgeRebuildStatus?.status === 'running' || mainKnowledgeRebuildStatus?.status === 'queued'
  const knowledgeRebuildBusy = knowledgeRebuildActive || knowledgeRebuildPaused
  const knowledgeRebuildFailureMessage = useMemo(() => resolveKnowledgeRebuildFailureMessage(mainKnowledgeRebuildStatus), [mainKnowledgeRebuildStatus])
  const hanlpBootstrapStep = useMemo(() => knowledgeRebuildSteps.find((step) => step.key === HANLP_BOOTSTRAP_STAGE_KEY) ?? null, [knowledgeRebuildSteps])
  const hanlpBootstrapCompletedChapterCount = mainKnowledgeRebuildStatus?.hanlpBootstrapCompletedChapterCount ?? null
  const hanlpBootstrapTotalChapterCount = mainKnowledgeRebuildStatus?.hanlpBootstrapTotalChapterCount ?? null
  const hanlpBootstrapProgress = mainKnowledgeRebuildStatus?.hanlpBootstrapProgress ?? hanlpBootstrapStep?.progress ?? null
  const hanlpBootstrapPercent = useMemo(() => hanlpBootstrapProgress === null ? null : toProgressPercent(hanlpBootstrapProgress), [hanlpBootstrapProgress])
  const hanlpBootstrapHasProgressTelemetry = Boolean(hanlpBootstrapPercent !== null || hanlpBootstrapCompletedChapterCount !== null || hanlpBootstrapTotalChapterCount !== null)
  const hanlpBootstrapCacheHitRatePercent = useMemo(() => {
    if (mainKnowledgeRebuildStatus?.hanlpCacheHitRate !== undefined) return toProgressPercent(mainKnowledgeRebuildStatus.hanlpCacheHitRate)
    const hitCount = mainKnowledgeRebuildStatus?.hanlpBootstrapCacheHitCount ?? 0
    const missCount = mainKnowledgeRebuildStatus?.hanlpBootstrapCacheMissCount ?? 0
    const total = hitCount + missCount
    return total > 0 ? toProgressPercent(hitCount / total) : null
  }, [mainKnowledgeRebuildStatus])
  const hanlpBootstrapTimingLabel = useMemo(() => {
    const duration = mainKnowledgeRebuildStatus?.stageTimingsMs?.[HANLP_BOOTSTRAP_STAGE_KEY]
    return typeof duration === 'number' && Number.isFinite(duration) ? formatStageDuration(duration) : null
  }, [mainKnowledgeRebuildStatus])
  const hanlpBootstrapPhaseLabel = useMemo(() => {
    const detail = hanlpBootstrapStep?.detail?.trim()
    if (detail) return formatProgressMessage(detail, t) || detail
    const currentStep = mainKnowledgeRebuildStatus?.currentStep?.trim()
    if (knowledgeRebuildFailed) return t('workspace.knowledge.bootstrapFailed')
    if (currentStep) return formatProgressMessage(currentStep, t) || currentStep
    if (knowledgeRebuildPaused) return t('workspace.knowledge.bootstrapWaitingContinue')
    return hanlpBootstrapHasProgressTelemetry ? t('workspace.knowledge.bootstrapCalculating') : t('workspace.knowledge.waitingProgress')
  }, [hanlpBootstrapHasProgressTelemetry, hanlpBootstrapStep, knowledgeRebuildFailed, knowledgeRebuildPaused, mainKnowledgeRebuildStatus, t])
  const hanlpBootstrapEtaLabel = useMemo(() => formatKnowledgeEtaLabel({ etaMinutes: hanlpBootstrapStep?.etaMinutes ?? knowledgeRebuildEtaMinutes, isPaused: knowledgeRebuildPaused, isFailed: knowledgeRebuildFailed, hasTelemetry: hanlpBootstrapHasProgressTelemetry }), [hanlpBootstrapHasProgressTelemetry, hanlpBootstrapStep, knowledgeRebuildEtaMinutes, knowledgeRebuildFailed, knowledgeRebuildPaused])
  const hanlpBootstrapStatusLine = useMemo(() => {
    const completed = hanlpBootstrapCompletedChapterCount
    const total = hanlpBootstrapTotalChapterCount
    if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
        return completed >= total
          ? t('workspace.knowledge.bootstrapReadyStatus', { completed, total })
          : t('workspace.knowledge.bootstrapUpdatingStatus', { completed, total })
      }
    if (knowledgeRebuildFailed) return t('workspace.knowledge.bootstrapStoppedFailed')
    if (knowledgeRebuildPaused) return t('workspace.knowledge.bootstrapPausedStatus')
    if (knowledgeRebuildBusy) return hanlpBootstrapHasProgressTelemetry ? t('workspace.knowledge.bootstrapTelemetryRunning') : t('workspace.knowledge.bootstrapWaitingTelemetry')
    if (hanlpCacheSnapshot?.status === 'ready') return t('workspace.knowledge.bootstrapCacheReady')
    return t('workspace.knowledge.bootstrapNoProgress')
  }, [hanlpBootstrapCompletedChapterCount, hanlpBootstrapHasProgressTelemetry, hanlpBootstrapTotalChapterCount, hanlpCacheSnapshot, knowledgeRebuildBusy, knowledgeRebuildFailed, knowledgeRebuildPaused, t])
  const hanlpCacheStatus = mainKnowledgeRebuildStatus?.hanlpCacheStatus ?? hanlpCacheSnapshot?.status ?? 'empty'
  const hanlpCacheStatusLabel = HANLP_CACHE_STATUS_LABELS[hanlpCacheStatus]
  const hanlpSettingsLine = useMemo(() => {
    const snapshot = mainKnowledgeRebuildStatus?.hanlpSettingsSnapshot ?? hanlpCacheSnapshot?.settingsSnapshot
    if (!snapshot) return null
    return `script ${snapshot.hanlpScriptVersionHash.slice(0, 8)} · config ${snapshot.hanlpModelOrConfigHash.slice(0, 8)} · schema ${snapshot.outputSchemaVersion} · pipeline ${snapshot.pipelineVersion}`
  }, [hanlpCacheSnapshot, mainKnowledgeRebuildStatus])
  const hanlpCacheDeleteState = useMemo(() => resolveHanlpCacheDeleteState({ knowledgeRebuildStatus, knowledgeActionLoading }), [knowledgeActionLoading, knowledgeRebuildStatus])
  const extractionCacheDeleteState = useMemo(() => resolveCacheDeleteState({ knowledgeRebuildStatus, knowledgeActionLoading, idleHelperText: t('workspace.knowledge.extractionDeleteIdleHelper') }), [knowledgeActionLoading, knowledgeRebuildStatus, t])
  const embeddingCacheDeleteState = useMemo(() => resolveCacheDeleteState({ knowledgeRebuildStatus, knowledgeActionLoading, idleHelperText: t('workspace.knowledge.embeddingDeleteIdleHelper') }), [knowledgeActionLoading, knowledgeRebuildStatus, t])
  const rawTextEmbeddingActiveStatus = useMemo(() => {
    if (!knowledgeRebuildStatus) return null
    return knowledgeRebuildStatus.status === 'queued'
      || knowledgeRebuildStatus.status === 'running'
      || knowledgeRebuildStatus.status === 'paused'
      ? knowledgeRebuildStatus
      : null
  }, [knowledgeRebuildStatus])
  const rawTextEmbeddingActive = rawTextEmbeddingActiveStatus !== null
  const activeRawEmbeddingStep = useMemo(() => rawTextEmbeddingActiveStatus?.steps.find((step) => step.key === 'raw-embedding') ?? null, [rawTextEmbeddingActiveStatus])
  const rawTextEmbeddingProgress = rawTextEmbeddingActiveStatus?.rawTextEmbeddingProgress
  const rawTextEmbeddingPercent = useMemo(() => {
    if (!rawTextEmbeddingActive) return null
    return rawTextEmbeddingProgress === undefined ? null : toProgressPercent(rawTextEmbeddingProgress)
  }, [rawTextEmbeddingActive, rawTextEmbeddingProgress])
  const rawEmbeddingCurrentStep = isRawEmbeddingProgress(rawTextEmbeddingActiveStatus?.currentStep)
  const rawEmbeddingWaitingFinalization = Boolean(activeRawEmbeddingStep?.status === 'running')
  const rawEmbeddingRunningInParallel = rawTextEmbeddingActive && !rawEmbeddingWaitingFinalization && ((rawTextEmbeddingProgress !== undefined && toProgressPercent(rawTextEmbeddingProgress) < 100) || rawEmbeddingCurrentStep)
  const rawEmbeddingCompleted = rawTextEmbeddingPercent !== null && rawTextEmbeddingPercent >= 100
  const rawTextEmbeddingCacheHitRatePercent = useMemo(() => rawTextEmbeddingActiveStatus?.rawTextEmbeddingCacheHitRate === undefined ? null : toProgressPercent(rawTextEmbeddingActiveStatus.rawTextEmbeddingCacheHitRate), [rawTextEmbeddingActiveStatus])
  const rawTextEmbeddingTimingLabel = useMemo(() => {
    const duration = rawTextEmbeddingActiveStatus?.stageTimingsMs?.[RAW_TEXT_PRECOMPUTE_STAGE_KEY]
    return typeof duration === 'number' && Number.isFinite(duration) ? formatStageDuration(duration) : null
  }, [rawTextEmbeddingActiveStatus])
  const rawTextEmbeddingSettingsLine = useMemo(() => {
    const snapshot = rawTextEmbeddingActiveStatus?.embeddingSettingsSnapshot
    if (snapshot) return `${formatEmbeddingProviderLabel(snapshot.provider)} · ${snapshot.model} · batch ${snapshot.embeddingBatchSize}`
    const coverage = knowledgeStatusOverview?.embeddingCache
    if (!coverage?.provider || !coverage.model) return null
    return `${formatEmbeddingProviderLabel(coverage.provider)} · ${coverage.model}`
  }, [knowledgeStatusOverview, rawTextEmbeddingActiveStatus])
  const rawTextEmbeddingPhaseBadge = useMemo(() => {
    if (!rawTextEmbeddingActive) return formatKnowledgeCoverageBadge(knowledgeStatusOverview?.embeddingCache)
    if (rawTextEmbeddingActiveStatus?.status === 'paused') return t('workspace.knowledge.etaPaused')
    if (rawEmbeddingWaitingFinalization) return t('workspace.knowledge.rawEmbeddingWaitingFinalization')
    if (rawEmbeddingRunningInParallel) return t('workspace.knowledge.rawEmbeddingParallel')
    if (rawEmbeddingCompleted) return t('workspace.knowledge.rawEmbeddingCompleted')
    return t('workspace.knowledge.rawEmbeddingNotStarted')
  }, [knowledgeStatusOverview, rawEmbeddingCompleted, rawEmbeddingRunningInParallel, rawEmbeddingWaitingFinalization, rawTextEmbeddingActive, rawTextEmbeddingActiveStatus, t])
  const rawTextEmbeddingStatusLine = useMemo(() => {
    if (!rawTextEmbeddingActive) return formatKnowledgeCoverageDetail(t('workspace.knowledge.rawEmbeddingCacheEyebrow'), knowledgeStatusOverview?.embeddingCache)
    if (rawTextEmbeddingActiveStatus?.status === 'paused') return rawTextEmbeddingProgress !== undefined ? t('workspace.knowledge.rawEmbeddingPausedPartial') : t('workspace.knowledge.rawEmbeddingPausedNoTelemetry')
    if (rawEmbeddingWaitingFinalization) return rawEmbeddingCompleted ? t('workspace.knowledge.rawEmbeddingWaitingIndexReady') : t('workspace.knowledge.rawEmbeddingWaitingIndex')
    if (rawEmbeddingRunningInParallel) return rawTextEmbeddingProgress !== undefined ? t('workspace.knowledge.rawEmbeddingParallelWithPercent') : t('workspace.knowledge.rawEmbeddingParallelWaiting')
    if (rawEmbeddingCompleted) return t('workspace.knowledge.rawEmbeddingDone')
    return t('workspace.knowledge.rawEmbeddingPending')
  }, [knowledgeStatusOverview, rawEmbeddingCompleted, rawEmbeddingRunningInParallel, rawEmbeddingWaitingFinalization, rawTextEmbeddingActive, rawTextEmbeddingActiveStatus, rawTextEmbeddingProgress, t])
  const retrievalIndexStep = useMemo(() => knowledgeRebuildSteps.find((step) => step.key === 'index') ?? null, [knowledgeRebuildSteps])
  const retrievalIndexOverview = knowledgeStatusOverview?.retrievalIndex ?? null
  const retrievalTaskStatus = useMemo(() => {
    const task = retrievalIndexOverview?.task ?? (knowledgeRebuildStatus?.jobType === 'rebuild_retrieval_index' ? knowledgeRebuildStatus : null)
    if (task?.status === 'succeeded' || task?.status === 'completed' || task?.status === 'aborted') return null
    return task
  }, [knowledgeRebuildStatus, retrievalIndexOverview])
  const retrievalTaskPhaseLabel = useMemo(() => resolveKnowledgeJobPhaseLabel(retrievalTaskStatus, t), [retrievalTaskStatus, t])
  const retrievalTaskStatusLabel = useMemo(() => formatKnowledgeJobStatusLabel(retrievalTaskStatus?.status), [retrievalTaskStatus])
  const retrievalControlsState = useMemo(() => resolveRetrievalTaskControlsState({ retrievalTask: retrievalTaskStatus, retrievalIndexOverview, knowledgeRebuildStatus, knowledgeActionLoading, knowledgeRebuilding }), [knowledgeActionLoading, knowledgeRebuildStatus, knowledgeRebuilding, retrievalIndexOverview, retrievalTaskStatus])
  const retrievalIndexStatusLine = useMemo(() => {
    if (retrievalTaskStatus?.status === 'failed') return resolveKnowledgeRebuildFailureMessage(retrievalTaskStatus) ?? t('workspace.knowledge.retrievalRefreshFailed')
    if (retrievalTaskStatus?.status === 'paused') return t('workspace.knowledge.retrievalPaused')
    if (retrievalTaskStatus?.status === 'queued') return t('workspace.knowledge.retrievalQueued')
    if (activeRawEmbeddingStep?.status === 'running' && rawTextEmbeddingActiveStatus?.jobType === 'rebuild_retrieval_index') return t('workspace.knowledge.retrievalWaitingEmbedding')
    if (retrievalTaskStatus?.status === 'running') return t('workspace.knowledge.retrievalRunning')
    return formatRetrievalIndexDetail(retrievalIndexOverview)
  }, [activeRawEmbeddingStep, rawTextEmbeddingActiveStatus, retrievalIndexOverview, retrievalTaskStatus, t])
  const knowledgeGraphOverview = knowledgeStatusOverview?.knowledgeGraph ?? null
  const extractionCacheOverview = knowledgeStatusOverview?.extractionCache ?? null
  const embeddingCacheOverview = knowledgeStatusOverview?.embeddingCache ?? null
  const currentKnowledgeRunningStepKey = useMemo(() => {
    return knowledgeRebuildSteps.find((step) => step.status === 'running')?.key ?? null
  }, [knowledgeRebuildSteps])

  const editor = useEditor({
    extensions: [StarterKit],
    content: currentChapter?.content ?? '',
    immediatelyRender: false,
    editable: false,
    editorProps: { attributes: { 'data-testid': 'workspace-chapter-reader', class: 'px-5 py-5 sm:px-8 sm:py-8 text-[1.06rem] leading-9 text-zinc-200 outline-none min-h-[62vh]' } },
    onUpdate({ editor }) {
      const chapterId = editorChapterIdRef.current
      if (chapterId) {
        const chapter = currentChapter?.id === chapterId
          ? currentChapter
          : params.localChapters.find((item) => item.id === chapterId)
        const html = editor.getHTML()
        const plainText = editor.getText()
        if (chapter) scheduleChapterDraftCache(chapter, html, plainText)
        editorBufferRef.current.update(chapterId, () => ({
          html,
          plainText,
        }))
      }
    },
    onBlur() {
      flushChapterDraftCache()
      flushEditorBuffer()
    },
  })

  const readerScope = currentChapter && currentChapter.contentLoaded !== false && !params.isNovelDeletionPending
    && centerPaneView === 'body' && (!workspaceSelection || workspaceSelection.kind === 'chapter')
    ? JSON.stringify([params.currentNovelId, currentChapter.id])
    : null
  const readerMode = useChapterReaderMode(editor, readerScope, saveWorkspaceBeforeNavigation)

  useEffect(() => {
    if (!editor || !currentChapter || currentChapter.contentLoaded === false) return
    const buffered = editorBufferRef.current.getBuffered()
    if (buffered?.chapterId === currentChapter.id) return
    if (editor.getHTML() !== currentChapter.content) {
      editorBufferRef.current.discard()
      editor.commands.setContent(currentChapter.content, { emitUpdate: false })
    }
  }, [editor, currentChapter])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushChapterDraftCache()
        void flushAndSaveWorkspace(false, true)
      }
    }
    const handlePageHide = () => {
      flushChapterDraftCache()
      void flushAndSaveWorkspace(false, true)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [flushAndSaveWorkspace, flushChapterDraftCache])

  useEffect(() => {
    if (centerPaneView !== 'body' || !currentChapter || currentChapter.contentLoaded === false || !pendingSourceJump) return
    if (pendingSourceJump.chapterId !== currentChapter.id) return
    const timer = window.setTimeout(() => {
      const root = editorRef.current
      const target = root ? findSourceBlock(root, pendingSourceJump.searchText) : null
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        const lineLabel = pendingSourceJump.lineStart !== null
          ? pendingSourceJump.lineEnd !== null && pendingSourceJump.lineEnd !== pendingSourceJump.lineStart
            ? t('workspace.knowledge.jumpSourceLineRange', { start: pendingSourceJump.lineStart, end: pendingSourceJump.lineEnd })
            : t('workspace.knowledge.jumpSourceLineSingle', { line: pendingSourceJump.lineStart })
          : t('workspace.knowledge.jumpSourceLocation')
        showKnowledgeToast(t('workspace.knowledge.jumpSourceToast', { chapter: pendingSourceJump.chapterNo, lineLabel }), 1800, 'info')
      }
      setPendingSourceJump(null)
    }, 120)
    return () => {
      window.clearTimeout(timer)
    }
  }, [centerPaneView, currentChapter, pendingSourceJump, showKnowledgeToast])

  const closePanel = useCallback(() => {
    invalidateRecoverableRewriteOwnership()
    if (activeMode && currentChapter) {
      params.resetPresetCompatSessionStateForSelection(workspaceSelection ?? toChapterTimelineSelection(currentChapter), [toPresetCompatSessionSurfaceId(activeMode)])
    }
    setActiveMode(null)
    setLockedSelectionText('')
    setSaveContinueBlockError('')
    setRewriteLaunchSource('chapter')
    setRewriteSourceTextOverride('')
    setActiveFutureJumpRewriteContext(null)
    setActiveContinueBlockRewriteContext(null)
    setPendingFutureJumpRewriteLaunch(null)
    setPendingContinueBlockRewriteLaunch(null)
    setGenerationContext(null)
    setGraphContext(null)
    setContextPreviewError('')
    setGraphReviewControls(DEFAULT_GRAPH_REVIEW_CONTROLS)
    setContextPanelOpen(false)
    setGraphSelection(null)
    setDisabledContextBlockIds([])
    setExcludedGraphEdgeIds([])
    setExcludedEvidenceIds([])
    setGraphMutationPendingId(null)
    setGraphMutationError('')
    setRewriteState((current) => ({ ...current, error: '' }))
  }, [activeMode, currentChapter, invalidateRecoverableRewriteOwnership, params, workspaceSelection])

  useEffect(() => {
    if (centerPaneView === 'body') return
    const timer = window.setTimeout(() => {
      setToolbarPos(null)
      setSelectionText('')
      setLockedSelectionText('')
      if (activeMode) closePanel()
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [activeMode, centerPaneView, closePanel])

  useEffect(() => {
    if (editor) {
      editorRef.current = editor.view.dom as HTMLDivElement
    }
  }, [editor])

  const currentNovelCharacters = params.localCharacters.filter((item) => item.novelId === params.currentNovelId)
  const currentNovelVisibleCharacters = useMemo(() => filterWorkspaceVisibleCharacters(currentNovelCharacters), [currentNovelCharacters])
  const currentNovelVisibleCharacterCount = currentNovelVisibleCharacters.length
  const currentNovelWorldEntries = params.localWorldEntries.filter((item) => item.novelId === params.currentNovelId)
  const currentNovelOutlines = params.localOutlines.filter((item) => item.novelId === params.currentNovelId)
  const currentNovelTimelineEvents = params.localTimelineEvents.filter((item) => item.novelId === params.currentNovelId).slice().sort((a, b) => a.order - b.order)
  const currentNovelCharactersSorted = useMemo(() => sortCharactersForWorkspaceRail(currentNovelVisibleCharacters), [currentNovelVisibleCharacters])
  const currentNovelWorldEntryGroups = useMemo(() => groupWorldEntriesForWorkspaceRail(currentNovelWorldEntries), [currentNovelWorldEntries])
  const workspaceKnowledgeTabs: Array<{ tab: WorkspaceRefTab; label: string; icon: typeof Users }> = [
    { tab: 'characters', label: t('workspace.referenceTab.characters'), icon: Users },
    { tab: 'organizations', label: t('workspace.referenceTab.organizations'), icon: Building2 },
    { tab: 'locations', label: t('workspace.referenceTab.locations'), icon: MapPin },
    { tab: 'worldbuilding', label: t('workspace.referenceTab.worldbuilding'), icon: Globe },
    { tab: 'outline', label: t('workspace.referenceTab.outline'), icon: ScrollText },
    { tab: 'timeline', label: t('workspace.referenceTab.timeline'), icon: ScrollText },
  ]

  useEffect(() => {
    // RP and other branch views keep the editor instance, but have no chapter
    // selection to track. Their input/scroll events must not update this state.
    if (!readerScope) return
    let frame: number | null = null
    const updateSelection = () => {
      frame = null
      const selection = extractSelection(editorRef.current)
      if (selection || !activeMode) setSelectionText(selection?.text ?? '')
      const position = selection ? clampToolbarPosition({
        top: selection.rect.top - TOOLBAR_OFFSET_Y,
        left: selection.rect.left + selection.rect.width / 2,
      }, toolbarRef.current) : null
      setToolbarPos((current) => current?.top === position?.top && current?.left === position?.left ? current : position)
    }
    const handler = () => {
      // Focus restoration and layout can emit events during a React commit.
      // Read the final layout once per frame, outside that synchronous update.
      if (frame === null) frame = window.requestAnimationFrame(updateSelection)
    }
    document.addEventListener('selectionchange', handler)
    window.addEventListener('resize', handler)
    window.addEventListener('scroll', handler, true)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', handler)
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
    }
  }, [activeMode, readerScope])

  useEffect(() => {
    if (!toolbarPos || activeMode || !toolbarRef.current) return
    const position = clampToolbarPosition(toolbarPos, toolbarRef.current)
    if (position !== toolbarPos) {
      setToolbarPos(position)
    }
  }, [activeMode, toolbarPos])

  const loadChapterGraph = useCallback(async (chapter: Chapter, controls = chapterGraphControls, preserveData = false) => {
    const requestId = chapterGraphRequestRef.current + 1
    chapterGraphRequestRef.current = requestId
    const sourceChapter = chapter.parentChapterId ? parentChapter ?? null : chapter
    if (!params.currentNovelId || !sourceChapter) {
      setChapterGraphData(null)
      setChapterGraphSelection(null)
      setChapterGraphError('')
      setChapterGraphLoading(false)
      return
    }
    const novelId = params.currentNovelId
    if (!preserveData) {
      setChapterGraphData(null)
      setChapterGraphSelection(null)
    }
    setChapterGraphLoading(true)
    setChapterGraphError('')
    try {
      const paramsQuery = new URLSearchParams({
        novelId,
        chapterId: sourceChapter.id,
        hops: String(controls.maxHops),
        includeLowConfidence: String(!controls.hideLowConfidence),
        confirmedOnly: String(controls.confirmedOnly),
      })
      const data = await callChapterGraphContextApi(`/api/rag/graph-context?${paramsQuery.toString()}`)
      if (chapterGraphRequestRef.current !== requestId) return
      if (!data.ok || !data.graphContext || !data.chapterId || !data.branchId || !data.chapterTitle || !data.chapterNo || !data.novelId) {
          throw new Error(data.error || t('workspace.chapterGraph.loadFailed'))
      }
      const nextData = {
        ...(data as ChapterGraphContextData),
        sourceMeta: chapter.parentChapterId
          ? { mode: 'inherited-parent', chapterId: sourceChapter.id, chapterNo: sourceChapter.order, chapterTitle: sourceChapter.title }
          : { mode: 'direct', chapterId: sourceChapter.id, chapterNo: sourceChapter.order, chapterTitle: sourceChapter.title },
      } satisfies ChapterGraphContextData
      setChapterGraphData(nextData)
      setChapterGraphSelection((current) => resolveGraphSelection(nextData.graphContext, preserveData ? current : null))
    } catch (error) {
      if (chapterGraphRequestRef.current !== requestId) return
      setChapterGraphError(resolveWorkspaceUserFacingError('chapter-graph-load', error, locale))
      if (!preserveData) {
        setChapterGraphData(null)
        setChapterGraphSelection(null)
      }
    } finally {
      if (chapterGraphRequestRef.current === requestId) {
        setChapterGraphLoading(false)
      }
    }
  }, [chapterGraphControls, locale, params.currentNovelId, parentChapter, t])

  useEffect(() => {
    if (centerPaneView !== 'graph' || !currentChapter) return
    if (currentChapter.parentChapterId && !parentChapter) {
      chapterGraphRequestRef.current += 1
      chapterGraphScopeRef.current = ''
      const timer = window.setTimeout(() => {
        setChapterGraphData(null)
        setChapterGraphSelection(null)
        setChapterGraphError(t('workspace.chapterGraph.noInheritedParent'))
        setChapterGraphLoading(false)
      }, 0)
      return () => {
        window.clearTimeout(timer)
      }
    }
    const scope = `${params.currentNovelId}:${currentChapter.id}:${parentChapter?.id ?? ''}`
    const timer = window.setTimeout(() => {
      const preserveData = chapterGraphScopeRef.current === scope
      chapterGraphScopeRef.current = scope
      void loadChapterGraph(currentChapter, chapterGraphControls, preserveData)
    }, 0)
    return () => {
      window.clearTimeout(timer)
    }
  }, [centerPaneView, chapterGraphControls, currentChapter, loadChapterGraph, parentChapter, params.currentNovelId, t])

  const handleChapterGraphControlChange = (nextControls: GraphReviewControls) => {
    // The effect owns fetching so a control change cannot trigger a second, clearing request.
    setChapterGraphControls(nextControls)
  }

  const selectedRewriteCandidate = rewriteFlow.candidates[rewriteFlow.selectedIndex] ?? rewriteFlow.candidates[0]
  const previewRewriteContent = selectedRewriteCandidate?.content || rewriteState.result
  const activeGraphContext = graphContext ?? generationContext?.graphContext ?? null
  const activePromptBlockCount = generationContext?.promptBlocks.length ?? 0
  const activeSeedEntityCount = activeGraphContext?.seedEntities.length ?? 0
  const activeGraphEdgeCount = activeGraphContext?.edges.length ?? 0
  const activeEvidenceCount = generationContext?.lanceEvidence.length ?? 0
  const scenarioStatusLabels = (Object.keys(AI_SCENARIO_META) as AIScenarioKey[]).map((scenario) => {
    const meta = scenarioMeta[scenario]
    const settings = resolvedAISettings[scenario]
    if (settings.provider === 'openai-compatible') {
      return settings.openAICompatible.configured && settings.openAICompatible.model
        ? `${meta.shortLabel} ${settings.openAICompatible.model} · ${t('workspace.aiStatus.online')}`
        : `${meta.shortLabel} OpenAI ${t('workspace.aiStatus.notConfigured')}`
    }
    return settings.ollama.configured && settings.ollama.model
      ? `${meta.shortLabel} ${settings.ollama.model} · ${t('workspace.aiStatus.local')}`
      : `${meta.shortLabel} Ollama ${t('workspace.aiStatus.notConfigured')}`
  })
  const providerLabel = scenarioStatusLabels[0] ?? `${scenarioMeta.rewrite.shortLabel} OpenAI ${t('workspace.aiStatus.notConfigured')}`
  const getInstructionForMode = useCallback((mode: WorkspaceActionMode) => {
    if (mode === 'rewrite') return rewritePrompt
    return t('workspace.rewrite.defaultContinueInstruction')
  }, [rewritePrompt, t])
  const buildPresetCompatRuntimeContext = useCallback((surfaceId: PresetCompatSurfaceId) => {
    if (!currentChapter) return {}
    const selection = workspaceSelection ?? toChapterTimelineSelection(currentChapter)
    const sessionEntry = params.presetCompatSessionState[createPresetCompatSessionStateKey(selection, surfaceId)]
    return { sessionPhase: sessionEntry?.phase ?? null, hasImpersonationContext: surfaceId === 'roleplay' }
  }, [currentChapter, params.presetCompatSessionState, workspaceSelection])
  const hydrateRewritePanelFromRecoverableJob = useCallback((job: RecoverableRewriteJob) => {
    const restoredSelection = job.panel.selectedText.trim()
    if (restoredSelection) {
      setSelectionText(restoredSelection)
      setLockedSelectionText(restoredSelection)
    }
    setRewritePrompt(job.panel.userInstruction || t('workspace.rewrite.defaultPrompt'))
    setRewriteSourceTextOverride(job.panel.sourceTextOverride ?? '')
    if (job.panel.rewriteLaunchSource === 'chapter' || job.panel.rewriteLaunchSource === 'what_if' || job.panel.rewriteLaunchSource === 'future_jump' || job.panel.rewriteLaunchSource === 'continue_block') {
      setRewriteLaunchSource(job.panel.rewriteLaunchSource)
    }
    setSelectedWritingSkillCardIds(normalizeWritingSkillCardIds({
      writingSkillCardIds: job.panel.writingSkillCardIds,
      writingSkillCardId: job.panel.writingSkillCardId,
    }))
    if (job.panel.writingSkillExampleCount) setWritingSkillExampleCount(job.panel.writingSkillExampleCount)
    setWritingSkillSeed(
      typeof job.panel.writingSkillSeed === 'number' && Number.isFinite(job.panel.writingSkillSeed)
        ? Math.floor(job.panel.writingSkillSeed) & 0x7fffffff
        : createWritingSkillRuntimeSeed(),
    )
  }, [t])

  const syncRewriteJobFromRecoverableJob = useCallback((job: RecoverableRewriteJob) => {
    const nextCandidate = job.result ? toRewriteCandidateFromRecoverableResult(job.result) : null
    const isPending = job.status === 'queued' || job.status === 'running'
    const nextError = job.status === 'failed' ? resolveWorkspaceUserFacingError('rewrite-job-failed', job.errorMessage, locale) : ''
    setRewriteFlow({ loading: isPending, error: nextError, provider: job.result?.provider || 'recoverable-rewrite-job', candidates: nextCandidate ? [nextCandidate] : [], selectedIndex: 0, jobId: job.jobId, jobStatus: job.status, jobCurrentStep: job.currentStep })
    setRewriteState((current) => ({ loading: isPending, error: nextError, result: nextCandidate?.content || current.result }))
  }, [locale, t])

  const workspaceSaveNotice = params.workspaceSaveFeedback?.kind === 'save-failed'
    ? { message: t('workspace.persistence.saveFailed'), variant: 'error' as const }
    : params.workspaceSaveFeedback?.kind === 'chapter-conflict'
      ? { message: t('workspace.persistence.chapterConflict'), variant: 'warning' as const }
      : params.workspaceSaveFeedback?.kind === 'structural-conflict'
        ? { message: t('workspace.persistence.structuralConflict'), variant: 'error' as const }
        : null

  return {
    currentNovelId: params.currentNovelId,
    leftPanelOpen,
    setLeftPanelOpen,
    referencePanelOpen,
    setReferencePanelOpen,
    knowledgePanelOpen,
    setKnowledgePanelOpen,
    chapterListState,
    setChapterListState,
    centerPaneView,
    setCenterPaneView,
    refTab,
    setRefTab,
    settingsOpen,
    setSettingsOpen,
    confirmDeleteKnowledge,
    setConfirmDeleteKnowledge,
    selectionText,
    setSelectionText,
    lockedSelectionText,
    setLockedSelectionText,
    toolbarPos,
    setToolbarPos,
    activeMode,
    setActiveMode,
    rewritePrompt,
    setRewritePrompt,
    rewriteState,
    setRewriteState,
    rewriteFlow,
    setRewriteFlow,
    writingSkillCards,
    writingSkillCardsLoading,
    writingSkillCardsError,
    selectedWritingSkillCardIds,
    setSelectedWritingSkillCardIds,
    writingSkillExampleCount,
    setWritingSkillExampleCount,
    writingSkillSeed,
    setWritingSkillSeed,
    generationContext,
    setGenerationContext,
    graphContext,
    setGraphContext,
    contextPreviewLoading,
    setContextPreviewLoading,
    contextPreviewError,
    setContextPreviewError,
    graphReviewLoading,
    setGraphReviewLoading,
    currentBranchMetricsOverride,
    setCurrentBranchMetricsOverride,
    continueBlockMetricsNodeIdRef,
    whatIfMetricsNodeIdRef,
    futureJumpMetricsNodeIdRef,
    handleWhatIfMetricsChange,
    handleContinueBlockMetricsChange,
    handleFutureJumpMetricsChange,
    graphReviewControls,
    setGraphReviewControls,
    contextPanelOpen,
    setContextPanelOpen,
    graphSelection,
    setGraphSelection,
    disabledContextBlockIds,
    setDisabledContextBlockIds,
    excludedGraphEdgeIds,
    setExcludedGraphEdgeIds,
    excludedEvidenceIds,
    setExcludedEvidenceIds,
    graphMutationPendingId,
    setGraphMutationPendingId,
    graphMutationError,
    setGraphMutationError,
    chapterGraphData,
    setChapterGraphData,
    chapterGraphLoading,
    setChapterGraphLoading,
    chapterGraphError,
    setChapterGraphError,
    chapterGraphControls,
    setChapterGraphControls,
    chapterGraphSelection,
    setChapterGraphSelection,
    pendingSourceJump,
    setPendingSourceJump,
    workspaceSelection,
    setWorkspaceSelection,
    storyTimelineData,
    setStoryTimelineData,
    storyTimelineError,
    copied,
    setCopied,
    toast: workspaceSaveNotice?.message ?? toast,
    toastVariant: workspaceSaveNotice?.variant ?? toastVariant,
    setToast,
    saveContinueBlockPending,
    setSaveContinueBlockPending,
    saveContinueBlockError,
    setSaveContinueBlockError,
    roleplaySessionStarting,
    setRoleplaySessionStarting,
    deletingBranchNodeId,
    setDeletingBranchNodeId,
    pendingWhatIfRewriteLaunch,
    setPendingWhatIfRewriteLaunch,
    pendingFutureJumpRewriteLaunch,
    setPendingFutureJumpRewriteLaunch,
    pendingContinueBlockRewriteLaunch,
    setPendingContinueBlockRewriteLaunch,
    activeFutureJumpRewriteContext,
    setActiveFutureJumpRewriteContext,
    activeContinueBlockRewriteContext,
    setActiveContinueBlockRewriteContext,
    rewriteLaunchSource,
    setRewriteLaunchSource,
    rewriteSourceTextOverride,
    setRewriteSourceTextOverride,
    futureMapLaunch,
    setFutureMapLaunch,
    knowledgeRebuilding,
    setKnowledgeRebuilding,
    presetCompatLibraryOpen,
    setPresetCompatLibraryOpen,
    knowledgeRebuildStatus,
    setKnowledgeRebuildStatus,
    hanlpCacheSnapshot,
    setHanlpCacheSnapshot,
    knowledgeStatusOverview,
    setKnowledgeStatusOverview,
    knowledgeActionLoading,
    setKnowledgeActionLoading,
    confirmDeleteHanlpCache,
    setConfirmDeleteHanlpCache,
    confirmDeleteExtractionCache,
    setConfirmDeleteExtractionCache,
    confirmDeleteEmbeddingCache,
    setConfirmDeleteEmbeddingCache,
    knowledgeRebuildRangeMode,
    setKnowledgeRebuildRangeMode,
    knowledgeRebuildFirstChapterCount,
    setKnowledgeRebuildFirstChapterCount,
    knowledgeRebuildStartChapter,
    setKnowledgeRebuildStartChapter,
    knowledgeRebuildEndChapter,
    setKnowledgeRebuildEndChapter,
    ollamaModelsByScenario,
    setOllamaModelsByScenario,
    ollamaModelsLoading,
    setOllamaModelsLoading,
    ollamaModelsError,
    setOllamaModelsError,
    openAICompatibleModelsByScenario,
    setOpenAICompatibleModelsByScenario,
    openAICompatibleModelsLoading,
    setOpenAICompatibleModelsLoading,
    openAICompatibleModelsRequestRef,
    editState,
    setEditState,
    knowledgePanelReadOnly,
    editor,
    readerMode,
    flushEditorBuffer,
    saveWorkspaceBeforeNavigation,
    editorRef,
    toolbarRef,
    lastActiveKnowledgeJobIdRef,
    resolvedAISettings,
    updateScenarioProvider,
    updateScenarioOpenAIField,
    updateScenarioOllamaField,
    updateKnowledgeExtractionParallelism,
    updateEmbeddingBatchSize,
    applyLocalEmbeddingSettings,
    refreshCurrentFullKnowledgeProjection,
    showKnowledgeToast,
    currentNovelMeta,
    sortedChapters,
    currentChapter,
    parentChapter,
    graphSourceMeta,
    selectChapter,
    resolveSourceChapter,
    jumpToGraphSource,
    hasWorkspaceContent,
    mainlineChapters,
    selectedKnowledgeRebuildChapterRange,
    selectedKnowledgeRebuildChapterRangeLabel,
    branchChaptersByParentId,
    storyTimelineBranchId,
    resolvedStoryTimeline,
    timelineChapterById,
    timelineNodeById,
    handleTimelineSelection,
    loadStoryTimeline,
    chapterListTarget,
    chapterText,
    resolveEdgeSourceJumpTarget,
    resolveEvidenceSourceJumpTarget,
    mainKnowledgeRebuildStatus,
    currentKnowledgeJobActive,
    currentKnowledgeJobBusy,
    knowledgeRebuildEtaMinutes,
    knowledgeRebuildSteps,
    knowledgeRebuildFailed,
    knowledgeRebuildPaused,
    knowledgeRebuildActive,
    knowledgeRebuildBusy,
    knowledgeRebuildFailureMessage,
    hanlpBootstrapCompletedChapterCount,
    hanlpBootstrapTotalChapterCount,
    hanlpBootstrapCacheHitRatePercent,
    hanlpBootstrapTimingLabel,
    hanlpBootstrapPhaseLabel,
    hanlpBootstrapEtaLabel,
    hanlpBootstrapStatusLine,
    hanlpCacheStatusLabel,
    hanlpSettingsLine,
    hanlpCacheDeleteState,
    extractionCacheDeleteState,
    embeddingCacheDeleteState,
    rawTextEmbeddingCacheHitRatePercent,
    rawTextEmbeddingTimingLabel,
    rawTextEmbeddingSettingsLine,
    rawTextEmbeddingPhaseBadge,
    rawTextEmbeddingStatusLine,
    rawTextEmbeddingActive,
    retrievalIndexOverview,
    retrievalTaskStatus,
    retrievalTaskPhaseLabel,
    retrievalTaskStatusLabel,
    retrievalControlsState,
    retrievalIndexStatusLine,
    knowledgeGraphOverview,
    extractionCacheOverview,
    embeddingCacheOverview,
    currentKnowledgeRunningStepKey,
    currentNovelVisibleCharacterCount,
    currentNovelOutlines,
    currentNovelTimelineEvents,
    currentNovelCharactersSorted,
    currentNovelWorldEntryGroups,
    workspaceKnowledgeTabs,
    loadChapterGraph,
    handleChapterGraphControlChange,
    selectedRewriteCandidate,
    previewRewriteContent,
    activeGraphContext,
    activePromptBlockCount,
    activeSeedEntityCount,
    activeGraphEdgeCount,
    activeEvidenceCount,
    scenarioStatusLabels,
    providerLabel,
    getInstructionForMode,
    buildPresetCompatRuntimeContext,
    recoverablePanelHydrationGenerationRef,
    invalidateRecoverablePanelHydration,
    rewritePanelOwnershipGenerationRef,
    ownedRecoverableRewriteJobIdRef,
    recoverableRewriteContextKeyRef,
    invalidateRecoverableRewriteOwnership,
    hydrateRewritePanelFromRecoverableJob,
    syncRewriteJobFromRecoverableJob,
    closePanel,
  }
}

export type SelectionNovelStudioCoreState = ReturnType<typeof useSelectionNovelStudioCore>

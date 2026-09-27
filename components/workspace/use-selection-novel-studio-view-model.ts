"use client"

import { useEffect, useMemo } from 'react'
import { normalizeStoryBranchInstructionText } from '@/lib/story-branch-labels'
import { getClientLocale, getMessage } from '@/lib/i18n/messages'
import type { Chapter } from '@/lib/types'
import type { StoryTimelineBranchNode, TimelineSelection } from '@/lib/story-branch-types'
import { resolveCurrentNodeMetrics } from '@/components/workspace/selection-novel-studio-helpers'

type BranchMetricsOverride = {
  nodeId: string
  currentText: string
  inputTokens: number | null
  outputTokens: number | null
} | null

type GraphSourceMeta = {
  mode: 'direct' | 'inherited-parent'
  chapterNo: number
}

type FutureMapLaunchState = {
  novelId: string
  branchId: string
  sourceContext: {
    nodeId: string
    nodeType: 'rewrite' | 'continue_block'
    chapterId: string | null
    chapterNo: number
    whatIfSessionId: string | null
  }
  title: string
  parentTimelineNodeId: string
}

type Params = {
  currentChapter: Chapter | null
  workspaceSelection: TimelineSelection | null
  timelineNodeById: Map<string, StoryTimelineBranchNode>
  resolveSourceChapter: (params: { chapterId?: string | null; chapterNo?: number | null }) => Chapter | null
  currentNovelId: string
  storyTimelineBranchId: string
  chapterText: string
  currentBranchMetricsOverride: BranchMetricsOverride
  graphSourceMeta: GraphSourceMeta | null
  continueBlockMetricsNodeIdRef: { current: string | null }
  whatIfMetricsNodeIdRef: { current: string | null }
  futureJumpMetricsNodeIdRef: { current: string | null }
  selectionText: string
  lockedSelectionText: string
}

export function useSelectionNovelStudioViewModel({
  currentChapter,
  workspaceSelection,
  timelineNodeById,
  resolveSourceChapter,
  currentNovelId,
  storyTimelineBranchId,
  chapterText,
  currentBranchMetricsOverride,
  graphSourceMeta,
  continueBlockMetricsNodeIdRef,
  whatIfMetricsNodeIdRef,
  futureJumpMetricsNodeIdRef,
  selectionText,
  lockedSelectionText,
}: Params) {
  const activeWorkspaceSelection = workspaceSelection ?? ({ kind: 'chapter', chapterId: currentChapter?.id ?? '', chapterNo: currentChapter?.order ?? 0 } satisfies TimelineSelection)
  const selectedTimelineNode = activeWorkspaceSelection.kind === 'chapter' ? null : timelineNodeById.get(activeWorkspaceSelection.nodeId) ?? null
  const selectedContinueBlockNode = activeWorkspaceSelection.kind === 'rewrite' || activeWorkspaceSelection.kind === 'continue_block' ? selectedTimelineNode : null
  const selectedContinueBlockFutureMapLaunch = useMemo<FutureMapLaunchState | null>(() => {
    if ((activeWorkspaceSelection.kind !== 'rewrite' && activeWorkspaceSelection.kind !== 'continue_block') || !selectedContinueBlockNode || !currentNovelId) {
      return null
    }
    const sourceChapterNo = selectedContinueBlockNode.sourceChapterNo ?? selectedContinueBlockNode.anchorChapterNo
    const sourceChapter = resolveSourceChapter({ chapterId: null, chapterNo: sourceChapterNo })
    return {
      novelId: currentNovelId,
      branchId: storyTimelineBranchId,
      sourceContext: {
        nodeId: activeWorkspaceSelection.nodeId,
        nodeType: activeWorkspaceSelection.kind,
        chapterId: sourceChapter?.id ?? null,
        chapterNo: sourceChapterNo,
        whatIfSessionId: selectedContinueBlockNode.whatIfSessionId ?? null,
      },
      title: selectedContinueBlockNode.title,
      parentTimelineNodeId: activeWorkspaceSelection.nodeId,
    }
  }, [activeWorkspaceSelection, currentNovelId, resolveSourceChapter, selectedContinueBlockNode, storyTimelineBranchId])
  const selectedTimelineLineageLabel = selectedTimelineNode?.readableLineageLabel?.trim() || selectedTimelineNode?.readableLabel?.trim() || selectedTimelineNode?.title?.trim() || ''
  const selectedTimelineDisplayLabel = selectedTimelineNode?.readableLabel?.trim() || selectedTimelineLineageLabel || selectedTimelineNode?.title?.trim() || ''
  const selectedTimelineInstructionText = normalizeStoryBranchInstructionText(selectedTimelineNode?.userInstruction?.trim() || selectedTimelineNode?.subtitle?.trim() || '')
  const workspaceHeaderTitle = activeWorkspaceSelection.kind === 'chapter' ? currentChapter?.title ?? '' : selectedTimelineDisplayLabel || selectedTimelineNode?.title || currentChapter?.title || ''
  const currentNodeMetrics = resolveCurrentNodeMetrics({
    selection: activeWorkspaceSelection,
    chapterText,
    selectedNode: selectedTimelineNode,
    override: activeWorkspaceSelection.kind !== 'chapter' && currentBranchMetricsOverride?.nodeId === activeWorkspaceSelection.nodeId ? currentBranchMetricsOverride : null,
  })

  useEffect(() => {
    continueBlockMetricsNodeIdRef.current = activeWorkspaceSelection.kind === 'rewrite' || activeWorkspaceSelection.kind === 'continue_block' ? activeWorkspaceSelection.nodeId : null
    whatIfMetricsNodeIdRef.current = activeWorkspaceSelection.kind === 'what_if' ? activeWorkspaceSelection.nodeId : null
    futureJumpMetricsNodeIdRef.current = activeWorkspaceSelection.kind === 'future_jump' ? activeWorkspaceSelection.nodeId : null
  }, [activeWorkspaceSelection, continueBlockMetricsNodeIdRef, futureJumpMetricsNodeIdRef, whatIfMetricsNodeIdRef])

  const summarySource = lockedSelectionText || selectionText
  const locale = getClientLocale()
  const chapterSelectionSummary = summarySource
    ? getMessage(locale, 'workspace.viewModel.selectionSummary', { text: `${summarySource.slice(0, 24)}${summarySource.length > 24 ? '…' : ''}` })
    : getMessage(locale, 'workspace.viewModel.selectionSummaryEmpty')
  const chapterGraphSummary = getMessage(
    locale,
    graphSourceMeta?.mode === 'inherited-parent' ? 'workspace.viewModel.graphSummaryInherited' : 'workspace.viewModel.graphSummary',
    graphSourceMeta?.mode === 'inherited-parent' ? { chapterNo: graphSourceMeta.chapterNo } : undefined
  )
  const mobileRoleplayFocus = activeWorkspaceSelection.kind === 'roleplay_session'

  return {
    activeWorkspaceSelection,
    selectedTimelineNode,
    selectedContinueBlockNode,
    selectedContinueBlockFutureMapLaunch,
    selectedTimelineDisplayLabel,
    selectedTimelineInstructionText,
    workspaceHeaderTitle,
    currentNodeMetrics,
    chapterSelectionSummary,
    chapterGraphSummary,
    mobileRoleplayFocus,
  }
}

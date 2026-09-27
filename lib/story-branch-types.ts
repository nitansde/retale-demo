import type { RoleplayMessageRecord, RoleplaySessionDetail, RoleplaySessionRecord } from '@/lib/roleplay-types'

export type TimelineSelection =
  | {
      kind: 'chapter'
      chapterId: string
      chapterNo: number
    }
  | {
      kind: 'rewrite'
      nodeId: string
      continueBlockId: string
      anchorChapterNo: number
    }
  | {
      kind: 'continue_block'
      nodeId: string
      continueBlockId: string
      anchorChapterNo: number
    }
  | {
      kind: 'what_if'
      nodeId: string
      sessionId: string
      anchorChapterNo: number
    }
  | {
      kind: 'future_jump'
      nodeId: string
      runId: string
      sourceChapterNo: number
      targetChapterNo: number
    }
  | {
      kind: 'roleplay_session'
      nodeId: string
      roleplaySessionId: string
      anchorChapterNo: number
    }

export type StoryTimelineNodeType = 'rewrite' | 'what_if' | 'continue_block' | 'future_jump' | 'roleplay_session'

export type ChapterTimelineItem = {
  type: 'chapter'
  chapterNo: number
  chapterId: string
  title: string
  wordCount: number
  summary?: string | null
}

export type StoryTimelineNodeRecord = {
  id: string
  novelId: string
  branchId: string
  nodeType: StoryTimelineNodeType
  labelIndex: number
  anchorChapterNo: number
  title: string
  subtitle: string | null
  parentNodeId: string | null
  sourceChapterNo: number | null
  targetChapterNo: number | null
  chapterId: string | null
  continueBlockId: string | null
  whatIfSessionId: string | null
  futureJumpRunId: string | null
  roleplaySessionId?: string | null
  currentText?: string | null
  latestText?: string | null
  latestRevisionNo?: number | null
  userInstruction?: string | null
  selectedText?: string | null
  originalText?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  writingSkillCardIds?: string[]
  writingSkillExampleCount?: number | null
  readableLabel?: string
  readableLineageLabel?: string
  laneIndex: number
  colorToken: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type StoryTimelineBranchNode = {
  type: 'branch_node'
  id: string
  nodeType: StoryTimelineNodeType
  readableLabel?: string
  readableLineageLabel?: string
  anchorChapterNo: number
  parentNodeId: string | null
  title: string
  subtitle: string | null
  laneIndex: number
  colorToken: string | null
  sourceChapterNo: number | null
  targetChapterNo: number | null
  continueBlockId: string | null
  whatIfSessionId: string | null
  futureJumpRunId: string | null
  roleplaySessionId?: string | null
  currentText?: string | null
  latestText?: string | null
  latestRevisionNo?: number | null
  userInstruction?: string | null
  selectedText?: string | null
  originalText?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  writingSkillCardIds?: string[]
  writingSkillExampleCount?: number | null
  createdAt?: string
  updatedAt?: string
  status: string
}

export type StoryTimelineEdge = {
  fromNodeId: string
  toNodeId: string
}

export type StoryTimelineResponse = {
  novelId: string
  branchId: string
  chapters: ChapterTimelineItem[]
  branchNodes: StoryTimelineBranchNode[]
  edges: StoryTimelineEdge[]
}

type StoryTimelineOrderedNode = {
  id: string
  nodeType: StoryTimelineNodeType
  anchorChapterNo: number
  parentNodeId: string | null
  laneIndex: number
}

function resolveStoryTimelineVisibleDepth<T extends StoryTimelineOrderedNode>(
  node: T,
  nodesById: Map<string, T>,
  visited = new Set<string>()
): number {
  if (!node.parentNodeId) return 0
  if (visited.has(node.id)) return 0

  const parentNode = nodesById.get(node.parentNodeId)
  if (!parentNode) return 0

  visited.add(node.id)
  const parentDepth = resolveStoryTimelineVisibleDepth(parentNode, nodesById, visited)

  if (node.nodeType !== 'continue_block') return parentDepth
  return Math.max(parentDepth, 1)
}

export function orderStoryTimelineBranchNodes<T extends StoryTimelineOrderedNode>(
  nodes: T[],
  compareNode: (left: T, right: T) => number
): T[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const childrenByParentId = new Map<string, T[]>()
  const rootNodes: T[] = []

  for (const node of nodes) {
    if (node.parentNodeId && nodesById.has(node.parentNodeId)) {
      const current = childrenByParentId.get(node.parentNodeId) ?? []
      current.push(node)
      childrenByParentId.set(node.parentNodeId, current)
      continue
    }

    rootNodes.push(node)
  }

  for (const children of childrenByParentId.values()) {
    children.sort(compareNode)
  }

  rootNodes.sort((left, right) => {
    if (left.anchorChapterNo !== right.anchorChapterNo) return left.anchorChapterNo - right.anchorChapterNo
    return compareNode(left, right)
  })

  const nodeDepths = new Map(nodes.map((node) => [node.id, resolveStoryTimelineVisibleDepth(node, nodesById)]))
  const ordered: T[] = []
  const visit = (node: T) => {
    ordered.push({ ...node, laneIndex: nodeDepths.get(node.id) ?? node.laneIndex })
    for (const child of childrenByParentId.get(node.id) ?? []) {
      visit(child)
    }
  }

  for (const rootNode of rootNodes) {
    visit(rootNode)
  }

  return ordered
}

export type OutlineNodeChapterRecord = {
  id: string
  outlineNodeId: string
  chapterNo: number
  chapterId: string | null
  chapterTitle: string | null
  isPrimary: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type OutlineNodeRecord = {
  id: string
  novelId: string
  branchId: string
  chapterNo: number | null
  title: string
  summary: string
  originalOutcome: string | null
  trackKey: string
  phaseLabel: string | null
  sourceType: string
  confidence: number | null
  involvedEntities: string[]
  keyEvents: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type FutureMapTrack = {
  trackKey: string
  phaseLabel: string | null
  eventCount: number
  sourceTypes: string[]
}

export type FutureMapEvent = {
  id: string
  chapterNo: number | null
  title: string
  summary: string
  originalOutcome: string | null
  trackKey: string
  phaseLabel: string | null
  sourceType: string
  confidence: number | null
  sortOrder: number
}

export const FUTURE_MAP_MISSING_SUMMARY_FALLBACK = '暂无摘要，仍可直接跳转到本章。'

export type FutureMapDefaults = {
  selectedTrackKey: string | null
  selectedOutlineNodeId: string | null
}

export type FutureMapResponse = {
  novelId: string
  branchId: string
  tracks: FutureMapTrack[]
  events: FutureMapEvent[]
  chaptersByEvent: Record<string, OutlineNodeChapterRecord[]>
  defaults: FutureMapDefaults
}

export type FutureJumpSourceNodeType = TimelineSelection['kind']

export type FutureJumpSourceContext = {
  nodeId: string | null
  nodeType: FutureJumpSourceNodeType
  chapterId: string | null
  chapterNo: number
  whatIfSessionId: string | null
}

export type { RoleplayMessageRecord, RoleplaySessionDetail, RoleplaySessionRecord }

export type WhatIfSessionRecord = {
  id: string
  novelId: string
  baseBranchId: string
  sourceChapterNo: number
  title: string
  premise: string
  selectedText: string
  originalText: string
  generatedText: string
  inputTokens?: number | null
  outputTokens?: number | null
  status: string
  createdAt: string
  updatedAt: string
}

export type WhatIfDeltaRecord = {
  id: string
  sessionId: string
  deltaType: string
  subjectName: string | null
  targetName: string | null
  subjectEntityId: string | null
  targetEntityId: string | null
  key: string
  oldValue: string | null
  newValue: string | null
  validFromChapter: number | null
  description: string
  confidence: number | null
  createdAt: string
}

export type WhatIfSessionRevisionRecord = {
  revisionNo: number
  revisionKind: string
  userInstruction: string
  selectedText: string
  originalText: string
  generatedText: string
  inputTokens?: number | null
  outputTokens?: number | null
  title: string
  subtitle: string | null
  createdAt: string
}

export type WhatIfSessionRevisionHistoryItem = {
  revisionNo: number
  revisionKind: string
  createdAt: string
}

export type WhatIfSessionDetail = WhatIfSessionRecord & {
  deltas: WhatIfDeltaRecord[]
  latestRevision?: WhatIfSessionRevisionRecord | null
  revisionHistory?: WhatIfSessionRevisionHistoryItem[]
  revisions?: WhatIfSessionRevisionRecord[]
}

export type WhatIfCreateRequest = {
  novelId: string
  branchId: string
  sourceChapterNo: number
  selectedText: string
  originalText: string
  generatedText: string
  userInstruction: string
  inputTokens?: number | null
  outputTokens?: number | null
  titleHint?: string | null
  subtitleHint?: string | null
}

export type WhatIfCreateResponse = {
  sessionId: string
  timelineNodeId: string
  generatedText: string
  deltas: WhatIfDeltaRecord[]
  title: string
  subtitle: string | null
}

export type FutureJumpRevisionRecord = {
  id: string
  runId: string
  revisionNo: number
  revisionKind: string
  userFeedback: string | null
  bridgeSummary: string
  generatedTargetText: string
  inputTokens?: number | null
  outputTokens?: number | null
  createdAt: string
}

export type FutureJumpRevisionHistoryItem = {
  revisionNo: number
  revisionKind: string
  userFeedback: string | null
  createdAt: string
}

export type FutureJumpRunRecord = {
  id: string
  sourceTextSnapshot: string
  baseBranchId: string
  parentTimelineNodeId: string | null
  sourceContext: FutureJumpSourceContext
  targetOutlineNodeId: string
  targetOutlineChapterId: string
  sourceChapterNo: number
  targetChapterNo: number
  userDirection: string
  bridgeSummary: string
  generatedTargetText: string
  inputTokens?: number | null
  outputTokens?: number | null
  latestRevisionNo: number
  errorMessage: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type FutureJumpCreateRequest = {
  novelId: string
  sourceContext: FutureJumpSourceContext
  targetOutlineNodeId: string
  targetOutlineChapterId: string
  parentTimelineNodeId?: string | null
  userDirection?: string | null
}

export type FutureJumpMutationResponse = {
  runId: string
  timelineNodeId: string | null
  bridgeSummary: string
  generatedTargetText: string
  presetCompat?: PresetCompatResponseMetadata | null
}

export type FutureJumpReviseRequest = {
  novelId: string
  userFeedback: string
}

export type FutureJumpRunDetail = FutureJumpRunRecord & {
  timelineNodeId: string | null
  latestRevision: FutureJumpRevisionRecord | null
  revisionHistory: FutureJumpRevisionHistoryItem[]
  revisions: FutureJumpRevisionRecord[]
}

export type ContinueBlockRevisionRecord = {
  id: string
  continueBlockId: string
  revisionNo: number
  revisionKind: string
  userInstruction: string
  selectedText: string
  originalText: string
  generatedText: string
  inputTokens?: number | null
  outputTokens?: number | null
  title: string
  subtitle: string | null
  createdAt: string
}

export type ContinueBlockRevisionHistoryItem = {
  revisionNo: number
  revisionKind: string
  createdAt: string
}

export type ContinueBlockRecord = {
  id: string
  novelId: string
  branchId: string
  parentTimelineNodeId: string | null
  sourceChapterNo: number
  title: string
  subtitle: string | null
  userInstruction: string
  selectedText: string
  originalText: string
  latestText: string
  inputTokens?: number | null
  outputTokens?: number | null
  writingSkillCardIds: string[]
  writingSkillExampleCount: number
  latestRevisionNo: number
  status: string
  createdAt: string
  updatedAt: string
}

export type ContinueBlockDetail = ContinueBlockRecord & {
  timelineNodeId: string | null
  latestRevision: ContinueBlockRevisionRecord | null
  revisionHistory: ContinueBlockRevisionHistoryItem[]
  revisions: ContinueBlockRevisionRecord[]
}

export type ContinueBlockCreateRequest = {
  novelId: string
  branchId: string
  sourceChapterNo: number
  parentTimelineNodeId?: string | null
  selectedText: string
  originalText: string
  generatedText: string
  userInstruction: string
  inputTokens?: number | null
  outputTokens?: number | null
  writingSkillCardIds?: string[]
  writingSkillExampleCount?: number
  titleHint?: string | null
  subtitleHint?: string | null
}

export type ContinueBlockRegenerateRequest = {
  novelId: string
  branchId: string
  continueBlockId: string
  generatedText: string
  userInstruction: string
  selectedText: string
  originalText: string
  inputTokens?: number | null
  outputTokens?: number | null
  writingSkillCardIds?: string[]
  writingSkillExampleCount?: number
  titleHint?: string | null
  subtitleHint?: string | null
}

export type ContinueBlockMutationResponse = {
  continueBlockId: string
  timelineNodeId: string
  nodeType: Extract<StoryTimelineNodeType, 'rewrite' | 'continue_block'>
  readableLabel?: string
  readableLineageLabel?: string
  generatedText: string
  title: string
  subtitle: string | null
  latestRevisionNo: number
  writingSkillCardIds: string[]
  writingSkillExampleCount: number
}
import type { PresetCompatResponseMetadata } from '@/lib/preset-compat/runtime-integration'

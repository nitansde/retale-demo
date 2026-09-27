"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BranchBlock } from '@/components/timeline/BranchBlock'
import { BranchLineLayer } from '@/components/timeline/BranchLineLayer'
import { ChapterTimelineCard } from '@/components/timeline/ChapterTimelineCard'
import { useI18n } from '@/lib/i18n/provider'
import { resolveStoryBranchDisplayLabel } from '@/lib/story-branch-labels'
import { orderStoryTimelineBranchNodes, type ChapterTimelineItem, type StoryTimelineBranchNode, type StoryTimelineEdge, type TimelineSelection } from '@/lib/story-branch-types'
import { toBranchTimelineSelection } from '@/components/workspace/workspace-selection'
import type { Chapter } from '@/lib/types'
import { cn } from '@/lib/utils'

type NodePosition = {
  x: number
  y: number
}

function areNodePositionsEqual(left: Record<string, NodePosition>, right: Record<string, NodePosition>) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    const leftPosition = left[key]
    const rightPosition = right[key]
    if (!rightPosition) return false
    if (leftPosition.x !== rightPosition.x || leftPosition.y !== rightPosition.y) return false
  }

  return true
}

function compareNodeCreation(left: StoryTimelineBranchNode, right: StoryTimelineBranchNode): number {
  const leftCreatedAt = left.createdAt ?? ''
  const rightCreatedAt = right.createdAt ?? ''
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt.localeCompare(rightCreatedAt)
  return left.id.localeCompare(right.id)
}

function orderBranchNodes(branchNodes: StoryTimelineBranchNode[]): StoryTimelineBranchNode[] {
  return orderStoryTimelineBranchNodes(branchNodes, compareNodeCreation)
}

function collectSourceChain(nodeId: string | null, parents: ReadonlyMap<string, string>) {
  const chain = new Set<string>()
  let current = nodeId
  while (current && !chain.has(current)) {
    chain.add(current)
    current = parents.get(current) ?? null
  }
  return chain
}

export function StoryTimeline(props: {
  chapters: ChapterTimelineItem[]
  branchNodes: StoryTimelineBranchNode[]
  allBranchNodes?: StoryTimelineBranchNode[]
  edges: StoryTimelineEdge[]
  activeChapterId: string
  activeSelection: TimelineSelection | null
  branchChaptersByParentId: Map<string, Chapter[]>
  onSelectionChange: (selection: TimelineSelection) => void
  onDeleteChapter: (chapterId: string) => void
  onDeleteBranchChapter: (chapterId: string) => void
  deletingBranchNodeId: string | null
  onDeleteBranchNode: (node: StoryTimelineBranchNode) => void
}) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const connectionLayerRef = useRef<SVGSVGElement | null>(null)
  const chapterRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const nodeRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [layout, setLayout] = useState<{ width: number; height: number; nodePositions: Record<string, NodePosition> }>({
    width: 0,
    height: 0,
    nodePositions: {},
  })
  const sourceNodes = props.allBranchNodes ?? props.branchNodes
  const sourceNodesById = useMemo(() => new Map(sourceNodes.map((node) => [node.id, node])), [sourceNodes])
  const connections = useMemo(() => {
    const parents = new Map(props.edges.map((edge) => [edge.toNodeId, edge.fromNodeId]))
    for (const node of sourceNodes) {
      parents.set(node.id, node.parentNodeId ?? parents.get(node.id) ?? `chapter:${node.sourceChapterNo ?? node.anchorChapterNo}`)
    }
    return {
      parents,
      edges: Array.from(parents, ([toNodeId, fromNodeId]) => ({ fromNodeId, toNodeId })),
    }
  }, [props.edges, sourceNodes])

  const nodesByAnchor = useMemo(() => {
    const orderedNodes = orderBranchNodes(props.branchNodes)
    const grouped = new Map<number, StoryTimelineBranchNode[]>()
    for (const node of orderedNodes) {
      const current = grouped.get(node.anchorChapterNo) ?? []
      current.push(node)
      grouped.set(node.anchorChapterNo, current)
    }
    return grouped
  }, [props.branchNodes])

  const measureLayout = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const bounds = container.getBoundingClientRect()
    // The directory drawer animates with scale(). Convert viewport coordinates
    // back to SVG coordinates so the endpoints stay attached during and after it.
    const inverseTransform = connectionLayerRef.current?.getScreenCTM?.()?.inverse()
    const nodePositions: Record<string, NodePosition> = {}

    const measureNode = (element: HTMLButtonElement | null, nodeId: string) => {
      if (!element) return
      const rect = element.getBoundingClientRect()
      const point = inverseTransform
        ? new DOMPoint(rect.left, rect.top + rect.height / 2).matrixTransform(inverseTransform)
        : null
      nodePositions[nodeId] = point ? { x: point.x, y: point.y } : {
        x: rect.left - bounds.left,
        y: rect.top - bounds.top + rect.height / 2,
      }
    }
    chapterRefs.current.forEach(measureNode)
    nodeRefs.current.forEach(measureNode)

    setLayout((current) => {
      if (
        current.width === bounds.width
        && current.height === bounds.height
        && areNodePositionsEqual(current.nodePositions, nodePositions)
      ) {
        return current
      }

      return {
        width: bounds.width,
        height: bounds.height,
        nodePositions,
      }
    })
  }, [])

  useEffect(() => {
    measureLayout()

    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      measureLayout()
    })
    const container = containerRef.current
    if (container) observer.observe(container)
    chapterRefs.current.forEach((element) => {
      if (element) observer.observe(element)
    })
    nodeRefs.current.forEach((element) => {
      if (element) observer.observe(element)
    })

    window.addEventListener('resize', measureLayout)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureLayout)
    }
  }, [measureLayout, props.chapters, props.branchNodes])

  const selectedNodeId = props.activeSelection?.kind === 'chapter' ? null : props.activeSelection?.nodeId ?? null
  const visibleNodeIds = new Set(props.branchNodes.map((node) => node.id))
  const previewNodeId = hoveredNodeId && visibleNodeIds.has(hoveredNodeId)
    ? hoveredNodeId
    : focusedNodeId && visibleNodeIds.has(focusedNodeId) ? focusedNodeId : null
  const selectedChain = collectSourceChain(selectedNodeId, connections.parents)
  const previewChain = collectSourceChain(previewNodeId, connections.parents)
  const highlightedChain = previewNodeId ? previewChain : selectedChain

  return (
    <div ref={containerRef} data-testid="story-timeline" className={cn('relative space-y-1 lg:space-y-3', props.branchNodes.length > 0 && 'pl-3')}>
      <BranchLineLayer
        ref={connectionLayerRef}
        width={layout.width}
        height={layout.height}
        edges={connections.edges}
        nodePositions={layout.nodePositions}
        selectedChain={selectedChain}
        previewChain={previewChain}
      />

      {props.chapters.map((chapter) => {
        const branchChapters = props.branchChaptersByParentId.get(chapter.chapterId) ?? []
        const attachedNodes = nodesByAnchor.get(chapter.chapterNo) ?? []

        return (
          <ChapterTimelineCard
            key={chapter.chapterId}
            ref={(element) => {
              const key = `chapter:${chapter.chapterNo}`
              if (element) chapterRefs.current.set(key, element)
              else chapterRefs.current.delete(key)
            }}
            chapter={chapter}
            highlighted={highlightedChain.has(`chapter:${chapter.chapterNo}`)}
            activeChapterId={props.activeChapterId}
            navigationTargetChapterId={props.activeSelection?.kind === 'chapter'
              ? props.activeSelection.chapterId
              : props.activeSelection
                ? null
                : props.activeChapterId}
            branchChapters={branchChapters}
            onSelectChapter={() => props.onSelectionChange({ kind: 'chapter', chapterId: chapter.chapterId, chapterNo: chapter.chapterNo })}
            onDeleteChapter={() => props.onDeleteChapter(chapter.chapterId)}
            onSelectBranchChapter={(branchChapter) => props.onSelectionChange({ kind: 'chapter', chapterId: branchChapter.id, chapterNo: branchChapter.order })}
            onDeleteBranchChapter={(branchChapter) => props.onDeleteBranchChapter(branchChapter.id)}
            branchArtifacts={
              attachedNodes.length ? (
                attachedNodes.map((node) => {
                  const selection = toBranchTimelineSelection(node)
                  const highlighted = highlightedChain.has(node.id)
                  const sourceId = connections.parents.get(node.id)
                  const sourceNode = sourceId ? sourceNodesById.get(sourceId) : null
                  const sourceLabel = sourceNode
                    ? [
                        sourceNode.anchorChapterNo !== node.anchorChapterNo ? t('workspace.timeline.chapterLabel', { count: sourceNode.anchorChapterNo }) : '',
                        resolveStoryBranchDisplayLabel(sourceNode),
                      ].filter(Boolean).join(' · ')
                    : sourceId?.startsWith('chapter:')
                      ? t('workspace.timeline.chapterLabel', { count: node.sourceChapterNo ?? node.anchorChapterNo })
                      : t('workspace.timeline.parentBranch')

                  return (
                    <BranchBlock
                      key={node.id}
                      ref={(element) => {
                        if (element) nodeRefs.current.set(node.id, element)
                        else nodeRefs.current.delete(node.id)
                      }}
                      node={node}
                      sourceLabel={sourceLabel}
                      compactSourceLabel={sourceNode ? resolveStoryBranchDisplayLabel(sourceNode) : sourceLabel}
                      selected={selectedNodeId === node.id}
                      highlighted={highlighted}
                      deleting={props.deletingBranchNodeId === node.id}
                      disabled={!selection}
                      onSelect={() => {
                        if (selection) props.onSelectionChange(selection)
                      }}
                      onDelete={() => props.onDeleteBranchNode(node)}
                      onHoverChange={(hovered) => {
                        setHoveredNodeId((current) => (hovered ? node.id : current === node.id ? null : current))
                      }}
                      onFocusChange={(focused) => {
                        setFocusedNodeId((current) => (focused ? node.id : current === node.id ? null : current))
                      }}
                    />
                  )
                })
              ) : null
            }
          />
        )
      })}
    </div>
  )
}

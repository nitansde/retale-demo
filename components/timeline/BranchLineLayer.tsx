"use client"

import { forwardRef } from 'react'
import type { StoryTimelineEdge } from '@/lib/story-branch-types'
import { cn } from '@/lib/utils'

type NodePosition = {
  x: number
  y: number
}

function buildFoldedPath(from: NodePosition, to: NodePosition, fromChapter: boolean) {
  const trunkX = fromChapter ? 3 : 7
  const direction = to.y >= from.y ? 1 : -1
  const radius = Math.min(4, Math.abs(to.y - from.y) / 2)
  return `M ${from.x} ${from.y} H ${trunkX + radius} Q ${trunkX} ${from.y} ${trunkX} ${from.y + radius * direction} V ${to.y - radius * direction} Q ${trunkX} ${to.y} ${trunkX + radius} ${to.y} H ${to.x}`
}

export const BranchLineLayer = forwardRef<SVGSVGElement, {
  width: number
  height: number
  edges: StoryTimelineEdge[]
  nodePositions: Record<string, NodePosition>
  selectedChain: ReadonlySet<string>
  previewChain: ReadonlySet<string>
}>((props, ref) => {
  const isSelected = (edge: StoryTimelineEdge) => props.selectedChain.has(edge.fromNodeId) && props.selectedChain.has(edge.toNodeId)
  const isHovered = (edge: StoryTimelineEdge) => props.previewChain.has(edge.fromNodeId) && props.previewChain.has(edge.toNodeId)
  const emphasis = (edge: StoryTimelineEdge) => isSelected(edge) ? 2 : isHovered(edge) ? 1 : 0
  const edges = [...props.edges].sort((left, right) => emphasis(left) - emphasis(right))
  return (
    <svg ref={ref} className="pointer-events-none absolute inset-0 z-20 overflow-visible" width={props.width} height={props.height} aria-hidden="true">
      {edges.map((edge) => {
        const from = props.nodePositions[edge.fromNodeId]
        const to = props.nodePositions[edge.toNodeId]
        if (!from || !to) return null

        const highlighted = isHovered(edge)
        const selected = isSelected(edge)

        return (
          <path
            key={`${edge.fromNodeId}-${edge.toNodeId}`}
            data-testid={`timeline-edge-${edge.fromNodeId}-${edge.toNodeId}`}
            data-active={selected ? 'true' : 'false'}
            data-highlighted={highlighted ? 'true' : 'false'}
            d={buildFoldedPath(from, to, edge.fromNodeId.startsWith('chapter:'))}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            className={cn(
              'stroke-line/40 transition-opacity duration-150 motion-reduce:transition-none',
              (props.previewChain.size ? highlighted : selected) ? 'opacity-100' : 'opacity-0'
            )}
          />
        )
      })}
    </svg>
  )
})

BranchLineLayer.displayName = 'BranchLineLayer'

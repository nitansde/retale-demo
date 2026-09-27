import { InputValidationError, ResourceNotFoundError } from '@/lib/server/domain-errors'
import type { DatabaseAccess } from '@/lib/server/database-access'
import type { StoryTimelineNodeRecord } from '@/lib/story-branch-types'
import { findStoryTimelineNodeById } from '@/lib/server/story-timeline-store'

type TimelineNodeContextParams = {
  nodeId: string | null | undefined
  novelId: string
  branchId: string
  db?: Pick<DatabaseAccess, 'execute' | 'queryAll' | 'queryOne'>
}

function normalizeNodeId(nodeId: string | null | undefined) {
  return typeof nodeId === 'string' ? nodeId.trim() : ''
}

export function findTimelineNodeInBranchContext(params: TimelineNodeContextParams): StoryTimelineNodeRecord | null {
  const nodeId = normalizeNodeId(params.nodeId)
  if (!nodeId) return null

  const node = findStoryTimelineNodeById(nodeId, params.db)
  if (!node || node.novelId !== params.novelId || node.branchId !== params.branchId) {
    return null
  }

  return node
}

export function requireTimelineNodeInBranchContext(
  params: TimelineNodeContextParams & { label: string }
): StoryTimelineNodeRecord {
  const nodeId = normalizeNodeId(params.nodeId)
  if (!nodeId) {
    throw new InputValidationError(`${params.label} is required`)
  }

  const node = findTimelineNodeInBranchContext(params)
  if (!node) {
    throw new ResourceNotFoundError(`${params.label} not found: ${nodeId}`)
  }

  return node
}

export function requireOptionalTimelineNodeInBranchContext(
  params: TimelineNodeContextParams & { label: string }
): StoryTimelineNodeRecord | null {
  const nodeId = normalizeNodeId(params.nodeId)
  if (!nodeId) return null

  return requireTimelineNodeInBranchContext({ ...params, nodeId })
}

export function buildChildReadableLineageLabel(
  parentNode: Pick<StoryTimelineNodeRecord, 'readableLineageLabel'> | null,
  readableLabel: string
) {
  return parentNode?.readableLineageLabel ? `${parentNode.readableLineageLabel}, ${readableLabel}` : readableLabel
}

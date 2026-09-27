import { ResourceNotFoundError } from '@/lib/server/domain-errors'
import { parseRequestInput } from '@/lib/server/request-validation'
import {
  continueBlockCreateRequestSchema,
  continueBlockMutationResponseSchema,
  continueBlockRegenerateRequestSchema,
} from '@/lib/server/story-branch-contracts'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import {
  appendContinueBlockRevision,
  findContinueBlockById,
  insertContinueBlockWithInitialRevision,
} from '@/lib/server/continue-block-store'
import {
  createStoryTimelineNode,
  findStoryTimelineNodeByContinueBlockId,
  getNextContinueReadableLabelIndex,
  getNextStoryTimelineLabelIndex,
  updateStoryTimelineNodePresentation,
} from '@/lib/server/story-timeline-store'
import {
  buildChildReadableLineageLabel,
  requireOptionalTimelineNodeInBranchContext,
} from '@/lib/server/story-branch-mutation-helpers'
import { formatStoryBranchReadableLabel, prefixStoryBranchTitle } from '@/lib/story-branch-labels'
import type {
  ContinueBlockCreateRequest,
  ContinueBlockMutationResponse,
  ContinueBlockRegenerateRequest,
  StoryTimelineNodeType,
} from '@/lib/story-branch-types'
import { uid } from '@/lib/utils'

function sanitizeLineTitle(value: string) {
  const trimmed = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[「」『』【】]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!trimmed) return ''
  return trimmed.length > 18 ? `${trimmed.slice(0, 18).trim()}…` : trimmed
}

function buildContinueBlockTitle(params: {
  readableLineageLabel: string
  titleHint?: string | null
  userInstruction: string
  selectedText: string
}) {
  const explicit = sanitizeLineTitle(params.titleHint?.trim() || '')
  const instruction = sanitizeLineTitle(params.userInstruction)
  const selected = sanitizeLineTitle(params.selectedText)
  const suffix = explicit || instruction || selected || '续写块'
  return prefixStoryBranchTitle(params.readableLineageLabel, suffix)
}

function buildContinueBlockSubtitle(params: {
  subtitleHint?: string | null
  userInstruction: string
}) {
  const explicit = params.subtitleHint?.trim()
  if (explicit) return explicit.slice(0, 48)
  const instruction = params.userInstruction.trim()
  return instruction ? instruction.slice(0, 48) : null
}

export async function createContinueBlockFromRewrite(rawInput: ContinueBlockCreateRequest): Promise<ContinueBlockMutationResponse> {
  const input = parseRequestInput(continueBlockCreateRequestSchema, rawInput)
  const db = createNovelDatabaseAccess(input.novelId)
  const nodeType: StoryTimelineNodeType = input.parentTimelineNodeId ? 'continue_block' : 'rewrite'
  const { continueBlock, timelineNode } = await db.withTransaction(() => {
    const labelIndex = getNextStoryTimelineLabelIndex(input.novelId, input.branchId, nodeType, db)
    const readableLabelIndex = nodeType === 'continue_block' && input.parentTimelineNodeId
      ? getNextContinueReadableLabelIndex(input.novelId, input.branchId, input.parentTimelineNodeId, db)
      : labelIndex
    const readableLabel = formatStoryBranchReadableLabel(nodeType, readableLabelIndex)
    const parentNode = requireOptionalTimelineNodeInBranchContext({
      nodeId: input.parentTimelineNodeId,
      novelId: input.novelId,
      branchId: input.branchId,
      label: 'Parent timeline node',
      db,
    })
    const readableLineageLabel = buildChildReadableLineageLabel(parentNode, readableLabel)
    const title = buildContinueBlockTitle({
      readableLineageLabel,
      titleHint: input.titleHint,
      userInstruction: input.userInstruction,
      selectedText: input.selectedText,
    })
    const subtitle = buildContinueBlockSubtitle({ subtitleHint: input.subtitleHint, userInstruction: input.userInstruction })
    const insertedContinueBlock = insertContinueBlockWithInitialRevision({
      id: uid('continue-block'),
      novelId: input.novelId,
      branchId: input.branchId,
      parentTimelineNodeId: input.parentTimelineNodeId ?? null,
      sourceChapterNo: input.sourceChapterNo,
      title,
      subtitle,
      userInstruction: input.userInstruction,
      selectedText: input.selectedText,
      originalText: input.originalText,
      latestText: input.generatedText,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      writingSkillCardIds: input.writingSkillCardIds,
      writingSkillExampleCount: input.writingSkillExampleCount,
      latestRevisionNo: 1,
      status: 'active',
    }, db)

    if (!insertedContinueBlock) {
      throw new Error('Failed to create continue block')
    }

    const insertedTimelineNode = createStoryTimelineNode({
      id: uid('timeline-node'),
      novelId: input.novelId,
      branchId: input.branchId,
      nodeType,
      labelIndex,
      readableLabel,
      readableLineageLabel,
      anchorChapterNo: input.sourceChapterNo,
      title,
      subtitle,
      parentNodeId: input.parentTimelineNodeId ?? null,
      sourceChapterNo: input.sourceChapterNo,
      targetChapterNo: null,
      chapterId: null,
      continueBlockId: insertedContinueBlock.id,
      whatIfSessionId: null,
      futureJumpRunId: null,
      laneIndex: 0,
      colorToken: 'fuchsia',
      status: insertedContinueBlock.status,
    }, db)

    if (!insertedTimelineNode) {
      throw new Error('Failed to create continue block timeline node')
    }

    return { continueBlock: insertedContinueBlock, timelineNode: insertedTimelineNode }
  })

  return continueBlockMutationResponseSchema.parse({
    continueBlockId: continueBlock.id,
    timelineNodeId: timelineNode.id,
    nodeType: timelineNode.nodeType,
    readableLabel: timelineNode.readableLabel,
    readableLineageLabel: timelineNode.readableLineageLabel,
    generatedText: continueBlock.latestText,
    title: continueBlock.title,
    subtitle: continueBlock.subtitle,
    latestRevisionNo: continueBlock.latestRevisionNo,
    writingSkillCardIds: continueBlock.writingSkillCardIds,
    writingSkillExampleCount: continueBlock.writingSkillExampleCount,
  })
}

export async function regenerateContinueBlock(rawInput: ContinueBlockRegenerateRequest): Promise<ContinueBlockMutationResponse> {
  const input = parseRequestInput(continueBlockRegenerateRequestSchema, rawInput)
  const db = createNovelDatabaseAccess(input.novelId)
  const existing = findContinueBlockById(input.continueBlockId, db)
  if (!existing || existing.novelId !== input.novelId || existing.branchId !== input.branchId) {
    throw new ResourceNotFoundError(`Continue block not found: ${input.continueBlockId}`)
  }

  const timelineNode = findStoryTimelineNodeByContinueBlockId(existing.id, db)
  const labelIndex = timelineNode?.labelIndex ?? existing.latestRevisionNo
  const readableLineageLabel = timelineNode?.readableLineageLabel
    ?? formatStoryBranchReadableLabel(timelineNode?.nodeType ?? 'continue_block', labelIndex)
  const title = buildContinueBlockTitle({
    readableLineageLabel,
    titleHint: input.titleHint,
    userInstruction: input.userInstruction,
    selectedText: input.selectedText,
  })
  const subtitle = buildContinueBlockSubtitle({ subtitleHint: input.subtitleHint, userInstruction: input.userInstruction })
  const updated = await appendContinueBlockRevision({
    continueBlockId: existing.id,
    revisionKind: 'regenerate',
    userInstruction: input.userInstruction,
    selectedText: input.selectedText,
    originalText: input.originalText,
    generatedText: input.generatedText,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    writingSkillCardIds: input.writingSkillCardIds,
    writingSkillExampleCount: input.writingSkillExampleCount,
    title,
    subtitle,
    status: 'revised',
  }, db)

  if (!updated) {
    throw new Error(`Failed to regenerate continue block: ${input.continueBlockId}`)
  }

  const refreshedTimelineNode = timelineNode ?? findStoryTimelineNodeByContinueBlockId(existing.id, db)
  if (!refreshedTimelineNode) {
    throw new ResourceNotFoundError(`Continue block timeline node not found: ${input.continueBlockId}`)
  }

  updateStoryTimelineNodePresentation(refreshedTimelineNode.id, {
    title: updated.title,
    subtitle: updated.subtitle,
    status: updated.status,
  }, db)

  return continueBlockMutationResponseSchema.parse({
    continueBlockId: updated.id,
    timelineNodeId: refreshedTimelineNode.id,
    nodeType: refreshedTimelineNode.nodeType,
    readableLabel: refreshedTimelineNode.readableLabel,
    readableLineageLabel: refreshedTimelineNode.readableLineageLabel,
    generatedText: updated.latestText,
    title: updated.title,
    subtitle: updated.subtitle,
    latestRevisionNo: updated.latestRevisionNo,
    writingSkillCardIds: updated.writingSkillCardIds,
    writingSkillExampleCount: updated.writingSkillExampleCount,
  })
}

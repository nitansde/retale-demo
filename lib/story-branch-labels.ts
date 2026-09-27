import type { StoryTimelineNodeType } from '@/lib/story-branch-types'
import { parseRoleplayTurn } from '@/lib/roleplay-script'

type StoryBranchLabelNode = {
  id: string
  nodeType: StoryTimelineNodeType
  labelIndex: number
  parentNodeId: string | null
}

type StoryBranchDisplayNode = {
  readableLabel?: string | null
  readableLineageLabel?: string | null
  title?: string | null
}

const STORY_BRANCH_LABEL_PREFIXES = {
  rewrite: 'RE',
  continue_block: 'CONT',
  what_if: 'IF',
  future_jump: 'JUMP',
  roleplay_session: 'RP',
} as const satisfies Record<StoryTimelineNodeType, string>

export function formatStoryBranchReadableLabel(nodeType: StoryTimelineNodeType, labelIndex: number) {
  return `${STORY_BRANCH_LABEL_PREFIXES[nodeType]}-${String(labelIndex).padStart(2, '0')}`
}

export function buildStoryBranchReadableLineageLabel(
  node: StoryBranchLabelNode,
  nodesById: ReadonlyMap<string, StoryBranchLabelNode>
) {
  const segments: string[] = []
  const visited = new Set<string>()

  let current: StoryBranchLabelNode | undefined = node
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    segments.unshift(formatStoryBranchReadableLabel(current.nodeType, current.labelIndex))
    current = current.parentNodeId ? nodesById.get(current.parentNodeId) : undefined
  }

  return segments.join(', ')
}

export function prefixStoryBranchTitle(readableLineageLabel: string, suffix: string) {
  const trimmedSuffix = suffix.trim()
  return trimmedSuffix ? `${readableLineageLabel} ${trimmedSuffix}` : readableLineageLabel
}

export function resolveStoryBranchDisplayLabel(node: StoryBranchDisplayNode) {
  const readableLabel = node.readableLabel?.trim()
  if (readableLabel) return readableLabel

  const readableLineageLabel = node.readableLineageLabel?.trim()
  if (readableLineageLabel) return readableLineageLabel

  return node.title?.trim() ?? ''
}

export function normalizeStoryBranchInstructionText(value: string | null | undefined) {
  return value
    ?.replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() ?? ''
}

export function formatStoryBranchInstructionPreview(value: string | null | undefined, maxChars = 15) {
  const normalized = normalizeStoryBranchInstructionText(value).replace(/\s+/g, ' ')
  if (!normalized) return ''

  const characters = Array.from(normalized)
  return characters.length > maxChars ? `${characters.slice(0, maxChars).join('')}…` : characters.join('')
}

export function summarizeStoryBranchText(value: string | null | undefined, maxChars = 24) {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  if (!normalized) return ''

  const characters = Array.from(normalized)
  return characters.length > maxChars ? `${characters.slice(0, maxChars).join('')}…` : characters.join('')
}

export function resolveRoleplaySessionTimelinePresentation(input: {
  anchorChapterNo: number
  title?: string | null
  subtitle?: string | null
  firstUserMessage?: string | null
  sourceSelectedText?: string | null
  sourceTextSnapshot?: string | null
}) {
  const explicitTitle = input.title?.trim() ?? ''
  let firstUserRequest = input.firstUserMessage ?? ''
  try {
    const storedMessage: unknown = JSON.parse(firstUserRequest)
    const turn = storedMessage && typeof storedMessage === 'object' && 'turn' in storedMessage
      ? parseRoleplayTurn(storedMessage.turn)
      : null
    if (turn) {
      firstUserRequest = [
        turn.storyGuidance,
        turn.dialogue && `${turn.playerName}对${turn.counterpartName}说：${turn.dialogue}`,
      ].filter(Boolean).join('\n')
    }
  } catch { /* Legacy user messages are stored as plain text. */ }
  const firstUserSummary = summarizeStoryBranchText(firstUserRequest, 22)
  const selectedTextSummary = summarizeStoryBranchText(input.sourceSelectedText, 22)
  const sourceSnapshotSummary = summarizeStoryBranchText(input.sourceTextSnapshot, 22)
  const title = explicitTitle || firstUserSummary || selectedTextSummary || sourceSnapshotSummary || `RP · 第 ${input.anchorChapterNo} 章`
  const subtitle = normalizeStoryBranchInstructionText(firstUserRequest) || null

  return { title, subtitle }
}

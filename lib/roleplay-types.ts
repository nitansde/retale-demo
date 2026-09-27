import type { RoleplayScript, RoleplayTurn } from '@/lib/roleplay-script'

export type RoleplaySourceNodeType = 'chapter' | 'rewrite' | 'continue_block' | 'what_if' | 'future_jump' | 'roleplay_session'

export type RoleplayMessageRole = 'user' | 'assistant'

export type RoleplaySessionRecord = {
  id: string
  novelId: string
  branchId: string
  title: string
  subtitle: string | null
  sourceChapterId: string | null
  sourceChapterNo: number
  sourceChapterTitle: string | null
  sourceTimelineNodeId: string | null
  sourceTimelineNodeType: RoleplaySourceNodeType | null
  sourceSelectedText: string
  sourceTextSnapshot: string
  sourceSelectedLineStart: number | null
  sourceSelectedLineEnd: number | null
  status: string
  createdAt: string
  updatedAt: string
}

export type RoleplayMessageRecord = {
  id: string
  sessionId: string
  messageIndex: number
  turnIndex: number
  variantIndex: number
  role: RoleplayMessageRole
  content: string
  turn?: RoleplayTurn
  script?: RoleplayScript
  parentMessageId: string | null
  forkedFromMessageId: string | null
  variantGroupId: string | null
  status: string
  createdAt: string
  updatedAt: string
}

export type RoleplaySessionDetail = RoleplaySessionRecord & {
  timelineNodeId: string | null
  messages: RoleplayMessageRecord[]
}

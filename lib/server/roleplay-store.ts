import { InputValidationError, ResourceNotFoundError } from '@/lib/server/domain-errors'
import { parseRequestInput } from '@/lib/server/request-validation'
import { roleplayMessageCreateSchema, roleplaySessionCreateSchema } from '@/lib/server/story-branch-contracts'
import { createStoryTimelineNode, findStoryTimelineNodeByRoleplaySessionId, getNextStoryTimelineLabelIndex } from '@/lib/server/story-timeline-store'
import {
  buildChildReadableLineageLabel,
  requireOptionalTimelineNodeInBranchContext,
} from '@/lib/server/story-branch-mutation-helpers'
import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/database-access'
import { formatStoryBranchReadableLabel } from '@/lib/story-branch-labels'
import type { RoleplayMessageRecord, RoleplaySessionDetail, RoleplaySessionRecord } from '@/lib/roleplay-types'
import { uid } from '@/lib/utils'
import { parseRoleplayScript, parseRoleplayTurn, roleplayScriptText } from '@/lib/roleplay-script'
import { getRoleplayBranchDeletionIds } from '@/lib/roleplay-branches'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
  withTransaction: typeof withTransaction
}

const defaultDb: Db = { execute, queryAll, queryOne, withTransaction }

type ParsedRoleplayMessageCreate = ReturnType<typeof roleplayMessageCreateSchema.parse>

type RoleplaySessionRow = {
  id: string
  novel_id: string
  branch_id: string
  title: string
  subtitle: string | null
  source_chapter_id: string | null
  source_chapter_no: number
  source_chapter_title: string | null
  source_timeline_node_id: string | null
  source_timeline_node_type: RoleplaySessionRecord['sourceTimelineNodeType']
  source_selected_text: string
  source_text_snapshot: string
  source_selected_line_start: number | null
  source_selected_line_end: number | null
  status: string
  created_at: string
  updated_at: string
}

type RoleplayMessageRow = {
  id: string
  session_id: string
  message_index: number
  turn_index: number
  variant_index: number
  role: RoleplayMessageRecord['role']
  content: string
  parent_message_id: string | null
  forked_from_message_id: string | null
  variant_group_id: string | null
  status: string
  created_at: string
  updated_at: string
}

function toRoleplaySessionRecord(row: RoleplaySessionRow): RoleplaySessionRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    branchId: row.branch_id,
    title: row.title,
    subtitle: row.subtitle,
    sourceChapterId: row.source_chapter_id,
    sourceChapterNo: row.source_chapter_no,
    sourceChapterTitle: row.source_chapter_title,
    sourceTimelineNodeId: row.source_timeline_node_id,
    sourceTimelineNodeType: row.source_timeline_node_type,
    sourceSelectedText: row.source_selected_text,
    sourceTextSnapshot: row.source_text_snapshot,
    sourceSelectedLineStart: row.source_selected_line_start,
    sourceSelectedLineEnd: row.source_selected_line_end,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRoleplayMessageRecord(row: RoleplayMessageRow): RoleplayMessageRecord {
  let structured = {}
  try {
    const value = JSON.parse(row.content)
    const turn = row.role === 'user' ? parseRoleplayTurn(value.turn) : null
    const script = row.role === 'assistant' ? parseRoleplayScript(value.script) : null
    if (turn) structured = { turn, content: turn.dialogue || turn.storyGuidance }
    if (script) structured = { script, content: roleplayScriptText(script) }
  } catch { /* Non-script messages are not rendered by the script view. */ }
  return {
    id: row.id,
    sessionId: row.session_id,
    messageIndex: row.message_index,
    turnIndex: row.turn_index,
    variantIndex: row.variant_index,
    role: row.role,
    content: row.content,
    ...structured,
    parentMessageId: row.parent_message_id,
    forkedFromMessageId: row.forked_from_message_id,
    variantGroupId: row.variant_group_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function listRoleplayMessages(sessionId: string, db: Db = defaultDb) {
  const rows = db.queryAll<RoleplayMessageRow>(
    `SELECT *
     FROM roleplay_messages
     WHERE session_id = ?
     ORDER BY message_index ASC, variant_index ASC, created_at ASC, id ASC`,
    sessionId
  )

  return rows.map(toRoleplayMessageRecord)
}

function findRoleplayMessageById(id: string, db: Db = defaultDb) {
  const row = db.queryOne<RoleplayMessageRow>('SELECT * FROM roleplay_messages WHERE id = ? LIMIT 1', id)
  return row ? toRoleplayMessageRecord(row) : null
}

function insertRoleplayMessage(input: ParsedRoleplayMessageCreate, db: Db) {
  db.execute(
    `INSERT INTO roleplay_messages (
      id, session_id, message_index, turn_index, variant_index, role, content,
      parent_message_id, forked_from_message_id, variant_group_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.sessionId,
    input.messageIndex,
    input.turnIndex,
    input.variantIndex,
    input.role,
    input.content,
    input.parentMessageId ?? null,
    input.forkedFromMessageId ?? null,
    input.variantGroupId ?? null,
    input.status
  )

  return findRoleplayMessageById(input.id, db)
}

function assertMessageBelongsToSession(messageId: string | null | undefined, sessionId: string, label: string, db: Db) {
  if (!messageId) return null
  const message = findRoleplayMessageById(messageId, db)
  if (!message) {
    throw new ResourceNotFoundError(`${label} not found: ${messageId}`)
  }
  if (message.sessionId !== sessionId) {
    throw new ResourceNotFoundError(`${label} does not belong to roleplay session: ${messageId}`)
  }
  return message
}

export function listRoleplaySessionsByNovel(novelId: string, db: Db = defaultDb) {
  const rows = db.queryAll<RoleplaySessionRow>(
    `SELECT *
     FROM roleplay_sessions
     WHERE novel_id = ?
     ORDER BY created_at DESC, id DESC`,
    novelId
  )

  return rows.map(toRoleplaySessionRecord)
}

export function findRoleplaySessionById(sessionId: string, db: Db = defaultDb): RoleplaySessionDetail | null {
  const row = db.queryOne<RoleplaySessionRow>('SELECT * FROM roleplay_sessions WHERE id = ? LIMIT 1', sessionId)
  if (!row) return null

  const timelineNode = findStoryTimelineNodeByRoleplaySessionId(sessionId, db)
  return {
    ...toRoleplaySessionRecord(row),
    timelineNodeId: timelineNode?.id ?? null,
    messages: listRoleplayMessages(sessionId, db),
  }
}

export async function createRoleplaySession(
  rawInput: Omit<RoleplaySessionRecord, 'createdAt' | 'updatedAt'>,
  db: Db = defaultDb
) {
  const input = parseRequestInput(roleplaySessionCreateSchema, rawInput)
  const timelineNodeId = uid('timeline-node')

  await db.withTransaction(async () => {
    const parentNode = requireOptionalTimelineNodeInBranchContext({
      nodeId: input.sourceTimelineNodeId,
      novelId: input.novelId,
      branchId: input.branchId,
      label: 'Source timeline node',
      db,
    })
    const labelIndex = getNextStoryTimelineLabelIndex(input.novelId, input.branchId, 'roleplay_session', db)
    const readableLabel = formatStoryBranchReadableLabel('roleplay_session', labelIndex)
    const readableLineageLabel = buildChildReadableLineageLabel(parentNode, readableLabel)

    db.execute(
      `INSERT INTO roleplay_sessions (
        id, novel_id, branch_id, title, subtitle, source_chapter_id, source_chapter_no,
        source_chapter_title, source_timeline_node_id, source_timeline_node_type,
        source_selected_text, source_text_snapshot, source_selected_line_start,
        source_selected_line_end, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.novelId,
      input.branchId,
      input.title,
      input.subtitle ?? null,
      input.sourceChapterId,
      input.sourceChapterNo,
      input.sourceChapterTitle ?? null,
      input.sourceTimelineNodeId ?? null,
      input.sourceTimelineNodeType ?? null,
      input.sourceSelectedText,
      input.sourceTextSnapshot,
      input.sourceSelectedLineStart ?? null,
      input.sourceSelectedLineEnd ?? null,
      input.status
    )

    createStoryTimelineNode({
      id: timelineNodeId,
      novelId: input.novelId,
      branchId: input.branchId,
      nodeType: 'roleplay_session',
      labelIndex,
      readableLabel,
      readableLineageLabel,
      anchorChapterNo: input.sourceChapterNo,
      title: input.title,
      subtitle: input.subtitle ?? null,
      parentNodeId: input.sourceTimelineNodeId ?? null,
      sourceChapterNo: input.sourceChapterNo,
      targetChapterNo: null,
      chapterId: input.sourceChapterId,
      continueBlockId: null,
      whatIfSessionId: null,
      futureJumpRunId: null,
      roleplaySessionId: input.id,
      laneIndex: 0,
      colorToken: 'amber',
      status: input.status,
    }, db)
  })

  const session = findRoleplaySessionById(input.id, db)
  if (!session) {
    throw new Error(`Failed to create roleplay session: ${input.id}`)
  }

  return {
    session,
    timelineNodeId,
  }
}

export async function appendRoleplayMessage(
  rawInput: Omit<RoleplayMessageRecord, 'createdAt' | 'updatedAt' | 'messageIndex' | 'turnIndex' | 'variantIndex'> & {
    messageIndex?: number
    turnIndex?: number
    variantIndex?: number
  },
  db: Db = defaultDb
) {
  return db.withTransaction(() => {
    const session = findRoleplaySessionById(rawInput.sessionId, db)
    if (!session) {
      throw new ResourceNotFoundError(`Roleplay session not found: ${rawInput.sessionId}`)
    }

    const validatedParent = assertMessageBelongsToSession(rawInput.parentMessageId, rawInput.sessionId, 'Parent message', db)
    const validatedFork = assertMessageBelongsToSession(rawInput.forkedFromMessageId, rawInput.sessionId, 'Fork source message', db)
    const nextMessageIndexRow = db.queryOne<{ next_message_index: number }>(
      'SELECT COALESCE(MAX(message_index), 0) + 1 AS next_message_index FROM roleplay_messages WHERE session_id = ?',
      rawInput.sessionId
    )
    const nextTurnIndexRow = db.queryOne<{ next_turn_index: number }>(
      'SELECT COALESCE(MAX(turn_index), 0) + 1 AS next_turn_index FROM roleplay_messages WHERE session_id = ?',
      rawInput.sessionId
    )
    const input = parseRequestInput(roleplayMessageCreateSchema, {
      ...rawInput,
      messageIndex: rawInput.messageIndex ?? nextMessageIndexRow?.next_message_index ?? 1,
      turnIndex: rawInput.turnIndex ?? nextTurnIndexRow?.next_turn_index ?? 1,
      variantIndex: rawInput.variantIndex ?? 1,
      parentMessageId: validatedParent?.id ?? rawInput.parentMessageId ?? null,
      forkedFromMessageId: validatedFork?.id ?? rawInput.forkedFromMessageId ?? null,
      variantGroupId: rawInput.variantGroupId ?? null,
      status: rawInput.status ?? 'active',
    })
    const message = insertRoleplayMessage(input, db)
    if (!message) {
      throw new Error(`Failed to append roleplay message: ${input.id}`)
    }
    return message
  })
}

export async function deleteRoleplayBranch(input: { sessionId: string; messageId: string }, db: Db = defaultDb) {
  return db.withTransaction(() => {
    const session = findRoleplaySessionById(input.sessionId, db)
    if (!session) throw new ResourceNotFoundError(`Roleplay session not found: ${input.sessionId}`)
    if (!session.messages.some((message) => message.id === input.messageId)) {
      throw new ResourceNotFoundError(`Roleplay branch not found: ${input.messageId}`)
    }
    const deletedMessageIds = getRoleplayBranchDeletionIds(session.messages, input.messageId)
    if (!deletedMessageIds.length) throw new InputValidationError('The branch has changed. Reload it before deleting.')
    // Other reply variants may reference a deleted message as their fork source.
    for (const messageId of deletedMessageIds) {
      db.execute('UPDATE roleplay_messages SET forked_from_message_id = NULL WHERE session_id = ? AND forked_from_message_id = ?', input.sessionId, messageId)
    }
    // Delete children before parents; no surviving path depends on these messages.
    for (const messageId of deletedMessageIds) {
      db.execute('DELETE FROM roleplay_messages WHERE session_id = ? AND id = ?', input.sessionId, messageId)
    }
    db.execute('UPDATE roleplay_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', input.sessionId)
    return { deletedMessageIds }
  })
}

export async function deleteRoleplayTurn(input: { sessionId: string; messageId: string }, db: Db = defaultDb) {
  return db.withTransaction(() => {
    const session = findRoleplaySessionById(input.sessionId, db)
    if (!session) throw new ResourceNotFoundError(`Roleplay session not found: ${input.sessionId}`)
    const request = session.messages.find((message) => message.id === input.messageId)
    if (!request) throw new ResourceNotFoundError(`Roleplay request not found: ${input.messageId}`)
    if (request.role !== 'user') throw new InputValidationError('Only user requests can be deleted with their replies')

    const deletedMessageIds = session.messages
      .filter((message) => message.id === request.id || (message.role === 'assistant' && message.parentMessageId === request.id))
      .map((message) => message.id)
    const deletedIds = new Set(deletedMessageIds)

    // Keep later turns and forks connected to the history before the removed request.
    for (const message of session.messages) {
      if (deletedIds.has(message.id)) continue
      const parentRemoved = message.parentMessageId !== null && deletedIds.has(message.parentMessageId)
      const forkRemoved = message.forkedFromMessageId !== null && deletedIds.has(message.forkedFromMessageId)
      if (!parentRemoved && !forkRemoved) continue
      db.execute(
        `UPDATE roleplay_messages SET parent_message_id = ?, forked_from_message_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND id = ?`,
        parentRemoved ? request.parentMessageId : message.parentMessageId,
        forkRemoved ? null : message.forkedFromMessageId,
        input.sessionId, message.id
      )
    }
    for (const messageId of deletedMessageIds) {
      db.execute('DELETE FROM roleplay_messages WHERE session_id = ? AND id = ?', input.sessionId, messageId)
    }
    db.execute('UPDATE roleplay_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', input.sessionId)
    return { deletedMessageIds }
  })
}

export async function createRoleplayLatestTurnVariant(
  input: {
    sessionId: string
    sourceMessageId?: string
    role: RoleplayMessageRecord['role']
    content: string
    parentMessageId?: string | null
    forkedFromMessageId?: string | null
    status?: string
  },
  db: Db = defaultDb
) {
  return db.withTransaction(() => {
    const session = findRoleplaySessionById(input.sessionId, db)
    if (!session) {
      throw new ResourceNotFoundError(`Roleplay session not found: ${input.sessionId}`)
    }

    // A selected route may end before the session's most recently saved message.
    const latestMessage = input.sourceMessageId
      ? assertMessageBelongsToSession(input.sourceMessageId, input.sessionId, 'Variant source message', db)
      : session.messages.at(-1)
    if (!latestMessage) {
      throw new InputValidationError(`Cannot create latest-turn variant without messages: ${input.sessionId}`)
    }
    if (input.role !== latestMessage.role) {
      throw new InputValidationError(`Latest-turn variant role must match latest message role: expected ${latestMessage.role}`)
    }
    if (input.sourceMessageId && input.parentMessageId !== undefined && input.parentMessageId !== latestMessage.parentMessageId) {
      throw new InputValidationError('Variant parent must match the source message parent')
    }

    const variantGroupId = latestMessage.variantGroupId ?? uid('roleplay-variant-group')
    const nextMessageIndexRow = db.queryOne<{ next_message_index: number }>(
      'SELECT COALESCE(MAX(message_index), 0) + 1 AS next_message_index FROM roleplay_messages WHERE session_id = ?',
      input.sessionId
    )
    const nextVariantIndexRow = db.queryOne<{ next_variant_index: number }>(
      `SELECT COALESCE(MAX(variant_index), 0) + 1 AS next_variant_index
       FROM roleplay_messages
       WHERE session_id = ? AND turn_index = ?`,
      input.sessionId,
      latestMessage.turnIndex
    )
    if (!latestMessage.variantGroupId) {
      db.execute(
        `UPDATE roleplay_messages
         SET variant_group_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ? AND turn_index = ? AND variant_group_id IS NULL`,
        variantGroupId,
        input.sessionId,
        latestMessage.turnIndex
      )
    }

    const parentMessageId = input.parentMessageId ?? latestMessage.parentMessageId
    const forkedFromMessageId = input.forkedFromMessageId ?? latestMessage.id
    const validatedParent = assertMessageBelongsToSession(parentMessageId, input.sessionId, 'Parent message', db)
    const validatedFork = assertMessageBelongsToSession(forkedFromMessageId, input.sessionId, 'Fork source message', db)
    const variantInput = parseRequestInput(roleplayMessageCreateSchema, {
      id: uid('roleplay-message'),
      sessionId: input.sessionId,
      messageIndex: nextMessageIndexRow?.next_message_index ?? latestMessage.messageIndex + 1,
      turnIndex: latestMessage.turnIndex,
      variantIndex: nextVariantIndexRow?.next_variant_index ?? latestMessage.variantIndex + 1,
      role: input.role,
      content: input.content,
      parentMessageId: validatedParent?.id ?? null,
      forkedFromMessageId: validatedFork?.id ?? null,
      variantGroupId,
      status: input.status ?? latestMessage.status,
    })
    const variantMessage = insertRoleplayMessage(variantInput, db)
    if (!variantMessage) {
      throw new Error(`Failed to create latest-turn variant: ${input.sessionId}`)
    }
    return variantMessage
  })
}

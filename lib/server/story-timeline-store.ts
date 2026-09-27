import { execute, queryAll, queryOne } from '@/lib/server/database-access'
import { resolveChapterNavigationSummary } from '@/lib/chapter-navigation'
import { safeParseJson } from '@/lib/server/json-parse'
import {
  buildStoryBranchReadableLineageLabel,
  formatStoryBranchReadableLabel,
  resolveRoleplaySessionTimelinePresentation,
} from '@/lib/story-branch-labels'
import { orderStoryTimelineBranchNodes } from '@/lib/story-branch-types'
import { countChineseFriendlyWords } from '@/lib/utils'
import { normalizeWritingSkillCardIds } from '@/lib/writing-skill-selection'
import type {
  ChapterTimelineItem,
  StoryTimelineBranchNode,
  StoryTimelineEdge,
  StoryTimelineNodeRecord,
  StoryTimelineNodeType,
  StoryTimelineResponse,
} from '@/lib/story-branch-types'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
}

const defaultDb: Db = { execute, queryAll, queryOne }

type StoryTimelineNodeRow = {
  id: string
  novel_id: string
  branch_id: string
  node_type: StoryTimelineNodeType
  label_index: number
  anchor_chapter_no: number
  title: string
  subtitle: string | null
  parent_node_id: string | null
  source_chapter_no: number | null
  target_chapter_no: number | null
  chapter_id: string | null
  continue_block_id: string | null
  what_if_session_id: string | null
  future_jump_run_id: string | null
  roleplay_session_id: string | null
  continue_block_latest_text: string | null
  continue_block_latest_input_tokens: number | null
  continue_block_latest_output_tokens: number | null
  continue_block_writing_skill_card_ids_json: string | null
  continue_block_writing_skill_example_count: number | null
  continue_block_latest_revision_no: number | null
  continue_block_user_instruction: string | null
  continue_block_selected_text: string | null
  continue_block_original_text: string | null
  what_if_generated_text: string | null
  what_if_input_tokens: number | null
  what_if_output_tokens: number | null
  future_jump_generated_target_text: string | null
  future_jump_latest_input_tokens: number | null
  future_jump_latest_output_tokens: number | null
  readable_label: string | null
  readable_lineage_label: string | null
  lane_index: number | null
  color_token: string | null
  status: string
  created_at: string
  updated_at: string
}

type StoryTimelineNodeDeleteResult = {
  deletedNode: StoryTimelineNodeRecord
  promotedChildIds: string[]
}

type StoryTimelineNodeParentRow = {
  id: string
  parent_node_id: string | null
}

const STORY_TIMELINE_NODE_SELECT = `
  SELECT
     story_timeline_nodes.*,
     continue_blocks.latest_text AS continue_block_latest_text,
     continue_blocks.latest_input_tokens AS continue_block_latest_input_tokens,
     continue_blocks.latest_output_tokens AS continue_block_latest_output_tokens,
     continue_blocks.writing_skill_card_ids_json AS continue_block_writing_skill_card_ids_json,
     continue_blocks.writing_skill_example_count AS continue_block_writing_skill_example_count,
     continue_blocks.latest_revision_no AS continue_block_latest_revision_no,
     continue_blocks.user_instruction AS continue_block_user_instruction,
     continue_blocks.selected_text AS continue_block_selected_text,
     continue_blocks.original_text AS continue_block_original_text,
     what_if_sessions.generated_text AS what_if_generated_text,
     what_if_sessions.input_tokens AS what_if_input_tokens,
     what_if_sessions.output_tokens AS what_if_output_tokens,
     future_jump_runs.generated_target_text AS future_jump_generated_target_text,
     future_jump_runs.latest_input_tokens AS future_jump_latest_input_tokens,
     future_jump_runs.latest_output_tokens AS future_jump_latest_output_tokens
  FROM story_timeline_nodes
  LEFT JOIN continue_blocks ON continue_blocks.id = story_timeline_nodes.continue_block_id
  LEFT JOIN what_if_sessions ON what_if_sessions.id = story_timeline_nodes.what_if_session_id
  LEFT JOIN future_jump_runs ON future_jump_runs.id = story_timeline_nodes.future_jump_run_id
`

type KnowledgeChapterRow = {
  id: string
  chapterNo: number
  title: string | null
  rawText: string | null
  summary: string | null
  knowledgeStatus: string
  summaryProvider: string | null
}

type RoleplayTimelineSessionRow = {
  id: string
  novel_id: string
  branch_id: string
  title: string
  subtitle: string | null
  source_chapter_no: number
  source_timeline_node_id: string | null
  source_selected_text: string
  source_text_snapshot: string
  status: string
  created_at: string
  updated_at: string
  first_user_message: string | null
  latest_message: string | null
}

function parseContinueBlockWritingSkillCardIds(value: string | null) {
  const parsed = safeParseJson(value)
  return normalizeWritingSkillCardIds({
    writingSkillCardIds: Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [],
  })
}

function normalizeContinueBlockWritingSkillExampleCount(value: number | null) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : 5
}

function toStoryTimelineNodeRecord(row: StoryTimelineNodeRow): StoryTimelineNodeRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    branchId: row.branch_id,
    nodeType: row.node_type,
    labelIndex: row.label_index,
    anchorChapterNo: row.anchor_chapter_no,
    title: row.title,
    subtitle: row.subtitle,
    parentNodeId: row.parent_node_id,
    sourceChapterNo: row.source_chapter_no,
    targetChapterNo: row.target_chapter_no,
    chapterId: row.chapter_id,
    continueBlockId: row.continue_block_id,
    whatIfSessionId: row.what_if_session_id,
    futureJumpRunId: row.future_jump_run_id,
    roleplaySessionId: row.roleplay_session_id,
    currentText: row.continue_block_latest_text ?? row.what_if_generated_text ?? row.future_jump_generated_target_text,
    latestText: row.continue_block_latest_text,
    inputTokens: row.continue_block_latest_input_tokens ?? row.what_if_input_tokens ?? row.future_jump_latest_input_tokens,
    outputTokens: row.continue_block_latest_output_tokens ?? row.what_if_output_tokens ?? row.future_jump_latest_output_tokens,
    writingSkillCardIds: row.continue_block_id
      ? parseContinueBlockWritingSkillCardIds(row.continue_block_writing_skill_card_ids_json)
      : undefined,
    writingSkillExampleCount: row.continue_block_id
      ? normalizeContinueBlockWritingSkillExampleCount(row.continue_block_writing_skill_example_count)
      : undefined,
    latestRevisionNo: row.continue_block_latest_revision_no,
    userInstruction: row.continue_block_user_instruction,
    selectedText: row.continue_block_selected_text,
    originalText: row.continue_block_original_text,
    readableLabel: row.readable_label ?? undefined,
    readableLineageLabel: row.readable_lineage_label ?? undefined,
    laneIndex: row.lane_index ?? 0,
    colorToken: row.color_token,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function withReadableBranchMetadata<T extends StoryTimelineNodeRecord>(nodes: T[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  return nodes.map((node) => ({
    ...node,
    readableLabel: node.readableLabel ?? formatStoryBranchReadableLabel(node.nodeType, node.labelIndex),
    readableLineageLabel: node.readableLineageLabel ?? buildStoryBranchReadableLineageLabel(node, nodesById),
  }))
}

function loadRoleplayTimelineSessions(novelId: string, branchId: string, db: Db) {
  return db.queryAll<RoleplayTimelineSessionRow>(
    `SELECT
       roleplay_sessions.id,
       roleplay_sessions.novel_id,
       roleplay_sessions.branch_id,
       roleplay_sessions.title,
       roleplay_sessions.subtitle,
       roleplay_sessions.source_chapter_no,
       roleplay_sessions.source_timeline_node_id,
       roleplay_sessions.source_selected_text,
       roleplay_sessions.source_text_snapshot,
       roleplay_sessions.status,
       roleplay_sessions.created_at,
       roleplay_sessions.updated_at,
       (
         SELECT roleplay_messages.content
         FROM roleplay_messages
         WHERE roleplay_messages.session_id = roleplay_sessions.id AND roleplay_messages.role = 'user'
         ORDER BY roleplay_messages.message_index ASC, roleplay_messages.id ASC
         LIMIT 1
       ) AS first_user_message,
       (
         SELECT roleplay_messages.content
         FROM roleplay_messages
         WHERE roleplay_messages.session_id = roleplay_sessions.id
         ORDER BY roleplay_messages.message_index DESC, roleplay_messages.id DESC
         LIMIT 1
       ) AS latest_message
     FROM roleplay_sessions
     WHERE roleplay_sessions.novel_id = ? AND roleplay_sessions.branch_id = ?
     ORDER BY roleplay_sessions.created_at ASC, roleplay_sessions.id ASC`,
    novelId,
    branchId
  )
}

function buildRoleplayTimelineNodeRecord(session: RoleplayTimelineSessionRow, labelIndex: number): StoryTimelineNodeRecord {
  const presentation = resolveRoleplaySessionTimelinePresentation({
    anchorChapterNo: session.source_chapter_no,
    title: session.title,
    subtitle: session.subtitle,
    firstUserMessage: session.first_user_message,
    sourceSelectedText: session.source_selected_text,
    sourceTextSnapshot: session.source_text_snapshot,
  })

  return {
    id: `roleplay-session:${session.id}`,
    novelId: session.novel_id,
    branchId: session.branch_id,
    nodeType: 'roleplay_session',
    labelIndex,
    anchorChapterNo: session.source_chapter_no,
    title: presentation.title,
    subtitle: presentation.subtitle,
    parentNodeId: session.source_timeline_node_id,
    sourceChapterNo: session.source_chapter_no,
    targetChapterNo: null,
    chapterId: null,
    continueBlockId: null,
    whatIfSessionId: null,
    futureJumpRunId: null,
    roleplaySessionId: session.id,
    currentText: session.latest_message ?? session.first_user_message ?? session.source_text_snapshot,
    latestText: null,
    latestRevisionNo: null,
    userInstruction: presentation.subtitle,
    selectedText: session.source_selected_text,
    originalText: session.source_text_snapshot,
    inputTokens: null,
    outputTokens: null,
    laneIndex: 0,
    colorToken: 'emerald',
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  }
}

function mergeRoleplayTimelineNodes(
  nodes: StoryTimelineNodeRecord[],
  roleplaySessions: RoleplayTimelineSessionRow[]
): StoryTimelineNodeRecord[] {
  if (!roleplaySessions.length) return nodes

  const roleplaySessionById = new Map(roleplaySessions.map((session) => [session.id, session]))
  const mergedNodes = nodes.map((node) => {
    if (node.nodeType !== 'roleplay_session' || !node.roleplaySessionId) return node

    const session = roleplaySessionById.get(node.roleplaySessionId)
    if (!session) return node

    const presentation = resolveRoleplaySessionTimelinePresentation({
      anchorChapterNo: node.anchorChapterNo,
      title: node.title,
      subtitle: node.subtitle,
      firstUserMessage: session.first_user_message,
      sourceSelectedText: session.source_selected_text,
      sourceTextSnapshot: session.source_text_snapshot,
    })

    return {
      ...node,
      parentNodeId: node.parentNodeId ?? session.source_timeline_node_id,
      sourceChapterNo: node.sourceChapterNo ?? session.source_chapter_no,
      title: presentation.title,
      subtitle: presentation.subtitle,
      userInstruction: presentation.subtitle,
      currentText: node.currentText ?? session.latest_message ?? session.first_user_message ?? session.source_text_snapshot,
      selectedText: node.selectedText ?? session.source_selected_text,
      originalText: node.originalText ?? session.source_text_snapshot,
      status: node.status || session.status,
    }
  })

  const existingRoleplaySessionIds = new Set(
    mergedNodes
      .filter((node) => node.nodeType === 'roleplay_session' && node.roleplaySessionId)
      .map((node) => node.roleplaySessionId as string)
  )

  let nextLabelIndex = mergedNodes
    .filter((node) => node.nodeType === 'roleplay_session')
    .reduce((maxIndex, node) => Math.max(maxIndex, node.labelIndex), 0)

  for (const session of roleplaySessions) {
    if (existingRoleplaySessionIds.has(session.id)) continue
    nextLabelIndex += 1
    mergedNodes.push(buildRoleplayTimelineNodeRecord(session, nextLabelIndex))
  }

  return mergedNodes
}

function loadStoryTimelineNodeLineageScope(nodeId: string, db: Db, scoped = new Map<string, StoryTimelineNodeRecord>()) {
  if (scoped.has(nodeId)) return scoped

  const row = db.queryOne<StoryTimelineNodeRow>(`${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.id = ?`, nodeId)
  if (!row) return scoped

  const node = toStoryTimelineNodeRecord(row)
  scoped.set(node.id, node)

  if (node.parentNodeId) {
    loadStoryTimelineNodeLineageScope(node.parentNodeId, db, scoped)
  }

  return scoped
}

function withReadableBranchMetadataForNode(nodeId: string, db: Db) {
  const lineageScope = loadStoryTimelineNodeLineageScope(nodeId, db)
  if (!lineageScope.size) return null
  const hydrated = withReadableBranchMetadata([...lineageScope.values()])
  return hydrated.find((node) => node.id === nodeId) ?? null
}

export function getNextStoryTimelineLabelIndex(novelId: string, branchId: string, nodeType: StoryTimelineNodeType, db: Db = defaultDb) {
  const row = db.queryOne<{ next_index: number }>(
    `SELECT COALESCE(MAX(label_index), 0) + 1 AS next_index
     FROM story_timeline_nodes
     WHERE novel_id = ? AND branch_id = ? AND node_type = ?`,
    novelId,
    branchId,
    nodeType
  )

  return row?.next_index ?? 1
}

function resolveStoryTimelineRootNodeId(nodeId: string, db: Db) {
  let currentNodeId: string | null = nodeId
  const visited = new Set<string>()

  while (currentNodeId && !visited.has(currentNodeId)) {
    visited.add(currentNodeId)
    const row: StoryTimelineNodeParentRow | null = db.queryOne(
      'SELECT id, parent_node_id FROM story_timeline_nodes WHERE id = ? LIMIT 1',
      currentNodeId
    )

    if (!row) return null
    if (!row.parent_node_id) return row.id
    currentNodeId = row.parent_node_id
  }

  return currentNodeId
}

function parseContinueReadableLabelIndex(readableLabel: string | null | undefined) {
  const normalized = readableLabel?.trim()
  if (!normalized) return null

  const match = /^CONT-(\d+)$/u.exec(normalized)
  if (!match) return null

  const parsed = Number.parseInt(match[1] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function getNextContinueReadableLabelIndex(novelId: string, branchId: string, parentNodeId: string, db: Db = defaultDb) {
  const rootNodeId = resolveStoryTimelineRootNodeId(parentNodeId, db)
  if (!rootNodeId) return 1

  const nodes = listStoryTimelineNodes(novelId, branchId, db)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const rootNodeIdByNodeId = new Map<string, string | null>()

  const getRootNodeIdForNode = (nodeId: string) => {
    if (rootNodeIdByNodeId.has(nodeId)) return rootNodeIdByNodeId.get(nodeId) ?? null

    let currentNodeId: string | null = nodeId
    const visited = new Set<string>()

    while (currentNodeId && !visited.has(currentNodeId)) {
      visited.add(currentNodeId)
      const currentNode = nodesById.get(currentNodeId)
      if (!currentNode) {
        rootNodeIdByNodeId.set(nodeId, null)
        return null
      }
      if (!currentNode.parentNodeId) {
        rootNodeIdByNodeId.set(nodeId, currentNode.id)
        return currentNode.id
      }
      currentNodeId = currentNode.parentNodeId
    }

    rootNodeIdByNodeId.set(nodeId, null)
    return null
  }

  const nextIndex = nodes
    .filter((node) => node.nodeType === 'continue_block' && getRootNodeIdForNode(node.id) === rootNodeId)
    .reduce((maxIndex, node) => {
      const scopedReadableIndex = parseContinueReadableLabelIndex(node.readableLabel)
      return Math.max(maxIndex, scopedReadableIndex ?? node.labelIndex)
    }, 0)

  return nextIndex + 1
}

export function createStoryTimelineNode(input: Omit<StoryTimelineNodeRecord, 'createdAt' | 'updatedAt'>, db: Db = defaultDb) {
  db.execute(
    `INSERT INTO story_timeline_nodes (
      id, novel_id, branch_id, node_type, label_index, anchor_chapter_no, title, subtitle,
      parent_node_id, source_chapter_no, target_chapter_no, chapter_id, continue_block_id,
      what_if_session_id, future_jump_run_id, roleplay_session_id, readable_label, readable_lineage_label, lane_index, color_token, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.novelId,
    input.branchId,
    input.nodeType,
    input.labelIndex,
    input.anchorChapterNo,
    input.title,
    input.subtitle,
    input.parentNodeId,
    input.sourceChapterNo,
    input.targetChapterNo,
    input.chapterId,
    input.continueBlockId,
    input.whatIfSessionId,
    input.futureJumpRunId,
    input.roleplaySessionId ?? null,
    input.readableLabel ?? null,
    input.readableLineageLabel ?? null,
    input.laneIndex,
    input.colorToken,
    input.status
  )

  return findStoryTimelineNodeById(input.id, db)
}

export function findStoryTimelineNodeById(id: string, db: Db = defaultDb) {
  return withReadableBranchMetadataForNode(id, db)
}

export function findStoryTimelineNodeByFutureJumpRunId(futureJumpRunId: string, db: Db = defaultDb) {
  const row = db.queryOne<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.future_jump_run_id = ? LIMIT 1`,
    futureJumpRunId
  )
  return row ? withReadableBranchMetadataForNode(row.id, db) : null
}

export function findStoryTimelineNodeByContinueBlockId(continueBlockId: string, db: Db = defaultDb) {
  const row = db.queryOne<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.continue_block_id = ? LIMIT 1`,
    continueBlockId
  )
  return row ? withReadableBranchMetadataForNode(row.id, db) : null
}

export function findStoryTimelineNodeByWhatIfSessionId(whatIfSessionId: string, db: Db = defaultDb) {
  const row = db.queryOne<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.what_if_session_id = ? LIMIT 1`,
    whatIfSessionId
  )
  return row ? withReadableBranchMetadataForNode(row.id, db) : null
}

export function findStoryTimelineNodeByRoleplaySessionId(roleplaySessionId: string, db: Db = defaultDb) {
  const row = db.queryOne<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT} WHERE story_timeline_nodes.roleplay_session_id = ? LIMIT 1`,
    roleplaySessionId
  )
  if (row) return withReadableBranchMetadataForNode(row.id, db)

  const session = db.queryOne<RoleplayTimelineSessionRow>(
    `SELECT
       roleplay_sessions.id,
       roleplay_sessions.novel_id,
       roleplay_sessions.branch_id,
       roleplay_sessions.title,
       roleplay_sessions.subtitle,
       roleplay_sessions.source_chapter_no,
       roleplay_sessions.source_timeline_node_id,
       roleplay_sessions.source_selected_text,
       roleplay_sessions.source_text_snapshot,
       roleplay_sessions.status,
       roleplay_sessions.created_at,
       roleplay_sessions.updated_at,
       (
         SELECT roleplay_messages.content
         FROM roleplay_messages
         WHERE roleplay_messages.session_id = roleplay_sessions.id AND roleplay_messages.role = 'user'
         ORDER BY roleplay_messages.message_index ASC, roleplay_messages.id ASC
         LIMIT 1
       ) AS first_user_message,
       (
         SELECT roleplay_messages.content
         FROM roleplay_messages
         WHERE roleplay_messages.session_id = roleplay_sessions.id
         ORDER BY roleplay_messages.message_index DESC, roleplay_messages.id DESC
         LIMIT 1
       ) AS latest_message
     FROM roleplay_sessions
     WHERE roleplay_sessions.id = ?
     LIMIT 1`,
    roleplaySessionId
  )

  return session ? withReadableBranchMetadata([buildRoleplayTimelineNodeRecord(session, 1)])[0] ?? null : null
}

export function listStoryTimelineNodesByFutureJumpRunIds(futureJumpRunIds: string[], db: Db = defaultDb) {
  if (!futureJumpRunIds.length) return []

  const placeholders = futureJumpRunIds.map(() => '?').join(', ')
  const rows = db.queryAll<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT}
     WHERE story_timeline_nodes.future_jump_run_id IN (${placeholders})
     ORDER BY story_timeline_nodes.anchor_chapter_no ASC, story_timeline_nodes.lane_index ASC, story_timeline_nodes.label_index ASC`,
    ...futureJumpRunIds
  )

  return withReadableBranchMetadata(rows.map(toStoryTimelineNodeRecord))
}

export function listStoryTimelineNodes(novelId: string, branchId: string, db: Db = defaultDb) {
  const rows = db.queryAll<StoryTimelineNodeRow>(
    `${STORY_TIMELINE_NODE_SELECT}
     WHERE story_timeline_nodes.novel_id = ? AND story_timeline_nodes.branch_id = ?
     ORDER BY story_timeline_nodes.anchor_chapter_no ASC, story_timeline_nodes.lane_index ASC, story_timeline_nodes.label_index ASC`,
    novelId,
    branchId
  )

  return withReadableBranchMetadata(rows.map(toStoryTimelineNodeRecord))
}

export function listStoryTimelineDescendantNodeIds(rootNodeId: string, nodes: StoryTimelineNodeRecord[]) {
  const childrenByParentId = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentNodeId) continue
    const current = childrenByParentId.get(node.parentNodeId) ?? []
    current.push(node.id)
    childrenByParentId.set(node.parentNodeId, current)
  }

  const ordered: string[] = []
  const visited = new Set<string>()

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    for (const childId of childrenByParentId.get(nodeId) ?? []) {
      visit(childId)
    }

    ordered.push(nodeId)
  }

  visit(rootNodeId)
  return ordered
}

export function deleteStoryTimelineNodesByIds(nodeIds: string[], db: Db = defaultDb) {
  for (const nodeId of nodeIds) {
    const row = db.queryOne<{ continue_block_id: string | null }>(
      'SELECT continue_block_id FROM story_timeline_nodes WHERE id = ?',
      nodeId
    )
    if (row?.continue_block_id) {
      db.execute('DELETE FROM continue_blocks WHERE id = ?', row.continue_block_id)
    }
    db.execute('DELETE FROM story_timeline_nodes WHERE id = ?', nodeId)
  }
}

export function deleteStoryTimelineNode(nodeId: string, db: Db = defaultDb): StoryTimelineNodeDeleteResult | null {
  const deletedNode = findStoryTimelineNodeById(nodeId, db)
  if (!deletedNode) return null

  const branchNodes = orderStoryTimelineNodes(listStoryTimelineNodes(deletedNode.novelId, deletedNode.branchId, db))
  const directChildren = branchNodes.filter((node) => node.parentNodeId === deletedNode.id)

  for (const [index, child] of directChildren.entries()) {
    const nextParentNodeId = deletedNode.parentNodeId
    const createdAt = buildPromotionCreatedAt(deletedNode.createdAt, index)

    db.execute(
      'UPDATE story_timeline_nodes SET parent_node_id = ?, created_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      nextParentNodeId,
      createdAt,
      child.id
    )

    if (child.continueBlockId) {
      db.execute(
        'UPDATE continue_blocks SET parent_timeline_node_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        nextParentNodeId,
        child.continueBlockId
      )
    }

    if (child.futureJumpRunId) {
      db.execute(
        'UPDATE future_jump_runs SET parent_timeline_node_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        nextParentNodeId,
        child.futureJumpRunId
      )
    }
  }

  if (deletedNode.continueBlockId) {
    db.execute('DELETE FROM continue_blocks WHERE id = ?', deletedNode.continueBlockId)
  }
  if (deletedNode.roleplaySessionId) {
    db.execute('DELETE FROM roleplay_sessions WHERE id = ?', deletedNode.roleplaySessionId)
  }

  db.execute('DELETE FROM story_timeline_nodes WHERE id = ?', nodeId)

  return {
    deletedNode,
    promotedChildIds: directChildren.map((node) => node.id),
  }
}

export function updateStoryTimelineNodePresentation(
  id: string,
  input: { title: string; subtitle: string | null; status: string },
  db: Db = defaultDb
) {
  db.execute(
    'UPDATE story_timeline_nodes SET title = ?, subtitle = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    input.title,
    input.subtitle,
    input.status,
    id
  )
  return findStoryTimelineNodeById(id, db)
}

function loadTimelineChapters(novelId: string, branchId: string, db: Db): ChapterTimelineItem[] {
  const rows = db.queryAll<KnowledgeChapterRow>(
    `SELECT chapter.id,
            chapter.chapterNo,
            chapter.title,
            chapter.rawText,
            chapter.summary,
            chapter.knowledgeStatus,
            (
              SELECT candidate.provider
              FROM chapter_extraction_candidates candidate
              WHERE candidate.branch_id = chapter.branchId
                AND candidate.chapter_id = chapter.id
                AND candidate.status = 'persisted'
              ORDER BY candidate.updated_at DESC, candidate.created_at DESC, candidate.id DESC
              LIMIT 1
            ) AS summaryProvider
     FROM KnowledgeChapter chapter
     WHERE chapter.novelId = ? AND chapter.branchId = ?
     ORDER BY chapter.chapterNo ASC, chapter.id ASC`,
    novelId,
    branchId
  )

  return rows.map((row) => ({
    type: 'chapter',
    chapterNo: row.chapterNo,
    chapterId: row.id,
    title: row.title?.trim() || `第 ${row.chapterNo} 章`,
    wordCount: countChineseFriendlyWords(row.rawText ?? ''),
    summary: row.knowledgeStatus === 'ready' && row.summaryProvider !== 'fallback'
      ? resolveChapterNavigationSummary(row.summary)
      : null,
  }))
}

function toStoryTimelineBranchNode(node: StoryTimelineNodeRecord): StoryTimelineBranchNode {
  return {
    type: 'branch_node',
    id: node.id,
    nodeType: node.nodeType,
    readableLabel: node.readableLabel ?? formatStoryBranchReadableLabel(node.nodeType, node.labelIndex),
    readableLineageLabel: node.readableLineageLabel ?? formatStoryBranchReadableLabel(node.nodeType, node.labelIndex),
    anchorChapterNo: node.anchorChapterNo,
    parentNodeId: node.parentNodeId,
    title: node.title,
    subtitle: node.subtitle,
    laneIndex: node.laneIndex,
    colorToken: node.colorToken,
    sourceChapterNo: node.sourceChapterNo,
    targetChapterNo: node.targetChapterNo,
    continueBlockId: node.continueBlockId,
    whatIfSessionId: node.whatIfSessionId,
    futureJumpRunId: node.futureJumpRunId,
    roleplaySessionId: node.roleplaySessionId ?? null,
    currentText: node.currentText ?? null,
    latestText: node.latestText ?? null,
    inputTokens: node.inputTokens ?? null,
    outputTokens: node.outputTokens ?? null,
    writingSkillCardIds: node.writingSkillCardIds,
    writingSkillExampleCount: node.writingSkillExampleCount ?? null,
    latestRevisionNo: node.latestRevisionNo ?? null,
    userInstruction: node.userInstruction ?? null,
    selectedText: node.selectedText ?? null,
    originalText: node.originalText ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    status: node.status,
  }
}

function compareStoryTimelineNodeChronology(left: StoryTimelineNodeRecord, right: StoryTimelineNodeRecord): number {
  if (left.createdAt !== right.createdAt) return left.createdAt.localeCompare(right.createdAt)
  return left.id.localeCompare(right.id)
}

function buildPromotionCreatedAt(createdAt: string, index: number) {
  const normalized = createdAt.trim().replace(' ', 'T')
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/iu.test(normalized) ? normalized : `${normalized}Z`
  const parsed = Date.parse(withZone)
  if (!Number.isFinite(parsed)) return createdAt
  return new Date(parsed + index).toISOString().replace('T', ' ').replace(/Z$/u, '')
}

function orderStoryTimelineNodes(nodes: StoryTimelineNodeRecord[]): StoryTimelineNodeRecord[] {
  return orderStoryTimelineBranchNodes(nodes, compareStoryTimelineNodeChronology)
}

function buildTimelineEdges(nodes: StoryTimelineNodeRecord[]): StoryTimelineEdge[] {
  return nodes
    .filter((node) => node.parentNodeId)
    .map((node) => ({
      fromNodeId: node.parentNodeId!,
      toNodeId: node.id,
    }))
}

export function loadStoryTimeline(novelId: string, branchId: string, db: Db = defaultDb): StoryTimelineResponse {
  const chapters = loadTimelineChapters(novelId, branchId, db)
  const authoredNodes = listStoryTimelineNodes(novelId, branchId, db)
  const roleplaySessions = loadRoleplayTimelineSessions(novelId, branchId, db)
  const nodes = orderStoryTimelineNodes(mergeRoleplayTimelineNodes(authoredNodes, roleplaySessions))

  return {
    novelId,
    branchId,
    chapters,
    branchNodes: nodes.map(toStoryTimelineBranchNode),
    edges: buildTimelineEdges(nodes),
  }
}

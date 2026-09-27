import { uid } from '@/lib/utils'
import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/database-access'
import { safeParseJson } from '@/lib/server/json-parse'
import { findStoryTimelineNodeByContinueBlockId } from '@/lib/server/story-timeline-store'
import { normalizeWritingSkillCardIds } from '@/lib/writing-skill-selection'
import type {
  ContinueBlockDetail,
  ContinueBlockRecord,
  ContinueBlockRevisionHistoryItem,
  ContinueBlockRevisionRecord,
} from '@/lib/story-branch-types'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
  withTransaction: typeof withTransaction
}

const defaultDb: Db = { execute, queryAll, queryOne, withTransaction }

type ContinueBlockRow = {
  id: string
  novel_id: string
  branch_id: string
  parent_timeline_node_id: string | null
  source_chapter_no: number
  title: string
  subtitle: string | null
  user_instruction: string
  selected_text: string
  original_text: string
  latest_text: string
  latest_input_tokens: number | null
  latest_output_tokens: number | null
  writing_skill_card_ids_json: string | null | undefined
  writing_skill_example_count: number | null | undefined
  latest_revision_no: number
  status: string
  created_at: string
  updated_at: string
}

function parseWritingSkillCardIds(value: string | null | undefined) {
  const parsed = safeParseJson(value)
  return normalizeWritingSkillCardIds({
    writingSkillCardIds: Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [],
  })
}

function normalizeWritingSkillExampleCount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : 5
}

type ContinueBlockRevisionRow = {
  id: string
  continue_block_id: string
  revision_no: number
  revision_kind: string
  user_instruction: string
  selected_text: string
  original_text: string
  generated_text: string
  input_tokens: number | null
  output_tokens: number | null
  title: string
  subtitle: string | null
  created_at: string
}

function toContinueBlockRecord(row: ContinueBlockRow): ContinueBlockRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    branchId: row.branch_id,
    parentTimelineNodeId: row.parent_timeline_node_id,
    sourceChapterNo: row.source_chapter_no,
    title: row.title,
    subtitle: row.subtitle,
    userInstruction: row.user_instruction,
    selectedText: row.selected_text,
    originalText: row.original_text,
    latestText: row.latest_text,
    inputTokens: row.latest_input_tokens,
    outputTokens: row.latest_output_tokens,
    writingSkillCardIds: parseWritingSkillCardIds(row.writing_skill_card_ids_json),
    writingSkillExampleCount: normalizeWritingSkillExampleCount(row.writing_skill_example_count),
    latestRevisionNo: row.latest_revision_no,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function findContinueBlockRecordById(id: string, db: Db = defaultDb): ContinueBlockRecord | null {
  const row = db.queryOne<ContinueBlockRow>('SELECT * FROM continue_blocks WHERE id = ?', id)
  return row ? toContinueBlockRecord(row) : null
}

function toContinueBlockRevisionRecord(row: ContinueBlockRevisionRow): ContinueBlockRevisionRecord {
  return {
    id: row.id,
    continueBlockId: row.continue_block_id,
    revisionNo: row.revision_no,
    revisionKind: row.revision_kind,
    userInstruction: row.user_instruction,
    selectedText: row.selected_text,
    originalText: row.original_text,
    generatedText: row.generated_text,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    title: row.title,
    subtitle: row.subtitle,
    createdAt: row.created_at,
  }
}

function toRevisionHistoryItem(revision: ContinueBlockRevisionRecord): ContinueBlockRevisionHistoryItem {
  return {
    revisionNo: revision.revisionNo,
    revisionKind: revision.revisionKind,
    createdAt: revision.createdAt,
  }
}

export function listContinueBlockRevisions(continueBlockId: string, db: Db = defaultDb) {
  const rows = db.queryAll<ContinueBlockRevisionRow>(
    'SELECT * FROM continue_block_revisions WHERE continue_block_id = ? ORDER BY revision_no ASC',
    continueBlockId
  )
  return rows.map(toContinueBlockRevisionRecord)
}

export function findContinueBlockById(id: string, db: Db = defaultDb): ContinueBlockDetail | null {
  const row = db.queryOne<ContinueBlockRow>('SELECT * FROM continue_blocks WHERE id = ?', id)
  if (!row) return null

  const revisions = listContinueBlockRevisions(id, db)
  const latestRevision = revisions.at(-1) ?? null
  const timelineNode = findStoryTimelineNodeByContinueBlockId(id, db)

  return {
    ...toContinueBlockRecord(row),
    timelineNodeId: timelineNode?.id ?? null,
    latestRevision,
    revisionHistory: revisions.map(toRevisionHistoryItem),
    revisions,
  }
}

export function insertContinueBlockWithInitialRevision(
  input: Omit<ContinueBlockRecord, 'createdAt' | 'updatedAt'>,
  db: Db = defaultDb
) {
  db.execute(
    `INSERT INTO continue_blocks (
      id, novel_id, branch_id, parent_timeline_node_id, source_chapter_no, title, subtitle,
      user_instruction, selected_text, original_text, latest_text, latest_input_tokens, latest_output_tokens,
      writing_skill_card_ids_json, writing_skill_example_count, latest_revision_no, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.novelId,
    input.branchId,
    input.parentTimelineNodeId,
    input.sourceChapterNo,
    input.title,
    input.subtitle,
    input.userInstruction,
    input.selectedText,
    input.originalText,
    input.latestText,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    JSON.stringify(normalizeWritingSkillCardIds({ writingSkillCardIds: input.writingSkillCardIds })),
    normalizeWritingSkillExampleCount(input.writingSkillExampleCount),
    input.latestRevisionNo,
    input.status
  )

  db.execute(
    `INSERT INTO continue_block_revisions (
      id, continue_block_id, revision_no, revision_kind, user_instruction,
      selected_text, original_text, generated_text, input_tokens, output_tokens, title, subtitle
    ) VALUES (?, ?, 1, 'initial', ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid('continue-block-revision'),
    input.id,
    input.userInstruction,
    input.selectedText,
    input.originalText,
    input.latestText,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    input.title,
    input.subtitle
  )

  return findContinueBlockRecordById(input.id, db)
}

export async function appendContinueBlockRevision(
  input: {
    continueBlockId: string
    revisionKind: string
    userInstruction: string
    selectedText: string
    originalText: string
    generatedText: string
    inputTokens?: number | null
    outputTokens?: number | null
    writingSkillCardIds: string[]
    writingSkillExampleCount: number
    title: string
    subtitle: string | null
    status?: string
  },
  db: Db = defaultDb
) {
  await db.withTransaction(async () => {
    const row = db.queryOne<{ next_revision_no: number }>(
      'SELECT COALESCE(MAX(revision_no), 0) + 1 AS next_revision_no FROM continue_block_revisions WHERE continue_block_id = ?',
      input.continueBlockId
    )
    const nextRevisionNo = row?.next_revision_no ?? 1

    db.execute(
      `INSERT INTO continue_block_revisions (
        id, continue_block_id, revision_no, revision_kind, user_instruction,
        selected_text, original_text, generated_text, input_tokens, output_tokens, title, subtitle
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      uid('continue-block-revision'),
      input.continueBlockId,
      nextRevisionNo,
      input.revisionKind,
      input.userInstruction,
      input.selectedText,
      input.originalText,
      input.generatedText,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.title,
      input.subtitle
    )

    db.execute(
      `UPDATE continue_blocks
       SET title = ?, subtitle = ?, user_instruction = ?, selected_text = ?, original_text = ?, latest_text = ?,
           latest_input_tokens = ?, latest_output_tokens = ?, writing_skill_card_ids_json = ?,
           writing_skill_example_count = ?, latest_revision_no = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      input.title,
      input.subtitle,
      input.userInstruction,
      input.selectedText,
      input.originalText,
      input.generatedText,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      JSON.stringify(normalizeWritingSkillCardIds({ writingSkillCardIds: input.writingSkillCardIds })),
      normalizeWritingSkillExampleCount(input.writingSkillExampleCount),
      nextRevisionNo,
      input.status ?? 'revised',
      input.continueBlockId
    )
  })

  return findContinueBlockRecordById(input.continueBlockId, db)
}

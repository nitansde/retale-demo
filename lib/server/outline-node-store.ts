import { execute, queryAll, queryOne } from '@/lib/server/database-access'
import type { OutlineNodeChapterRecord, OutlineNodeRecord } from '@/lib/story-branch-types'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
}

const defaultDb: Db = { execute, queryAll, queryOne }

type OutlineNodeRow = {
  id: string
  novel_id: string
  branch_id: string
  chapter_no: number | null
  title: string
  summary: string
  original_outcome: string | null
  track_key: string
  phase_label: string | null
  source_type: string
  confidence: number | null
  involved_entities_json: string
  key_events_json: string
  sort_order: number
  created_at: string
  updated_at: string
}

type OutlineNodeChapterRow = {
  id: string
  outline_node_id: string
  chapter_no: number
  chapter_id: string | null
  chapter_title: string | null
  is_primary: number
  sort_order: number
  created_at: string
  updated_at: string
}

function toOutlineNodeRecord(row: OutlineNodeRow): OutlineNodeRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    branchId: row.branch_id,
    chapterNo: row.chapter_no,
    title: row.title,
    summary: row.summary,
    originalOutcome: row.original_outcome,
    trackKey: row.track_key,
    phaseLabel: row.phase_label,
    sourceType: row.source_type,
    confidence: row.confidence,
    involvedEntities: JSON.parse(row.involved_entities_json || '[]') as string[],
    keyEvents: JSON.parse(row.key_events_json || '[]') as string[],
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toOutlineNodeChapterRecord(row: OutlineNodeChapterRow): OutlineNodeChapterRecord {
  return {
    id: row.id,
    outlineNodeId: row.outline_node_id,
    chapterNo: row.chapter_no,
    chapterId: row.chapter_id,
    chapterTitle: row.chapter_title,
    isPrimary: row.is_primary === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createOutlineNode(input: Omit<OutlineNodeRecord, 'createdAt' | 'updatedAt'>, db: Db = defaultDb) {
  db.execute(
    `INSERT INTO outline_nodes (
      id, novel_id, branch_id, chapter_no, title, summary, original_outcome,
      track_key, phase_label, source_type, confidence, involved_entities_json,
      key_events_json, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.novelId,
    input.branchId,
    input.chapterNo,
    input.title,
    input.summary,
    input.originalOutcome,
    input.trackKey,
    input.phaseLabel,
    input.sourceType,
    input.confidence,
    JSON.stringify(input.involvedEntities),
    JSON.stringify(input.keyEvents),
    input.sortOrder
  )

  return findOutlineNodeById(input.id, db)
}

export function createOutlineNodeChapter(input: Omit<OutlineNodeChapterRecord, 'createdAt' | 'updatedAt'>, db: Db = defaultDb) {
  db.execute(
    `INSERT INTO outline_node_chapters (
      id, outline_node_id, chapter_no, chapter_id, chapter_title, is_primary, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.outlineNodeId,
    input.chapterNo,
    input.chapterId,
    input.chapterTitle,
    input.isPrimary ? 1 : 0,
    input.sortOrder
  )

  return findOutlineNodeChapterById(input.id, db)
}

export function findOutlineNodeChapterById(id: string, db: Db = defaultDb) {
  const row = db.queryOne<OutlineNodeChapterRow>('SELECT * FROM outline_node_chapters WHERE id = ?', id)
  return row ? toOutlineNodeChapterRecord(row) : null
}

export function listOutlineNodeChapters(outlineNodeId: string, db: Db = defaultDb) {
  const rows = db.queryAll<OutlineNodeChapterRow>(
    'SELECT * FROM outline_node_chapters WHERE outline_node_id = ? ORDER BY sort_order ASC, chapter_no ASC',
    outlineNodeId
  )

  return rows.map(toOutlineNodeChapterRecord)
}

export function findOutlineNodeById(id: string, db: Db = defaultDb) {
  const row = db.queryOne<OutlineNodeRow>('SELECT * FROM outline_nodes WHERE id = ?', id)
  return row ? toOutlineNodeRecord(row) : null
}

export function listOutlineNodes(novelId: string, branchId: string, db: Db = defaultDb) {
  const rows = db.queryAll<OutlineNodeRow>(
    `SELECT * FROM outline_nodes
     WHERE novel_id = ? AND branch_id = ?
     ORDER BY sort_order ASC, chapter_no ASC, id ASC`,
    novelId,
    branchId
  )

  return rows.map(toOutlineNodeRecord)
}

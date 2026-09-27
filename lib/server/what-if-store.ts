import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/database-access'
import {
  deleteStoryTimelineNodesByIds,
  findStoryTimelineNodeByWhatIfSessionId,
  listStoryTimelineDescendantNodeIds,
  listStoryTimelineNodes,
  listStoryTimelineNodesByFutureJumpRunIds,
} from '@/lib/server/story-timeline-store'
import { listFutureJumpRunsByWhatIfSourceId } from '@/lib/server/future-jump-store'
import type { WhatIfDeltaRecord, WhatIfSessionDetail, WhatIfSessionRecord } from '@/lib/story-branch-types'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
  withTransaction: typeof withTransaction
}

const defaultDb: Db = { execute, queryAll, queryOne, withTransaction }

type WhatIfSessionRow = {
  id: string
  novel_id: string
  base_branch_id: string
  source_chapter_no: number
  title: string
  premise: string
  selected_text: string
  original_text: string
  generated_text: string
  input_tokens: number | null
  output_tokens: number | null
  status: string
  created_at: string
  updated_at: string
}

type WhatIfDeltaRow = {
  id: string
  session_id: string
  delta_type: string
  subject_name: string | null
  target_name: string | null
  subject_entity_id: string | null
  target_entity_id: string | null
  key: string
  old_value: string | null
  new_value: string | null
  valid_from_chapter: number | null
  description: string
  confidence: number | null
  created_at: string
}

function toWhatIfSessionRecord(row: WhatIfSessionRow): WhatIfSessionRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    baseBranchId: row.base_branch_id,
    sourceChapterNo: row.source_chapter_no,
    title: row.title,
    premise: row.premise,
    selectedText: row.selected_text,
    originalText: row.original_text,
    generatedText: row.generated_text,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toWhatIfDeltaRecord(row: WhatIfDeltaRow): WhatIfDeltaRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    deltaType: row.delta_type,
    subjectName: row.subject_name,
    targetName: row.target_name,
    subjectEntityId: row.subject_entity_id,
    targetEntityId: row.target_entity_id,
    key: row.key,
    oldValue: row.old_value,
    newValue: row.new_value,
    validFromChapter: row.valid_from_chapter,
    description: row.description,
    confidence: row.confidence,
    createdAt: row.created_at,
  }
}

export function createWhatIfSession(input: Omit<WhatIfSessionRecord, 'createdAt' | 'updatedAt'>, db: Db = defaultDb) {
  db.execute(
    `INSERT INTO what_if_sessions (
      id, novel_id, base_branch_id, source_chapter_no, title, premise,
      selected_text, original_text, generated_text, input_tokens, output_tokens, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.novelId,
    input.baseBranchId,
    input.sourceChapterNo,
    input.title,
    input.premise,
    input.selectedText,
    input.originalText,
    input.generatedText,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    input.status
  )

  return findWhatIfSessionById(input.id, db)
}

export function addWhatIfDelta(input: Omit<WhatIfDeltaRecord, 'createdAt'>, db: Db = defaultDb) {
  db.execute(
    `INSERT INTO what_if_deltas (
      id, session_id, delta_type, subject_name, target_name, subject_entity_id, target_entity_id,
      key, old_value, new_value, valid_from_chapter, description, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.sessionId,
    input.deltaType,
    input.subjectName,
    input.targetName,
    input.subjectEntityId,
    input.targetEntityId,
    input.key,
    input.oldValue,
    input.newValue,
    input.validFromChapter,
    input.description,
    input.confidence
  )

  return listWhatIfDeltas(input.sessionId, db).find((delta) => delta.id === input.id) ?? null
}

export function listWhatIfDeltas(sessionId: string, db: Db = defaultDb) {
  const rows = db.queryAll<WhatIfDeltaRow>(
    'SELECT * FROM what_if_deltas WHERE session_id = ? ORDER BY created_at ASC, id ASC',
    sessionId
  )

  return rows.map(toWhatIfDeltaRecord)
}

export function findWhatIfSessionById(id: string, db: Db = defaultDb): WhatIfSessionDetail | null {
  const row = db.queryOne<WhatIfSessionRow>('SELECT * FROM what_if_sessions WHERE id = ?', id)
  if (!row) return null

  return {
    ...toWhatIfSessionRecord(row),
    deltas: listWhatIfDeltas(id, db),
  }
}

export async function deleteWhatIfSession(sessionId: string, db: Db = defaultDb) {
  const session = findWhatIfSessionById(sessionId, db)
  if (!session) return null

  await db.withTransaction(async () => {
    const futureJumpRuns = listFutureJumpRunsByWhatIfSourceId(sessionId, db)
    const futureJumpRunIds = futureJumpRuns.map((run) => run.id)
    const sessionTimelineNode = findStoryTimelineNodeByWhatIfSessionId(sessionId, db)
    const allTimelineNodes = listStoryTimelineNodes(session.novelId, session.baseBranchId, db)
    const orderedNodeIds = new Set<string>()

    if (sessionTimelineNode) {
      for (const nodeId of listStoryTimelineDescendantNodeIds(sessionTimelineNode.id, allTimelineNodes)) {
        orderedNodeIds.add(nodeId)
      }
    }

    for (const node of listStoryTimelineNodesByFutureJumpRunIds(futureJumpRunIds, db)) {
      if (!orderedNodeIds.has(node.id)) {
        for (const nodeId of listStoryTimelineDescendantNodeIds(node.id, allTimelineNodes)) {
          orderedNodeIds.add(nodeId)
        }
      }
    }

    deleteStoryTimelineNodesByIds(Array.from(orderedNodeIds), db)
    db.execute('DELETE FROM future_jump_runs WHERE source_what_if_session_id = ?', sessionId)
    db.execute('DELETE FROM what_if_sessions WHERE id = ?', sessionId)
  })

  return session
}

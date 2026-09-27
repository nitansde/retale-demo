import type { DatabaseAccess } from '@/lib/server/database-access'
import { createControlDatabaseAccess } from '@/lib/server/database-access'
import { safeParseJson } from '@/lib/server/json-parse'
import { uid } from '@/lib/utils'
import { WRITING_SKILL_DEFAULTS } from '@/lib/writing-skill-defaults'
import {
  WRITING_SKILL_CARD_STATUSES,
  WRITING_SKILL_JOB_STATUSES,
  type DistillationJobStatus,
  type ParagraphRangeRef,
  type SampledRangeRecord,
  type SkillDistillationResult,
  type WritingSkillCard,
  type WritingSkillCardDetail,
  type WritingSkillCardSource,
  type WritingSkillCardStatus,
  type WritingSkillDistillationJob,
  type WritingSkillExample,
  type WritingSkillRule,
} from '@/lib/writing-skill-types'

export type WritingSkillStoreDb = DatabaseAccess

type CardRow = {
  id: string
  libraryId: string
  libraryVersion: string
  libraryName: string
  title: string
  userInstruction: string
  summary: string
  applicationScope: string
  rulesJson: string
  avoidJson: string
  defaultExampleCount: number
  modelConfigId: string
  status: string
  sourceJobId: string | null
  createdAt: string
  updatedAt: string
  exampleCount?: number
}

type ExampleRow = {
  id: string
  skillCardId: string
  rangeRefJson: string
  displayRef: string
  score: number
  enabled: number
  createdAt: string
}

type JobRow = {
  id: string
  libraryId: string
  libraryVersion: string | null
  userInstruction: string
  modelConfigId: string
  status: string
  message: string
  randomSeed: number
  roundCount: number
  sampledRangesJson: string
  candidateRefsJson: string
  inputTokens: number
  outputTokens: number
  requestJson: string
  resultCardId: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

type CardSourceRow = {
  sourceType: string
  sourceId: string
  sourceVersion: string
  sourceName: string
  sourceOrder: number
}

function defaultDb() {
  return createControlDatabaseAccess()
}

function parseArray<T>(value: string, fallback: T[] = []) {
  const parsed = safeParseJson(value)
  return Array.isArray(parsed) ? parsed as T[] : fallback
}

function parseRecord(value: string) {
  const parsed = safeParseJson(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

function normalizeCardStatus(value: string): WritingSkillCardStatus {
  return WRITING_SKILL_CARD_STATUSES.includes(value as WritingSkillCardStatus)
    ? value as WritingSkillCardStatus
    : 'ARCHIVED'
}

function normalizeJobStatus(value: string): DistillationJobStatus {
  return WRITING_SKILL_JOB_STATUSES.includes(value as DistillationJobStatus)
    ? value as DistillationJobStatus
    : 'FAILED'
}

function mapCard(row: CardRow): WritingSkillCard {
  return {
    id: row.id,
    libraryId: row.libraryId,
    libraryVersion: row.libraryVersion,
    libraryName: row.libraryName,
    title: row.title,
    userInstruction: row.userInstruction,
    summary: row.summary,
    applicationScope: row.applicationScope,
    rules: parseArray<WritingSkillRule>(row.rulesJson),
    avoid: parseArray<string>(row.avoidJson),
    defaultExampleCount: row.defaultExampleCount,
    modelConfigId: row.modelConfigId,
    status: normalizeCardStatus(row.status),
    sourceJobId: row.sourceJobId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(typeof row.exampleCount === 'number' ? { exampleCount: row.exampleCount } : {}),
  }
}

function mapExample(row: ExampleRow): WritingSkillExample | null {
  const rangeRef = parseRecord(row.rangeRefJson) as Partial<ParagraphRangeRef>
  if (
    !rangeRef.libraryId
    || !rangeRef.libraryVersion
    || !rangeRef.workId
    || !rangeRef.chapterId
    || !rangeRef.startParagraphId
    || !rangeRef.endParagraphId
  ) {
    return null
  }

  return {
    id: row.id,
    skillCardId: row.skillCardId,
    rangeRef: rangeRef as ParagraphRangeRef,
    displayRef: row.displayRef,
    score: row.score,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
  }
}

function mapJob(row: JobRow): WritingSkillDistillationJob {
  const candidateRefs = parseArray<string>(row.candidateRefsJson)
  return {
    id: row.id,
    libraryId: row.libraryId,
    libraryVersion: row.libraryVersion,
    userInstruction: row.userInstruction,
    modelConfigId: row.modelConfigId,
    status: normalizeJobStatus(row.status),
    message: row.message,
    randomSeed: row.randomSeed,
    roundCount: row.roundCount,
    sampledRanges: parseArray<SampledRangeRecord>(row.sampledRangesJson),
    candidateRefs,
    candidateCount: candidateRefs.length,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    errorMessage: row.errorMessage,
    resultCardId: row.resultCardId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function readWritingSkillJobRequest(jobId: string, db: WritingSkillStoreDb = defaultDb()) {
  const row = db.queryOne<{ requestJson: string }>(
    'SELECT requestJson FROM WritingSkillDistillationJob WHERE id = ?',
    jobId,
  )
  return row ? parseRecord(row.requestJson) : null
}

export function createWritingSkillJob(input: {
  libraryId: string
  instruction: string
  modelConfigId: string
  randomSeed: number
  request?: Record<string, unknown>
}, db: WritingSkillStoreDb = defaultDb()) {
  const id = uid('writing-skill-job')
  db.execute(
    `INSERT INTO WritingSkillDistillationJob (
       id, libraryId, userInstruction, modelConfigId, status, message, randomSeed, requestJson
     ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
    id,
    input.libraryId,
    input.instruction,
    input.modelConfigId,
    '等待开始',
    input.randomSeed,
    JSON.stringify(input.request ?? {}),
  )
  return readWritingSkillJob(id, db)!
}

export function readWritingSkillJob(jobId: string, db: WritingSkillStoreDb = defaultDb()) {
  const row = db.queryOne<JobRow>(
    `SELECT id, libraryId, libraryVersion, userInstruction, modelConfigId, status, message,
            randomSeed, roundCount, sampledRangesJson, candidateRefsJson, inputTokens,
            outputTokens, requestJson, resultCardId, errorMessage, createdAt, updatedAt
     FROM WritingSkillDistillationJob WHERE id = ?`,
    jobId,
  )
  return row ? mapJob(row) : null
}

export function updateWritingSkillJob(jobId: string, updates: Partial<{
  libraryVersion: string | null
  status: DistillationJobStatus
  message: string
  roundCount: number
  sampledRanges: SampledRangeRecord[]
  candidateRefs: string[]
  inputTokens: number
  outputTokens: number
  resultCardId: string | null
  errorMessage: string | null
}>, db: WritingSkillStoreDb = defaultDb()) {
  const fields: string[] = []
  const values: Array<string | number | null> = []
  const add = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`)
    values.push(value)
  }

  if ('libraryVersion' in updates) add('libraryVersion', updates.libraryVersion ?? null)
  if (updates.status) add('status', updates.status)
  if (updates.message !== undefined) add('message', updates.message)
  if (updates.roundCount !== undefined) add('roundCount', updates.roundCount)
  if (updates.sampledRanges) add('sampledRangesJson', JSON.stringify(updates.sampledRanges))
  if (updates.candidateRefs) add('candidateRefsJson', JSON.stringify(updates.candidateRefs))
  if (updates.inputTokens !== undefined) add('inputTokens', updates.inputTokens)
  if (updates.outputTokens !== undefined) add('outputTokens', updates.outputTokens)
  if ('resultCardId' in updates) add('resultCardId', updates.resultCardId ?? null)
  if ('errorMessage' in updates) add('errorMessage', updates.errorMessage ?? null)
  if (!fields.length) return readWritingSkillJob(jobId, db)

  db.execute(
    `UPDATE WritingSkillDistillationJob
     SET ${fields.join(', ')}, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?`,
    ...values,
    jobId,
  )
  return readWritingSkillJob(jobId, db)
}

export function listWritingSkillCards(filters: {
  libraryId?: string
  status?: WritingSkillCardStatus
} = {}, db: WritingSkillStoreDb = defaultDb()) {
  const conditions: string[] = []
  const values: string[] = []
  if (filters.libraryId) {
    conditions.push(`(
      card.libraryId = ?
      OR EXISTS (
        SELECT 1
        FROM WritingSkillCardSource source
        WHERE source.skillCardId = card.id
          AND source.sourceType = 'LIBRARY'
          AND source.sourceId = ?
      )
    )`)
    values.push(filters.libraryId, filters.libraryId)
  }
  if (filters.status) {
    conditions.push('card.status = ?')
    values.push(filters.status)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return db.queryAll<CardRow>(
    `SELECT card.id, card.libraryId, card.libraryVersion, card.libraryName, card.title,
            card.userInstruction, card.summary, card.applicationScope, card.rulesJson,
            card.avoidJson, card.defaultExampleCount, card.modelConfigId, card.status,
            card.sourceJobId, card.createdAt, card.updatedAt,
            COUNT(example.id) AS exampleCount
     FROM WritingSkillCard card
     LEFT JOIN WritingSkillExample example ON example.skillCardId = card.id
     ${where}
     GROUP BY card.id
     ORDER BY card.updatedAt DESC, card.createdAt DESC`,
    ...values,
  ).map(mapCard)
}

export function readWritingSkillCard(cardId: string, db: WritingSkillStoreDb = defaultDb()) {
  const row = db.queryOne<CardRow>(
    `SELECT card.id, card.libraryId, card.libraryVersion, card.libraryName, card.title,
            card.userInstruction, card.summary, card.applicationScope, card.rulesJson,
            card.avoidJson, card.defaultExampleCount, card.modelConfigId, card.status,
            card.sourceJobId, card.createdAt, card.updatedAt,
            (SELECT COUNT(*) FROM WritingSkillExample example WHERE example.skillCardId = card.id) AS exampleCount
     FROM WritingSkillCard card WHERE card.id = ?`,
    cardId,
  )
  return row ? mapCard(row) : null
}

export function listWritingSkillExamples(cardId: string, db: WritingSkillStoreDb = defaultDb()) {
  return db.queryAll<ExampleRow>(
    `SELECT id, skillCardId, rangeRefJson, displayRef, score, enabled, createdAt
     FROM WritingSkillExample WHERE skillCardId = ?
     ORDER BY score DESC, createdAt ASC`,
    cardId,
  ).map(mapExample).filter((example): example is WritingSkillExample => example !== null)
}

export function listWritingSkillCardSources(cardId: string, db: WritingSkillStoreDb = defaultDb()) {
  const rows = db.queryAll<CardSourceRow>(
    `SELECT sourceType, sourceId, sourceVersion, sourceName, sourceOrder
     FROM WritingSkillCardSource
     WHERE skillCardId = ?
     ORDER BY sourceOrder ASC, sourceType ASC, sourceId ASC`,
    cardId,
  )
  const sources = rows.flatMap((row) => (
    row.sourceType === 'LIBRARY' || row.sourceType === 'UPLOAD'
      ? [{
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          sourceVersion: row.sourceVersion,
          sourceName: row.sourceName,
          sourceOrder: row.sourceOrder,
        } satisfies WritingSkillCardSource]
      : []
  ))
  if (sources.length) return sources
  const legacy = readWritingSkillCard(cardId, db)
  return legacy ? [{
    sourceType: 'LIBRARY' as const,
    sourceId: legacy.libraryId,
    sourceVersion: legacy.libraryVersion,
    sourceName: legacy.libraryName,
    sourceOrder: 0,
  }] : []
}

export function readWritingSkillCardDetail(cardId: string, db: WritingSkillStoreDb = defaultDb()): WritingSkillCardDetail | null {
  const card = readWritingSkillCard(cardId, db)
  return card ? {
    ...card,
    sources: listWritingSkillCardSources(cardId, db),
    examples: listWritingSkillExamples(cardId, db),
  } : null
}

export async function saveWritingSkillCard(input: {
  libraryId: string
  libraryVersion: string
  libraryName: string
  userInstruction: string
  modelConfigId: string
  sourceJobId: string
  result: SkillDistillationResult
  sources?: WritingSkillCardSource[]
  examples: Array<{
    rangeRef: ParagraphRangeRef
    displayRef: string
    score: number
  }>
  replaceCardId?: string | null
}, db: WritingSkillStoreDb = defaultDb()) {
  const cardId = input.replaceCardId?.trim() || uid('writing-skill')
  await db.withTransaction(() => {
    const existing = input.replaceCardId ? readWritingSkillCard(input.replaceCardId, db) : null
    if (input.replaceCardId && !existing) {
      throw new Error('Writing skill card not found')
    }

    if (existing) {
      db.execute(
        `UPDATE WritingSkillCard
         SET libraryId = ?, libraryVersion = ?, libraryName = ?, title = ?, userInstruction = ?,
             summary = ?, applicationScope = ?, rulesJson = ?, avoidJson = ?, modelConfigId = ?,
             status = 'ACTIVE', sourceJobId = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE id = ?`,
        input.libraryId,
        input.libraryVersion,
        input.libraryName,
        input.result.title,
        input.userInstruction,
        input.result.summary,
        input.result.applicationScope,
        JSON.stringify(input.result.rules),
        JSON.stringify(input.result.avoid),
        input.modelConfigId,
        input.sourceJobId,
        cardId,
      )
      db.execute('DELETE FROM WritingSkillExample WHERE skillCardId = ?', cardId)
      db.execute('DELETE FROM WritingSkillCardSource WHERE skillCardId = ?', cardId)
    } else {
      db.execute(
        `INSERT INTO WritingSkillCard (
           id, libraryId, libraryVersion, libraryName, title, userInstruction, summary,
           applicationScope, rulesJson, avoidJson, defaultExampleCount, modelConfigId,
           status, sourceJobId
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        cardId,
        input.libraryId,
        input.libraryVersion,
        input.libraryName,
        input.result.title,
        input.userInstruction,
        input.result.summary,
        input.result.applicationScope,
        JSON.stringify(input.result.rules),
        JSON.stringify(input.result.avoid),
        WRITING_SKILL_DEFAULTS.defaultRuntimeExampleCount,
        input.modelConfigId,
        input.sourceJobId,
      )
    }

    const sources = input.sources?.length ? input.sources : [{
      sourceType: 'LIBRARY' as const,
      sourceId: input.libraryId,
      sourceVersion: input.libraryVersion,
      sourceName: input.libraryName,
      sourceOrder: 0,
    }]
    for (const source of sources) {
      db.execute(
        `INSERT INTO WritingSkillCardSource (
           skillCardId, sourceType, sourceId, sourceVersion, sourceName, sourceOrder
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        cardId,
        source.sourceType,
        source.sourceId,
        source.sourceVersion,
        source.sourceName,
        source.sourceOrder,
      )
    }

    for (const example of input.examples) {
      db.execute(
        `INSERT INTO WritingSkillExample (
           id, skillCardId, rangeRefJson, displayRef, score, enabled
         ) VALUES (?, ?, ?, ?, ?, 1)`,
        uid('writing-skill-example'),
        cardId,
        JSON.stringify(example.rangeRef),
        example.displayRef,
        example.score,
      )
    }
  })

  return readWritingSkillCardDetail(cardId, db)!
}

export async function updateWritingSkillCard(cardId: string, updates: {
  title?: string
  defaultExampleCount?: number
  status?: WritingSkillCardStatus
  examples?: Array<{ id: string; enabled: boolean }>
}, db: WritingSkillStoreDb = defaultDb()) {
  await db.withTransaction(() => {
    const card = readWritingSkillCard(cardId, db)
    if (!card) throw new Error('Writing skill card not found')

    const fields: string[] = []
    const values: Array<string | number> = []
    if (updates.title !== undefined) {
      const title = updates.title.trim()
      if (!title || title.length > 120) throw new Error('Title must be between 1 and 120 characters')
      fields.push('title = ?')
      values.push(title)
    }
    if (updates.defaultExampleCount !== undefined) {
      const count = Math.floor(updates.defaultExampleCount)
      if (count < 1 || count > WRITING_SKILL_DEFAULTS.maxRuntimeExampleCount) {
        throw new Error(`Example count must be between 1 and ${WRITING_SKILL_DEFAULTS.maxRuntimeExampleCount}`)
      }
      fields.push('defaultExampleCount = ?')
      values.push(count)
    }
    if (updates.status !== undefined) {
      if (!WRITING_SKILL_CARD_STATUSES.includes(updates.status)) throw new Error('Invalid writing skill status')
      fields.push('status = ?')
      values.push(updates.status)
    }
    if (fields.length) {
      db.execute(
        `UPDATE WritingSkillCard SET ${fields.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        ...values,
        cardId,
      )
    }

    for (const example of updates.examples ?? []) {
      db.execute(
        `UPDATE WritingSkillExample SET enabled = ? WHERE id = ? AND skillCardId = ?`,
        example.enabled ? 1 : 0,
        example.id,
        cardId,
      )
    }
  })
  return readWritingSkillCardDetail(cardId, db)!
}

export function deleteWritingSkillCard(cardId: string, db: WritingSkillStoreDb = defaultDb()) {
  return db.execute('DELETE FROM WritingSkillCard WHERE id = ?', cardId).changes > 0
}

export function markWritingSkillCardsStaleForLibraryVersion(
  libraryId: string,
  currentVersion: string | null,
  db: WritingSkillStoreDb = defaultDb(),
) {
  const result = currentVersion
    ? db.execute(
        `UPDATE WritingSkillCard
         SET status = 'STALE', updatedAt = CURRENT_TIMESTAMP
         WHERE libraryId = ? AND status = 'ACTIVE' AND libraryVersion != ?`,
        libraryId,
        currentVersion,
      )
    : db.execute(
        `UPDATE WritingSkillCard
         SET status = 'STALE', updatedAt = CURRENT_TIMESTAMP
         WHERE libraryId = ? AND status = 'ACTIVE'`,
        libraryId,
      )
  return result.changes
}

export function markWritingSkillCardStale(
  cardId: string,
  db: WritingSkillStoreDb = defaultDb(),
) {
  return db.execute(
    `UPDATE WritingSkillCard
     SET status = 'STALE', updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'ACTIVE'`,
    cardId,
  ).changes
}

export function cancelWritingSkillJob(jobId: string, db: WritingSkillStoreDb = defaultDb()) {
  db.execute(
    `UPDATE WritingSkillDistillationJob
     SET status = 'CANCELLED', message = '已取消', errorMessage = NULL, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND status NOT IN ('COMPLETED', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'CANCELLED')`,
    jobId,
  )
  return readWritingSkillJob(jobId, db)
}

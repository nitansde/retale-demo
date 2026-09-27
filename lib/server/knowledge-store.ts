import { createHash } from 'node:crypto'
import {
  execute,
  queryAll,
  queryOne,
  type DatabaseAccess,
  type SqlParam,
  withTransaction,
} from '@/lib/server/database-access'
import { estimateTokenCount, uid } from '@/lib/utils'

export const MAIN_BRANCH_NAME = 'main'

type KnowledgeStoreDb = Pick<DatabaseAccess, 'execute' | 'queryAll' | 'queryOne' | 'withTransaction'>

const defaultDb: KnowledgeStoreDb = { execute, queryAll, queryOne, withTransaction }

export function getMainBranchId(novelId: string) {
  return `${novelId}:main`
}

export function normalizeBranchId(novelId: string, branchId?: string | null) {
  const normalized = branchId?.trim()
  if (!normalized) {
    return getMainBranchId(novelId)
  }

  return normalized.includes(':') ? normalized : `${novelId}:${normalized}`
}

export type LineRecordInput = {
  lineNo: number
  text: string
  charStart: number | null
  charEnd: number | null
}

export type TextSpanInput = {
  id: string
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  lineStart: number
  lineEnd: number
  charStart?: number | null
  charEnd?: number | null
  text: string
  spanType: string
  tokenEstimate?: number | null
}

export type KnowledgeChapterDerivedArtifactSource = {
  id: string
  novelId: string
  branchId: string
  chapterNo: number
  rawText: string
}

export type KnowledgeChapterDerivedArtifactRepairResult = {
  repairedChapterNos: number[]
}

export function hashContent(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function splitChapterLines(text: string): LineRecordInput[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const rawLines = normalized.split('\n')
  const lines: LineRecordInput[] = []
  let cursor = 0

  rawLines.forEach((raw, index) => {
    const start = cursor
    const end = cursor + raw.length
    lines.push({
      lineNo: index + 1,
      text: raw,
      charStart: start,
      charEnd: end,
    })
    cursor = end + 1
  })

  return lines
}

export function buildTextSpansFromLines(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  text: string
  lines: LineRecordInput[]
}): TextSpanInput[] {
  const { novelId, branchId, chapterId, chapterNo, text, lines } = params
  const spans: TextSpanInput[] = []
  const paragraphBuffer: Array<{ line: LineRecordInput; offsetStart: number; offsetEnd: number }> = []

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return
    const first = paragraphBuffer[0]
    const last = paragraphBuffer[paragraphBuffer.length - 1]
    const paragraphText = paragraphBuffer.map((item) => item.line.text).join('\n').trim()
    if (!paragraphText) {
      paragraphBuffer.length = 0
      return
    }

    spans.push({
      id: uid('span-paragraph'),
      novelId,
      branchId,
      chapterId,
      chapterNo,
      lineStart: first.line.lineNo,
      lineEnd: last.line.lineNo,
      charStart: first.offsetStart,
      charEnd: last.offsetEnd,
      text: paragraphText,
      spanType: 'paragraph',
      tokenEstimate: estimateTokenCount(paragraphText),
    })

    paragraphBuffer.length = 0
  }

  let runningOffset = 0
  for (const line of lines) {
    const clean = line.text.trim()
    const start = runningOffset
    const end = runningOffset + line.text.length

    if (clean) {
      paragraphBuffer.push({ line, offsetStart: start, offsetEnd: end })

      spans.push({
        id: uid('span-evidence'),
        novelId,
        branchId,
        chapterId,
        chapterNo,
        lineStart: line.lineNo,
        lineEnd: line.lineNo,
        charStart: start,
        charEnd: end,
        text: clean,
        spanType: 'evidence',
        tokenEstimate: estimateTokenCount(clean),
      })
    } else {
      flushParagraph()
    }

    runningOffset = end + 1
  }
  flushParagraph()

  const paragraphSpans = spans.filter((item) => item.spanType === 'paragraph')
  for (let index = 0; index < paragraphSpans.length; index += 2) {
    const sceneParts = paragraphSpans.slice(index, index + 2)
    if (!sceneParts.length) continue
    spans.push({
      id: uid('span-scene'),
      novelId,
      branchId,
      chapterId,
      chapterNo,
      lineStart: sceneParts[0].lineStart,
      lineEnd: sceneParts[sceneParts.length - 1].lineEnd,
      charStart: sceneParts[0].charStart ?? null,
      charEnd: sceneParts[sceneParts.length - 1].charEnd ?? null,
      text: sceneParts.map((item) => item.text).join('\n\n'),
      spanType: 'scene',
      tokenEstimate: estimateTokenCount(sceneParts.map((item) => item.text).join('\n\n')),
    })
  }

  const summaryText = text.trim().split(/\n+/).slice(0, 8).join('\n').trim()
  if (summaryText) {
    spans.push({
      id: uid('span-summary'),
      novelId,
      branchId,
      chapterId,
      chapterNo,
      lineStart: lines[0]?.lineNo ?? 1,
      lineEnd: lines[Math.max(0, lines.length - 1)]?.lineNo ?? 1,
      charStart: 0,
      charEnd: text.length,
      text: summaryText,
      spanType: 'summary',
      tokenEstimate: estimateTokenCount(summaryText),
    })
  }

  return spans
}

function buildDerivedArtifacts(chapter: KnowledgeChapterDerivedArtifactSource) {
  const lines = splitChapterLines(chapter.rawText)
  const spans = buildTextSpansFromLines({
    novelId: chapter.novelId,
    branchId: chapter.branchId,
    chapterId: chapter.id,
    chapterNo: chapter.chapterNo,
    text: chapter.rawText,
    lines,
  })

  return { lines, spans }
}

function insertChapterLines(chapterId: string, lines: ReturnType<typeof splitChapterLines>, db: KnowledgeStoreDb = defaultDb) {
  for (const line of lines) {
    db.execute(
      'INSERT INTO ChapterLine (id, chapterId, lineNo, text, charStart, charEnd) VALUES (?, ?, ?, ?, ?, ?)',
      uid('line'),
      chapterId,
      line.lineNo,
      line.text,
      line.charStart,
      line.charEnd
    )
  }
}

function insertTextSpans(spans: ReturnType<typeof buildTextSpansFromLines>, db: KnowledgeStoreDb = defaultDb) {
  for (const span of spans) {
    db.execute(
      `
        INSERT INTO TextSpan (
          id, novelId, branchId, chapterId, chapterNo, lineStart, lineEnd, charStart, charEnd, text, spanType, tokenEstimate
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      span.id,
      span.novelId,
      span.branchId,
      span.chapterId,
      span.chapterNo,
      span.lineStart,
      span.lineEnd,
      span.charStart ?? null,
      span.charEnd ?? null,
      span.text,
      span.spanType,
      span.tokenEstimate ?? null
    )
  }
}

function getDerivedArtifactCounts(chapterId: string, db: KnowledgeStoreDb = defaultDb) {
  return db.queryOne<{ lineCount: number; spanCount: number }>(
    `
      SELECT
        (SELECT COUNT(*) FROM ChapterLine WHERE chapterId = ?) AS lineCount,
        (SELECT COUNT(*) FROM TextSpan WHERE chapterId = ?) AS spanCount
    `,
    chapterId,
    chapterId
  ) ?? { lineCount: 0, spanCount: 0 }
}

function chapterHasMissingDerivedArtifacts(chapter: KnowledgeChapterDerivedArtifactSource, db: KnowledgeStoreDb = defaultDb) {
  const expected = buildDerivedArtifacts(chapter)
  const counts = getDerivedArtifactCounts(chapter.id, db)
  return counts.lineCount <= 0 || (expected.spans.length > 0 && counts.spanCount <= 0)
}

export function replaceKnowledgeChapterDerivedArtifacts(chapter: KnowledgeChapterDerivedArtifactSource, db: KnowledgeStoreDb = defaultDb) {
  const artifacts = buildDerivedArtifacts(chapter)

  db.execute('DELETE FROM TextSpan WHERE chapterId = ?', chapter.id)
  db.execute('DELETE FROM ChapterLine WHERE chapterId = ?', chapter.id)
  insertChapterLines(chapter.id, artifacts.lines, db)
  insertTextSpans(artifacts.spans, db)

  return {
    lineCount: artifacts.lines.length,
    spanCount: artifacts.spans.length,
  }
}

export function ensureKnowledgeChapterDerivedArtifacts(chapter: KnowledgeChapterDerivedArtifactSource, db: KnowledgeStoreDb = defaultDb) {
  const artifacts = buildDerivedArtifacts(chapter)
  const counts = getDerivedArtifactCounts(chapter.id, db)
  let repaired = false

  if (counts.lineCount <= 0) {
    db.execute('DELETE FROM ChapterLine WHERE chapterId = ?', chapter.id)
    insertChapterLines(chapter.id, artifacts.lines, db)
    repaired = true
  }

  if (artifacts.spans.length > 0 && counts.spanCount <= 0) {
    db.execute('DELETE FROM TextSpan WHERE chapterId = ?', chapter.id)
    insertTextSpans(artifacts.spans, db)
    repaired = true
  }

  return {
    repaired,
    lineCount: counts.lineCount <= 0 ? artifacts.lines.length : counts.lineCount,
    spanCount: artifacts.spans.length > 0 && counts.spanCount <= 0 ? artifacts.spans.length : counts.spanCount,
  }
}

export async function healMissingKnowledgeChapterDerivedArtifacts(params: {
  novelId: string
  branchId: string
  chapterRange?: { startChapter?: number; endChapter?: number }
  db?: KnowledgeStoreDb
}): Promise<KnowledgeChapterDerivedArtifactRepairResult> {
  const db = params.db ?? defaultDb
  const queryParams: SqlParam[] = [params.novelId, params.branchId]
  const rangeFilters: string[] = []
  if (typeof params.chapterRange?.startChapter === 'number') {
    rangeFilters.push('chapterNo >= ?')
    queryParams.push(Math.max(1, Math.floor(params.chapterRange.startChapter)))
  }
  if (typeof params.chapterRange?.endChapter === 'number') {
    rangeFilters.push('chapterNo <= ?')
    queryParams.push(Math.max(1, Math.floor(params.chapterRange.endChapter)))
  }

  const chapters = db.queryAll<KnowledgeChapterDerivedArtifactSource>(
    `
      SELECT id, novelId, branchId, chapterNo, rawText
      FROM KnowledgeChapter
      WHERE novelId = ? AND branchId = ?
      ${rangeFilters.length ? `AND ${rangeFilters.join(' AND ')}` : ''}
      ORDER BY chapterNo ASC
    `,
    ...queryParams
  )
  const chaptersToRepair = chapters.filter((chapter) => chapterHasMissingDerivedArtifacts(chapter, db))
  if (!chaptersToRepair.length) {
    return { repairedChapterNos: [] }
  }

  await db.withTransaction(() => {
    for (const chapter of chaptersToRepair) {
      ensureKnowledgeChapterDerivedArtifacts(chapter, db)
    }
  })

  return {
    repairedChapterNos: chaptersToRepair.map((chapter) => chapter.chapterNo),
  }
}

export function findStoryBranch(id: string, db: KnowledgeStoreDb = defaultDb) {
  return db.queryOne<{ id: string; novelId: string; name: string }>(
    'SELECT id, novelId, name FROM StoryBranch WHERE id = ?',
    id
  )
}

export async function enqueueKnowledgeJob(params: {
  novelId: string
  branchId?: string | null
  jobType: string
  payload?: unknown
  currentStep?: string
  db?: KnowledgeStoreDb
}) {
  const db = params.db ?? defaultDb
  const id = uid('job')
  db.execute(
    `
      INSERT INTO KnowledgeJob (id, novelId, branchId, jobType, status, currentStep, payloadJson)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)
    `,
    id,
    params.novelId,
    params.branchId ?? null,
    params.jobType,
    params.currentStep ?? null,
    params.payload ? JSON.stringify(params.payload) : null
  )

  return db.queryOne<{ id: string; novelId: string; branchId: string | null; jobType: string }>(
    'SELECT id, novelId, branchId, jobType FROM KnowledgeJob WHERE id = ?',
    id
  )
}

export async function markKnowledgeStaleFromChapter(params: {
  novelId: string
  branchId: string
  fromChapterNo: number
  db?: KnowledgeStoreDb
}) {
  const db = params.db ?? defaultDb
  await db.withTransaction(async () => {
    db.execute(
      `
        UPDATE KnowledgeChapter
        SET isDirty = 1,
            knowledgeStatus = 'stale',
            dirtyReason = ?,
            updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ? AND chapterNo >= ?
      `,
      `Chapter ${params.fromChapterNo} changed`,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    // Match rebuild cleanup by source chapter. An open validity interval does
    // not make knowledge from an unchanged earlier chapter stale.
    db.execute(
      `
        UPDATE KnowledgeFact
        SET status = 'outdated', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND sourceChapter >= ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    db.execute(
      `
        UPDATE KnowledgeRelation
        SET status = 'outdated', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND sourceChapter >= ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    db.execute(
      `
        UPDATE EntityLink
        SET status = 'potentially_stale', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND sourceChapter >= ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    db.execute(
      `
        UPDATE EntityState
        SET status = 'potentially_stale', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND sourceChapter >= ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    db.execute(
      `
        UPDATE KnowledgeEvent
        SET status = 'outdated', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ? AND chapterNo >= ? AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

    db.execute(
      `
        UPDATE EventLink
        SET status = 'potentially_stale', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND (validFromChapter >= ? OR sourceChapter >= ?)
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo,
      params.fromChapterNo
    )

    db.execute(
      `
        UPDATE KnowledgeWorld
        SET status = 'outdated', updatedAt = CURRENT_TIMESTAMP
        WHERE novelId = ? AND branchId = ?
          AND validFromChapter >= ?
          AND status != 'user_confirmed'
      `,
      params.novelId,
      params.branchId,
      params.fromChapterNo
    )

  })

  const { deleteBranchRetrievalIndexFromChapter } = await import('@/lib/server/retrieval-index')
  await deleteBranchRetrievalIndexFromChapter(params.novelId, params.branchId, params.fromChapterNo)

}

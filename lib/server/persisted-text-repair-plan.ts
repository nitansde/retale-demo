import { countChineseFriendlyWords, htmlToPlainText } from '@/lib/utils'
import type { DatabaseAccess } from '@/lib/server/database-access'

type ReadDb = Pick<DatabaseAccess, 'queryAll' | 'queryOne'>
type ChapterRow = {
  id: string
  title: string
  parentChapterId: string | null
  contentHtml: string
  wordCount: number
  knowledgeId: string | null
  knowledgeTitle: string | null
  rawText: string | null
  chapterNo: number | null
}

/** Kept only to identify data produced by the pre-fix decoder, never for new text. */
function legacyPlainText(html: string) {
  return html.replace(/<\/p>/g, '\n\n').replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim()
}

export function planPersistedTextRepair(db: ReadDb, novelId: string) {
  const workspaceStateId = 'singleton'
  const runtime = db.queryOne<{ revision: number }>('SELECT revision FROM WorkspaceRuntimeState WHERE id = ?', workspaceStateId)
  if (!runtime) throw new Error('No authoritative workspace runtime snapshot; recover the workspace first')
  const novels = db.queryAll<{ id: string }>('SELECT id FROM WorkspaceRuntimeNovel WHERE workspaceStateId = ?', workspaceStateId)
  if (novels.length !== 1 || novels[0].id !== novelId) throw new Error('The workspace must contain only the requested novel')
  const blockers: string[] = []
  const journal = db.queryOne<{ revision: number | null }>('SELECT MAX(committedRevision) AS revision FROM WorkspaceChapterPatchJournal WHERE workspaceStateId = ?', workspaceStateId)
  if ((journal?.revision ?? 0) > runtime.revision) blockers.push('Recover newer chapter patches before repairing text')
  const sync = db.queryOne<{ startedRevision: number | null }>('SELECT startedRevision FROM WorkspaceKnowledgeSyncState WHERE workspaceStateId = ?', workspaceStateId)
  if (sync?.startedRevision != null) blockers.push('A workspace sync is claimed; finish or recover it before repairing text')
  const jobs = db.queryAll<{ id: string }>("SELECT id FROM KnowledgeJob WHERE novelId = ? AND status IN ('queued', 'running', 'paused')", novelId)
  for (const job of jobs) blockers.push(`Finish or abort active/resumable job ${job.id} before repairing text`)
  const chapters = db.queryAll<ChapterRow>(`
    SELECT chapter.id, chapter.title, chapter.parentChapterId, chapter.contentHtml, chapter.wordCount,
      knowledge.id AS knowledgeId, knowledge.title AS knowledgeTitle, knowledge.rawText, knowledge.chapterNo
    FROM WorkspaceRuntimeChapter chapter
    LEFT JOIN KnowledgeChapter knowledge ON knowledge.id = chapter.id
      AND knowledge.novelId = chapter.novelId AND knowledge.branchId = chapter.novelId || ':main'
    WHERE chapter.workspaceStateId = ? AND chapter.novelId = ?
    ORDER BY chapter.sortOrder, chapter.id
  `, workspaceStateId, novelId)
  if (db.queryOne<{ id: string }>('SELECT id FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ? AND novelId != ? LIMIT 1', workspaceStateId, novelId)) {
    blockers.push('The workspace contains chapters from another novel')
  }
  const extraKnowledge = db.queryAll<{ id: string }>(`
    SELECT id FROM KnowledgeChapter WHERE novelId = ? AND branchId = ? AND id NOT IN (
      SELECT id FROM WorkspaceRuntimeChapter WHERE workspaceStateId = ? AND novelId = ? AND parentChapterId IS NULL
    )
  `, novelId, `${novelId}:main`, workspaceStateId, novelId)
  for (const row of extraKnowledge) blockers.push(`Sync removed chapter ${row.id} before repairing text`)
  const repairs: Array<{
    chapterId: string; chapterNo: number | null; repairRawText: boolean; repairWordCount: boolean
    storedWordCount: number; derivedWordCount: number
  }> = []
  const skippedCounts: Array<{ chapterId: string; storedWordCount: number; derivedWordCount: number }> = []
  let chapterNo = 0
  for (const chapter of chapters) {
    const derived = htmlToPlainText(chapter.contentHtml)
    const legacy = legacyPlainText(chapter.contentHtml)
    const entityDifference = derived !== legacy
    const derivedWordCount = countChineseFriendlyWords(derived)
    let repairRawText = false
    if (!chapter.parentChapterId) {
      chapterNo += 1
      if (chapter.knowledgeId === null || chapter.chapterNo !== chapterNo || chapter.knowledgeTitle !== chapter.title) {
        blockers.push(`Sync chapter metadata/order for ${chapter.id} before repairing text`)
      } else if (chapter.rawText !== derived) {
        repairRawText = entityDifference && chapter.rawText === legacy
        if (!repairRawText) blockers.push(`Chapter ${chapter.id} has a text difference unrelated to entity decoding; sync it first`)
      }
    }
    // A confirmed raw-text repair also refreshes its dependent count. Otherwise
    // change a count only when the old decoder explains it exactly.
    const repairWordCount = chapter.wordCount !== derivedWordCount && (repairRawText
      || (entityDifference && chapter.wordCount === countChineseFriendlyWords(legacy)))
    if (chapter.wordCount !== derivedWordCount && !repairWordCount) {
      skippedCounts.push({ chapterId: chapter.id, storedWordCount: chapter.wordCount, derivedWordCount })
    }
    if (repairRawText || repairWordCount) {
      repairs.push({ chapterId: chapter.id, chapterNo: chapter.chapterNo, repairRawText, repairWordCount, storedWordCount: chapter.wordCount, derivedWordCount })
    }
  }
  return { novelId, workspaceStateId, workspaceRevision: runtime.revision, chapterCount: chapters.length, repairs, skippedCounts, blockers }
}

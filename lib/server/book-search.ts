import { BOOK_SEARCH_RESULT_LIMIT, type BookSearchMatch, type BookSearchMode, type BookSearchResult } from '@/lib/book-search'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { ResourceNotFoundError } from '@/lib/server/domain-errors'
import { getMainBranchId } from '@/lib/server/knowledge-store'
import { hasLanceBookTextEmbeddings, searchLanceBookText } from '@/lib/server/retrieval-index'
import { loadWorkspacePayloadFromRuntimeOrRecovery } from '@/lib/server/workspace-resilience'
import { htmlToPlainText } from '@/lib/utils'

type SearchChapter = { id: string; title: string; sortOrder: number; contentHtml: string; parentChapterId: string | null }

function normalizeText(text: string) {
  return text.replace(/\s+/gu, ' ').trim()
}

function excerpt(text: string, query: string) {
  const position = text.toLowerCase().indexOf(query.toLowerCase())
  const start = Math.max(0, position - 70)
  return text.slice(start, start + 320)
}

function getSearchDatabase(novelId: string) {
  const db = createNovelDatabaseAccess(novelId)
  if (!db.queryOne('SELECT id FROM NovelRecord WHERE id = ? UNION SELECT id FROM WorkspaceRuntimeNovel WHERE id = ?', novelId, novelId)) {
    throw new ResourceNotFoundError('Novel not found')
  }
  return db
}

export async function getBookSearchCapabilities(novelId: string) {
  getSearchDatabase(novelId)
  return { semanticAvailable: await hasLanceBookTextEmbeddings(novelId, getMainBranchId(novelId)) }
}

export async function searchBook(novelId: string, query: string, mode: BookSearchMode = 'semantic', signal?: AbortSignal): Promise<BookSearchResult> {
  const db = getSearchDatabase(novelId)
  // Imported books may not have any knowledge artifacts yet. The editor's saved
  // runtime is the source of truth, rather than the asynchronously synced index.
  if (!db.queryOne('SELECT id FROM WorkspaceRuntimeState WHERE id = ?', 'singleton')) {
    await loadWorkspacePayloadFromRuntimeOrRecovery('singleton', db)
  }
  let fallback = false
  let fallbackReason: BookSearchResult['fallbackReason']
  let semantic: Awaited<ReturnType<typeof searchLanceBookText>> = { available: false, matches: [] }
  if (mode === 'semantic') {
    try {
      semantic = await searchLanceBookText({ novelId, branchId: getMainBranchId(novelId), query, limit: BOOK_SEARCH_RESULT_LIMIT * 3, signal })
      fallback = !semantic.available
      if (fallback) fallbackReason = 'missing_embedding'
    } catch {
      signal?.throwIfAborted()
      fallback = true
      fallbackReason = 'unavailable'
    }
  }

  const phrase = query.toLowerCase()
  const keywords: BookSearchMatch[] = []
  const verifiedSemantic = new Map<string, BookSearchMatch>()
  const semanticByChapter = new Map<string, typeof semantic.matches>()
  for (const match of semantic.matches) {
    if (!match.chapterId) continue
    const group = semanticByChapter.get(match.chapterId) ?? []
    group.push(match)
    semanticByChapter.set(match.chapterId, group)
  }
  let cursor: { sortOrder: number; id: string } | null = null
  while (true) {
    signal?.throwIfAborted()
    // Bound memory for large books; do not transport full chapter bodies to the browser.
    const chapters: SearchChapter[] = db.queryAll<SearchChapter>(
      `SELECT id, title, sortOrder, contentHtml, parentChapterId FROM WorkspaceRuntimeChapter
       WHERE workspaceStateId = 'singleton' AND novelId = ?
       ${cursor ? 'AND (sortOrder > ? OR (sortOrder = ? AND id > ?))' : ''}
       ORDER BY sortOrder, id LIMIT 64`,
      novelId, ...(cursor ? [cursor.sortOrder, cursor.sortOrder, cursor.id] : []),
    )
    if (!chapters.length) break
    for (const chapter of chapters) {
      const text = htmlToPlainText(chapter.contentHtml)
      const normalized = normalizeText(text)
      const base = {
        chapterId: chapter.id, chapterNo: Math.floor(chapter.sortOrder), chapterTitle: chapter.title,
        sourceType: chapter.parentChapterId ? 'rewrite' as const : 'chapter' as const,
      }
      for (const match of semanticByChapter.get(chapter.id) ?? []) {
        const source = normalizeText(match.text)
        // Ignore deleted/edited passages still present in an older embedding index.
        if (!source || !normalized.includes(source)) continue
        const preview = excerpt(source, query)
        verifiedSemantic.set(match.id, {
          ...base, text: preview, searchText: preview,
          lineStart: match.lineStart, lineEnd: match.lineEnd, kind: 'semantic',
        })
      }
      if (keywords.length > BOOK_SEARCH_RESULT_LIMIT) continue
      const title = chapter.title.toLowerCase()
      const titleMatches = title.includes(phrase)
      const paragraphs = text.split(/\n+/u).map((line) => line.trim()).filter(Boolean)
      let matched = false
      for (const paragraph of paragraphs) {
        if (!titleMatches && !paragraph.toLowerCase().includes(phrase)) continue
        const preview = excerpt(paragraph, query)
        keywords.push({ ...base, text: preview, searchText: preview, lineStart: null, lineEnd: null, kind: 'exact' })
        matched = true
        if (titleMatches || keywords.length > BOOK_SEARCH_RESULT_LIMIT) break
      }
      if (titleMatches && !matched) {
        const preview = excerpt(paragraphs[0] ?? '', query)
        keywords.push({ ...base, text: preview, searchText: preview, lineStart: null, lineEnd: null, kind: 'exact' })
      }
    }
    cursor = chapters[chapters.length - 1]
  }
  // Saved rewrites and their continuations live outside the chapter table.
  // Only search the current version of active, navigable timeline nodes.
  const blocks = db.queryAll<{
    id: string; nodeId: string; nodeType: 'rewrite' | 'continue_block'; chapterNo: number
    title: string; text: string; chapterId: string
  }>(
    `SELECT b.id, n.id AS nodeId, n.node_type AS nodeType, b.source_chapter_no AS chapterNo,
            b.title, b.latest_text AS text,
            COALESCE((SELECT c.id FROM WorkspaceRuntimeChapter c
              WHERE c.workspaceStateId = 'singleton' AND c.novelId = b.novel_id
                AND c.parentChapterId IS NULL AND c.sortOrder = b.source_chapter_no LIMIT 1), '') AS chapterId
     FROM continue_blocks b JOIN story_timeline_nodes n ON n.continue_block_id = b.id
       AND n.novel_id = b.novel_id AND n.branch_id = b.branch_id
     WHERE b.novel_id = ? AND b.branch_id = ? AND b.status = 'active' AND n.status = 'active'
       AND n.node_type IN ('rewrite', 'continue_block')
       AND (instr(lower(b.latest_text), ?) > 0 OR instr(lower(b.title), ?) > 0)
     ORDER BY b.source_chapter_no, n.label_index, b.id LIMIT ?`,
    novelId, getMainBranchId(novelId), phrase, phrase, BOOK_SEARCH_RESULT_LIMIT + 1,
  )
  for (const block of blocks) {
    const preview = excerpt(block.text, query)
    keywords.push({
      chapterId: block.chapterId, chapterNo: block.chapterNo, chapterTitle: block.title,
      text: preview, searchText: preview, lineStart: null, lineEnd: null, kind: 'exact', sourceType: block.nodeType,
      selection: { kind: block.nodeType, nodeId: block.nodeId, continueBlockId: block.id, anchorChapterNo: block.chapterNo },
    })
  }
  const matches: BookSearchMatch[] = []
  for (const match of [...semantic.matches.flatMap((item) => verifiedSemantic.get(item.id) ?? []), ...keywords]) {
    if (matches.some((existing) => (existing.selection?.nodeId ?? existing.chapterId) === (match.selection?.nodeId ?? match.chapterId)
      && (existing.text.includes(match.text) || match.text.includes(existing.text)))) continue
    matches.push(match)
  }
  return {
    query, mode: semantic.available ? 'semantic' : 'exact', fallback, fallbackReason,
    limited: matches.length > BOOK_SEARCH_RESULT_LIMIT,
    matches: matches.slice(0, BOOK_SEARCH_RESULT_LIMIT),
  }
}

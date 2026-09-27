import { createHash } from 'node:crypto'
import type { DatabaseAccess } from '@/lib/server/database-access'
import { createControlDatabaseAccess, createNovelDatabaseAccess } from '@/lib/server/database-access'
import { getMainBranchId } from '@/lib/server/knowledge-store'
import { listReadyWorkspaceNovelRegistry } from '@/lib/server/persistence'
import {
  formatMaterialParagraphRef,
  loadMaterialLibrary,
  readMaterialLibraryVersion,
  type MaterialLibrary,
} from '@/lib/server/writing-skill-material'
import { splitPlainTextParagraphs, uid } from '@/lib/utils'
import type {
  MaterialParagraph,
  WritingSkillCardSource,
  WritingSkillMaterialSourceSummary,
  WritingSkillSourceRef,
  WritingSkillSourceType,
} from '@/lib/writing-skill-types'

const CHAPTER_HEADING_REGEX = /(第\s*[0-9一二三四五六七八九十百千零两]+\s*章[^\n]*)/g
const CHAPTER_HEADING_LINE_REGEX = /^第\s*[0-9一二三四五六七八九十百千零两]+\s*章/
const MAX_WRITING_SKILL_SOURCE_COUNT = 20

type MaterialBookRow = {
  id: string
  title: string
  author: string | null
  rawText: string
  contentHash: string
  chapterCount: number
  estimatedTokens: number
  byteSize: number
  createdAt: string
  updatedAt: string
}

type LibrarySourceCountRow = {
  chapterCount: number
  rawChars: number
}

type LibrarySnapshotCountRow = {
  snapshotCount: number
  validSnapshotCount: number
  snapshotChars: number
}

function defaultDb() {
  return createControlDatabaseAccess()
}

function estimateMaterialTokens(text: string) {
  return Math.max(1, Math.ceil(text.replace(/\s+/g, '').length / 1.35))
}

function sourceKey(source: WritingSkillSourceRef) {
  return `${source.sourceType.toLowerCase()}:${source.sourceId}`
}

function normalizeSourceType(value: unknown): WritingSkillSourceType | null {
  return value === 'LIBRARY' || value === 'UPLOAD' ? value : null
}

export function normalizeWritingSkillSourceRefs(value: unknown) {
  if (!Array.isArray(value)) return [] as WritingSkillSourceRef[]
  const seen = new Set<string>()
  const result: WritingSkillSourceRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const sourceType = normalizeSourceType(record.sourceType)
    const sourceId = typeof record.sourceId === 'string' ? record.sourceId.trim() : ''
    if (!sourceType || !sourceId) continue
    const key = `${sourceType}:${sourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ sourceType, sourceId })
    if (result.length >= MAX_WRITING_SKILL_SOURCE_COUNT) break
  }
  return result
}

function splitUploadedBookChapters(rawText: string) {
  const cleanText = rawText.replace(/\r\n?/g, '\n').trim()
  if (!cleanText) return [] as Array<{ title: string; text: string }>
  const parts = cleanText.split(CHAPTER_HEADING_REGEX).map((part) => part.trim()).filter(Boolean)
  const chapters: Array<{ title: string; text: string }> = []
  const hasPreface = Boolean(parts[0] && !CHAPTER_HEADING_LINE_REGEX.test(parts[0]))
  if (hasPreface) chapters.push({ title: '序章 / 简介', text: parts[0] })
  const startIndex = hasPreface ? 1 : 0
  for (let index = startIndex; index < parts.length; index += 2) {
    const heading = parts[index]
    if (!heading || !CHAPTER_HEADING_LINE_REGEX.test(heading)) continue
    chapters.push({ title: heading, text: parts[index + 1] ?? '' })
  }
  return chapters.length ? chapters : [{ title: '第1章 导入正文', text: cleanText }]
}

function mapMaterialBookSummary(row: MaterialBookRow): WritingSkillMaterialSourceSummary {
  return {
    sourceType: 'UPLOAD',
    sourceId: row.id,
    title: row.title,
    author: row.author,
    chapterCount: row.chapterCount,
    estimatedTokens: row.estimatedTokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listUploadedWritingSkillMaterials(db: DatabaseAccess = defaultDb()) {
  return db.queryAll<MaterialBookRow>(
    `SELECT id, title, author, '' AS rawText, contentHash, chapterCount, estimatedTokens,
            byteSize, createdAt, updatedAt
     FROM WritingSkillMaterialBook
     ORDER BY updatedAt DESC, createdAt DESC`,
  ).map(mapMaterialBookSummary)
}

export function createUploadedWritingSkillMaterial(input: {
  title: string
  author?: string | null
  rawText: string
  byteSize: number
}, db: DatabaseAccess = defaultDb()) {
  const title = input.title.trim().slice(0, 200)
  const rawText = input.rawText.replace(/\r\n?/g, '\n').trim()
  if (!title) throw new Error('素材书名称不能为空')
  if (!rawText) throw new Error('上传的素材书没有可读取的正文')
  const chapters = splitUploadedBookChapters(rawText)
  const id = uid('writing-skill-material')
  const contentHash = createHash('sha256').update(rawText).digest('hex')
  const estimatedTokens = chapters.reduce((total, chapter) => (
    total + splitPlainTextParagraphs(chapter.text).reduce((sum, paragraph) => sum + estimateMaterialTokens(paragraph), 0)
  ), 0)
  db.execute(
    `INSERT INTO WritingSkillMaterialBook (
       id, title, author, rawText, contentHash, chapterCount, estimatedTokens, byteSize
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    title,
    input.author?.trim() || null,
    rawText,
    contentHash,
    chapters.length,
    estimatedTokens,
    Math.max(0, Math.floor(input.byteSize)),
  )
  const row = readUploadedWritingSkillMaterialRow(id, db)
  if (!row) throw new Error('素材书保存失败')
  return mapMaterialBookSummary(row)
}

function readUploadedWritingSkillMaterialRow(id: string, db: DatabaseAccess = defaultDb()) {
  return db.queryOne<MaterialBookRow>(
    `SELECT id, title, author, rawText, contentHash, chapterCount, estimatedTokens,
            byteSize, createdAt, updatedAt
     FROM WritingSkillMaterialBook WHERE id = ?`,
    id,
  )
}

export function deleteUploadedWritingSkillMaterial(id: string, db: DatabaseAccess = defaultDb()) {
  return db.execute('DELETE FROM WritingSkillMaterialBook WHERE id = ?', id).changes > 0
}

function loadUploadedMaterialLibrary(id: string, db: DatabaseAccess = defaultDb()): MaterialLibrary {
  const row = readUploadedWritingSkillMaterialRow(id, db)
  if (!row) throw new Error('仅蒸馏素材不存在或已被删除')
  const chapters = splitUploadedBookChapters(row.rawText)
  const paragraphs = chapters.flatMap((chapter, chapterOffset) => {
    const chapterIndex = chapterOffset + 1
    return splitPlainTextParagraphs(chapter.text).map((text, paragraphOffset) => {
      const paragraphIndex = paragraphOffset + 1
      return {
        id: `upload:${row.id}:c${chapterIndex}:p${paragraphIndex}`,
        libraryId: row.id,
        libraryVersion: row.contentHash,
        workId: row.id,
        chapterId: `upload:${row.id}:c${chapterIndex}`,
        chapterIndex,
        paragraphIndex,
        anonymizedText: text,
        estimatedTokens: estimateMaterialTokens(text),
        displayRef: formatMaterialParagraphRef(chapterIndex, paragraphIndex),
      } satisfies MaterialParagraph
    })
  })
  if (!paragraphs.length) throw new Error('仅蒸馏素材中没有可读取的段落')
  return {
    id: row.id,
    version: row.contentHash,
    name: row.title,
    author: row.author,
    workId: row.id,
    paragraphs,
    totalTokens: paragraphs.reduce((sum, paragraph) => sum + paragraph.estimatedTokens, 0),
    chapterIds: chapters.map((_, index) => `upload:${row.id}:c${index + 1}`),
    paragraphByDisplayRef: new Map(paragraphs.map((paragraph) => [paragraph.displayRef, paragraph])),
    paragraphById: new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph])),
  }
}

export function listWritingSkillMaterialSources(db: DatabaseAccess = defaultDb()) {
  const librarySources = listReadyWorkspaceNovelRegistry().flatMap((row) => {
    try {
      const novelDb = createNovelDatabaseAccess(row.novelId)
      const novel = novelDb.queryOne<{ title: string; author: string | null; sourceType: string | null }>(
        'SELECT title, author, sourceType FROM NovelRecord WHERE id = ?',
        row.novelId,
      )
      if (!novel) return []
      const chapterCounts = novelDb.queryOne<LibrarySourceCountRow>(
        `SELECT COUNT(*) AS chapterCount, COALESCE(SUM(LENGTH(rawText)), 0) AS rawChars
         FROM KnowledgeChapter
         WHERE novelId = ? AND branchId = ?`,
        row.novelId,
        getMainBranchId(row.novelId),
      )
      if (!chapterCounts?.chapterCount) return []
      const snapshotCounts = novelDb.queryOne<LibrarySnapshotCountRow>(
        `SELECT COUNT(*) AS snapshotCount,
                COALESCE(SUM(CASE WHEN originalContentHtml IS NOT NULL THEN 1 ELSE 0 END), 0) AS validSnapshotCount,
                COALESCE(SUM(LENGTH(COALESCE(originalContentHtml, ''))), 0) AS snapshotChars
         FROM WorkspaceRuntimeChapter
         WHERE workspaceStateId = 'singleton' AND novelId = ? AND parentChapterId IS NULL`,
        row.novelId,
      )
      const snapshotCount = snapshotCounts?.snapshotCount ?? 0
      const validSnapshotCount = snapshotCounts?.validSnapshotCount ?? 0
      const usesSnapshots = snapshotCount > 0
      if (
        (novel.sourceType === 'workspace' && !usesSnapshots)
        || (usesSnapshots && (
          snapshotCount !== chapterCounts.chapterCount
          || validSnapshotCount !== chapterCounts.chapterCount
        ))
      ) return []
      const sourceChars = usesSnapshots
        ? snapshotCounts?.snapshotChars ?? 0
        : chapterCounts.rawChars
      if (!sourceChars) return []
      return [{
        sourceType: 'LIBRARY' as const,
        sourceId: row.novelId,
        title: novel.title,
        author: novel.author,
        chapterCount: chapterCounts.chapterCount,
        estimatedTokens: Math.max(1, Math.ceil(sourceChars / 1.6)),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } satisfies WritingSkillMaterialSourceSummary]
    } catch {
      return []
    }
  })
  return {
    librarySources,
    uploadedSources: listUploadedWritingSkillMaterials(db),
  }
}

function loadSourceLibrary(
  source: WritingSkillSourceRef,
  options: {
    db?: DatabaseAccess
    loadLibrary?: (libraryId: string) => MaterialLibrary
  } = {},
) {
  return source.sourceType === 'LIBRARY'
    ? (options.loadLibrary ?? loadMaterialLibrary)(source.sourceId)
    : loadUploadedMaterialLibrary(source.sourceId, options.db)
}

function materialCollectionVersion(sources: Array<{ source: WritingSkillSourceRef; version: string }>) {
  return createHash('sha256')
    .update('writing-skill-collection:v1')
    .update(sources.map(({ source, version }) => `${sourceKey(source)}:${version}`).join('|'))
    .digest('hex')
}

// Listing cards only needs source versions, not every anonymized paragraph.
// The cache belongs to this read operation so edits/deletions are seen next time.
export function readWritingSkillMaterialCollectionVersion(
  sourceRefs: WritingSkillSourceRef[],
  options: {
    db?: DatabaseAccess
    sourceVersions?: Map<string, string | null>
  } = {},
) {
  const refs = normalizeWritingSkillSourceRefs(sourceRefs)
  if (!refs.length) return null
  const versions = options.sourceVersions ?? new Map<string, string | null>()
  const sources: Array<{ source: WritingSkillSourceRef; version: string }> = []
  for (const source of refs) {
    const key = sourceKey(source)
    if (!versions.has(key)) {
      versions.set(key, source.sourceType === 'LIBRARY'
        ? readMaterialLibraryVersion(source.sourceId)
        : (options.db ?? defaultDb()).queryOne<{ contentHash: string }>(
            'SELECT contentHash FROM WritingSkillMaterialBook WHERE id = ?', source.sourceId,
          )?.contentHash ?? null)
    }
    const version = versions.get(key)
    if (!version) return null
    sources.push({ source, version })
  }
  return materialCollectionVersion(sources)
}

export function loadWritingSkillMaterialCollection(
  sourceRefs: WritingSkillSourceRef[],
  options: {
    db?: DatabaseAccess
    loadLibrary?: (libraryId: string) => MaterialLibrary
  } = {},
) {
  const refs = normalizeWritingSkillSourceRefs(sourceRefs)
  if (!refs.length) throw new Error('请至少选择一本蒸馏素材')
  const loaded = refs.map((source) => ({ source, library: loadSourceLibrary(source, options) }))
  const collectionId = `writing-skill-collection:${createHash('sha256')
    .update(loaded.map(({ source }) => sourceKey(source)).join('|'))
    .digest('hex').slice(0, 24)}`
  const collectionVersion = materialCollectionVersion(loaded.map(({ source, library }) => ({ source, version: library.version })))
  const sources: WritingSkillCardSource[] = loaded.map(({ source, library }, sourceOrder) => ({
    ...source,
    sourceVersion: library.version,
    sourceName: library.name,
    sourceOrder,
  }))
  const paragraphs = loaded.flatMap(({ source, library }, sourceOffset) => {
    const workIndex = sourceOffset + 1
    const key = sourceKey(source)
    return library.paragraphs.map((paragraph) => ({
      ...paragraph,
      id: `${key}:${paragraph.id}`,
      libraryId: collectionId,
      libraryVersion: collectionVersion,
      workId: key,
      chapterId: `${key}:${paragraph.chapterId}`,
      displayRef: formatMaterialParagraphRef(paragraph.chapterIndex, paragraph.paragraphIndex, workIndex),
    }))
  })
  const library: MaterialLibrary = {
    id: collectionId,
    version: collectionVersion,
    name: sources.map((source) => source.sourceName).join('、'),
    author: null,
    workId: collectionId,
    paragraphs,
    totalTokens: paragraphs.reduce((sum, paragraph) => sum + paragraph.estimatedTokens, 0),
    chapterIds: Array.from(new Set(paragraphs.map((paragraph) => paragraph.chapterId))),
    paragraphByDisplayRef: new Map(paragraphs.map((paragraph) => [paragraph.displayRef, paragraph])),
    paragraphById: new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph])),
  }
  return { library, sources }
}

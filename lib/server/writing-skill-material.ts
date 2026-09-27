import { createHash } from 'node:crypto'
import type { DatabaseAccess } from '@/lib/server/database-access'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { getMainBranchId } from '@/lib/server/knowledge-store'
import { safeParseJson } from '@/lib/server/json-parse'
import { htmlToPlainText, shuffleWithSeed, splitPlainTextParagraphs } from '@/lib/utils'
import type {
  MaterialParagraph,
  MaterialScanResult,
  ParagraphRangeRef,
  SampledRangeRecord,
} from '@/lib/writing-skill-types'

type ChapterRow = {
  id: string
  chapterNo: number
  title: string | null
  rawText: string
}

type OriginalChapterSnapshotRow = {
  id: string
  originalContentHtml: string | null
}

type EntityRow = {
  id: string
  entityType: string
  canonicalName: string
  firstSeenChapter: number | null
}

export type MaterialLibrary = {
  id: string
  version: string
  name: string
  author: string | null
  workId: string
  paragraphs: MaterialParagraph[]
  totalTokens: number
  chapterIds: string[]
  paragraphByDisplayRef: Map<string, MaterialParagraph>
  paragraphById: Map<string, MaterialParagraph>
}

export type ValidatedCandidateRange = {
  rangeRef: ParagraphRangeRef
  displayRef: string
  chapterId: string
  chapterIndex: number
  startParagraphIndex: number
  endParagraphIndex: number
}

export type SampledMaterial = {
  paragraphs: MaterialParagraph[]
  estimatedTokens: number
  chapterIds: string[]
  displayRefs: string[]
  mode: 'full' | 'sampled'
}

function estimateMaterialTokens(text: string) {
  return Math.max(1, Math.ceil(text.replace(/\s+/g, '').length / 1.6))
}

function padRef(value: number, length: number) {
  return String(Math.max(1, Math.floor(value))).padStart(length, '0')
}

export function formatMaterialParagraphRef(chapterIndex: number, paragraphIndex: number, workIndex = 1) {
  return `W${padRef(workIndex, 2)}-C${padRef(chapterIndex, 3)}-P${padRef(paragraphIndex, 3)}`
}

export function parseMaterialParagraphRef(value: string) {
  const match = value.trim().match(/^W(\d+)-C(\d+)-P(\d+)$/i)
  if (!match) return null
  const parsed = {
    workIndex: Number.parseInt(match[1], 10),
    chapterIndex: Number.parseInt(match[2], 10),
    paragraphIndex: Number.parseInt(match[3], 10),
  }
  return parsed.workIndex >= 1 && parsed.chapterIndex >= 1 && parsed.paragraphIndex >= 1
    ? parsed
    : null
}

export function parseMaterialRangeDisplayRef(value: string) {
  const normalized = value.trim()
  const parts = normalized.split(':')
  if (parts.length > 2) return null
  const [startRaw, endRaw] = parts
  const start = parseMaterialParagraphRef(startRaw)
  if (!start) return null
  if (!endRaw) return { startRef: startRaw.toUpperCase(), endRef: startRaw.toUpperCase() }

  const fullEndRef = /^P\d+$/i.test(endRaw.trim())
    ? `W${padRef(start.workIndex, 2)}-C${padRef(start.chapterIndex, 3)}-${endRaw.trim().toUpperCase()}`
    : endRaw.trim().toUpperCase()
  const end = parseMaterialParagraphRef(fullEndRef)
  if (!end) return null
  return { startRef: startRaw.toUpperCase(), endRef: fullEndRef }
}

export function formatParagraphRef(range: {
  start: MaterialParagraph
  end: MaterialParagraph
}) {
  return range.start.displayRef === range.end.displayRef
    ? range.start.displayRef
    : `${range.start.displayRef}:P${padRef(range.end.paragraphIndex, 3)}`
}

type OriginalSourceChapter = Pick<ChapterRow, 'id' | 'chapterNo' | 'title'> & {
  originalText: string
}

function computeLibraryVersion(chapters: OriginalSourceChapter[]) {
  return createHash('sha256')
    .update('writing-skill-original-source:v1')
    .update(chapters.map((chapter) => (
      `${chapter.id}:${chapter.chapterNo}:${createHash('sha256').update(chapter.originalText).digest('hex')}`
    )).join('|'))
    .digest('hex')
}

function readOriginalSourceChapters(input: {
  db: DatabaseAccess
  libraryId: string
  branchId: string
  sourceType: string | null
}) {
  const chapters = input.db.queryAll<ChapterRow>(
    `SELECT id, chapterNo, title, rawText
     FROM KnowledgeChapter WHERE novelId = ? AND branchId = ?
     ORDER BY chapterNo ASC, id ASC`,
    input.libraryId,
    input.branchId,
  )
  if (!chapters.length) throw new Error('素材库中没有可读取的章节')

  const snapshots = input.db.queryAll<OriginalChapterSnapshotRow>(
    `SELECT id, originalContentHtml
     FROM WorkspaceRuntimeChapter
     WHERE workspaceStateId = 'singleton' AND novelId = ? AND parentChapterId IS NULL
     ORDER BY sortOrder ASC, id ASC`,
    input.libraryId,
  )
  if (!snapshots.length) {
    if (input.sourceType === 'workspace') {
      throw new Error('素材库缺少原文快照，无法安全提炼写作技巧')
    }
    return chapters.map((chapter) => ({
      id: chapter.id,
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      originalText: chapter.rawText,
    }))
  }

  const snapshotByChapterId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
  return chapters.map((chapter) => {
    const snapshot = snapshotByChapterId.get(chapter.id)
    if (!snapshot || snapshot.originalContentHtml === null) {
      throw new Error(`第 ${chapter.chapterNo} 章缺少原文快照，无法安全提炼写作技巧`)
    }
    return {
      id: chapter.id,
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      originalText: htmlToPlainText(snapshot.originalContentHtml),
    }
  })
}

function placeholderType(entityType: string) {
  const normalized = entityType.toLowerCase()
  if (normalized.includes('character') || normalized.includes('person')) return '人物'
  if (normalized.includes('location') || normalized.includes('place')) return '地点'
  if (normalized.includes('organization') || normalized.includes('org')) return '组织'
  if (normalized.includes('item') || normalized.includes('object')) return '物品'
  if (normalized.includes('skill') || normalized.includes('ability')) return '能力'
  return '设定'
}

function parseRuntimeNames(value: string | null, key: 'name' | 'title') {
  const parsed = safeParseJson(value)
  if (!Array.isArray(parsed)) return [] as string[]
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const candidate = (item as Record<string, unknown>)[key]
    return typeof candidate === 'string' && candidate.trim() ? [candidate.trim()] : []
  })
}

function readAnonymizationReplacements(db: DatabaseAccess, branchId: string) {
  const entities = db.queryAll<EntityRow>(
    `SELECT id, entityType, canonicalName, firstSeenChapter
     FROM KnowledgeEntity
     WHERE branchId = ?
     ORDER BY COALESCE(firstSeenChapter, 2147483647), entityType, canonicalName, id`,
    branchId,
  )
  const aliases = db.queryAll<{ entityId: string; alias: string }>(
    `SELECT entityId, alias FROM EntityAliasMapping WHERE branchId = ?
     UNION
     SELECT alias.entityId, alias.alias
     FROM EntityAlias alias
     INNER JOIN KnowledgeEntity entity ON entity.id = alias.entityId
     WHERE entity.branchId = ?`,
    branchId,
    branchId,
  )
  const aliasesByEntity = new Map<string, string[]>()
  for (const alias of aliases) {
    const current = aliasesByEntity.get(alias.entityId) ?? []
    current.push(alias.alias)
    aliasesByEntity.set(alias.entityId, current)
  }

  const counters = new Map<string, number>()
  const replacements = new Map<string, string>()
  for (const entity of entities) {
    const type = placeholderType(entity.entityType)
    const index = (counters.get(type) ?? 0) + 1
    counters.set(type, index)
    const placeholder = `[${type}${String.fromCharCode(64 + Math.min(index, 26))}${index > 26 ? index : ''}]`
    for (const name of [entity.canonicalName, ...(aliasesByEntity.get(entity.id) ?? [])]) {
      const normalized = name.trim()
      if (normalized.length >= 2) replacements.set(normalized, placeholder)
    }
  }

  const candidates = db.queryAll<{ surfaceText: string }>(
    `SELECT surface_text AS surfaceText FROM character_candidates
     WHERE branch_id = ? ORDER BY first_seen_chapter, surface_text`,
    branchId,
  )
  for (const candidate of candidates) {
    const name = candidate.surfaceText.trim()
    if (name.length < 2 || replacements.has(name)) continue
    const index = (counters.get('人物') ?? 0) + 1
    counters.set('人物', index)
    replacements.set(name, `[人物${String.fromCharCode(64 + Math.min(index, 26))}${index > 26 ? index : ''}]`)
  }

  const runtime = db.queryOne<{ localCharactersJson: string | null; localWorldEntriesJson: string | null }>(
    `SELECT localCharactersJson, localWorldEntriesJson
     FROM WorkspaceRuntimeState WHERE id = 'singleton'`,
  )
  for (const name of parseRuntimeNames(runtime?.localCharactersJson ?? null, 'name')) {
    if (name.length < 2 || replacements.has(name)) continue
    const index = (counters.get('人物') ?? 0) + 1
    counters.set('人物', index)
    replacements.set(name, `[人物${String.fromCharCode(64 + Math.min(index, 26))}${index > 26 ? index : ''}]`)
  }
  for (const title of parseRuntimeNames(runtime?.localWorldEntriesJson ?? null, 'title')) {
    if (title.length < 2 || replacements.has(title)) continue
    const index = (counters.get('设定') ?? 0) + 1
    counters.set('设定', index)
    replacements.set(title, `[设定${String.fromCharCode(64 + Math.min(index, 26))}${index > 26 ? index : ''}]`)
  }

  return Array.from(replacements.entries()).sort((left, right) => right[0].length - left[0].length)
}

export function anonymizeMaterialText(text: string, replacements: ReadonlyArray<readonly [string, string]>) {
  return replacements.reduce(
    (current, [source, replacement]) => current.split(source).join(replacement),
    text,
  )
}

export function loadMaterialLibrary(libraryId: string, db: DatabaseAccess = createNovelDatabaseAccess(libraryId)): MaterialLibrary {
  const branchId = getMainBranchId(libraryId)
  const novel = db.queryOne<{ id: string; title: string; author: string | null; sourceType: string | null }>(
    'SELECT id, title, author, sourceType FROM NovelRecord WHERE id = ?',
    libraryId,
  )
  if (!novel) throw new Error('素材库不存在或尚未完成导入')

  const chapters = readOriginalSourceChapters({
    db,
    libraryId,
    branchId,
    sourceType: novel.sourceType,
  })
  const version = computeLibraryVersion(chapters)

  const replacements = readAnonymizationReplacements(db, branchId)
  const paragraphs = chapters.flatMap((chapter) => (
    splitPlainTextParagraphs(chapter.originalText).map((text, index) => {
      const paragraphIndex = index + 1
      const anonymizedText = anonymizeMaterialText(text, replacements)
      return {
        id: `writing-skill-original:${chapter.id}:p${paragraphIndex}`,
        libraryId,
        libraryVersion: version,
        workId: novel.id,
        chapterId: chapter.id,
        chapterIndex: chapter.chapterNo,
        paragraphIndex,
        anonymizedText,
        estimatedTokens: estimateMaterialTokens(anonymizedText),
        displayRef: formatMaterialParagraphRef(chapter.chapterNo, paragraphIndex),
      } satisfies MaterialParagraph
    })
  ))
  if (!paragraphs.length) throw new Error('素材库原文中没有可读取的段落')

  return {
    id: libraryId,
    version,
    name: novel.title,
    author: novel.author,
    workId: novel.id,
    paragraphs,
    totalTokens: paragraphs.reduce((sum, paragraph) => sum + paragraph.estimatedTokens, 0),
    chapterIds: chapters.map((chapter) => chapter.id),
    paragraphByDisplayRef: new Map(paragraphs.map((paragraph) => [paragraph.displayRef, paragraph])),
    paragraphById: new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph])),
  }
}

export function readMaterialLibraryVersion(libraryId: string) {
  try {
    const db = createNovelDatabaseAccess(libraryId)
    const branchId = getMainBranchId(libraryId)
    const novel = db.queryOne<{ sourceType: string | null }>(
      'SELECT sourceType FROM NovelRecord WHERE id = ?',
      libraryId,
    )
    if (!novel) return null
    const chapters = readOriginalSourceChapters({
      db,
      libraryId,
      branchId,
      sourceType: novel.sourceType,
    })
    return chapters.length ? computeLibraryVersion(chapters) : null
  } catch {
    return null
  }
}

export function resolveMaterialRange(library: MaterialLibrary, displayRef: string) {
  const parsed = parseMaterialRangeDisplayRef(displayRef)
  if (!parsed) return null
  const start = library.paragraphByDisplayRef.get(parsed.startRef)
  const end = library.paragraphByDisplayRef.get(parsed.endRef)
  if (!start || !end) return null
  if (start.chapterId !== end.chapterId || start.workId !== end.workId) return null
  if (start.paragraphIndex > end.paragraphIndex) return null
  return {
    start,
    end,
    displayRef: formatParagraphRef({ start, end }),
    rangeRef: {
      libraryId: library.id,
      libraryVersion: library.version,
      workId: start.workId,
      chapterId: start.chapterId,
      startParagraphId: start.id,
      endParagraphId: end.id,
    } satisfies ParagraphRangeRef,
  }
}

export function resolveInternalMaterialRange(library: MaterialLibrary, rangeRef: ParagraphRangeRef) {
  if (rangeRef.libraryId !== library.id || rangeRef.libraryVersion !== library.version) return null
  const start = library.paragraphById.get(rangeRef.startParagraphId)
  const end = library.paragraphById.get(rangeRef.endParagraphId)
  if (!start || !end || start.chapterId !== rangeRef.chapterId || end.chapterId !== rangeRef.chapterId) return null
  if (start.workId !== rangeRef.workId || end.workId !== rangeRef.workId) return null
  if (start.paragraphIndex > end.paragraphIndex) return null
  return { start, end, displayRef: formatParagraphRef({ start, end }) }
}

export function getRangeParagraphs(library: MaterialLibrary, displayRef: string, contextParagraphs = 0) {
  const resolved = resolveMaterialRange(library, displayRef)
  if (!resolved) return []
  return library.paragraphs.filter((paragraph) => (
    paragraph.chapterId === resolved.start.chapterId
    && paragraph.paragraphIndex >= Math.max(1, resolved.start.paragraphIndex - contextParagraphs)
    && paragraph.paragraphIndex <= resolved.end.paragraphIndex + contextParagraphs
  ))
}

export function createSeededRandom(seed: number) {
  let state = Math.floor(seed) >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function deriveWritingSkillRoundSeed(seed: number, round: number) {
  const hash = createHash('sha256').update(`${seed}:${round}`).digest()
  return hash.readUInt32BE(0) & 0x7fffffff
}

function groupParagraphsByChapter(paragraphs: MaterialParagraph[]) {
  const groups = new Map<string, MaterialParagraph[]>()
  for (const paragraph of paragraphs) {
    const current = groups.get(paragraph.chapterId) ?? []
    current.push(paragraph)
    groups.set(paragraph.chapterId, current)
  }
  return groups
}

function estimateCompiledParagraphTokens(paragraph: MaterialParagraph) {
  return paragraph.estimatedTokens + 8
}

function materialWorkIndex(paragraph: MaterialParagraph) {
  return parseMaterialParagraphRef(paragraph.displayRef)?.workIndex ?? 1
}

function sampleContiguousParagraphBlock(
  paragraphs: MaterialParagraph[],
  budget: number,
  random: () => number,
) {
  const fittingStarts = paragraphs
    .map((_, index) => index)
    .filter((index) => estimateCompiledParagraphTokens(paragraphs[index]) <= budget)
  if (!fittingStarts.length) return [] as MaterialParagraph[]
  const start = fittingStarts[Math.floor(random() * fittingStarts.length)]
  const selected: MaterialParagraph[] = []
  let tokens = 0
  for (let index = start; index < paragraphs.length; index += 1) {
    const cost = estimateCompiledParagraphTokens(paragraphs[index])
    if (tokens + cost > budget) break
    selected.push(paragraphs[index])
    tokens += cost
  }
  return selected
}

export function sampleWritingSkillMaterial(input: {
  library: MaterialLibrary
  tokenBudget: number
  seed: number
  excludedChapterIds?: string[]
}): SampledMaterial {
  const budget = Math.max(0, Math.floor(input.tokenBudget))
  const excluded = new Set(input.excludedChapterIds ?? [])
  const available = input.library.paragraphs.filter((paragraph) => !excluded.has(paragraph.chapterId))
  const fullTokens = input.library.paragraphs.reduce((sum, paragraph) => sum + estimateCompiledParagraphTokens(paragraph), 0)
  if (!excluded.size && fullTokens <= budget) {
    return {
      paragraphs: input.library.paragraphs.slice(),
      estimatedTokens: fullTokens,
      chapterIds: input.library.chapterIds.slice(),
      displayRefs: input.library.chapterIds.flatMap((chapterId) => {
        const chapterParagraphs = input.library.paragraphs.filter((paragraph) => paragraph.chapterId === chapterId)
        return chapterParagraphs.length
          ? [formatParagraphRef({ start: chapterParagraphs[0], end: chapterParagraphs[chapterParagraphs.length - 1] })]
          : []
      }),
      mode: 'full',
    }
  }

  const grouped = groupParagraphsByChapter(available)
  const orderedChapters = Array.from(grouped.entries()).sort((left, right) => (
    materialWorkIndex(left[1][0]) - materialWorkIndex(right[1][0])
      || left[1][0].chapterIndex - right[1][0].chapterIndex
  ))
  const bucketSize = Math.max(1, Math.ceil(orderedChapters.length / 3))
  const random = createSeededRandom(input.seed)
  const buckets = [0, 1, 2].map((bucket) => shuffleWithSeed(
    orderedChapters.slice(bucket * bucketSize, (bucket + 1) * bucketSize),
    random,
  ))
  const chapterOrder: typeof orderedChapters = []
  while (buckets.some((bucket) => bucket.length)) {
    for (const bucket of buckets) {
      const next = bucket.shift()
      if (next) chapterOrder.push(next)
    }
  }

  const selected: MaterialParagraph[] = []
  const selectedChapterIds: string[] = []
  const displayRefs: string[] = []
  let tokens = 0
  for (const [chapterId, paragraphs] of chapterOrder) {
    const remaining = budget - tokens
    if (remaining <= 0) break
    const chapterTokens = paragraphs.reduce((sum, paragraph) => sum + estimateCompiledParagraphTokens(paragraph), 0)
    const nextParagraphs = chapterTokens <= remaining
      ? paragraphs
      : sampleContiguousParagraphBlock(paragraphs, remaining, random)
    if (!nextParagraphs.length) continue
    const nextTokens = nextParagraphs.reduce((sum, paragraph) => sum + estimateCompiledParagraphTokens(paragraph), 0)
    selected.push(...nextParagraphs)
    selectedChapterIds.push(chapterId)
    displayRefs.push(formatParagraphRef({
      start: nextParagraphs[0],
      end: nextParagraphs[nextParagraphs.length - 1],
    }))
    tokens += nextTokens
  }

  return {
    paragraphs: selected.sort((left, right) => (
      materialWorkIndex(left) - materialWorkIndex(right)
        || left.chapterIndex - right.chapterIndex
        || left.paragraphIndex - right.paragraphIndex
    )),
    estimatedTokens: tokens,
    chapterIds: selectedChapterIds,
    displayRefs,
    mode: 'sampled',
  }
}

export function toSampledRangeRecord(sample: SampledMaterial, round: number, seed: number): SampledRangeRecord {
  return {
    round,
    seed,
    chapterIds: sample.chapterIds,
    displayRefs: sample.displayRefs,
    estimatedTokens: sample.estimatedTokens,
    mode: sample.mode,
  }
}

export function compileNumberedMaterial(paragraphs: MaterialParagraph[]) {
  const lines: string[] = []
  let lastChapterId = ''
  for (const paragraph of paragraphs) {
    if (paragraph.chapterId !== lastChapterId) {
      if (lines.length) lines.push('')
      lines.push(`=== WORK W${padRef(materialWorkIndex(paragraph), 2)} / CHAPTER C${padRef(paragraph.chapterIndex, 3)} ===`)
      lastChapterId = paragraph.chapterId
    }
    lines.push(`[${paragraph.displayRef}]`)
    lines.push(paragraph.anonymizedText)
  }
  return lines.join('\n')
}

function rangesOverlapOrTouch(left: ValidatedCandidateRange, right: ValidatedCandidateRange) {
  return left.chapterId === right.chapterId
    && right.startParagraphIndex <= left.endParagraphIndex + 1
}

export function mergeWritingSkillCandidateRanges(candidates: ValidatedCandidateRange[]) {
  const ordered = candidates.slice().sort((left, right) => (
    left.displayRef.localeCompare(right.displayRef)
    || left.startParagraphIndex - right.startParagraphIndex
    || left.endParagraphIndex - right.endParagraphIndex
  ))
  const merged: ValidatedCandidateRange[] = []
  for (const candidate of ordered) {
    const previous = merged[merged.length - 1]
    if (!previous || !rangesOverlapOrTouch(previous, candidate)) {
      merged.push({ ...candidate })
      continue
    }

    const start = previous.startParagraphIndex <= candidate.startParagraphIndex ? previous : candidate
    const end = previous.endParagraphIndex >= candidate.endParagraphIndex ? previous : candidate
    const startParagraphId = start.rangeRef.startParagraphId
    const endParagraphId = end.rangeRef.endParagraphId
    const startDisplay = previous.displayRef.split(':')[0]
    previous.startParagraphIndex = Math.min(previous.startParagraphIndex, candidate.startParagraphIndex)
    previous.endParagraphIndex = Math.max(previous.endParagraphIndex, candidate.endParagraphIndex)
    previous.rangeRef = { ...previous.rangeRef, startParagraphId, endParagraphId }
    previous.displayRef = previous.startParagraphIndex === previous.endParagraphIndex
      ? startDisplay
      : `${startDisplay}:P${padRef(previous.endParagraphIndex, 3)}`
  }
  return merged
}

export function validateWritingSkillScanResult(input: {
  library: MaterialLibrary
  sample: SampledMaterial
  result: MaterialScanResult
}) {
  const allowedRefs = new Set(input.sample.paragraphs.map((paragraph) => paragraph.displayRef))
  const valid = input.result.candidates.flatMap((candidate) => {
    const startRef = candidate.startRef.trim().toUpperCase()
    const endRef = candidate.endRef.trim().toUpperCase()
    if (!allowedRefs.has(startRef) || !allowedRefs.has(endRef)) return []
    const start = input.library.paragraphByDisplayRef.get(startRef)
    const end = input.library.paragraphByDisplayRef.get(endRef)
    if (!start || !end || start.chapterId !== end.chapterId || start.paragraphIndex > end.paragraphIndex) return []
    return [{
      rangeRef: {
        libraryId: input.library.id,
        libraryVersion: input.library.version,
        workId: start.workId,
        chapterId: start.chapterId,
        startParagraphId: start.id,
        endParagraphId: end.id,
      },
      displayRef: formatParagraphRef({ start, end }),
      chapterId: start.chapterId,
      chapterIndex: start.chapterIndex,
      startParagraphIndex: start.paragraphIndex,
      endParagraphIndex: end.paragraphIndex,
    } satisfies ValidatedCandidateRange]
  })
  return mergeWritingSkillCandidateRanges(valid)
}

export function compileEvidenceMaterial(library: MaterialLibrary, ranges: ValidatedCandidateRange[]) {
  const citationGuide = [
    '=== ALLOWED CORE EVIDENCE REFERENCES ===',
    'evidenceRefs 只能逐字复制下列核心候选范围编号；上下文段落仅用于理解，不可引用：',
    ...ranges.map((range) => `- ${range.displayRef}`),
  ].join('\n')
  const evidence = ranges.map((range, index) => {
    const resolved = resolveMaterialRange(library, range.displayRef)
    const paragraphs = getRangeParagraphs(library, range.displayRef, 1)
    let coreIndex = 0
    const coreCount = resolved
      ? resolved.end.paragraphIndex - resolved.start.paragraphIndex + 1
      : 0
    return [
      `=== EVIDENCE ${index + 1}: ${range.displayRef} ===`,
      ...paragraphs.flatMap((paragraph) => {
        const isCore = Boolean(
          resolved
          && paragraph.chapterId === resolved.start.chapterId
          && paragraph.paragraphIndex >= resolved.start.paragraphIndex
          && paragraph.paragraphIndex <= resolved.end.paragraphIndex,
        )
        if (isCore) {
          coreIndex += 1
          return [`[CORE ${coreIndex}/${coreCount}]`, paragraph.anonymizedText]
        }
        const position = resolved && paragraph.paragraphIndex < resolved.start.paragraphIndex
          ? 'BEFORE'
          : 'AFTER'
        return [`[CONTEXT ${position} — NOT CITABLE]`, paragraph.anonymizedText]
      }),
    ].join('\n')
  }).join('\n\n')
  return `${citationGuide}\n\n${evidence}`
}

import type { Chapter } from '@/lib/types'

export const CHAPTER_DRAFT_CACHE_STORAGE_KEY = 'retale.chapter-drafts.v1'
export const CHAPTER_DRAFT_CACHE_MAX_ENTRY_COUNT = 5
export const CHAPTER_DRAFT_CACHE_MAX_BYTES = 3_500_000
export const CHAPTER_DRAFT_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

type ChapterDraftCacheEntry = {
  version: 1
  novelId: string
  chapterId: string
  baseContentFingerprint: string
  content: string
  wordCount: number
  savedAt: number
}

type ChapterDraftCacheStore = {
  version: 1
  entries: ChapterDraftCacheEntry[]
}

export type ChapterDraftCacheRecord = Readonly<ChapterDraftCacheEntry>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createChapterContentFingerprint(content: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${content.length}:${(hash >>> 0).toString(16)}`
}

function parseEntry(value: unknown, now: number): ChapterDraftCacheEntry | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (typeof value.novelId !== 'string' || !value.novelId) return null
  if (typeof value.chapterId !== 'string' || !value.chapterId) return null
  if (typeof value.baseContentFingerprint !== 'string' || !value.baseContentFingerprint) return null
  if (typeof value.content !== 'string') return null
  if (typeof value.wordCount !== 'number' || !Number.isSafeInteger(value.wordCount) || value.wordCount < 0) return null
  if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || value.savedAt <= 0) return null
  if (now - value.savedAt > CHAPTER_DRAFT_CACHE_MAX_AGE_MS) return null

  return {
    version: 1,
    novelId: value.novelId,
    chapterId: value.chapterId,
    baseContentFingerprint: value.baseContentFingerprint,
    content: value.content,
    wordCount: value.wordCount,
    savedAt: value.savedAt,
  }
}

function serializeStore(entries: ChapterDraftCacheEntry[]) {
  return JSON.stringify({ version: 1, entries } satisfies ChapterDraftCacheStore)
}

function getUtf8ByteLength(value: string) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength
  return value.length
}

function readStore(now = Date.now()): ChapterDraftCacheStore {
  if (typeof window === 'undefined') return { version: 1, entries: [] }

  try {
    const raw = window.localStorage.getItem(CHAPTER_DRAFT_CACHE_STORAGE_KEY)
    if (!raw) return { version: 1, entries: [] }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      window.localStorage.removeItem(CHAPTER_DRAFT_CACHE_STORAGE_KEY)
      return { version: 1, entries: [] }
    }

    const deduped = new Map<string, ChapterDraftCacheEntry>()
    parsed.entries
      .map((entry) => parseEntry(entry, now))
      .filter((entry): entry is ChapterDraftCacheEntry => entry !== null)
      .sort((left, right) => right.savedAt - left.savedAt)
      .forEach((entry) => {
        const key = `${entry.novelId}\u0000${entry.chapterId}`
        if (!deduped.has(key)) deduped.set(key, entry)
      })

    return { version: 1, entries: Array.from(deduped.values()).slice(0, CHAPTER_DRAFT_CACHE_MAX_ENTRY_COUNT) }
  } catch {
    return { version: 1, entries: [] }
  }
}

function writeStore(entries: ChapterDraftCacheEntry[]) {
  if (typeof window === 'undefined') return false

  const bounded = entries
    .slice()
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, CHAPTER_DRAFT_CACHE_MAX_ENTRY_COUNT)
  let serialized = serializeStore(bounded)
  while (bounded.length > 1 && getUtf8ByteLength(serialized) > CHAPTER_DRAFT_CACHE_MAX_BYTES) {
    bounded.pop()
    serialized = serializeStore(bounded)
  }
  if (getUtf8ByteLength(serialized) > CHAPTER_DRAFT_CACHE_MAX_BYTES) return false

  try {
    if (bounded.length) {
      window.localStorage.setItem(CHAPTER_DRAFT_CACHE_STORAGE_KEY, serialized)
    } else {
      window.localStorage.removeItem(CHAPTER_DRAFT_CACHE_STORAGE_KEY)
    }
    return true
  } catch {
    return false
  }
}

export function readChapterDraft(novelId: string, chapterId: string): ChapterDraftCacheRecord | null {
  return readStore().entries.find((entry) => entry.novelId === novelId && entry.chapterId === chapterId) ?? null
}

export function writeChapterDraft(input: {
  novelId: string
  chapterId: string
  baseContent: string
  content: string
  wordCount: number
  savedAt?: number
}) {
  if (!input.novelId || !input.chapterId) return false
  const store = readStore(input.savedAt)
  const existing = store.entries.find((entry) => entry.novelId === input.novelId && entry.chapterId === input.chapterId)
  const baseContentFingerprint = existing?.baseContentFingerprint ?? createChapterContentFingerprint(input.baseContent)
  const remaining = store.entries.filter((entry) => entry.novelId !== input.novelId || entry.chapterId !== input.chapterId)

  if (createChapterContentFingerprint(input.content) === baseContentFingerprint) {
    return writeStore(remaining)
  }

  return writeStore([{
    version: 1,
    novelId: input.novelId,
    chapterId: input.chapterId,
    baseContentFingerprint,
    content: input.content,
    wordCount: input.wordCount,
    savedAt: input.savedAt ?? Date.now(),
  }, ...remaining])
}

export function removeChapterDraft(novelId: string, chapterId: string) {
  const store = readStore()
  return writeStore(store.entries.filter((entry) => entry.novelId !== novelId || entry.chapterId !== chapterId))
}

export function clearAcknowledgedChapterDrafts(chapters: Array<Pick<Chapter, 'id' | 'novelId' | 'content'>>) {
  const store = readStore()
  if (!store.entries.length) return true
  const contentByChapter = new Map(chapters.map((chapter) => [`${chapter.novelId}\u0000${chapter.id}`, chapter.content]))
  return writeStore(store.entries.filter((entry) => (
    contentByChapter.get(`${entry.novelId}\u0000${entry.chapterId}`) !== entry.content
  )))
}

export function canRestoreChapterDraftWithoutConflict(draft: ChapterDraftCacheRecord, serverContent: string) {
  return draft.baseContentFingerprint === createChapterContentFingerprint(serverContent)
}

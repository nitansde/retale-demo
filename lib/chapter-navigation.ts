import type { ChapterTimelineItem } from '@/lib/story-branch-types'

export const CHAPTER_NAVIGATION_WINDOW_SIZE = 80

function normalizeNavigationText(value: string | null | undefined) {
  return value?.replace(/\s+/gu, ' ').trim() ?? ''
}

export function resolveChapterNavigationSummary(
  summary: string | null | undefined,
) {
  return normalizeNavigationText(summary) || null
}

export function resolveCenteredChapterWindowStart<T extends { chapterId: string }>(
  chapters: T[],
  currentChapterId: string,
  windowSize = CHAPTER_NAVIGATION_WINDOW_SIZE,
) {
  if (!chapters.length || windowSize <= 0) return 0
  const currentIndex = chapters.findIndex((chapter) => chapter.chapterId === currentChapterId)
  if (currentIndex < 0) return 0
  const maxStart = Math.max(0, chapters.length - windowSize)
  return Math.min(maxStart, Math.max(0, currentIndex - Math.floor(windowSize / 2)))
}

export function filterChapterNavigationItems(
  chapters: ChapterTimelineItem[],
  query: string,
) {
  const normalizedQuery = normalizeNavigationText(query).toLocaleLowerCase()
  if (!normalizedQuery) return chapters

  const chapterNumberMatch = normalizedQuery.match(/^第?\s*(\d+)\s*章?$/u)
  if (chapterNumberMatch) {
    const chapterNo = Number(chapterNumberMatch[1])
    return chapters.filter((chapter) => chapter.chapterNo === chapterNo)
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean)
  return chapters.filter((chapter) => {
    const haystack = [
      String(chapter.chapterNo),
      `第${chapter.chapterNo}章`,
      chapter.title,
      chapter.summary ?? '',
    ].join(' ').toLocaleLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
}

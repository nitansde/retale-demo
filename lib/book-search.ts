import type { TimelineSelection } from '@/lib/story-branch-types'

export const BOOK_SEARCH_QUERY_LIMIT = 200
export const BOOK_SEARCH_RESULT_LIMIT = 40

export type BookSearchMode = 'semantic' | 'exact'

export type BookSearchMatch = {
  chapterId: string
  chapterNo: number
  chapterTitle: string
  text: string
  searchText: string
  lineStart: number | null
  lineEnd: number | null
  kind: BookSearchMode
  sourceType?: 'chapter' | 'rewrite' | 'continue_block'
  selection?: Extract<TimelineSelection, { kind: 'rewrite' | 'continue_block' }>
}

export type BookSearchResult = {
  query: string
  mode: BookSearchMode
  fallback: boolean
  fallbackReason?: 'missing_embedding' | 'unavailable'
  limited: boolean
  matches: BookSearchMatch[]
}

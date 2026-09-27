import { countChineseFriendlyWords, plainTextLinesToHtml } from '@/lib/utils'
import type { Chapter, PersistedNovelState } from '@/lib/types'

const CHAPTER_HEADING_REGEX = /(第\s*[0-9一二三四五六七八九十百千零两]+\s*章[^\n]*)/g

function buildImportedChapter(params: {
  id: string
  novelId: string
  title: string
  order: number
  contentText: string
}) {
  const cleanText = params.contentText.trim() || '（本章暂无正文）'
  return {
    id: params.id,
    novelId: params.novelId,
    title: params.title,
    order: params.order,
    content: plainTextLinesToHtml(cleanText),
    originalContent: plainTextLinesToHtml(cleanText),
    status: 'draft' as const,
    wordCount: countChineseFriendlyWords(cleanText),
    updatedAt: '刚刚 · 导入',
    trajectory: ['从 TXT 导入'],
  }
}

export function importNovelIntoWorkspace(state: PersistedNovelState, input: { title: string; text: string; summary?: string }): PersistedNovelState {
  const cleanTitle = input.title.trim() || `导入小说 ${state.localNovels.length + 1}`
  const cleanText = input.text.replace(/\r\n?/g, '\n').trim()
  if (!cleanText) return state

  const now = Date.now()
  const novelId = `novel_${now}`
  const parts = cleanText.split(CHAPTER_HEADING_REGEX).map((item) => item.trim()).filter(Boolean)

  const importedChapters: Chapter[] = []
  const preface = parts[0] && !CHAPTER_HEADING_REGEX.test(parts[0]) ? parts[0].trim() : ''

  if (preface) {
    importedChapters.push(
      buildImportedChapter({
        id: `ch_${now}_0`,
        novelId,
        title: '序章 / 简介',
        order: 1,
        contentText: preface,
      })
    )
  }

  if (parts.length >= 2) {
    const startIndex = preface ? 1 : 0
    for (let i = startIndex; i < parts.length; i += 2) {
      const heading = parts[i]
      const body = parts[i + 1] ?? ''
      if (!heading) continue
      importedChapters.push(
        buildImportedChapter({
          id: `ch_${now}_${importedChapters.length + 1}`,
          novelId,
          title: heading,
          order: importedChapters.length + 1,
          contentText: body,
        })
      )
    }
  }

  if (!importedChapters.length) {
    importedChapters.push(
      buildImportedChapter({
        id: `ch_${now}_1`,
        novelId,
        title: '第1章 导入正文',
        order: 1,
        contentText: cleanText,
      })
    )
  }

  return {
    ...state,
    currentNovelId: novelId,
    currentChapterId: importedChapters[0].id,
    currentTab: 'editor',
    localNovels: [
      ...(state.localNovels ?? []),
      {
        id: novelId,
        title: cleanTitle,
        summary: input.summary?.trim() || `共导入 ${importedChapters.length} 章。`,
        tags: ['导入', 'TXT'],
      },
    ],
    localChapters: [...(state.localChapters ?? []), ...importedChapters],
    localOutlines: state.localOutlines ?? [],
    localCharacters: state.localCharacters ?? [],
    localCharacterRelations: state.localCharacterRelations ?? [],
    localWorldEntries: state.localWorldEntries ?? [],
    localTimelineEvents: state.localTimelineEvents ?? [],
    trajectories: [
      {
        id: `traj_${now}`,
        chapterId: importedChapters[0].id,
        type: 'note',
        title: `导入小说《${cleanTitle}》`,
        detail: input.summary?.trim() || `共导入 ${importedChapters.length} 章。`,
        createdAt: '刚刚',
      },
      ...(state.trajectories ?? []),
    ],
  }
}

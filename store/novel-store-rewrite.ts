import { buildGenerationContext } from '@/lib/story-knowledge'
import { tm } from '@/lib/i18n/messages'
import {
  countChineseFriendlyWords,
  formatNowLabel,
  getParagraphsFromHtml,
  htmlToPlainText,
  plainTextToHtml,
  uid,
} from '@/lib/utils'
import type { Chapter, RewriteCandidate, RewriteHistoryEntry } from '@/lib/types'
import type { NovelStore, NovelStoreGet, PersistedNovelStoreSet } from '@/store/novel-store-types'

export function getScopeSource(chapter: Chapter, scope: NovelStore['rewriteScope'], selectedParagraphIndex: number | null, selectionText: string) {
  const chapterText = htmlToPlainText(chapter.content)
  if (scope === 'selection' && selectionText.trim()) return selectionText.trim()
  const paragraphs = getParagraphsFromHtml(chapter.content)
  if (scope === 'paragraph' && paragraphs.length) {
    const index = selectedParagraphIndex ?? 0
    return paragraphs[Math.max(0, Math.min(index, paragraphs.length - 1))]
  }
  return chapterText
}

export function createRewriteActions(setPersisted: PersistedNovelStoreSet, get: NovelStoreGet): Pick<NovelStore, 'generateRewriteBatch'> {
  return {
    generateRewriteBatch: async ({ prompt } = {}) => {
      const initial = get()
      const ordered = initial.localChapters.filter((item) => item.novelId === initial.currentNovelId && !item.parentChapterId)
        .slice().sort((a, b) => a.order - b.order)
      const currentIndex = ordered.findIndex((item) => item.id === initial.currentChapterId)
      const needed = new Set([initial.currentChapterId, ...ordered.slice(Math.max(0, currentIndex - 3), currentIndex + 1).map((chapter) => chapter.id)])
      await Promise.all([...needed].filter(Boolean).map((id) => initial.ensureChapterContent(id)))
      const state = get()
      if (state.currentNovelId !== initial.currentNovelId || state.currentChapterId !== initial.currentChapterId) return
      const chapter = state.localChapters.find((item) => item.id === state.currentChapterId)
      if (!chapter) return
      const mergedPrompt = prompt ?? state.promptText
      const source = getScopeSource(chapter, state.rewriteScope, state.selectedParagraphIndex, state.selectionText)
      const currentNovelCharacters = state.localCharacters.filter((item) => item.novelId === state.currentNovelId)
      const currentNovelRelations = state.localCharacterRelations.filter((item) => item.novelId === state.currentNovelId)
      const currentNovelWorldEntries = state.localWorldEntries.filter((item) => item.novelId === state.currentNovelId)
      const currentNovelTimelineEvents = state.localTimelineEvents.filter((item) => item.novelId === state.currentNovelId)
      const currentNovelOutlines = state.localOutlines.filter((item) => item.novelId === state.currentNovelId)
      const generationContext = buildGenerationContext({
        currentChapter: chapter,
        chapters: state.localChapters.filter((item) => item.novelId === state.currentNovelId && !item.parentChapterId),
        selectionText: state.selectionText,
        characters: currentNovelCharacters,
        relations: currentNovelRelations,
        worldEntries: currentNovelWorldEntries,
        timelineEvents: currentNovelTimelineEvents,
        outlines: currentNovelOutlines,
        recentChapterCount: 3,
      })

      try {
        const response = await fetch('/api/rewrite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceText: source,
            mode: state.rewriteMode,
            tone: state.rewriteTone,
            scope: state.rewriteScope,
            prompt: `${mergedPrompt}\n\n${generationContext}`,
            keepCanon: state.keepCanon,
            autoContinue: state.autoContinue,
            thoughtLevel: state.thinkingLevel,
          }),
        })
        const data = await response.json()
        if (!response.ok || data?.ok === false) {
          throw new Error(data?.error || 'Rewrite request failed')
        }
        const batchId = uid('batch')
        const nextCandidates: RewriteCandidate[] = (data.candidates ?? []).map((item: { title: string; summary: string; content: string }, index: number) => ({
          id: uid(`cand${index + 1}`),
          batchId,
          title: item.title,
          summary: `${item.summary}${data.provider ? ` · ${data.provider}` : ''}`,
          content: item.content,
          mode: state.rewriteMode,
          tone: state.rewriteTone,
          selected: index === 0,
          createdAt: formatNowLabel(),
          prompt: mergedPrompt,
          sourceExcerpt: source.slice(0, 120),
          actions: ['apply', 'insert', 'branch', 'continue'],
        }))
        if (!nextCandidates.length) {
          throw new Error(data?.error || 'Rewrite provider returned no candidates')
        }
        const historyEntry: RewriteHistoryEntry = {
          id: uid('hist'),
          batchId,
          chapterId: chapter.id,
          scope: state.rewriteScope,
          sourceExcerpt: source.slice(0, 120),
          mode: state.rewriteMode,
          tone: state.rewriteTone,
          createdAt: formatNowLabel(),
          candidateIds: nextCandidates.map((item) => item.id),
        }
        setPersisted((current) => ({
          currentTab: 'rewrite',
          helperTab: 'trajectory',
          rewriteCandidates: nextCandidates,
          rewriteHistory: [historyEntry, ...current.rewriteHistory],
          trajectories: [{ id: uid('traj'), chapterId: chapter.id, type: 'rewrite', title: tm('store.rewriteGeneratedTitle'), detail: tm('store.rewriteGeneratedDetail', { scope: current.rewriteScope, mode: current.rewriteMode, tone: current.rewriteTone }), createdAt: formatNowLabel() }, ...current.trajectories],
        }))
      } catch (error) {
        setPersisted((current) => current.rewriteCandidates.length ? { rewriteCandidates: [] } : current)
        throw error instanceof Error ? error : new Error('Rewrite request failed')
      }
    },
  }
}

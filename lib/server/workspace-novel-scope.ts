import type { PersistedNovelState } from '@/lib/types'
import { normalizeWorkspaceState } from '@/lib/workspace-state'

function uniqueNovelIds(values: Iterable<string>) {
  return [...new Set(Array.from(values).filter((value) => value.trim().length > 0))]
}

export function resolveWorkspaceNovelId(state: PersistedNovelState) {
  const normalized = normalizeWorkspaceState(state)
  const currentChapter = normalized.localChapters.find((chapter) => chapter.id === normalized.currentChapterId)

  if (currentChapter?.novelId) {
    return currentChapter.novelId
  }

  if (normalized.currentNovelId.trim().length > 0) {
    return normalized.currentNovelId
  }

  if (normalized.localNovels.length === 1) {
    return normalized.localNovels[0]?.id ?? null
  }

  const candidateNovelIds = uniqueNovelIds([
    ...normalized.localNovels.map((novel) => novel.id),
    ...normalized.localChapters.map((chapter) => chapter.novelId),
    ...normalized.localOutlines.map((outline) => outline.novelId),
    ...normalized.localCharacters.map((character) => character.novelId),
    ...normalized.localCharacterRelations.map((relation) => relation.novelId),
    ...normalized.localWorldEntries.map((entry) => entry.novelId),
    ...normalized.localTimelineEvents.map((event) => event.novelId),
  ])

  return candidateNovelIds.length === 1 ? candidateNovelIds[0] : null
}

export function scopeWorkspaceStateToNovel(state: PersistedNovelState, novelId: string) {
  const normalized = normalizeWorkspaceState(state)
  const localNovels = normalized.localNovels.filter((novel) => novel.id === novelId)
  const localChapters = normalized.localChapters.filter((chapter) => chapter.novelId === novelId)
  const chapterIds = new Set(localChapters.map((chapter) => chapter.id))
  const currentChapterBelongsToNovel = chapterIds.has(normalized.currentChapterId)

  return normalizeWorkspaceState({
    ...normalized,
    currentNovelId: localNovels.length > 0 || localChapters.length > 0 ? novelId : '',
    currentChapterId: currentChapterBelongsToNovel ? normalized.currentChapterId : '',
    localNovels,
    localChapters,
    localOutlines: normalized.localOutlines
      .filter((outline) => outline.novelId === novelId)
      .map((outline) => ({
        ...outline,
        relatedChapterIds: outline.relatedChapterIds.filter((chapterId) => chapterIds.has(chapterId)),
      })),
    localCharacters: normalized.localCharacters.filter((character) => character.novelId === novelId),
    localCharacterRelations: normalized.localCharacterRelations
      .filter((relation) => relation.novelId === novelId)
      .map((relation) => ({
        ...relation,
        chapterIds: relation.chapterIds.filter((chapterId) => chapterIds.has(chapterId)),
      })),
    localWorldEntries: normalized.localWorldEntries.filter((entry) => entry.novelId === novelId),
    localTimelineEvents: normalized.localTimelineEvents
      .filter((event) => event.novelId === novelId)
      .map((event) => ({
        ...event,
        chapterIds: event.chapterIds.filter((chapterId) => chapterIds.has(chapterId)),
      })),
    rewriteCandidates: currentChapterBelongsToNovel ? normalized.rewriteCandidates : [],
    rewriteHistory: normalized.rewriteHistory.filter((entry) => chapterIds.has(entry.chapterId)),
    trajectories: normalized.trajectories.filter((entry) => chapterIds.has(entry.chapterId)),
    presetCompatSessionState: currentChapterBelongsToNovel ? normalized.presetCompatSessionState : {},
  })
}

export function parseScopedWorkspacePayload(serializedPayload: string) {
  const parsed = JSON.parse(serializedPayload) as Partial<PersistedNovelState>
  const normalized = normalizeWorkspaceState(parsed)
  const novelId = resolveWorkspaceNovelId(normalized)

  return {
    normalized,
    novelId,
    scoped: novelId ? scopeWorkspaceStateToNovel(normalized, novelId) : normalized,
  }
}

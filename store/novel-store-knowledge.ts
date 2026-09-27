import { tm } from '@/lib/i18n/messages'
import { formatNowLabel, uid } from '@/lib/utils'
import type { Chapter, PersistedNovelState } from '@/lib/types'
import type {
  KnowledgeProjectionPayload,
  KnowledgeProjectionResult,
  NovelStore,
  NovelStoreGet,
  NovelStoreSet,
  PersistedNovelStoreSet,
} from '@/store/novel-store-types'
import { requestClientGet } from '@/lib/client-request-broker'

export function normalizeKnowledgeProjection(data: Partial<KnowledgeProjectionPayload>): KnowledgeProjectionPayload {
  return {
    localOutlines: data.localOutlines ?? [],
    localCharacters: data.localCharacters ?? [],
    localCharacterRelations: data.localCharacterRelations ?? [],
    localWorldEntries: data.localWorldEntries ?? [],
    localTimelineEvents: data.localTimelineEvents ?? [],
  }
}

export function normalizeKnowledgeProjectionResult(data: Partial<KnowledgeProjectionResult>): KnowledgeProjectionResult {
  return {
    ...normalizeKnowledgeProjection(data),
    knowledgeRebuildStatus: data.knowledgeRebuildStatus ?? null,
    hanlpCacheSnapshot: data.hanlpCacheSnapshot ?? null,
    knowledgeStatusOverview: data.knowledgeStatusOverview ?? null,
    jobOutcome: data.jobOutcome ?? null,
    actionError: data.actionError ?? null,
  }
}

export async function fetchKnowledgeProjection(options?: {
  novelId?: string
  asOfChapter?: number
  statusOnly?: boolean
  method?: 'GET' | 'POST'
  action?: 'rebuild' | 'rebuild-retrieval-index' | 'pause' | 'abort' | 'delete-knowledge' | 'delete-hanlp-cache' | 'delete-extraction-cache' | 'delete-embedding-cache'
  chapterRange?: NovelStore['rebuildStoryKnowledge'] extends (novelId?: string, options?: infer T) => Promise<unknown> ? T extends { chapterRange?: infer U } ? U : never : never
  signal?: AbortSignal
}): Promise<KnowledgeProjectionResult> {
  const novelId = options?.novelId
  const asOfChapter = options?.asOfChapter
  const statusOnly = options?.statusOnly === true
  const method = options?.method ?? 'GET'
  const action = options?.action ?? 'rebuild'
  const chapterRange = options?.chapterRange

  if (method === 'POST') {
    const response = await fetch('/api/knowledge-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId, action, ...(chapterRange ? { chapterRange } : {}) }),
    })
    const data = (await response.json()) as Partial<KnowledgeProjectionResult> & { ok?: boolean; error?: string }
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Failed to update knowledge projection')
    }

    return normalizeKnowledgeProjectionResult(data)
  }

  const searchParams = new URLSearchParams()
  if (novelId) searchParams.set('novelId', novelId)
  if (typeof asOfChapter === 'number' && Number.isFinite(asOfChapter) && asOfChapter >= 1) {
    searchParams.set('asOfChapter', String(asOfChapter))
  }
  if (statusOnly) searchParams.set('statusOnly', '1')
  const search = searchParams.size ? `?${searchParams.toString()}` : ''
  return requestClientGet(`/api/knowledge-view${search}`, {
    signal: options?.signal,
    parse: async (response) => {
      const data = (await response.json()) as Partial<KnowledgeProjectionResult> & { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) throw new Error(data.error || 'Failed to load knowledge projection')
      return normalizeKnowledgeProjectionResult(data)
    },
  })
}

export function mergeKnowledgeProjection(state: PersistedNovelState, projection: KnowledgeProjectionPayload, novelId?: string): KnowledgeProjectionPayload {
  if (!novelId) {
    return projection
  }

  return {
    localOutlines: [...state.localOutlines.filter((item) => item.novelId !== novelId), ...projection.localOutlines],
    localCharacters: [...state.localCharacters.filter((item) => item.novelId !== novelId), ...projection.localCharacters],
    localCharacterRelations: [
      ...state.localCharacterRelations.filter((item) => item.novelId !== novelId),
      ...projection.localCharacterRelations,
    ],
    localWorldEntries: [...state.localWorldEntries.filter((item) => item.novelId !== novelId), ...projection.localWorldEntries],
    localTimelineEvents: [...state.localTimelineEvents.filter((item) => item.novelId !== novelId), ...projection.localTimelineEvents],
  }
}

function hasKnowledgeProjectionContent(projection: KnowledgeProjectionPayload) {
  return projection.localOutlines.length > 0
    || projection.localCharacters.length > 0
    || projection.localCharacterRelations.length > 0
    || projection.localWorldEntries.length > 0
    || projection.localTimelineEvents.length > 0
}

export function mergeKnowledgeProjectionPreservingExistingIfEmpty(
  state: PersistedNovelState,
  projection: KnowledgeProjectionPayload,
  novelId?: string,
  preserveExistingIfProjectionEmpty = false
): KnowledgeProjectionPayload {
  if (!novelId) {
    return projection
  }

  if (preserveExistingIfProjectionEmpty && !hasKnowledgeProjectionContent(projection)) {
    return {
      localOutlines: state.localOutlines,
      localCharacters: state.localCharacters,
      localCharacterRelations: state.localCharacterRelations,
      localWorldEntries: state.localWorldEntries,
      localTimelineEvents: state.localTimelineEvents,
    }
  }

  return mergeKnowledgeProjection(state, projection, novelId)
}

function mergeAuthoritativeKnowledgeProjection(
  state: NovelStore,
  projection: KnowledgeProjectionPayload,
  novelId?: string,
  preserveExistingIfProjectionEmpty = false,
) {
  const mergedProjection = mergeKnowledgeProjectionPreservingExistingIfEmpty(
    state,
    projection,
    novelId,
    preserveExistingIfProjectionEmpty,
  )
  const acknowledgedProjection = state.lastAcknowledgedPersistedWorkspace
    && (!novelId || state.revisionNovelId === novelId)
    ? mergeKnowledgeProjectionPreservingExistingIfEmpty(
        state.lastAcknowledgedPersistedWorkspace,
        projection,
        novelId,
        preserveExistingIfProjectionEmpty,
      )
    : null

  return {
    ...mergedProjection,
    ...(acknowledgedProjection && state.lastAcknowledgedPersistedWorkspace
      ? {
          lastAcknowledgedPersistedWorkspace: {
            ...state.lastAcknowledgedPersistedWorkspace,
            ...acknowledgedProjection,
          },
        }
      : {}),
  }
}

export function createKnowledgeActions(set: NovelStoreSet, setPersisted: PersistedNovelStoreSet, get: NovelStoreGet): Pick<NovelStore,
  'rebuildStoryKnowledge'
  | 'rebuildStoryRetrievalIndex'
  | 'pauseStoryKnowledgeRebuild'
  | 'abortStoryKnowledgeRebuild'
  | 'deleteStoryKnowledgeGraph'
  | 'deleteStoryHanlpCache'
  | 'deleteStoryExtractionCache'
  | 'deleteStoryEmbeddingCache'
  | 'refreshKnowledgeProjection'
> {
  const collectMainChapters = (state: NovelStore, targetNovelId?: string) => state.localChapters.filter((chapter) => chapter.novelId === targetNovelId && !chapter.parentChapterId)
  const projectionRequestGenerations = new Map<string | undefined, number>()

  const beginProjectionRequest = (targetNovelId: string | undefined) => {
    const generation = (projectionRequestGenerations.get(targetNovelId) ?? 0) + 1
    projectionRequestGenerations.set(targetNovelId, generation)
    return generation
  }

  const isCurrentProjectionRequest = (targetNovelId: string | undefined, generation: number) => (
    projectionRequestGenerations.get(targetNovelId) === generation
  )

  const applyProjection = (
    targetNovelId: string | undefined,
    result: KnowledgeProjectionResult,
    generation: number,
    preserveExistingIfProjectionEmpty = false
  ) => {
    const projection = normalizeKnowledgeProjection(result)
    set((current) => isCurrentProjectionRequest(targetNovelId, generation)
      ? mergeAuthoritativeKnowledgeProjection(
          current,
          projection,
          targetNovelId,
          preserveExistingIfProjectionEmpty,
        )
      : {})
  }

  return {
    rebuildStoryKnowledge: async (novelId, options) => {
      const state = get()
      const targetNovelId = novelId ?? state.currentNovelId
      const chaptersForNovel = collectMainChapters(state, targetNovelId)
      if (!targetNovelId || !chaptersForNovel.length) return null

      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', chapterRange: options?.chapterRange })
      const projection = normalizeKnowledgeProjection(result)

      set((current) => isCurrentProjectionRequest(targetNovelId, generation)
        ? mergeAuthoritativeKnowledgeProjection(
            current,
            projection,
            targetNovelId,
            result.jobOutcome !== 'completed',
          )
        : {})
      if (result.jobOutcome === 'completed' && isCurrentProjectionRequest(targetNovelId, generation)) {
        setPersisted((current) => ({
          trajectories: [
            {
              id: uid('traj'),
              chapterId: chaptersForNovel[0].id,
              type: 'note',
              title: tm('store.knowledgeRebuildTitle'),
              detail: tm('store.knowledgeRebuildDetail', { title: chaptersForNovel[0].title }),
              createdAt: formatNowLabel(),
            },
            ...current.trajectories,
          ],
        }))
      }

      return result
    },
    rebuildStoryRetrievalIndex: async (novelId, options) => {
      const state = get()
      const targetNovelId = novelId ?? state.currentNovelId
      const chaptersForNovel = collectMainChapters(state, targetNovelId)
      if (!targetNovelId || !chaptersForNovel.length) return null

      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({
        novelId: targetNovelId,
        method: 'POST',
        action: 'rebuild-retrieval-index',
        chapterRange: options?.chapterRange,
      })
      applyProjection(targetNovelId, result, generation, true)
      return result
    },
    pauseStoryKnowledgeRebuild: async (novelId) => {
      const state = get()
      const targetNovelId = novelId ?? state.currentNovelId
      if (!targetNovelId) return null
      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'pause' })
      applyProjection(targetNovelId, result, generation, true)
      return result
    },
    abortStoryKnowledgeRebuild: async (novelId) => {
      const state = get()
      const targetNovelId = novelId ?? state.currentNovelId
      if (!targetNovelId) return null
      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'abort' })
      applyProjection(targetNovelId, result, generation, true)
      return result
    },
    deleteStoryKnowledgeGraph: async (novelId) => {
      const state = get()
      const targetNovelId = novelId ?? state.currentNovelId
      if (!targetNovelId) return null
      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'delete-knowledge' })
      set((current) => isCurrentProjectionRequest(targetNovelId, generation)
        ? mergeAuthoritativeKnowledgeProjection(current, normalizeKnowledgeProjection(result), targetNovelId)
        : {})
      return result
    },
    deleteStoryHanlpCache: async (novelId) => {
      const state = get()
      const targetNovelId = novelId ?? state.currentNovelId
      if (!targetNovelId) return null
      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'delete-hanlp-cache' })
      set((current) => isCurrentProjectionRequest(targetNovelId, generation)
        ? mergeAuthoritativeKnowledgeProjection(current, normalizeKnowledgeProjection(result), targetNovelId)
        : {})
      return result
    },
    deleteStoryExtractionCache: async (novelId) => {
      const state = get()
      const targetNovelId = novelId ?? state.currentNovelId
      if (!targetNovelId) return null
      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'delete-extraction-cache' })
      set((current) => isCurrentProjectionRequest(targetNovelId, generation)
        ? mergeAuthoritativeKnowledgeProjection(current, normalizeKnowledgeProjection(result), targetNovelId)
        : {})
      return result
    },
    deleteStoryEmbeddingCache: async (novelId) => {
      const state = get()
      const targetNovelId = novelId ?? state.currentNovelId
      if (!targetNovelId) return null
      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({ novelId: targetNovelId, method: 'POST', action: 'delete-embedding-cache' })
      set((current) => isCurrentProjectionRequest(targetNovelId, generation)
        ? mergeAuthoritativeKnowledgeProjection(current, normalizeKnowledgeProjection(result), targetNovelId)
        : {})
      return result
    },
    refreshKnowledgeProjection: async (novelId, asOfChapter, signal) => {
      const targetNovelId = novelId ?? get().currentNovelId
      const generation = beginProjectionRequest(targetNovelId)
      const result = await fetchKnowledgeProjection({ novelId: targetNovelId, asOfChapter, method: 'GET', signal })
      set((current) => isCurrentProjectionRequest(targetNovelId, generation)
        ? mergeAuthoritativeKnowledgeProjection(current, normalizeKnowledgeProjection(result), targetNovelId)
        : {})
      return result
    },
  }
}

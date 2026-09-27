import type { AIProvider, KnowledgeRebuildChapterRange } from '@/lib/types'
import { sleep } from '@/lib/server/async-control'
import { embedTextsWithOpenAICompatible } from '@/lib/server/openai-compatible'
import { embedTextsWithOllama } from '@/lib/server/ollama-local'
import {
  garbageCollectRawTextEmbeddingCacheEntries,
  lookupRawTextEmbeddingCacheEntries,
  upsertRawTextEmbeddingCacheEntries,
} from '@/lib/server/retrieval-embedding-cache'
import {
  formatMemoryAwareBatchPlan,
  resolveMemoryAwareEmbeddingBatchPlan,
} from '@/lib/server/memory-aware-batching'

const DEFAULT_EMBEDDING_BATCH_SIZE = 16

export type RawTextEmbeddingPrecomputeSettingsSnapshot = {
  provider: AIProvider
  model: string
  cacheModelIdentity?: string
  embeddingInputMaxCodePoints?: number | null
  embeddingBatchSize: number
}

export type RawTextEmbeddingPrecomputeProgress = {
  totalDocs: number
  completedDocs: number
  cacheHits: number
  cacheMisses: number
  failedDocs: number
  totalBatches: number
  completedBatches: number
  degraded: boolean
}

export type RawTextEmbeddingPrecomputeResult = RawTextEmbeddingPrecomputeProgress & {
  cancelled: boolean
  durationMs: number
}

async function embedTextsForRawTextPrecompute(
  embeddingInputs: string[],
  settingsSnapshot: RawTextEmbeddingPrecomputeSettingsSnapshot,
) {
  const result = settingsSnapshot.provider === 'openai-compatible'
    ? await embedTextsWithOpenAICompatible(embeddingInputs, { model: settingsSnapshot.model })
    : await embedTextsWithOllama(embeddingInputs, { model: settingsSnapshot.model })

  if (!result.enabled || !result.embeddings) {
    throw new Error(result.error || 'Failed to generate raw-text precompute embeddings')
  }

  if (result.embeddings.length !== embeddingInputs.length) {
    throw new Error(`Embedding provider returned ${result.embeddings.length} embeddings for ${embeddingInputs.length} raw-text docs`)
  }

  const dimension = result.embeddings[0]?.length ?? 0
  if (!dimension || result.embeddings.some((vector) => vector.length !== dimension)) {
    throw new Error('Raw-text precompute embedding dimensions are inconsistent within an embedding batch')
  }

  return result.embeddings
}

async function waitForRawTextPrecomputeRetry(delayMs: number, shouldContinue?: () => boolean | Promise<boolean>) {
  if (shouldContinue && !(await shouldContinue())) {
    return false
  }

  await sleep(delayMs)

  if (shouldContinue && !(await shouldContinue())) {
    return false
  }

  return true
}

export async function precomputeRawTextEmbeddingCache<TRow>(params: {
  novelId: string
  branchId: string
  settingsSnapshot: RawTextEmbeddingPrecomputeSettingsSnapshot
  chapterRange?: KnowledgeRebuildChapterRange
  maxConcurrentBatches?: number
  shouldContinue?: () => boolean | Promise<boolean>
  onProgress?: (progress: RawTextEmbeddingPrecomputeProgress) => void | Promise<void>
  healMissingKnowledgeChapterDerivedArtifacts: (params: {
    novelId: string
    branchId: string
    chapterRange?: KnowledgeRebuildChapterRange
  }) => Promise<unknown>
  loadRawTextRetrievalDocs: (novelId: string, branchId: string, chapterRange?: KnowledgeRebuildChapterRange) => TRow[]
  buildRawTextRetrievalEmbeddingInput: (row: TRow) => { text: string; embeddingInputHash: string }
}): Promise<RawTextEmbeddingPrecomputeResult> {
  const startedAt = Date.now()
  const batchPlan = resolveMemoryAwareEmbeddingBatchPlan({
    provider: params.settingsSnapshot.provider,
    model: params.settingsSnapshot.model,
    requestedBatchSize: params.settingsSnapshot.embeddingBatchSize || DEFAULT_EMBEDDING_BATCH_SIZE,
  })
  const requestedConcurrentBatches = Math.max(1, Math.floor(params.maxConcurrentBatches ?? 2))
  const maxConcurrentBatches = Math.min(requestedConcurrentBatches, batchPlan.maxConcurrentBatches)
  if (batchPlan.localWorkload) {
    console.log(`[raw-text-precompute] memory-aware batch plan: ${formatMemoryAwareBatchPlan(batchPlan)}`)
  }
  const cacheScope = {
    novelId: params.novelId,
    branchId: params.branchId,
    provider: params.settingsSnapshot.provider,
    model: params.settingsSnapshot.cacheModelIdentity ?? params.settingsSnapshot.model,
  }
  await params.healMissingKnowledgeChapterDerivedArtifacts({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterRange: params.chapterRange,
  })
  const rawTextDocs = params.loadRawTextRetrievalDocs(params.novelId, params.branchId, params.chapterRange)
  const docsWithInputs = rawTextDocs.map((row) => ({
    row,
    ...params.buildRawTextRetrievalEmbeddingInput(row),
  }))
  const reachableEmbeddingInputHashes = docsWithInputs.map((item) => item.embeddingInputHash)
  const hits = await lookupRawTextEmbeddingCacheEntries({
    scope: cacheScope,
    embeddingInputHashes: reachableEmbeddingInputHashes,
    touchOnHit: true,
  })

  const hitHashes = new Set(hits.map((entry) => entry.embeddingInputHash))
  const hitDocsCount = docsWithInputs.filter((item) => hitHashes.has(item.embeddingInputHash)).length
  const missingDocs = docsWithInputs.filter((item) => !hitHashes.has(item.embeddingInputHash))
  const batchSize = batchPlan.effectiveBatchSize
  const missingBatches = Array.from(
    { length: Math.ceil(missingDocs.length / batchSize) },
    (_, index) => missingDocs.slice(index * batchSize, (index + 1) * batchSize),
  ).filter((batch) => batch.length > 0)

  const progress: RawTextEmbeddingPrecomputeProgress = {
    totalDocs: docsWithInputs.length,
    completedDocs: hitDocsCount,
    cacheHits: hitDocsCount,
    cacheMisses: missingDocs.length,
    failedDocs: 0,
    totalBatches: missingBatches.length,
    completedBatches: 0,
    degraded: false,
  }
  let cancelled = false

  const finalizeReachableCacheSet = async () => {
    if (cancelled || params.chapterRange) {
      return
    }

    await garbageCollectRawTextEmbeddingCacheEntries({
      scope: cacheScope,
      reachableEmbeddingInputHashes,
    })
  }

  await params.onProgress?.({ ...progress })

  if (!missingBatches.length) {
    await finalizeReachableCacheSet()
    return {
      ...progress,
      cancelled: false,
      durationMs: Date.now() - startedAt,
    }
  }

  let nextBatchIndex = 0

  const runBatch = async (batch: typeof missingBatches[number]) => {
    const embeddingInputs = batch.map((item) => item.text)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const embeddings = await embedTextsForRawTextPrecompute(embeddingInputs, params.settingsSnapshot)
        await upsertRawTextEmbeddingCacheEntries({
          scope: cacheScope,
          entries: batch.map((item, index) => ({
            embeddingInput: item.text,
            vector: embeddings[index],
          })),
        })
        progress.completedDocs += batch.length
        return
      } catch {
        if (attempt >= 2) {
          progress.failedDocs += batch.length
          progress.degraded = true
          return
        }

        const shouldRetry = await waitForRawTextPrecomputeRetry(attempt === 0 ? 500 : 1500, params.shouldContinue)
        if (!shouldRetry) {
          cancelled = true
          return
        }
      }
    }
  }

  const worker = async () => {
    while (nextBatchIndex < missingBatches.length) {
      if (params.shouldContinue && !(await params.shouldContinue())) {
        cancelled = true
        return
      }

      const batchIndex = nextBatchIndex
      nextBatchIndex += 1
      const batch = missingBatches[batchIndex]
      await runBatch(batch)
      progress.completedBatches += 1
      await params.onProgress?.({ ...progress })
      if (cancelled) {
        return
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(maxConcurrentBatches, missingBatches.length) }, () => worker()))
  await finalizeReachableCacheSet()

  return {
    ...progress,
    cancelled,
    durationMs: Date.now() - startedAt,
  }
}

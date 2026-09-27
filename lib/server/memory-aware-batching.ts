import os from 'node:os'
import type { AIProvider } from '@/lib/types'
import { getLocalEmbeddingModel } from '@/lib/server/local-embedding-catalog'
import { isCustomLocalEmbeddingModelId } from '@/lib/server/local-embedding-custom-model'

const GIB = 1024 ** 3
const EMBEDDING_WORKING_SET_BYTES_PER_INPUT = 768 * 1024 ** 2

export type MemoryAwareEmbeddingBatchPlan = {
  requestedBatchSize: number
  effectiveBatchSize: number
  maxConcurrentBatches: number
  totalMemoryBytes: number
  localWorkload: boolean
  modelMemoryMaxBytes: number | null
}

function normalizePositiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

function floorPowerOfTwo(value: number) {
  if (value <= 1) return 1
  return 2 ** Math.floor(Math.log2(value))
}

function getSystemBatchCap(totalMemoryBytes: number) {
  if (totalMemoryBytes <= 8 * GIB) return 1
  if (totalMemoryBytes <= 12 * GIB) return 2
  if (totalMemoryBytes <= 16 * GIB) return 4
  if (totalMemoryBytes <= 24 * GIB) return 8
  if (totalMemoryBytes <= 32 * GIB) return 16
  if (totalMemoryBytes <= 64 * GIB) return 32
  return 64
}

function getModelMemoryMaxBytes(modelId: string) {
  return getLocalEmbeddingModel(modelId)?.memoryMaxBytes ?? null
}

function isLocalEmbeddingWorkload(provider: AIProvider, modelId: string) {
  return provider === 'ollama'
    || Boolean(getLocalEmbeddingModel(modelId))
    || isCustomLocalEmbeddingModelId(modelId)
}

export function resolvePhysicalMemoryBytes(explicitBytes?: number) {
  if (typeof explicitBytes === 'number' && Number.isFinite(explicitBytes) && explicitBytes > 0) {
    return Math.floor(explicitBytes)
  }
  const configured = Number.parseInt(process.env.RETALE_PHYSICAL_MEMORY_BYTES?.trim() || '', 10)
  if (Number.isFinite(configured) && configured > 0) {
    return configured
  }
  return os.totalmem()
}

export function resolveMemoryAwareEmbeddingBatchPlan(params: {
  provider: AIProvider
  model: string
  requestedBatchSize: number
  totalMemoryBytes?: number
}): MemoryAwareEmbeddingBatchPlan {
  const requestedBatchSize = normalizePositiveInteger(params.requestedBatchSize, 1)
  const totalMemoryBytes = normalizePositiveInteger(resolvePhysicalMemoryBytes(params.totalMemoryBytes), 8 * GIB)
  const localWorkload = isLocalEmbeddingWorkload(params.provider, params.model)
  const modelMemoryMaxBytes = getModelMemoryMaxBytes(params.model)

  if (!localWorkload) {
    return {
      requestedBatchSize,
      effectiveBatchSize: requestedBatchSize,
      maxConcurrentBatches: 2,
      totalMemoryBytes,
      localWorkload,
      modelMemoryMaxBytes,
    }
  }

  const systemBatchCap = getSystemBatchCap(totalMemoryBytes)
  const systemReserveBytes = Math.max(4 * GIB, Math.floor(totalMemoryBytes * 0.35))
  const workloadBudgetBytes = Math.max(
    EMBEDDING_WORKING_SET_BYTES_PER_INPUT,
    totalMemoryBytes - systemReserveBytes - (modelMemoryMaxBytes ?? 0),
  )
  const modelAwareBatchCap = floorPowerOfTwo(Math.max(
    1,
    Math.floor(workloadBudgetBytes / EMBEDDING_WORKING_SET_BYTES_PER_INPUT),
  ))
  const effectiveBatchSize = Math.min(requestedBatchSize, systemBatchCap, modelAwareBatchCap)

  return {
    requestedBatchSize,
    effectiveBatchSize,
    maxConcurrentBatches: totalMemoryBytes < 32 * GIB ? 1 : 2,
    totalMemoryBytes,
    localWorkload,
    modelMemoryMaxBytes,
  }
}

export function formatMemoryAwareBatchPlan(plan: MemoryAwareEmbeddingBatchPlan) {
  const totalGiB = (plan.totalMemoryBytes / GIB).toFixed(1)
  const modelGiB = plan.modelMemoryMaxBytes === null
    ? 'unknown'
    : (plan.modelMemoryMaxBytes / GIB).toFixed(1)
  return `requested=${plan.requestedBatchSize}, effective=${plan.effectiveBatchSize}, concurrent=${plan.maxConcurrentBatches}, physicalMemory=${totalGiB}GiB, modelMemoryMax=${modelGiB}GiB`
}

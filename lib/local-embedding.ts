export const LOCAL_EMBEDDING_BASE_URL = 'http://127.0.0.1:11435/v1'
export const LOCAL_EMBEDDING_API_KEY = 'retale-local'

export type LocalEmbeddingPhase =
  | 'not-installed'
  | 'downloading-runtime'
  | 'extracting-runtime'
  | 'downloading-model'
  | 'verifying'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'

export type LocalEmbeddingBackend = 'metal' | 'vulkan' | 'cpu'
export type LocalEmbeddingPooling = 'last' | 'cls' | 'mean'
export type LocalEmbeddingModelProfile =
  | 'balanced'
  | 'high-precision'
  | 'multilingual'
  | 'lightweight'
  | 'compact-precision'

export type LocalEmbeddingCatalogModel = {
  id: string
  label: string
  description: string
  family: string
  profile: LocalEmbeddingModelProfile
  quantization: string
  license: string
  downloadBytes: number
  dimension: number
  contextSize: number
  pooling: LocalEmbeddingPooling
  normalization: 'l2'
  memoryMinBytes: number
  memoryMaxBytes: number
  diskEstimateBytes: number
  recommended: boolean
}

export type LocalEmbeddingProgress = {
  artifact: 'runtime' | 'model'
  downloadedBytes: number
  totalBytes: number
  percent: number
}

export type LocalEmbeddingRuntimeStatus = {
  ok: true
  supported: boolean
  installed: boolean
  configured: boolean
  running: boolean
  phase: LocalEmbeddingPhase
  selectedModelId: string | null
  backend: LocalEmbeddingBackend
  acceleratorLabel: string
  platformLabel: string
  runtimeVersion: string
  runtimeDownloadBytes: number
  progress: LocalEmbeddingProgress | null
  error: string | null
  models: LocalEmbeddingCatalogModel[]
  connection: {
    baseUrl: string
    apiKey: string
    model: string | null
  }
}

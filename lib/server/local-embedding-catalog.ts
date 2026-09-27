import path from 'node:path'
import type { LocalEmbeddingBackend, LocalEmbeddingCatalogModel } from '@/lib/local-embedding'
import { LOCAL_EMBEDDING_BASE_URL } from '@/lib/local-embedding'
import { isCustomLocalEmbeddingModelId } from '@/lib/server/local-embedding-custom-model'

export const LLAMA_CPP_RUNTIME_VERSION = 'b10705'

export type LocalEmbeddingModelDefinition = LocalEmbeddingCatalogModel & {
  repository: string
  fileName: string
  downloadUrls: readonly string[]
  sha256: string
  queryInstruction: string | null
  queryRecipe: 'qwen3-retrieval-v1' | 'plain-v1'
}

export type LlamaCppRuntimeArtifact = {
  id: string
  platform: NodeJS.Platform
  arch: string
  backend: LocalEmbeddingBackend
  archiveType: 'tar.gz' | 'zip'
  fileName: string
  downloadUrl: string
  sha256: string
  downloadBytes: number
  executableName: string
}

const QWEN3_EMBEDDING_06B_Q8: LocalEmbeddingModelDefinition = {
  id: 'qwen3-embedding-0.6b-q8_0',
  label: 'Qwen3 Embedding 0.6B · Q8_0',
  description: '轻量备选。中英文检索表现均衡，适合内存较小或主要使用 CPU 的设备。',
  family: 'Qwen3 Embedding 0.6B',
  profile: 'lightweight',
  quantization: 'Q8_0',
  license: 'Apache 2.0',
  repository: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
  fileName: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
  downloadUrls: huggingFaceDownloadUrls('Qwen/Qwen3-Embedding-0.6B-GGUF', 'Qwen3-Embedding-0.6B-Q8_0.gguf'),
  sha256: '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439',
  downloadBytes: 639_150_592,
  dimension: 1024,
  contextSize: 1024,
  pooling: 'last',
  normalization: 'l2',
  memoryMinBytes: 800_000_000,
  memoryMaxBytes: 1_500_000_000,
  diskEstimateBytes: 850_000_000,
  recommended: false,
  queryInstruction: 'Given a query about a novel, retrieve passages, entities, events, and relationships relevant to the query',
  queryRecipe: 'qwen3-retrieval-v1',
}

const QWEN3_EMBEDDING_06B_F16: LocalEmbeddingModelDefinition = {
  ...QWEN3_EMBEDDING_06B_Q8,
  id: 'qwen3-embedding-0.6b-f16',
  label: 'Qwen3 Embedding 0.6B · F16',
  description: '保留的 0.6B 完整精度版本，兼容已有安装；同等资源下更推荐 4B Q4_K_M。',
  profile: 'compact-precision',
  quantization: 'F16',
  fileName: 'Qwen3-Embedding-0.6B-f16.gguf',
  downloadUrls: huggingFaceDownloadUrls('Qwen/Qwen3-Embedding-0.6B-GGUF', 'Qwen3-Embedding-0.6B-f16.gguf'),
  sha256: '421a27e58d165478cc7acb984a688c2aa41404968b0203e7cd743ece44c54340',
  downloadBytes: 1_197_629_632,
  memoryMinBytes: 1_400_000_000,
  memoryMaxBytes: 2_400_000_000,
  diskEstimateBytes: 1_450_000_000,
  recommended: false,
}

const QWEN3_EMBEDDING_4B_Q4_K_M: LocalEmbeddingModelDefinition = {
  id: 'qwen3-embedding-4b-q4_k_m',
  label: 'Qwen3 Embedding 4B · Q4_K_M',
  description: '默认推荐。适合 16 GB 消费级设备，在中英文小说检索质量、速度和资源占用之间较均衡。',
  family: 'Qwen3 Embedding 4B',
  profile: 'balanced',
  quantization: 'Q4_K_M',
  license: 'Apache 2.0',
  repository: 'Qwen/Qwen3-Embedding-4B-GGUF',
  fileName: 'Qwen3-Embedding-4B-Q4_K_M.gguf',
  downloadUrls: huggingFaceDownloadUrls('Qwen/Qwen3-Embedding-4B-GGUF', 'Qwen3-Embedding-4B-Q4_K_M.gguf'),
  sha256: '2b0cf8f17b4c723c27303015383c27ec4bf2d8314bb677d05e920dd70bb0f16b',
  downloadBytes: 2_496_703_776,
  dimension: 2560,
  contextSize: 2048,
  pooling: 'last',
  normalization: 'l2',
  memoryMinBytes: 3_500_000_000,
  memoryMaxBytes: 6_500_000_000,
  diskEstimateBytes: 2_800_000_000,
  recommended: true,
  queryInstruction: 'Given a query about a novel, retrieve passages, entities, events, and relationships relevant to the query',
  queryRecipe: 'qwen3-retrieval-v1',
}

const QWEN3_EMBEDDING_8B_Q4_K_M: LocalEmbeddingModelDefinition = {
  ...QWEN3_EMBEDDING_4B_Q4_K_M,
  id: 'qwen3-embedding-8b-q4_k_m',
  label: 'Qwen3 Embedding 8B · Q4_K_M',
  description: '质量优先。Qwen3 Embedding 系列的大模型档，适合更重视复杂人物、事件和长文语义检索的设备。',
  family: 'Qwen3 Embedding 8B',
  profile: 'high-precision',
  repository: 'Qwen/Qwen3-Embedding-8B-GGUF',
  fileName: 'Qwen3-Embedding-8B-Q4_K_M.gguf',
  downloadUrls: huggingFaceDownloadUrls('Qwen/Qwen3-Embedding-8B-GGUF', 'Qwen3-Embedding-8B-Q4_K_M.gguf'),
  sha256: '3fcd3febec8b3fd64435204db75bf0dd73b91e8d0661e0331acfe7e7c3120b85',
  downloadBytes: 4_676_804_928,
  dimension: 4096,
  memoryMinBytes: 6_000_000_000,
  memoryMaxBytes: 10_000_000_000,
  diskEstimateBytes: 5_100_000_000,
  recommended: false,
}

const BGE_M3_Q8_0: LocalEmbeddingModelDefinition = {
  id: 'bge-m3-q8_0',
  label: 'BGE-M3 · Q8_0',
  description: '热门多语种长文本模型，支持 100 多种语言；无需查询 instruction，适合作为 Qwen 之外的稳健备选。',
  family: 'BGE-M3',
  profile: 'multilingual',
  quantization: 'Q8_0',
  license: 'MIT',
  repository: 'ggml-org/bge-m3-Q8_0-GGUF',
  fileName: 'bge-m3-q8_0.gguf',
  downloadUrls: huggingFaceDownloadUrls('ggml-org/bge-m3-Q8_0-GGUF', 'bge-m3-q8_0.gguf'),
  sha256: 'aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173',
  downloadBytes: 634_553_760,
  dimension: 1024,
  contextSize: 4096,
  pooling: 'cls',
  normalization: 'l2',
  memoryMinBytes: 1_000_000_000,
  memoryMaxBytes: 2_500_000_000,
  diskEstimateBytes: 850_000_000,
  recommended: false,
  queryInstruction: null,
  queryRecipe: 'plain-v1',
}

const LOCAL_EMBEDDING_MODELS = [
  QWEN3_EMBEDDING_4B_Q4_K_M,
  QWEN3_EMBEDDING_8B_Q4_K_M,
  BGE_M3_Q8_0,
  QWEN3_EMBEDDING_06B_Q8,
  QWEN3_EMBEDDING_06B_F16,
] as const

const RELEASE_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_RUNTIME_VERSION}`

function huggingFaceDownloadUrls(repository: string, fileName: string) {
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/')
  const encodedFileName = encodeURIComponent(fileName)
  const suffix = `${encodedRepository}/resolve/main/${encodedFileName}?download=true`
  return [
    `https://huggingface.co/${suffix}`,
    `https://hf-mirror.com/${suffix}`,
  ] as const
}

const RUNTIME_ARTIFACTS: LlamaCppRuntimeArtifact[] = [
  runtimeArtifact('macos-arm64', 'darwin', 'arm64', 'metal', 'tar.gz', 'llama-b10705-bin-macos-arm64.tar.gz', 'c91e26ec5c5357dfe55f7d2c3b58f9b390244ac0f8c32d87d73c790f8c20bc87', 11_042_155),
  runtimeArtifact('macos-x64', 'darwin', 'x64', 'metal', 'tar.gz', 'llama-b10705-bin-macos-x64.tar.gz', '5ac6716a40a2ecea28ce7405f54161e025b8e7555a189f139dbeb8cd2b0c0b4c', 11_112_798),
  runtimeArtifact('linux-vulkan-arm64', 'linux', 'arm64', 'vulkan', 'tar.gz', 'llama-b10705-bin-ubuntu-vulkan-arm64.tar.gz', '86805e7c33cbc7433be91e97c612f4c86d87580aaeb97d56ecf59da403a8ac48', 27_300_378),
  runtimeArtifact('linux-vulkan-x64', 'linux', 'x64', 'vulkan', 'tar.gz', 'llama-b10705-bin-ubuntu-vulkan-x64.tar.gz', 'b7c484440024dceaa9f53c4d1e5c0c918476a975c1f898939c1915d2efb6e068', 33_478_848),
  runtimeArtifact('linux-cpu-arm64', 'linux', 'arm64', 'cpu', 'tar.gz', 'llama-b10705-bin-ubuntu-arm64.tar.gz', '6f2c96177fbf39ae3be16211a2c3cbe5476fd8b8345a2316437350ff1e3424c4', 13_163_005),
  runtimeArtifact('linux-cpu-x64', 'linux', 'x64', 'cpu', 'tar.gz', 'llama-b10705-bin-ubuntu-x64.tar.gz', '12fa9a50893f7082c8f6f6d5f76506bbe602b67578a917fd80542a168ac3b0a8', 16_417_793),
  runtimeArtifact('windows-vulkan-x64', 'win32', 'x64', 'vulkan', 'zip', 'llama-b10705-bin-win-vulkan-x64.zip', '7e437f65cd4997141a7ed06291f59f1a0e928588e25c95fb7fac5f4742c05ce0', 34_917_988),
  runtimeArtifact('windows-cpu-x64', 'win32', 'x64', 'cpu', 'zip', 'llama-b10705-bin-win-cpu-x64.zip', '2936e7e033a56dc8e17816234ea82979cc92f144eacadd1cee31f3b42e6b8077', 18_147_056),
  runtimeArtifact('windows-cpu-arm64', 'win32', 'arm64', 'cpu', 'zip', 'llama-b10705-bin-win-cpu-arm64.zip', 'b823e78777eef493b89bd0c3f6bced5e4b5d8724629fde572fcaf978db49f102', 11_918_255),
]

function runtimeArtifact(
  id: string,
  platform: NodeJS.Platform,
  arch: string,
  backend: LocalEmbeddingBackend,
  archiveType: 'tar.gz' | 'zip',
  fileName: string,
  sha256: string,
  downloadBytes: number,
): LlamaCppRuntimeArtifact {
  return {
    id,
    platform,
    arch,
    backend,
    archiveType,
    fileName,
    downloadUrl: `${RELEASE_BASE}/${fileName}`,
    sha256,
    downloadBytes,
    executableName: platform === 'win32' ? 'llama-server.exe' : 'llama-server',
  }
}

export function listPublicLocalEmbeddingModels(): LocalEmbeddingCatalogModel[] {
  return LOCAL_EMBEDDING_MODELS.map((model) => ({
    id: model.id,
    label: model.label,
    description: model.description,
    family: model.family,
    profile: model.profile,
    quantization: model.quantization,
    license: model.license,
    downloadBytes: model.downloadBytes,
    dimension: model.dimension,
    contextSize: model.contextSize,
    pooling: model.pooling,
    normalization: model.normalization,
    memoryMinBytes: model.memoryMinBytes,
    memoryMaxBytes: model.memoryMaxBytes,
    diskEstimateBytes: model.diskEstimateBytes,
    recommended: model.recommended,
  }))
}

export function getLocalEmbeddingModel(modelId: string) {
  return LOCAL_EMBEDDING_MODELS.find((model) => model.id === modelId) ?? null
}

export function getDefaultLocalEmbeddingModel() {
  return QWEN3_EMBEDDING_4B_Q4_K_M
}

export function getLlamaCppRuntimeArtifact(params: {
  platform?: NodeJS.Platform
  arch?: string
  backend: LocalEmbeddingBackend
}) {
  const platform = params.platform ?? process.platform
  const arch = params.arch ?? process.arch
  return RUNTIME_ARTIFACTS.find((artifact) => (
    artifact.platform === platform
    && artifact.arch === arch
    && artifact.backend === params.backend
  )) ?? null
}

export function getLlamaCppRuntimeArtifactById(artifactId: string) {
  return RUNTIME_ARTIFACTS.find((artifact) => artifact.id === artifactId) ?? null
}

export function getSupportedRuntimeBackends(platform: NodeJS.Platform = process.platform, arch: string = process.arch) {
  return RUNTIME_ARTIFACTS
    .filter((artifact) => artifact.platform === platform && artifact.arch === arch)
    .map((artifact) => artifact.backend)
}

export function buildLocalEmbeddingQuery(modelId: string, query: string) {
  const model = getLocalEmbeddingModel(modelId)
  const normalized = query.trim()
  if (!model?.queryInstruction || !normalized) return normalized
  return `Instruct: ${model.queryInstruction}\nQuery: ${normalized}`
}

export function buildLocalEmbeddingCacheIdentity(modelId: string) {
  const model = getLocalEmbeddingModel(modelId)
  if (!model) return modelId
  return [
    model.id,
    `sha256:${model.sha256}`,
    `dim:${model.dimension}`,
    `pool:${model.pooling}`,
    `norm:${model.normalization}`,
    `query:${model.queryRecipe}`,
  ].join('|')
}

export function isRetaleLocalEmbeddingConfig(baseUrl: string, modelId: string) {
  const normalize = (value: string) => value.trim().replace(/\/+$/u, '')
  return normalize(baseUrl) === normalize(LOCAL_EMBEDDING_BASE_URL)
    && (Boolean(getLocalEmbeddingModel(modelId)) || isCustomLocalEmbeddingModelId(modelId))
}

export function assertSafeCatalogFileName(fileName: string) {
  if (!fileName || fileName !== path.basename(fileName) || fileName === '.' || fileName === '..') {
    throw new Error('Local embedding catalog contains an unsafe file name')
  }
  return fileName
}

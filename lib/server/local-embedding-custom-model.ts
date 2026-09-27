import { randomBytes } from 'node:crypto'

export const CUSTOM_LOCAL_EMBEDDING_MODEL_MAX_BYTES = 8_000_000_000
export const CUSTOM_LOCAL_EMBEDDING_MODEL_ID_PATTERN = /^hf-embedding-[a-f0-9]{16}$/u

export type HuggingFaceCustomModelReference = {
  repository: string
  fileName: string
}

export type CustomLocalEmbeddingModelDefinition = HuggingFaceCustomModelReference & {
  id: string
  label: string
  localFileName: string
  downloadUrls: readonly string[]
  contextSize: number
  pooling: null
  normalization: 'l2'
}

const REPOSITORY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u
const HUGGING_FACE_DOWNLOAD_HOSTS = new Set(['huggingface.co', 'hf-mirror.com'])

function encodeHuggingFacePath(value: string) {
  return value.split('/').map(encodeURIComponent).join('/')
}

export function normalizeHuggingFaceCustomModelReference(
  reference: HuggingFaceCustomModelReference,
): HuggingFaceCustomModelReference {
  const repository = reference.repository.trim()
  const fileName = reference.fileName.trim()
  const repositorySegments = repository.split('/')

  if (
    repository.length > 193
    || repositorySegments.length !== 2
    || repositorySegments.some((segment) => !REPOSITORY_SEGMENT_PATTERN.test(segment))
  ) {
    throw new Error('repository must use the Hugging Face owner/model format')
  }
  if (
    !fileName
    || fileName.length > 512
    || !fileName.toLowerCase().endsWith('.gguf')
    || fileName.includes('\\')
    || fileName.includes('?')
    || fileName.includes('#')
    || /[\u0000-\u001f\u007f]/u.test(fileName)
  ) {
    throw new Error('fileName must be a safe .gguf path inside the selected repository')
  }

  const fileSegments = fileName.split('/')
  if (
    fileSegments.some((segment) => !segment || segment === '.' || segment === '..' || segment.length > 255)
  ) {
    throw new Error('fileName must be a safe .gguf path inside the selected repository')
  }

  return { repository, fileName }
}

export function buildHuggingFaceCustomModelDownloadUrls(reference: HuggingFaceCustomModelReference) {
  const normalized = normalizeHuggingFaceCustomModelReference(reference)
  const suffix = `${encodeHuggingFacePath(normalized.repository)}/resolve/main/${encodeHuggingFacePath(normalized.fileName)}?download=true`
  return [
    `https://huggingface.co/${suffix}`,
    `https://hf-mirror.com/${suffix}`,
  ] as const
}

export function assertAllowedHuggingFaceDownloadUrl(downloadUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(downloadUrl)
  } catch {
    throw new Error('Custom model download source is invalid')
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.port
    || !HUGGING_FACE_DOWNLOAD_HOSTS.has(parsed.hostname)
  ) {
    throw new Error('Custom models may only be downloaded from huggingface.co or hf-mirror.com')
  }
  return downloadUrl
}

export function isCustomLocalEmbeddingModelId(modelId: string) {
  return CUSTOM_LOCAL_EMBEDDING_MODEL_ID_PATTERN.test(modelId.trim())
}

function buildCustomLocalEmbeddingModel(
  modelId: string,
  reference: HuggingFaceCustomModelReference,
): CustomLocalEmbeddingModelDefinition {
  if (!isCustomLocalEmbeddingModelId(modelId)) throw new Error('Invalid custom local embedding model ID')
  const normalized = normalizeHuggingFaceCustomModelReference(reference)
  return {
    ...normalized,
    id: modelId,
    label: `${normalized.repository}/${normalized.fileName}`,
    localFileName: `${modelId}.gguf`,
    downloadUrls: buildHuggingFaceCustomModelDownloadUrls(normalized),
    contextSize: 1024,
    pooling: null,
    normalization: 'l2',
  }
}

export function createCustomLocalEmbeddingModel(reference: HuggingFaceCustomModelReference) {
  return buildCustomLocalEmbeddingModel(`hf-embedding-${randomBytes(8).toString('hex')}`, reference)
}

export function restoreCustomLocalEmbeddingModel(
  modelId: string,
  reference: HuggingFaceCustomModelReference,
) {
  return buildCustomLocalEmbeddingModel(modelId, reference)
}

import { setTimeout as sleep } from 'node:timers/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs, { promises as fsPromises } from 'node:fs'
import path from 'node:path'
import type {
  LocalEmbeddingBackend,
  LocalEmbeddingPhase,
  LocalEmbeddingPooling,
  LocalEmbeddingProgress,
  LocalEmbeddingRuntimeStatus,
} from '@/lib/local-embedding'
import { LOCAL_EMBEDDING_API_KEY, LOCAL_EMBEDDING_BASE_URL } from '@/lib/local-embedding'
import { resolvePhysicalMemoryBytes } from '@/lib/server/memory-aware-batching'
import { loadStoredAISettings, saveStoredAISettings } from '@/lib/server/ai-settings'
import { getDataRootPath } from '@/lib/server/db-resolver'
import {
  assertAllowedHuggingFaceDownloadUrl,
  createCustomLocalEmbeddingModel,
  CUSTOM_LOCAL_EMBEDDING_MODEL_MAX_BYTES,
  normalizeHuggingFaceCustomModelReference,
  restoreCustomLocalEmbeddingModel,
  type CustomLocalEmbeddingModelDefinition,
  type HuggingFaceCustomModelReference,
} from '@/lib/server/local-embedding-custom-model'
import {
  assertSafeCatalogFileName,
  getDefaultLocalEmbeddingModel,
  getLlamaCppRuntimeArtifact,
  getLlamaCppRuntimeArtifactById,
  getLocalEmbeddingModel,
  getSupportedRuntimeBackends,
  isRetaleLocalEmbeddingConfig,
  LLAMA_CPP_RUNTIME_VERSION,
  listPublicLocalEmbeddingModels,
  type LlamaCppRuntimeArtifact,
  type LocalEmbeddingModelDefinition,
} from '@/lib/server/local-embedding-catalog'

type InstallationManifest = {
  version: 1
  modelId: string
  modelSha256: string | null
  customModel: HuggingFaceCustomModelReference | null
  runtimeVersion: string
  runtimeArtifactId: string
  launchBackend: LocalEmbeddingBackend
  installedAt: string
}

type RuntimeLocalEmbeddingModel = {
  id: string
  label: string
  localFileName: string
  contextSize: number
  pooling: LocalEmbeddingPooling | null
  normalization: 'l2'
}

type InstallableLocalEmbeddingModel = RuntimeLocalEmbeddingModel & {
  downloadUrls: readonly string[]
  expectedBytes: number | null
  sha256: string | null
}

type MutableRuntimeState = {
  phase: LocalEmbeddingPhase
  selectedModelId: string | null
  backend: LocalEmbeddingBackend
  progress: LocalEmbeddingProgress | null
  error: string | null
}

type LocalEmbeddingRuntimeGlobal = {
  state: MutableRuntimeState
  child: ChildProcess | null
  installPromise: Promise<void> | null
  startPromise: Promise<void> | null
  logTail: string[]
  cleanupRegistered: boolean
}

const globalForLocalEmbedding = globalThis as typeof globalThis & {
  __retaleLocalEmbeddingRuntime?: LocalEmbeddingRuntimeGlobal
}

const HEALTH_URL = LOCAL_EMBEDDING_BASE_URL.replace(/\/v1\/?$/u, '/health')
const MODELS_URL = `${LOCAL_EMBEDDING_BASE_URL.replace(/\/$/u, '')}/models`
const STARTUP_TIMEOUT_MS = 60_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
const MAX_LOG_LINES = 80

function createRuntimeGlobal(): LocalEmbeddingRuntimeGlobal {
  return {
    state: {
      phase: 'not-installed',
      selectedModelId: null,
      backend: detectPreferredLocalEmbeddingBackend(),
      progress: null,
      error: null,
    },
    child: null,
    installPromise: null,
    startPromise: null,
    logTail: [],
    cleanupRegistered: false,
  }
}

function getRuntimeGlobal() {
  if (!globalForLocalEmbedding.__retaleLocalEmbeddingRuntime) {
    globalForLocalEmbedding.__retaleLocalEmbeddingRuntime = createRuntimeGlobal()
  }
  return globalForLocalEmbedding.__retaleLocalEmbeddingRuntime
}

function getLocalEmbeddingRootPath() {
  return path.join(getDataRootPath(), 'local-embedding')
}

function toInstallableCatalogModel(model: LocalEmbeddingModelDefinition): InstallableLocalEmbeddingModel {
  return {
    id: model.id,
    label: model.label,
    localFileName: model.fileName,
    contextSize: model.contextSize,
    pooling: model.pooling,
    normalization: model.normalization,
    downloadUrls: model.downloadUrls,
    expectedBytes: model.downloadBytes,
    sha256: model.sha256,
  }
}

function toInstallableCustomModel(model: CustomLocalEmbeddingModelDefinition): InstallableLocalEmbeddingModel {
  return {
    ...model,
    expectedBytes: null,
    sha256: null,
  }
}

function assertContainedPath(rootPath: string, candidatePath: string, label: string) {
  const relative = path.relative(rootPath, candidatePath)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return candidatePath
  }
  throw new Error(`${label} resolves outside the local embedding data directory`)
}

function resolveLocalEmbeddingPathsForModel(model: RuntimeLocalEmbeddingModel, runtimeArtifactId: string) {
  const artifact = getLlamaCppRuntimeArtifactById(runtimeArtifactId)
  if (!artifact) throw new Error('Unsupported llama.cpp runtime artifact')

  const rootPath = path.resolve(getLocalEmbeddingRootPath())
  const downloadsPath = path.join(rootPath, 'downloads')
  const modelsPath = path.join(rootPath, 'models')
  const runtimesPath = path.join(rootPath, 'runtimes', LLAMA_CPP_RUNTIME_VERSION)
  const runtimePath = path.join(runtimesPath, artifact.id)
  const modelPath = path.join(modelsPath, assertSafeCatalogFileName(model.localFileName))
  const runtimeArchivePath = path.join(downloadsPath, assertSafeCatalogFileName(artifact.fileName))

  for (const [label, candidate] of [
    ['Download directory', downloadsPath],
    ['Model directory', modelsPath],
    ['Runtime directory', runtimePath],
    ['Model path', modelPath],
    ['Runtime archive path', runtimeArchivePath],
  ] as const) {
    assertContainedPath(rootPath, path.resolve(candidate), label)
  }

  return {
    rootPath,
    downloadsPath,
    modelsPath,
    runtimesPath,
    runtimePath,
    modelPath,
    runtimeArchivePath,
    runtimeExecutablePath: path.join(runtimePath, artifact.executableName),
    manifestPath: path.join(rootPath, 'installation.json'),
  }
}

export function resolveLocalEmbeddingPaths(modelId: string, runtimeArtifactId: string) {
  const model = getLocalEmbeddingModel(modelId)
  if (!model) throw new Error('Unknown local embedding model')
  return resolveLocalEmbeddingPathsForModel(toInstallableCatalogModel(model), runtimeArtifactId)
}

function pathExists(candidatePath: string) {
  try {
    fs.accessSync(candidatePath)
    return true
  } catch {
    return false
  }
}

function detectVulkanSupport(platform: NodeJS.Platform, arch: string) {
  if (process.env.RETALE_LOCAL_EMBEDDING_FORCE_GPU === '1') return true
  if (process.env.RETALE_LOCAL_EMBEDDING_FORCE_CPU === '1') return false

  if (platform === 'linux') {
    const hasDevice = pathExists('/dev/dri') || pathExists('/dev/nvidia0')
    const libraryCandidates = arch === 'arm64'
      ? ['/usr/lib/aarch64-linux-gnu/libvulkan.so.1', '/usr/lib64/libvulkan.so.1', '/usr/lib/libvulkan.so.1']
      : ['/usr/lib/x86_64-linux-gnu/libvulkan.so.1', '/usr/lib64/libvulkan.so.1', '/usr/lib/libvulkan.so.1']
    return hasDevice && libraryCandidates.some(pathExists)
  }

  if (platform === 'win32') {
    const systemRoot = process.env.SystemRoot?.trim() || 'C:\\Windows'
    return pathExists(path.join(systemRoot, 'System32', 'vulkan-1.dll'))
  }

  return false
}

export function detectPreferredLocalEmbeddingBackend(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): LocalEmbeddingBackend {
  const backends = getSupportedRuntimeBackends(platform, arch)
  if (process.env.RETALE_LOCAL_EMBEDDING_FORCE_CPU !== '1' && platform === 'darwin' && backends.includes('metal')) {
    return 'metal'
  }
  if (backends.includes('vulkan') && detectVulkanSupport(platform, arch)) {
    return 'vulkan'
  }
  return 'cpu'
}

export function buildLocalEmbeddingLaunchAttempts(preferredBackend: LocalEmbeddingBackend) {
  if (preferredBackend === 'cpu') {
    return [{ backend: 'cpu' as const, gpuLayers: 0, useCpuRuntime: false }]
  }
  return [
    { backend: preferredBackend, gpuLayers: 999, useCpuRuntime: false },
    { backend: 'cpu' as const, gpuLayers: 0, useCpuRuntime: false },
    ...(preferredBackend === 'vulkan'
      ? [{ backend: 'cpu' as const, gpuLayers: 0, useCpuRuntime: true }]
      : []),
  ]
}

function getPreferredRuntimeArtifact() {
  const backend = detectPreferredLocalEmbeddingBackend()
  return getLlamaCppRuntimeArtifact({ backend })
    ?? getLlamaCppRuntimeArtifact({ backend: 'cpu' })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getManifestModel(manifest: InstallationManifest): RuntimeLocalEmbeddingModel | null {
  if (manifest.customModel) {
    try {
      return restoreCustomLocalEmbeddingModel(manifest.modelId, manifest.customModel)
    } catch {
      return null
    }
  }
  const model = getLocalEmbeddingModel(manifest.modelId)
  return model ? toInstallableCatalogModel(model) : null
}

function readInstallationManifest(): InstallationManifest | null {
  const defaultModel = getDefaultLocalEmbeddingModel()
  const artifact = getPreferredRuntimeArtifact()
  if (!artifact) return null
  const { manifestPath } = resolveLocalEmbeddingPaths(defaultModel.id, artifact.id)
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
    if (!isRecord(parsed)) return null
    if (
      parsed.version !== 1
      || typeof parsed.modelId !== 'string'
      || parsed.runtimeVersion !== LLAMA_CPP_RUNTIME_VERSION
      || typeof parsed.runtimeArtifactId !== 'string'
      || (parsed.launchBackend !== 'metal' && parsed.launchBackend !== 'vulkan' && parsed.launchBackend !== 'cpu')
      || typeof parsed.installedAt !== 'string'
    ) {
      return null
    }

    let customModel: HuggingFaceCustomModelReference | null = null
    if (parsed.customModel !== undefined && parsed.customModel !== null) {
      if (
        !isRecord(parsed.customModel)
        || typeof parsed.customModel.repository !== 'string'
        || typeof parsed.customModel.fileName !== 'string'
      ) return null
      try {
        customModel = normalizeHuggingFaceCustomModelReference({
          repository: parsed.customModel.repository,
          fileName: parsed.customModel.fileName,
        })
      } catch {
        return null
      }
    }

    const catalogModel = customModel ? null : getLocalEmbeddingModel(parsed.modelId)
    const model = customModel
      ? restoreCustomLocalEmbeddingModel(parsed.modelId, customModel)
      : catalogModel
    const runtimeArtifact = getLlamaCppRuntimeArtifactById(parsed.runtimeArtifactId)
    if (
      !model
      || !runtimeArtifact
      || (customModel ? parsed.modelSha256 !== null : catalogModel?.sha256 !== parsed.modelSha256)
      || runtimeArtifact.platform !== process.platform
      || runtimeArtifact.arch !== process.arch
    ) return null
    return {
      version: 1,
      modelId: parsed.modelId,
      modelSha256: customModel ? null : parsed.modelSha256 as string,
      customModel,
      runtimeVersion: LLAMA_CPP_RUNTIME_VERSION,
      runtimeArtifactId: parsed.runtimeArtifactId,
      launchBackend: parsed.launchBackend,
      installedAt: parsed.installedAt,
    }
  } catch {
    return null
  }
}

function installationIsPresent(manifest: InstallationManifest | null) {
  if (!manifest) return false
  try {
    const model = getManifestModel(manifest)
    if (!model) return false
    const paths = resolveLocalEmbeddingPathsForModel(model, manifest.runtimeArtifactId)
    return pathExists(paths.modelPath) && pathExists(paths.runtimeExecutablePath)
  } catch {
    return false
  }
}

function getPlatformLabel() {
  const archLabel = process.arch === 'arm64' ? 'ARM64' : process.arch === 'x64' ? 'x64' : process.arch
  if (process.platform === 'darwin') return `macOS · ${archLabel}`
  if (process.platform === 'win32') return `Windows · ${archLabel}`
  if (process.platform === 'linux') return `Linux / Docker · ${archLabel}`
  return `${process.platform} · ${archLabel}`
}

function getAcceleratorLabel(backend: LocalEmbeddingBackend) {
  if (backend === 'metal') return 'Apple Metal（失败时自动回退 CPU）'
  if (backend === 'vulkan') return 'Vulkan GPU（失败时自动回退 CPU）'
  return 'CPU'
}

function setState(patch: Partial<MutableRuntimeState>) {
  const runtime = getRuntimeGlobal()
  runtime.state = { ...runtime.state, ...patch }
}

function appendLog(chunk: unknown) {
  const runtime = getRuntimeGlobal()
  const lines = String(chunk).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  runtime.logTail.push(...lines)
  if (runtime.logTail.length > MAX_LOG_LINES) {
    runtime.logTail.splice(0, runtime.logTail.length - MAX_LOG_LINES)
  }
}

function getLogError(fallback: string) {
  const tail = getRuntimeGlobal().logTail.slice(-8).join(' | ')
  return tail ? `${fallback}: ${tail}` : fallback
}

function calculateProgress(artifact: 'runtime' | 'model', downloadedBytes: number, totalBytes: number): LocalEmbeddingProgress {
  return {
    artifact,
    downloadedBytes,
    totalBytes,
    percent: totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0,
  }
}

async function hashFile(filePath: string) {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

function getDownloadSourceLabel(downloadUrl: string) {
  try {
    return new URL(downloadUrl).host
  } catch {
    return 'configured source'
  }
}

async function verifyCompletedPartialFile(params: {
  kind: 'runtime' | 'model'
  expectedBytes: number
  sha256: string
  partialPath: string
  destinationPath: string
}) {
  const finalSize = (await fsPromises.stat(params.partialPath)).size
  if (finalSize !== params.expectedBytes) return false

  setState({ phase: 'verifying', progress: calculateProgress(params.kind, finalSize, params.expectedBytes) })
  const digest = await hashFile(params.partialPath)
  if (digest !== params.sha256) {
    await fsPromises.rm(params.partialPath, { force: true })
    return false
  }
  await fsPromises.rename(params.partialPath, params.destinationPath)
  return true
}

async function downloadFromSource(params: {
  kind: 'runtime' | 'model'
  url: string
  expectedBytes: number
  sha256: string
  destinationPath: string
}) {
  const partialPath = `${params.destinationPath}.partial`
  let existingBytes = pathExists(partialPath) ? (await fsPromises.stat(partialPath)).size : 0
  if (existingBytes > params.expectedBytes) {
    await fsPromises.rm(partialPath, { force: true })
    existingBytes = 0
  }
  if (existingBytes === params.expectedBytes && await verifyCompletedPartialFile({ ...params, partialPath })) {
    return
  }

  setState({
    phase: params.kind === 'runtime' ? 'downloading-runtime' : 'downloading-model',
    progress: calculateProgress(params.kind, existingBytes, params.expectedBytes),
    error: null,
  })

  const headers = new Headers({ 'Accept-Encoding': 'identity' })
  if (existingBytes > 0) headers.set('Range', `bytes=${existingBytes}-`)
  const controller = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS)
  }
  resetIdleTimer()
  try {
    const response = await fetch(params.url, { headers, redirect: 'follow', signal: controller.signal })
    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status}`)
    }
    if (!response.body) throw new Error('response did not contain a body')

    const append = existingBytes > 0 && response.status === 206
    if (!append) existingBytes = 0
    const file = await fsPromises.open(partialPath, append ? 'a' : 'w', 0o600)
    let downloadedBytes = existingBytes
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        resetIdleTimer()
        let offset = 0
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset)
          if (bytesWritten <= 0) throw new Error(`failed to write downloaded ${params.kind} data`)
          offset += bytesWritten
        }
        downloadedBytes += chunk.byteLength
        setState({ progress: calculateProgress(params.kind, downloadedBytes, params.expectedBytes) })
      }
    } finally {
      await file.close()
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }

  const finalSize = (await fsPromises.stat(partialPath)).size
  if (finalSize !== params.expectedBytes) {
    throw new Error(`size mismatch: expected ${params.expectedBytes}, received ${finalSize}`)
  }

  if (!await verifyCompletedPartialFile({ ...params, partialPath })) {
    throw new Error('checksum verification failed')
  }
}

export async function downloadVerifiedFile(params: {
  kind: 'runtime' | 'model'
  urls: readonly string[]
  expectedBytes: number
  sha256: string
  destinationPath: string
}) {
  if (!params.urls.length) throw new Error(`No download source configured for ${params.kind}`)
  await fsPromises.mkdir(path.dirname(params.destinationPath), { recursive: true })
  if (pathExists(params.destinationPath)) {
    const stats = await fsPromises.stat(params.destinationPath)
    if (stats.size === params.expectedBytes && await hashFile(params.destinationPath) === params.sha256) {
      return
    }
    await fsPromises.rm(params.destinationPath, { force: true })
  }

  const failures: string[] = []
  for (const url of params.urls) {
    try {
      await downloadFromSource({ ...params, url })
      return
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? `timed out after ${DOWNLOAD_IDLE_TIMEOUT_MS / 1000}s without data`
        : error instanceof Error
          ? error.message
          : 'download failed'
      failures.push(`${getDownloadSourceLabel(url)}: ${message}`)
    }
  }
  throw new Error(`Failed to download ${params.kind} from all configured sources (${failures.join('; ')})`)
}

function getResponseTotalBytes(response: Response, existingBytes: number, append: boolean) {
  const contentRange = response.headers.get('content-range')
  const rangeMatch = contentRange?.match(/\/(\d+)$/u)
  if (rangeMatch) {
    const total = Number(rangeMatch[1])
    if (Number.isSafeInteger(total) && total > 0) return total
  }

  const contentLength = Number(response.headers.get('content-length'))
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) return 0
  return append ? existingBytes + contentLength : contentLength
}

async function fileHasGgufMagic(filePath: string) {
  try {
    const file = await fsPromises.open(filePath, 'r')
    try {
      const magic = Buffer.alloc(4)
      const { bytesRead } = await file.read(magic, 0, magic.byteLength, 0)
      return bytesRead === magic.byteLength && magic.toString('ascii') === 'GGUF'
    } finally {
      await file.close()
    }
  } catch {
    return false
  }
}

async function downloadUnverifiedFromSource(params: {
  url: string
  destinationPath: string
}) {
  const partialPath = `${params.destinationPath}.partial`
  let existingBytes = pathExists(partialPath) ? (await fsPromises.stat(partialPath)).size : 0
  if (existingBytes > CUSTOM_LOCAL_EMBEDDING_MODEL_MAX_BYTES) {
    await fsPromises.rm(partialPath, { force: true })
    existingBytes = 0
  }

  setState({
    phase: 'downloading-model',
    progress: calculateProgress('model', existingBytes, 0),
    error: null,
  })

  const headers = new Headers({ 'Accept-Encoding': 'identity' })
  if (existingBytes > 0) headers.set('Range', `bytes=${existingBytes}-`)
  const controller = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let expectedTotalBytes = 0
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS)
  }
  resetIdleTimer()

  try {
    const response = await fetch(params.url, { headers, redirect: 'follow', signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (!response.body) throw new Error('response did not contain a body')

    const append = existingBytes > 0 && response.status === 206
    if (!append) existingBytes = 0
    expectedTotalBytes = getResponseTotalBytes(response, existingBytes, append)
    if (expectedTotalBytes > CUSTOM_LOCAL_EMBEDDING_MODEL_MAX_BYTES) {
      await fsPromises.rm(partialPath, { force: true })
      throw new Error('custom model exceeds the 8 GB safety limit')
    }

    const file = await fsPromises.open(partialPath, append ? 'a' : 'w', 0o600)
    let downloadedBytes = existingBytes
    let exceededLimit = false
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        resetIdleTimer()
        if (downloadedBytes + chunk.byteLength > CUSTOM_LOCAL_EMBEDDING_MODEL_MAX_BYTES) {
          exceededLimit = true
          throw new Error('custom model exceeds the 8 GB safety limit')
        }
        let offset = 0
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.byteLength - offset)
          if (bytesWritten <= 0) throw new Error('failed to write downloaded model data')
          offset += bytesWritten
        }
        downloadedBytes += chunk.byteLength
        setState({ progress: calculateProgress('model', downloadedBytes, expectedTotalBytes) })
      }
    } finally {
      await file.close()
      if (exceededLimit) await fsPromises.rm(partialPath, { force: true })
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }

  const finalSize = (await fsPromises.stat(partialPath)).size
  if (expectedTotalBytes > 0 && finalSize !== expectedTotalBytes) {
    throw new Error(`size mismatch: expected ${expectedTotalBytes}, received ${finalSize}`)
  }
  setState({ phase: 'verifying', progress: calculateProgress('model', finalSize, finalSize) })
  if (finalSize <= 4 || !await fileHasGgufMagic(partialPath)) {
    await fsPromises.rm(partialPath, { force: true })
    throw new Error('downloaded file is not a valid GGUF file')
  }
  await fsPromises.rm(params.destinationPath, { force: true })
  await fsPromises.rename(partialPath, params.destinationPath)
}

export async function downloadUnverifiedModelFile(params: {
  urls: readonly string[]
  destinationPath: string
}) {
  if (!params.urls.length) throw new Error('No download source configured for model')
  params.urls.forEach(assertAllowedHuggingFaceDownloadUrl)
  await fsPromises.mkdir(path.dirname(params.destinationPath), { recursive: true })
  if (pathExists(params.destinationPath)) {
    const stats = await fsPromises.stat(params.destinationPath)
    if (
      stats.size > 4
      && stats.size <= CUSTOM_LOCAL_EMBEDDING_MODEL_MAX_BYTES
      && await fileHasGgufMagic(params.destinationPath)
    ) return
    await fsPromises.rm(params.destinationPath, { force: true })
  }

  const failures: string[] = []
  for (const url of params.urls) {
    try {
      await downloadUnverifiedFromSource({ ...params, url })
      return
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? `timed out after ${DOWNLOAD_IDLE_TIMEOUT_MS / 1000}s without data`
        : error instanceof Error
          ? error.message
          : 'download failed'
      failures.push(`${getDownloadSourceLabel(url)}: ${message}`)
    }
  }
  throw new Error(`Failed to download custom model from all configured sources (${failures.join('; ')})`)
}

async function waitForCommand(child: ChildProcess) {
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Command exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}

function escapePowerShellLiteral(value: string) {
  return value.replace(/'/gu, "''")
}

export async function findExtractedRuntimeSourcePath(extractionPath: string, executableName: string) {
  const rootExecutablePath = path.join(extractionPath, executableName)
  if (pathExists(rootExecutablePath)) return extractionPath

  const entries = await fsPromises.readdir(extractionPath, { withFileTypes: true })
  const extractedDirectory = entries.find((entry) => (
    entry.isDirectory()
    && pathExists(path.join(extractionPath, entry.name, executableName))
  ))
  return extractedDirectory ? path.join(extractionPath, extractedDirectory.name) : null
}

async function extractRuntimeArchive(artifact: LlamaCppRuntimeArtifact, archivePath: string, runtimePath: string) {
  const executablePath = path.join(runtimePath, artifact.executableName)
  if (pathExists(executablePath)) return

  setState({ phase: 'extracting-runtime', progress: null })
  const temporaryPath = `${runtimePath}.partial-${process.pid}`
  const extractionPath = path.join(temporaryPath, 'payload')
  await fsPromises.rm(temporaryPath, { recursive: true, force: true })
  await fsPromises.mkdir(extractionPath, { recursive: true })

  try {
    const tarArgs = artifact.archiveType === 'tar.gz'
      ? ['-xzf', archivePath, '-C', extractionPath]
      : ['-xf', archivePath, '-C', extractionPath]
    try {
      await waitForCommand(spawn('tar', tarArgs, { stdio: ['ignore', 'ignore', 'pipe'] }))
    } catch (error) {
      if (artifact.archiveType !== 'zip' || process.platform !== 'win32') throw error
      const command = `Expand-Archive -LiteralPath '${escapePowerShellLiteral(archivePath)}' -DestinationPath '${escapePowerShellLiteral(extractionPath)}' -Force`
      await waitForCommand(spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio: ['ignore', 'ignore', 'pipe'] }))
    }

    const sourcePath = await findExtractedRuntimeSourcePath(extractionPath, artifact.executableName)
    if (!sourcePath) {
      throw new Error('llama.cpp archive did not contain llama-server')
    }

    await fsPromises.mkdir(path.dirname(runtimePath), { recursive: true })
    await fsPromises.rm(runtimePath, { recursive: true, force: true })
    await fsPromises.rename(sourcePath, runtimePath)
    if (process.platform !== 'win32') {
      await fsPromises.chmod(path.join(runtimePath, artifact.executableName), 0o755)
    }
    await fsPromises.rm(archivePath, { force: true })
  } finally {
    await fsPromises.rm(temporaryPath, { recursive: true, force: true })
  }
}

async function ensureRuntimeArtifactInstalled(artifact: LlamaCppRuntimeArtifact) {
  const model = getDefaultLocalEmbeddingModel()
  const paths = resolveLocalEmbeddingPaths(model.id, artifact.id)
  if (pathExists(paths.runtimeExecutablePath)) return paths
  await downloadVerifiedFile({
    kind: 'runtime',
    urls: [artifact.downloadUrl],
    expectedBytes: artifact.downloadBytes,
    sha256: artifact.sha256,
    destinationPath: paths.runtimeArchivePath,
  })
  await extractRuntimeArchive(artifact, paths.runtimeArchivePath, paths.runtimePath)
  return paths
}

async function ensureModelInstalled(model: InstallableLocalEmbeddingModel, runtimeArtifact: LlamaCppRuntimeArtifact) {
  const paths = resolveLocalEmbeddingPathsForModel(model, runtimeArtifact.id)
  if (model.expectedBytes !== null && model.sha256 !== null) {
    await downloadVerifiedFile({
      kind: 'model',
      urls: model.downloadUrls,
      expectedBytes: model.expectedBytes,
      sha256: model.sha256,
      destinationPath: paths.modelPath,
    })
  } else {
    await downloadUnverifiedModelFile({
      urls: model.downloadUrls,
      destinationPath: paths.modelPath,
    })
  }
  return paths
}

async function writeManifest(manifest: InstallationManifest) {
  const artifact = getLlamaCppRuntimeArtifactById(manifest.runtimeArtifactId)
  if (!artifact) throw new Error('Cannot write an unsupported runtime manifest')
  const model = getManifestModel(manifest)
  if (!model) throw new Error('Cannot write an invalid local embedding model manifest')
  const { rootPath, manifestPath } = resolveLocalEmbeddingPathsForModel(model, artifact.id)
  await fsPromises.mkdir(rootPath, { recursive: true })
  const temporaryPath = `${manifestPath}.partial`
  await fsPromises.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fsPromises.rm(manifestPath, { force: true })
  await fsPromises.rename(temporaryPath, manifestPath)
}

async function configureLocalEmbedding(modelId: string) {
  const current = loadStoredAISettings()
  await saveStoredAISettings({
    ...current,
    embeddings: {
      ...current.embeddings,
      provider: 'openai-compatible',
      openAICompatible: {
        ...current.embeddings.openAICompatible,
        baseUrl: LOCAL_EMBEDDING_BASE_URL,
        apiKey: LOCAL_EMBEDDING_API_KEY,
        apiKeyConfigured: true,
        apiKeyMasked: 're***ocal',
        model: modelId,
        configured: true,
      },
    },
  })
}

function buildRuntimeEnvironment(runtimePath: string) {
  const env = { ...process.env }
  if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = [runtimePath, env.DYLD_LIBRARY_PATH].filter(Boolean).join(path.delimiter)
  } else if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = [runtimePath, env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter)
  } else if (process.platform === 'win32') {
    env.PATH = [runtimePath, env.PATH].filter(Boolean).join(path.delimiter)
  }
  return env
}

async function isHealthy(modelId: string, timeoutMs = 1_500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(HEALTH_URL, { signal: controller.signal, cache: 'no-store' })
    if (!response.ok) return false
    const modelsResponse = await fetch(MODELS_URL, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${LOCAL_EMBEDDING_API_KEY}` },
    })
    if (!modelsResponse.ok) return false
    const payload = await modelsResponse.json() as { data?: Array<{ id?: unknown }> }
    return Array.isArray(payload.data) && payload.data.some((item) => item?.id === modelId)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export type LocalEmbeddingRuntimeTuning = {
  parallel: number
  batchSize: number
  microBatchSize: number
}

export function resolveLocalEmbeddingRuntimeTuning(totalMemoryBytes: number = resolvePhysicalMemoryBytes()): LocalEmbeddingRuntimeTuning {
  const gib = 1024 ** 3
  if (totalMemoryBytes <= 8 * gib) {
    return { parallel: 1, batchSize: 128, microBatchSize: 64 }
  }
  if (totalMemoryBytes <= 16 * gib) {
    return { parallel: 1, batchSize: 256, microBatchSize: 128 }
  }
  if (totalMemoryBytes <= 32 * gib) {
    return { parallel: 2, batchSize: 512, microBatchSize: 256 }
  }
  return { parallel: 4, batchSize: 1024, microBatchSize: 512 }
}

export function buildLocalEmbeddingServerArgs(
  model: RuntimeLocalEmbeddingModel,
  modelPath: string,
  gpuLayers: number,
  totalMemoryBytes: number = resolvePhysicalMemoryBytes(),
) {
  const tuning = resolveLocalEmbeddingRuntimeTuning(totalMemoryBytes)
  return [
    '--model', modelPath,
    '--alias', model.id,
    '--embedding',
    ...(model.pooling ? ['--pooling', model.pooling] : []),
    '--embd-normalize', '2',
    '--ctx-size', String(model.contextSize),
    '--parallel', String(tuning.parallel),
    '--batch-size', String(tuning.batchSize),
    '--ubatch-size', String(tuning.microBatchSize),
    '--n-gpu-layers', String(gpuLayers),
    '--api-key', LOCAL_EMBEDDING_API_KEY,
    '--cors-origins', 'localhost',
    '--no-cors-credentials',
    '--no-webui',
    '--host', '127.0.0.1',
    '--port', '11435',
  ]
}

async function terminateChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
  ])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function launchServer(params: {
  artifact: LlamaCppRuntimeArtifact
  model: RuntimeLocalEmbeddingModel
  backend: LocalEmbeddingBackend
  gpuLayers: number
}) {
  const paths = resolveLocalEmbeddingPathsForModel(params.model, params.artifact.id)
  const runtime = getRuntimeGlobal()
  runtime.logTail = []
  const child = spawn(paths.runtimeExecutablePath, buildLocalEmbeddingServerArgs(params.model, paths.modelPath, params.gpuLayers), {
    cwd: paths.runtimePath,
    env: buildRuntimeEnvironment(paths.runtimePath),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  child.stdout?.on('data', appendLog)
  child.stderr?.on('data', appendLog)
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  const startedAt = Date.now()
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(getLogError(`llama-server exited before becoming healthy (${child.exitCode ?? child.signalCode})`))
    }
    if (await isHealthy(params.model.id)) {
      runtime.child = child
      setState({ phase: 'running', backend: params.backend, progress: null, error: null })
      child.once('exit', (code, signal) => {
        if (runtime.child !== child) return
        runtime.child = null
        setState({
          phase: 'error',
          error: getLogError(`llama-server stopped unexpectedly (${code ?? signal ?? 'unknown status'})`),
        })
      })
      if (!runtime.cleanupRegistered) {
        runtime.cleanupRegistered = true
        process.once('exit', () => runtime.child?.kill('SIGTERM'))
      }
      return
    }
    await sleep(500)
  }

  await terminateChild(child)
  throw new Error(getLogError('llama-server did not become healthy within 60 seconds'))
}

async function startInstalledRuntime() {
  const runtime = getRuntimeGlobal()
  let manifest = readInstallationManifest()
  if (!manifest || !installationIsPresent(manifest)) {
    throw new Error('Local embedding is not installed. Open Settings and run the installation wizard first.')
  }
  const model = getManifestModel(manifest)
  const primaryArtifact = getLlamaCppRuntimeArtifactById(manifest.runtimeArtifactId)
  if (!model || !primaryArtifact) throw new Error('Local embedding installation manifest is invalid')

  if (runtime.child && runtime.child.exitCode === null && await isHealthy(model.id)) {
    setState({ phase: 'running', progress: null, error: null })
    await configureLocalEmbedding(model.id)
    return
  }
  if (await isHealthy(model.id)) {
    setState({ phase: 'running', progress: null, error: null })
    await configureLocalEmbedding(model.id)
    return
  }

  setState({ phase: 'starting', selectedModelId: model.id, backend: manifest.launchBackend, progress: null, error: null })
  const attempts = buildLocalEmbeddingLaunchAttempts(manifest.launchBackend)
  let lastError: unknown = null
  for (const attempt of attempts) {
    let artifact = primaryArtifact
    if (attempt.useCpuRuntime && primaryArtifact.backend !== 'cpu') {
      const cpuArtifact = getLlamaCppRuntimeArtifact({ backend: 'cpu' })
      if (!cpuArtifact) continue
      artifact = cpuArtifact
      await ensureRuntimeArtifactInstalled(cpuArtifact)
    }

    setState({ phase: 'starting', backend: attempt.backend, error: null })
    try {
      await launchServer({ artifact, model, backend: attempt.backend, gpuLayers: attempt.gpuLayers })
    } catch (error) {
      lastError = error
      if (runtime.child) {
        await terminateChild(runtime.child)
        runtime.child = null
      }
      continue
    }

    manifest = {
      ...manifest,
      runtimeArtifactId: artifact.id,
      launchBackend: attempt.backend,
    }
    try {
      await writeManifest(manifest)
      await configureLocalEmbedding(model.id)
      return
    } catch (error) {
      if (runtime.child) {
        await terminateChild(runtime.child)
        runtime.child = null
      }
      throw error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to start llama-server')
}

async function installLocalEmbeddingModel(params: {
  model: InstallableLocalEmbeddingModel
  customModel: HuggingFaceCustomModelReference | null
}) {
  const { model } = params
  const artifact = getPreferredRuntimeArtifact()
  if (!artifact) throw new Error(`llama.cpp is not available for ${process.platform}/${process.arch}`)

  setState({ phase: 'downloading-runtime', selectedModelId: model.id, backend: artifact.backend, progress: null, error: null })
  await ensureRuntimeArtifactInstalled(artifact)
  await ensureModelInstalled(model, artifact)
  await writeManifest({
    version: 1,
    modelId: model.id,
    modelSha256: model.sha256,
    customModel: params.customModel,
    runtimeVersion: LLAMA_CPP_RUNTIME_VERSION,
    runtimeArtifactId: artifact.id,
    launchBackend: artifact.backend,
    installedAt: new Date().toISOString(),
  })
  setState({ phase: 'stopped', progress: null, error: null })
  await startInstalledRuntime()
}

async function installLocalEmbedding(modelId: string) {
  const model = getLocalEmbeddingModel(modelId)
  if (!model) throw new Error('Unknown local embedding model')
  await installLocalEmbeddingModel({
    model: toInstallableCatalogModel(model),
    customModel: null,
  })
}

async function installCustomLocalEmbedding(reference: HuggingFaceCustomModelReference) {
  const normalized = normalizeHuggingFaceCustomModelReference(reference)
  const model = createCustomLocalEmbeddingModel(normalized)
  await installLocalEmbeddingModel({
    model: toInstallableCustomModel(model),
    customModel: normalized,
  })
}

function reportBackgroundFailure(error: unknown) {
  setState({
    phase: 'error',
    progress: null,
    error: error instanceof Error ? error.message : 'Local embedding operation failed',
  })
}

export async function getLocalEmbeddingRuntimeStatus(): Promise<LocalEmbeddingRuntimeStatus> {
  const runtime = getRuntimeGlobal()
  const manifest = readInstallationManifest()
  const installed = installationIsPresent(manifest)
  const supported = Boolean(getPreferredRuntimeArtifact())
  const embeddingSettings = loadStoredAISettings().embeddings
  const configured = embeddingSettings.provider === 'openai-compatible'
    && embeddingSettings.openAICompatible.apiKey === LOCAL_EMBEDDING_API_KEY
    && isRetaleLocalEmbeddingConfig(
      embeddingSettings.openAICompatible.baseUrl,
      embeddingSettings.openAICompatible.model,
    )
  const activeOperation = Boolean(runtime.installPromise || runtime.startPromise)
  const running = Boolean(runtime.child && runtime.child.exitCode === null && runtime.state.phase === 'running')
    || Boolean(!runtime.child && manifest && await isHealthy(manifest.modelId, 400))

  if (running) {
    runtime.state.phase = 'running'
    runtime.state.progress = null
    runtime.state.error = null
  } else if (!activeOperation && runtime.state.phase !== 'error') {
    runtime.state.phase = installed ? 'stopped' : 'not-installed'
    runtime.state.progress = null
  }
  if (manifest) {
    runtime.state.selectedModelId = manifest.modelId
    if (!activeOperation && !runtime.child) runtime.state.backend = manifest.launchBackend
  }

  const preferredArtifact = getPreferredRuntimeArtifact()
  return {
    ok: true,
    supported,
    installed,
    configured,
    running,
    phase: running ? 'running' : runtime.state.phase,
    selectedModelId: runtime.state.selectedModelId,
    backend: runtime.state.backend,
    acceleratorLabel: getAcceleratorLabel(runtime.state.backend),
    platformLabel: getPlatformLabel(),
    runtimeVersion: LLAMA_CPP_RUNTIME_VERSION,
    runtimeDownloadBytes: preferredArtifact?.downloadBytes ?? 0,
    progress: runtime.state.progress,
    error: runtime.state.error,
    models: listPublicLocalEmbeddingModels(),
    connection: {
      baseUrl: LOCAL_EMBEDDING_BASE_URL,
      apiKey: LOCAL_EMBEDDING_API_KEY,
      model: runtime.state.selectedModelId,
    },
  }
}

export async function beginLocalEmbeddingInstall(modelId: string) {
  const runtime = getRuntimeGlobal()
  if (!getLocalEmbeddingModel(modelId)) throw new Error('Unknown local embedding model')
  if (!runtime.installPromise) {
    runtime.installPromise = installLocalEmbedding(modelId)
      .catch((error) => {
        reportBackgroundFailure(error)
        throw error
      })
      .finally(() => {
        runtime.installPromise = null
      })
    void runtime.installPromise.catch(() => undefined)
  }
  return getLocalEmbeddingRuntimeStatus()
}

export async function beginCustomLocalEmbeddingInstall(reference: HuggingFaceCustomModelReference) {
  const normalized = normalizeHuggingFaceCustomModelReference(reference)
  const runtime = getRuntimeGlobal()
  if (!runtime.installPromise) {
    runtime.installPromise = installCustomLocalEmbedding(normalized)
      .catch((error) => {
        reportBackgroundFailure(error)
        throw error
      })
      .finally(() => {
        runtime.installPromise = null
      })
    void runtime.installPromise.catch(() => undefined)
  }
  return getLocalEmbeddingRuntimeStatus()
}

export async function beginLocalEmbeddingStart() {
  const runtime = getRuntimeGlobal()
  if (!runtime.startPromise) {
    runtime.startPromise = startInstalledRuntime()
      .catch((error) => {
        reportBackgroundFailure(error)
        throw error
      })
      .finally(() => {
        runtime.startPromise = null
      })
    void runtime.startPromise.catch(() => undefined)
  }
  return getLocalEmbeddingRuntimeStatus()
}

export async function ensureLocalEmbeddingRuntimeRunning() {
  const runtime = getRuntimeGlobal()
  const manifest = readInstallationManifest()
  if (manifest && await isHealthy(manifest.modelId)) return
  if (!runtime.startPromise) {
    runtime.startPromise = startInstalledRuntime()
      .catch((error) => {
        reportBackgroundFailure(error)
        throw error
      })
      .finally(() => {
        runtime.startPromise = null
      })
  }
  await runtime.startPromise
}

export async function stopLocalEmbeddingRuntime() {
  const runtime = getRuntimeGlobal()
  if (runtime.child) {
    const child = runtime.child
    runtime.child = null
    await terminateChild(child)
  }
  setState({ phase: readInstallationManifest() ? 'stopped' : 'not-installed', progress: null, error: null })
  return getLocalEmbeddingRuntimeStatus()
}

export function resetLocalEmbeddingRuntimeForTests() {
  const runtime = globalForLocalEmbedding.__retaleLocalEmbeddingRuntime
  runtime?.child?.kill('SIGTERM')
  delete globalForLocalEmbedding.__retaleLocalEmbeddingRuntime
}

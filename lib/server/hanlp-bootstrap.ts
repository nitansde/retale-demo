import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  hanlpBootstrapCacheRecordSchema,
  hanlpBootstrapResultRecordSchema,
  type HanlpBootstrapCacheRecord,
  type HanlpBootstrapResultRecord,
} from '@/lib/server/hanlp-contracts'
import { hashContent, normalizeBranchId, splitChapterLines } from '@/lib/server/knowledge-store'
import { execute, queryOne, withTransaction } from '@/lib/server/database-access'
import { uid } from '@/lib/utils'

export const HANLP_BOOTSTRAP_PIPELINE_VERSION = 'hanlp-bootstrap:v1'
export const HANLP_BOOTSTRAP_OUTPUT_SCHEMA_VERSION = 'v1'
export const UNKNOWN_LOCAL_CONFIG_MARKER = 'unknown-local-config'

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_SCRIPT_CANDIDATE_PATHS = [
  path.join(/* turbopackIgnore: true */ process.cwd(), 'hanlp_bootstrap.py'),
  path.join(/* turbopackIgnore: true */ process.cwd(), 'scripts', 'hanlp_bootstrap.py'),
] as const

const HANLP_ENTITY_GROUPS = [
  { key: 'people', aliases: ['persons'], entityType: 'person' },
  { key: 'locations', aliases: ['locationTerms'], entityType: 'location' },
  { key: 'organizations', aliases: ['orgs', 'organizationTerms'], entityType: 'organization' },
  { key: 'settings', aliases: ['settingTerms'], entityType: 'setting' },
] as const

type HanlpEntityType = (typeof HANLP_ENTITY_GROUPS)[number]['entityType']

type HanlpBootstrapCacheRow = {
  id: string
  novelId: string
  branchId: string
  chapterId: string | null
  chapterNo: number | null
  chapterTextHash: string
  hanlpScriptVersionHash: string
  hanlpModelOrConfigHash: string
  outputSchemaVersion: string
  cacheKey: string
  inputHash: string
  pipelineVersion: string
  sourceChapterId: string | null
  sourceChapterNo: number | null
  requestJson: string
  resultJson: string
  status: 'pending' | 'ready' | 'failed'
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

type HanlpBootstrapResultRow = {
  id: string
  novelId: string
  branchId: string
  knowledgeJobId: string | null
  chapterId: string | null
  chapterNo: number | null
  chapterSourceHash: string
  resultKind: 'bootstrap'
  provider: string | null
  model: string | null
  resultJson: string
  status: 'pending' | 'ready' | 'failed'
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type HanlpBootstrapMention = {
  text: string
  startOffset: number
  endOffset: number
}

export type HanlpBootstrapChapterMentions = {
  chapterNo: number
  mentions: HanlpBootstrapMention[]
}

export type HanlpBootstrapEntity = {
  text: string
  entityType: HanlpEntityType
  totalCount: number
  chapterCount: number
  coverageRatio: number
  score: number
  chapters: HanlpBootstrapChapterMentions[]
}

export type HanlpBootstrapOutput = {
  people: HanlpBootstrapEntity[]
  locations: HanlpBootstrapEntity[]
  organizations: HanlpBootstrapEntity[]
  settings: HanlpBootstrapEntity[]
  entities: HanlpBootstrapEntity[]
}

export type HanlpBootstrapCacheKey = {
  chapterTextHash: string
  hanlpScriptVersionHash: string
  hanlpModelOrConfigHash: string
  outputSchemaVersion: string
  cacheKey: string
  inputHash: string
  pipelineVersion: string
}

export type HanlpBootstrapChapterInput = {
  novelId: string
  branchId?: string | null
  chapterId: string
  chapterNo: number
  rawText: string
}

export type HanlpBootstrapRequestPayload = {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  chapterText: string
  outputSchemaVersion: string
}

export type HanlpBootstrapSubprocessInvocation = {
  pythonBin: string
  scriptPath: string
  timeoutMs: number
  request: HanlpBootstrapRequestPayload
}

export type HanlpBootstrapSubprocessResult = {
  status: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  error: Error | null
}

export type HanlpBootstrapSubprocessRunner = (
  invocation: HanlpBootstrapSubprocessInvocation
) => Promise<HanlpBootstrapSubprocessResult> | HanlpBootstrapSubprocessResult

export type HanlpBootstrapRunOptions = {
  scriptPath?: string | null
  pythonBin?: string | null
  timeoutMs?: number
  modelOrConfigIdentity?: string | null
  outputSchemaVersion?: string | null
  knowledgeJobId?: string | null
  runner?: HanlpBootstrapSubprocessRunner
}

export type HanlpBootstrapRunResult = {
  source: 'cache' | 'runner'
  cache: HanlpBootstrapCacheRecord
  result: HanlpBootstrapResultRecord
  output: HanlpBootstrapOutput
  cacheKey: HanlpBootstrapCacheKey
  scriptPath: string
  normalizedChapterText: string
}

export class HanlpBootstrapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HanlpBootstrapError'
  }
}

function requireTrimmedString(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new HanlpBootstrapError(`${label} must be a string`)
  }

  const normalized = value.trim()
  if (!normalized) {
    throw new HanlpBootstrapError(`${label} must not be empty`)
  }

  return normalized
}

function requirePositiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new HanlpBootstrapError(`${label} must be a positive integer`)
  }

  return Number(value)
}

function requireNonNegativeInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new HanlpBootstrapError(`${label} must be a non-negative integer`)
  }

  return Number(value)
}

function requireFiniteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HanlpBootstrapError(`${label} must be a finite number`)
  }

  return value
}

function normalizePersistedChapterText(rawText: string) {
  return splitChapterLines(rawText).map((line) => line.text).join('\n')
}

function normalizeMention(rawMention: unknown, normalizedChapterText: string, label: string): HanlpBootstrapMention {
  if (!rawMention || typeof rawMention !== 'object') {
    throw new HanlpBootstrapError(`${label} must be an object`)
  }

  const mention = rawMention as Record<string, unknown>
  const startOffset = requireNonNegativeInteger(mention.startOffset ?? mention.start ?? mention.charStart, `${label}.startOffset`)
  const endOffset = requirePositiveInteger(mention.endOffset ?? mention.end ?? mention.charEnd, `${label}.endOffset`)

  if (endOffset <= startOffset) {
    throw new HanlpBootstrapError(`${label}.endOffset must be greater than startOffset`)
  }

  if (endOffset > normalizedChapterText.length) {
    throw new HanlpBootstrapError(`${label} exceeds normalized chapter text length`)
  }

  const text = normalizedChapterText.slice(startOffset, endOffset)
  if (!text.trim()) {
    throw new HanlpBootstrapError(`${label} resolved to empty text`)
  }

  return {
    text,
    startOffset,
    endOffset,
  }
}

function normalizeEntity(rawEntity: unknown, entityType: HanlpEntityType, chapterNo: number, normalizedChapterText: string, label: string): HanlpBootstrapEntity {
  if (!rawEntity || typeof rawEntity !== 'object') {
    throw new HanlpBootstrapError(`${label} must be an object`)
  }

  const entity = rawEntity as Record<string, unknown>
  const text = requireTrimmedString(entity.text ?? entity.entityText ?? entity.term ?? entity.name, `${label}.text`)
  const totalCount = requirePositiveInteger(entity.totalCount ?? entity.count, `${label}.totalCount`)
  const chapterCount = requirePositiveInteger(entity.chapterCount, `${label}.chapterCount`)
  const coverageRatio = requireFiniteNumber(entity.coverageRatio ?? entity.chapterCoverage, `${label}.coverageRatio`)
  const score = requireFiniteNumber(entity.score, `${label}.score`)
  const rawChapters = Array.isArray(entity.chapters)
    ? entity.chapters
    : Array.isArray(entity.mentions)
      ? [{ chapterNo, mentions: entity.mentions }]
      : null

  if (!rawChapters) {
    throw new HanlpBootstrapError(`${label}.chapters must contain per-chapter entity lists`)
  }

  if (!rawChapters.length) {
    throw new HanlpBootstrapError(`${label}.chapters must be a non-empty array`)
  }

  const chapters = rawChapters.map((rawChapter, chapterIndex) => {
    if (!rawChapter || typeof rawChapter !== 'object') {
      throw new HanlpBootstrapError(`${label}.chapters[${chapterIndex}] must be an object`)
    }

    const chapterEntry = rawChapter as Record<string, unknown>
    const normalizedChapterNo = requirePositiveInteger(chapterEntry.chapterNo ?? chapterNo, `${label}.chapters[${chapterIndex}].chapterNo`)
    const rawMentions = chapterEntry.mentions
    if (!Array.isArray(rawMentions) || !rawMentions.length) {
      throw new HanlpBootstrapError(`${label}.chapters[${chapterIndex}].mentions must be a non-empty array`)
    }

    return {
      chapterNo: normalizedChapterNo,
      mentions: rawMentions.map((rawMention, mentionIndex) => normalizeMention(
        rawMention,
        normalizedChapterText,
        `${label}.chapters[${chapterIndex}].mentions[${mentionIndex}]`
      )),
    }
  })

  return {
    text,
    entityType,
    totalCount,
    chapterCount,
    coverageRatio,
    score,
    chapters,
  }
}

function readEntityGroup(source: Record<string, unknown>, key: string, aliases: readonly string[]) {
  const value = source[key] ?? aliases.map((alias) => source[alias]).find((candidate) => candidate !== undefined)
  if (!Array.isArray(value)) {
    throw new HanlpBootstrapError(`HanLP output must include a ${key} array`)
  }
  return value
}

function flattenEntities(output: Omit<HanlpBootstrapOutput, 'entities'>) {
  return [
    ...output.people,
    ...output.locations,
    ...output.organizations,
    ...output.settings,
  ]
}

function mapCacheRow(row: HanlpBootstrapCacheRow): HanlpBootstrapCacheRecord {
  return hanlpBootstrapCacheRecordSchema.parse(row)
}

function mapResultRow(row: HanlpBootstrapResultRow): HanlpBootstrapResultRecord {
  return hanlpBootstrapResultRecordSchema.parse(row)
}

function buildHanlpFailure(message: string) {
  return new HanlpBootstrapError(`${message} Install/configure local HanLP or restore a valid cache before rebuilding.`)
}

function buildScriptMissingFallback(scriptPath: string) {
  return `missing-script:${scriptPath}`
}

function resolvePythonBin(pythonBin?: string | null) {
  const fromArgs = pythonBin?.trim()
  const fromEnv = process.env.HANLP_PYTHON_BIN?.trim()
  return fromArgs || fromEnv || 'python3'
}

export function resolveHanlpBootstrapTimeoutMs(timeoutMs?: number | null) {
  if (Number.isInteger(timeoutMs) && Number(timeoutMs) > 0) {
    return Number(timeoutMs)
  }

  const fromEnv = process.env.HANLP_BOOTSTRAP_TIMEOUT_MS?.trim()
  if (!fromEnv) return DEFAULT_TIMEOUT_MS

  const parsed = Number(fromEnv)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS
}

export function resolveHanlpBootstrapScriptPath(scriptPath?: string | null) {
  const explicit = scriptPath?.trim() || process.env.HANLP_BOOTSTRAP_SCRIPT_PATH?.trim()
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(/* turbopackIgnore: true */ process.cwd(), explicit)
  }

  const existing = DEFAULT_SCRIPT_CANDIDATE_PATHS.find((candidate) => fs.existsSync(/* turbopackIgnore: true */ candidate))
  return existing ?? DEFAULT_SCRIPT_CANDIDATE_PATHS[0]
}

export function buildHanlpModelOrConfigHash(identity?: string | null) {
  const normalizedIdentity = identity?.trim() || UNKNOWN_LOCAL_CONFIG_MARKER
  return normalizedIdentity === UNKNOWN_LOCAL_CONFIG_MARKER ? normalizedIdentity : hashContent(normalizedIdentity)
}

export function buildHanlpScriptVersionHash(scriptPath: string, outputSchemaVersion = HANLP_BOOTSTRAP_OUTPUT_SCHEMA_VERSION) {
  const normalizedPath = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(/* turbopackIgnore: true */ process.cwd(), scriptPath)
  const scriptSource = fs.existsSync(/* turbopackIgnore: true */ normalizedPath)
    ? fs.readFileSync(/* turbopackIgnore: true */ normalizedPath, 'utf8')
    : buildScriptMissingFallback(normalizedPath)

  return hashContent(`${outputSchemaVersion}\n${scriptSource}`)
}

export function buildHanlpBootstrapCacheKey(params: {
  chapterText: string
  scriptPath: string
  modelOrConfigIdentity?: string | null
  outputSchemaVersion?: string | null
}) {
  const outputSchemaVersion = params.outputSchemaVersion?.trim() || HANLP_BOOTSTRAP_OUTPUT_SCHEMA_VERSION
  const chapterTextHash = hashContent(normalizePersistedChapterText(params.chapterText))
  const hanlpScriptVersionHash = buildHanlpScriptVersionHash(params.scriptPath, outputSchemaVersion)
  const hanlpModelOrConfigHash = buildHanlpModelOrConfigHash(params.modelOrConfigIdentity)
  const keyPayload = {
    chapter_text_hash: chapterTextHash,
    hanlp_script_version_hash: hanlpScriptVersionHash,
    hanlp_model_or_config_hash: hanlpModelOrConfigHash,
    output_schema_version: outputSchemaVersion,
  }

  return {
    chapterTextHash,
    hanlpScriptVersionHash,
    hanlpModelOrConfigHash,
    outputSchemaVersion,
    cacheKey: JSON.stringify(keyPayload),
    inputHash: hashContent(JSON.stringify(keyPayload)),
    pipelineVersion: HANLP_BOOTSTRAP_PIPELINE_VERSION,
  } satisfies HanlpBootstrapCacheKey
}

export function validateHanlpBootstrapOutput(rawOutput: unknown, params: { chapterNo: number; chapterText: string }): HanlpBootstrapOutput {
  if (!rawOutput || typeof rawOutput !== 'object') {
    throw new HanlpBootstrapError('HanLP output must be a JSON object')
  }

  const chapterNo = requirePositiveInteger(params.chapterNo, 'chapterNo')
  const normalizedChapterText = normalizePersistedChapterText(params.chapterText)
  const source = rawOutput as Record<string, unknown>
  const normalized = Object.fromEntries(
    HANLP_ENTITY_GROUPS.map(({ key, aliases, entityType }) => {
      const group = readEntityGroup(source, key, aliases)
      const entities = group.map((entry, index) => normalizeEntity(
        entry,
        entityType,
        chapterNo,
        normalizedChapterText,
        `${key}[${index}]`
      ))
      return [key, entities]
    })
  ) as Omit<HanlpBootstrapOutput, 'entities'>

  return {
    ...normalized,
    entities: flattenEntities(normalized),
  }
}

export function defaultHanlpBootstrapRunner(invocation: HanlpBootstrapSubprocessInvocation): Promise<HanlpBootstrapSubprocessResult> {
  return new Promise((resolve) => {
    const maxBuffer = 10 * 1024 * 1024
    const physicalMemoryBytes = os.totalmem()
    const threadLimit = Math.max(1, Math.min(4, os.availableParallelism()))
    const child = spawn(invocation.pythonBin, [invocation.scriptPath], {
      cwd: /* turbopackIgnore: true */ process.cwd(),
      env: {
        ...process.env,
        HANLP_BOOTSTRAP_PHYSICAL_MEMORY_BYTES: process.env.HANLP_BOOTSTRAP_PHYSICAL_MEMORY_BYTES?.trim()
          || String(physicalMemoryBytes),
        KMP_USE_SHM: process.env.KMP_USE_SHM?.trim() || '0',
        OMP_NUM_THREADS: process.env.OMP_NUM_THREADS?.trim() || String(threadLimit),
        MKL_NUM_THREADS: process.env.MKL_NUM_THREADS?.trim() || String(threadLimit),
        TOKENIZERS_PARALLELISM: process.env.TOKENIZERS_PARALLELISM?.trim() || 'false',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let timedOut = false
    let processError: Error | null = null

    const finish = (status: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ status, stdout, stderr, timedOut, error: processError })
    }

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, invocation.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes <= maxBuffer) {
        stdout += chunk.toString('utf8')
        return
      }

      processError = new Error('HanLP bootstrap stdout exceeded max buffer')
      child.kill('SIGKILL')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes <= maxBuffer) {
        stderr += chunk.toString('utf8')
        return
      }

      processError = new Error('HanLP bootstrap stderr exceeded max buffer')
      child.kill('SIGKILL')
    })

    child.stdin.on('error', (error: Error) => {
      processError = processError ?? error
    })

    child.on('error', (error: Error) => {
      processError = error
      finish(null)
    })

    child.on('close', (status) => {
      finish(status)
    })

    child.stdin.end(JSON.stringify(invocation.request), 'utf8')
  })
}

function loadReadyCache(params: {
  branchId: string
  chapterId: string
  chapterTextHash: string
  chapterNo: number
  cacheKey: HanlpBootstrapCacheKey
}) {
  const cacheRow = queryOne<HanlpBootstrapCacheRow>(
    `
      SELECT
        id,
        novel_id AS novelId,
        branch_id AS branchId,
        chapter_id AS chapterId,
        chapter_no AS chapterNo,
        chapter_text_hash AS chapterTextHash,
        hanlp_script_version_hash AS hanlpScriptVersionHash,
        hanlp_model_or_config_hash AS hanlpModelOrConfigHash,
        output_schema_version AS outputSchemaVersion,
        cache_key AS cacheKey,
        input_hash AS inputHash,
        pipeline_version AS pipelineVersion,
        source_chapter_id AS sourceChapterId,
        source_chapter_no AS sourceChapterNo,
        request_json AS requestJson,
        result_json AS resultJson,
        status,
        last_seen_at AS lastSeenAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM hanlp_bootstrap_cache
      WHERE branch_id = ?
        AND chapter_id = ?
        AND chapter_no = ?
        AND chapter_text_hash = ?
        AND hanlp_script_version_hash = ?
        AND hanlp_model_or_config_hash = ?
        AND output_schema_version = ?
        AND input_hash = ?
        AND pipeline_version = ?
        AND status = 'ready'
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    params.branchId,
    params.chapterId,
    params.chapterNo,
    params.chapterTextHash,
    params.cacheKey.hanlpScriptVersionHash,
    params.cacheKey.hanlpModelOrConfigHash,
    params.cacheKey.outputSchemaVersion,
    params.cacheKey.inputHash,
    params.cacheKey.pipelineVersion,
  )

  if (!cacheRow) {
    return null
  }

  const cache = mapCacheRow(cacheRow)
  const resultRow = queryOne<HanlpBootstrapResultRow>(
    `
      SELECT
        id,
        novel_id AS novelId,
        branch_id AS branchId,
        knowledge_job_id AS knowledgeJobId,
        chapter_id AS chapterId,
        chapter_no AS chapterNo,
        chapter_source_hash AS chapterSourceHash,
        result_kind AS resultKind,
        provider,
        model,
        result_json AS resultJson,
        status,
        error_message AS errorMessage,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM hanlp_bootstrap_results
      WHERE branch_id = ?
        AND chapter_id = ?
        AND chapter_source_hash = ?
        AND result_kind = 'bootstrap'
      LIMIT 1
    `,
    params.branchId,
    params.chapterId,
    params.chapterTextHash,
  )

  if (!resultRow) {
    execute('DELETE FROM hanlp_bootstrap_cache WHERE id = ?', cache.id)
    return null
  }

  let output: HanlpBootstrapOutput
  try {
    output = validateHanlpBootstrapOutput(JSON.parse(cache.resultJson), {
      chapterNo: params.chapterNo,
      chapterText: JSON.parse(cache.requestJson).chapterText as string,
    })
  } catch {
    execute('DELETE FROM hanlp_bootstrap_entities WHERE source_cache_id = ?', cache.id)
    execute('DELETE FROM hanlp_bootstrap_cache WHERE id = ?', cache.id)
    return null
  }

  execute(
    `
      UPDATE hanlp_bootstrap_cache
      SET last_seen_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    cache.id,
  )

  return {
    cache,
    result: mapResultRow(resultRow),
    output,
  }
}

async function persistHanlpBootstrap(params: {
  input: HanlpBootstrapChapterInput
  branchId: string
  cacheKey: HanlpBootstrapCacheKey
  request: HanlpBootstrapRequestPayload
  output: HanlpBootstrapOutput
  knowledgeJobId?: string | null
}) {
  let cache: HanlpBootstrapCacheRecord | null = null
  let result: HanlpBootstrapResultRecord | null = null

  await withTransaction(() => {
    const existingCache = queryOne<{ id: string }>(
      'SELECT id FROM hanlp_bootstrap_cache WHERE branch_id = ? AND input_hash = ? AND pipeline_version = ? LIMIT 1',
      params.branchId,
      params.cacheKey.inputHash,
      params.cacheKey.pipelineVersion,
    )
    const cacheId = existingCache?.id ?? uid('hanlp-cache')

    execute(
      `
        INSERT INTO hanlp_bootstrap_cache (
          id, novel_id, branch_id, chapter_id, chapter_no, chapter_text_hash,
          hanlp_script_version_hash, hanlp_model_or_config_hash, output_schema_version,
          cache_key, input_hash, pipeline_version, source_chapter_id, source_chapter_no,
          request_json, result_json, status, last_seen_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(branch_id, input_hash, pipeline_version) DO UPDATE SET
          novel_id = excluded.novel_id,
          chapter_id = excluded.chapter_id,
          chapter_no = excluded.chapter_no,
          chapter_text_hash = excluded.chapter_text_hash,
          hanlp_script_version_hash = excluded.hanlp_script_version_hash,
          hanlp_model_or_config_hash = excluded.hanlp_model_or_config_hash,
          output_schema_version = excluded.output_schema_version,
          cache_key = excluded.cache_key,
          source_chapter_id = excluded.source_chapter_id,
          source_chapter_no = excluded.source_chapter_no,
          request_json = excluded.request_json,
          result_json = excluded.result_json,
          status = excluded.status,
          last_seen_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `,
      cacheId,
      params.input.novelId,
      params.branchId,
      params.input.chapterId,
      params.input.chapterNo,
      params.cacheKey.chapterTextHash,
      params.cacheKey.hanlpScriptVersionHash,
      params.cacheKey.hanlpModelOrConfigHash,
      params.cacheKey.outputSchemaVersion,
      params.cacheKey.cacheKey,
      params.cacheKey.inputHash,
      params.cacheKey.pipelineVersion,
      params.input.chapterId,
      params.input.chapterNo,
      JSON.stringify(params.request),
      JSON.stringify(params.output),
    )

    const existingResult = queryOne<{ id: string }>(
      `
        SELECT id
        FROM hanlp_bootstrap_results
        WHERE branch_id = ?
          AND chapter_id = ?
          AND chapter_source_hash = ?
          AND result_kind = 'bootstrap'
        LIMIT 1
      `,
      params.branchId,
      params.input.chapterId,
      params.cacheKey.chapterTextHash,
    )
    const resultId = existingResult?.id ?? uid('hanlp-result')

    execute(
      `
        INSERT INTO hanlp_bootstrap_results (
          id, novel_id, branch_id, knowledge_job_id, chapter_id, chapter_no,
          chapter_source_hash, result_kind, provider, model, result_json, status,
          error_message, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'bootstrap', 'hanlp-local', ?, ?, 'ready', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(branch_id, chapter_id, chapter_source_hash, result_kind) DO UPDATE SET
          novel_id = excluded.novel_id,
          knowledge_job_id = excluded.knowledge_job_id,
          chapter_no = excluded.chapter_no,
          provider = excluded.provider,
          model = excluded.model,
          result_json = excluded.result_json,
          status = excluded.status,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
      `,
      resultId,
      params.input.novelId,
      params.branchId,
      params.knowledgeJobId ?? null,
      params.input.chapterId,
      params.input.chapterNo,
      params.cacheKey.chapterTextHash,
      params.cacheKey.hanlpModelOrConfigHash,
      JSON.stringify(params.output),
    )

    execute('DELETE FROM hanlp_bootstrap_entities WHERE source_result_id = ?', resultId)

    for (const entity of params.output.entities) {
      execute(
        `
          INSERT INTO hanlp_bootstrap_entities (
            id, novel_id, branch_id, chapter_id, chapter_no, entity_text, entity_type,
            total_count, chapter_count, coverage_ratio, score, source_cache_id,
            source_result_id, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        uid('hanlp-entity'),
        params.input.novelId,
        params.branchId,
        params.input.chapterId,
        params.input.chapterNo,
        entity.text,
        entity.entityType,
        entity.totalCount,
        entity.chapterCount,
        entity.coverageRatio,
        entity.score,
        cacheId,
        resultId,
      )
    }

    cache = mapCacheRow(queryOne<HanlpBootstrapCacheRow>(
      `
        SELECT
          id,
          novel_id AS novelId,
          branch_id AS branchId,
          chapter_id AS chapterId,
          chapter_no AS chapterNo,
          chapter_text_hash AS chapterTextHash,
          hanlp_script_version_hash AS hanlpScriptVersionHash,
          hanlp_model_or_config_hash AS hanlpModelOrConfigHash,
          output_schema_version AS outputSchemaVersion,
          cache_key AS cacheKey,
          input_hash AS inputHash,
          pipeline_version AS pipelineVersion,
          source_chapter_id AS sourceChapterId,
          source_chapter_no AS sourceChapterNo,
          request_json AS requestJson,
          result_json AS resultJson,
          status,
          last_seen_at AS lastSeenAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM hanlp_bootstrap_cache
        WHERE id = ?
      `,
      cacheId,
    )!)
    result = mapResultRow(queryOne<HanlpBootstrapResultRow>(
      `
        SELECT
          id,
          novel_id AS novelId,
          branch_id AS branchId,
          knowledge_job_id AS knowledgeJobId,
          chapter_id AS chapterId,
          chapter_no AS chapterNo,
          chapter_source_hash AS chapterSourceHash,
          result_kind AS resultKind,
          provider,
          model,
          result_json AS resultJson,
          status,
          error_message AS errorMessage,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM hanlp_bootstrap_results
        WHERE id = ?
      `,
      resultId,
    )!)
  })

  return {
    cache: cache!,
    result: result!,
  }
}

export async function runHanlpBootstrapForChapter(input: HanlpBootstrapChapterInput, options: HanlpBootstrapRunOptions = {}): Promise<HanlpBootstrapRunResult> {
  const chapterId = requireTrimmedString(input.chapterId, 'chapterId')
  const novelId = requireTrimmedString(input.novelId, 'novelId')
  const chapterNo = requirePositiveInteger(input.chapterNo, 'chapterNo')
  const branchId = normalizeBranchId(novelId, input.branchId)
  const normalizedChapterText = normalizePersistedChapterText(input.rawText)
  const scriptPath = resolveHanlpBootstrapScriptPath(options.scriptPath)
  const cacheKey = buildHanlpBootstrapCacheKey({
    chapterText: normalizedChapterText,
    scriptPath,
    modelOrConfigIdentity: options.modelOrConfigIdentity,
    outputSchemaVersion: options.outputSchemaVersion,
  })

  const cacheHit = loadReadyCache({
    branchId,
    chapterId,
    chapterTextHash: cacheKey.chapterTextHash,
    chapterNo,
    cacheKey,
  })
  if (cacheHit) {
    return {
      source: 'cache',
      cache: cacheHit.cache,
      result: cacheHit.result,
      output: cacheHit.output,
      cacheKey,
      scriptPath,
      normalizedChapterText,
    }
  }

  if (!fs.existsSync(scriptPath) && !options.runner) {
    throw buildHanlpFailure(`HanLP bootstrap script was not found at ${scriptPath}.`)
  }

  const request: HanlpBootstrapRequestPayload = {
    novelId,
    branchId,
    chapterId,
    chapterNo,
    chapterText: normalizedChapterText,
    outputSchemaVersion: cacheKey.outputSchemaVersion,
  }
  const runner = options.runner ?? defaultHanlpBootstrapRunner
  const invocation: HanlpBootstrapSubprocessInvocation = {
    pythonBin: resolvePythonBin(options.pythonBin),
    scriptPath,
    timeoutMs: resolveHanlpBootstrapTimeoutMs(options.timeoutMs),
    request,
  }

  let processResult: HanlpBootstrapSubprocessResult
  try {
    processResult = await runner(invocation)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw buildHanlpFailure(`HanLP bootstrap could not start: ${detail}.`)
  }

  if (processResult.timedOut) {
    throw buildHanlpFailure(`HanLP bootstrap timed out after ${invocation.timeoutMs}ms.`)
  }

  if (processResult.error && processResult.status === null) {
    throw buildHanlpFailure(`HanLP bootstrap failed to launch: ${processResult.error.message}.`)
  }

  if (processResult.status !== 0) {
    const stderr = processResult.stderr.trim() || 'no stderr output'
    throw buildHanlpFailure(`HanLP bootstrap exited with status ${processResult.status ?? 'unknown'}: ${stderr}.`)
  }

  let parsedOutput: unknown
  try {
    parsedOutput = JSON.parse(processResult.stdout)
  } catch {
    throw buildHanlpFailure('HanLP bootstrap emitted malformed JSON.')
  }

  let output: HanlpBootstrapOutput
  try {
    output = validateHanlpBootstrapOutput(parsedOutput, {
      chapterNo,
      chapterText: normalizedChapterText,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw buildHanlpFailure(`HanLP bootstrap returned malformed output: ${detail}.`)
  }

  const persisted = await persistHanlpBootstrap({
    input: { ...input, novelId, branchId, chapterId, chapterNo },
    branchId,
    cacheKey,
    request,
    output,
    knowledgeJobId: options.knowledgeJobId,
  })

  return {
    source: 'runner',
    cache: persisted.cache,
    result: persisted.result,
    output,
    cacheKey,
    scriptPath,
    normalizedChapterText,
  }
}

import { createHash } from 'node:crypto'
import type { GenerationContextRagArtifacts, GenerationContextRequest } from '@/lib/server/context-builder'
import { execute, queryOne } from '@/lib/server/database-access'
import { normalizeBranchId } from '@/lib/server/knowledge-store'
import { uid } from '@/lib/utils'

const SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000

type GenerationContextSnapshotRow = {
  id: string
  novelId: string
  branchId: string
  chapterId: string
  requestFingerprint: string
  knowledgeFingerprint: string
  contextJson: string
  expiresAt: string
}

type SnapshotScope = {
  request: Pick<GenerationContextRequest, 'novelId' | 'branchId' | 'chapterId'>
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([key, nestedValue]) => [key, stableValue(nestedValue)])
  )
}

function hashValue(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function buildArtifactRequestFingerprint(artifacts: GenerationContextRagArtifacts) {
  return hashValue({
    version: artifacts.version,
    graphCacheKey: artifacts.graph.cacheKey,
    evidenceCacheKey: artifacts.evidence.cacheKey,
  })
}

function buildArtifactKnowledgeFingerprint(artifacts: GenerationContextRagArtifacts) {
  return hashValue({
    graphKnowledgeFingerprint: artifacts.graph.knowledgeFingerprint,
    retrievalFingerprint: artifacts.evidence.retrievalFingerprint,
  })
}

function parseRagArtifacts(value: string) {
  try {
    const parsed = JSON.parse(value) as GenerationContextRagArtifacts
    if (!parsed || parsed.version !== 1) return null
    if (!parsed.graph || typeof parsed.graph.cacheKey !== 'string' || typeof parsed.graph.knowledgeFingerprint !== 'string') return null
    if (!parsed.graph.context || !Array.isArray(parsed.graph.context.seedEntities)) return null
    if (!Array.isArray(parsed.graph.context.nodes) || !Array.isArray(parsed.graph.context.edges)) return null
    if (!parsed.evidence || typeof parsed.evidence.cacheKey !== 'string' || typeof parsed.evidence.retrievalFingerprint !== 'string') return null
    if (!Array.isArray(parsed.evidence.matches)) return null
    return parsed
  } catch {
    return null
  }
}

export function createGenerationContextSnapshot(params: SnapshotScope & { artifacts: GenerationContextRagArtifacts }) {
  const branchId = normalizeBranchId(params.request.novelId, params.request.branchId)
  const now = new Date()
  const snapshotId = uid('generation-context')
  const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS).toISOString()
  execute('DELETE FROM GenerationContextSnapshot WHERE expiresAt <= ?', now.toISOString())
  execute(
    `
      INSERT INTO GenerationContextSnapshot (
        id, novelId, branchId, chapterId, requestFingerprint, knowledgeFingerprint, contextJson, expiresAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    snapshotId,
    params.request.novelId,
    branchId,
    params.request.chapterId,
    buildArtifactRequestFingerprint(params.artifacts),
    buildArtifactKnowledgeFingerprint(params.artifacts),
    JSON.stringify(params.artifacts),
    expiresAt,
  )
  return snapshotId
}

export function loadGenerationContextSnapshot(params: SnapshotScope & { snapshotId?: string | null }) {
  const snapshotId = params.snapshotId?.trim()
  if (!snapshotId) return null

  const branchId = normalizeBranchId(params.request.novelId, params.request.branchId)
  const row = queryOne<GenerationContextSnapshotRow>(
    `
      SELECT id, novelId, branchId, chapterId, requestFingerprint, knowledgeFingerprint, contextJson, expiresAt
      FROM GenerationContextSnapshot
      WHERE id = ? AND novelId = ? AND branchId = ? AND chapterId = ?
      LIMIT 1
    `,
    snapshotId,
    params.request.novelId,
    branchId,
    params.request.chapterId,
  )
  if (!row) return null

  if (row.expiresAt <= new Date().toISOString()) {
    execute('DELETE FROM GenerationContextSnapshot WHERE id = ?', row.id)
    return null
  }

  const artifacts = parseRagArtifacts(row.contextJson)
  if (
    !artifacts
    || row.requestFingerprint !== buildArtifactRequestFingerprint(artifacts)
    || row.knowledgeFingerprint !== buildArtifactKnowledgeFingerprint(artifacts)
  ) {
    execute('DELETE FROM GenerationContextSnapshot WHERE id = ?', row.id)
    return null
  }

  return artifacts
}

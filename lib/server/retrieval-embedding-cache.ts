import { hashContent, normalizeBranchId } from '@/lib/server/knowledge-store'
import { execute, queryAll, withTransaction } from '@/lib/server/database-access'
import { chunkValues } from '@/lib/utils'
import { decodeEmbeddingVector, encodeEmbeddingVector } from '@/lib/server/embedding-vector'
import {
  isEmbeddingCacheScopeProtected,
  previewEmbeddingCacheRetention,
  readEmbeddingCacheJobReferences,
  type EmbeddingCacheIdentity,
} from '@/lib/server/storage-retention'

export type RawTextEmbeddingCacheScope = {
  novelId: string
  branchId?: string | null
  provider: string
  model: string
}

export type RetrievalEmbeddingInputParts = {
  sourceLabel?: string | null
  title?: string | null
  relatedEntityNames?: string | null
  relatedEventNames?: string | null
  relatedTerms?: string | null
  text: string
}

export type RawTextEmbeddingCacheUpsertEntry = {
  embeddingInput: string
  vector: number[]
}

export type RawTextEmbeddingCacheEntry = {
  branchId: string
  provider: string
  model: string
  embeddingInputHash: string
  vector: number[]
  vectorDimension: number
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

type RawTextEmbeddingCacheRow = {
  branchId: string
  provider: string
  model: string
  embeddingInputHash: string
  vectorBlob: Uint8Array
  vectorDimension: number
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

type NormalizedRawTextEmbeddingCacheScope = ReturnType<typeof normalizeScope>

function requireTrimmedValue(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function normalizeScope(scope: RawTextEmbeddingCacheScope) {
  return {
    branchId: normalizeBranchId(scope.novelId, scope.branchId),
    provider: requireTrimmedValue(scope.provider, 'Embedding provider'),
    model: requireTrimmedValue(scope.model, 'Embedding model'),
  }
}

function uniqueNonEmptyHashes(embeddingInputHashes: string[]) {
  return Array.from(new Set(embeddingInputHashes.map((hash) => hash.trim()).filter(Boolean)))
}

function validateVector(vector: number[], expectedDimension?: number) {
  if (!Array.isArray(vector) || !vector.length) {
    throw new Error('Embedding vector must be a non-empty array')
  }

  const normalized = vector.map((value, index) => {
    if (!Number.isFinite(value)) {
      throw new Error(`Embedding vector contains a non-finite value at index ${index}`)
    }
    return value
  })

  if (expectedDimension !== undefined && normalized.length !== expectedDimension) {
    throw new Error(`Embedding vectors in the same batch must share one dimension; expected ${expectedDimension} but received ${normalized.length}`)
  }

  return normalized
}

function buildPlaceholders(count: number) {
  return Array.from({ length: count }, () => '?').join(', ')
}

function appendRows<T>(target: T[], source: T[]) {
  for (const row of source) {
    target.push(row)
  }
}

function deleteRawTextEmbeddingCacheHashBatch(scope: NormalizedRawTextEmbeddingCacheScope, hashes: string[]) {
  const result = execute(
    `
      DELETE FROM RawTextEmbeddingCache
      WHERE branchId = ?
        AND provider = ?
        AND model = ?
        AND embeddingInputHash IN (${buildPlaceholders(hashes.length)})
    `,
    scope.branchId,
    scope.provider,
    scope.model,
    ...hashes,
  )

  return Number(result.changes ?? 0)
}

export function buildCanonicalRetrievalEmbeddingInput(parts: RetrievalEmbeddingInputParts) {
  return [
    parts.sourceLabel ?? '',
    parts.title ?? '',
    (parts.relatedEntityNames ?? '').replace(/\n/g, ' '),
    (parts.relatedEventNames ?? '').replace(/\n/g, ' '),
    (parts.relatedTerms ?? '').replace(/\n/g, ' '),
    parts.text,
  ].filter(Boolean).join('\n')
}

export function buildEmbeddingInputHash(embeddingInput: string) {
  return hashContent(embeddingInput)
}

export async function lookupRawTextEmbeddingCacheEntries(params: {
  scope: RawTextEmbeddingCacheScope
  embeddingInputHashes: string[]
  touchOnHit?: boolean
}) {
  const hashes = uniqueNonEmptyHashes(params.embeddingInputHashes)
  if (!hashes.length) {
    return [] as RawTextEmbeddingCacheEntry[]
  }

  const scope = normalizeScope(params.scope)
  const rows: RawTextEmbeddingCacheRow[] = []
  for (const hashBatch of chunkValues(hashes)) {
    appendRows(rows, queryAll<RawTextEmbeddingCacheRow>(
      `
        SELECT branchId, provider, model, embeddingInputHash, vectorBlob, vectorDimension, lastSeenAt, createdAt, updatedAt
        FROM RawTextEmbeddingCache
        WHERE branchId = ?
          AND provider = ?
          AND model = ?
          AND embeddingInputHash IN (${buildPlaceholders(hashBatch.length)})
      `,
      scope.branchId,
      scope.provider,
      scope.model,
      ...hashBatch,
    ))
  }

  const invalidHashes: string[] = []
  const validEntries = new Map<string, RawTextEmbeddingCacheEntry>()

  for (const row of rows) {
    try {
      validEntries.set(row.embeddingInputHash, {
        branchId: row.branchId,
        provider: row.provider,
        model: row.model,
        embeddingInputHash: row.embeddingInputHash,
        vector: decodeEmbeddingVector(row.vectorBlob, row.vectorDimension),
        vectorDimension: row.vectorDimension,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })
    } catch {
      invalidHashes.push(row.embeddingInputHash)
    }
  }

  if (invalidHashes.length) {
    await withTransaction(() => {
      for (const hashBatch of chunkValues(invalidHashes)) {
        deleteRawTextEmbeddingCacheHashBatch(scope, hashBatch)
      }
    })
  }

  const matchedHashes = hashes.filter((hash) => validEntries.has(hash))
  if (params.touchOnHit && matchedHashes.length) {
    await withTransaction(() => {
      for (const hashBatch of chunkValues(matchedHashes)) {
        execute(
          `
            UPDATE RawTextEmbeddingCache
            SET lastSeenAt = CURRENT_TIMESTAMP,
                updatedAt = CURRENT_TIMESTAMP
            WHERE branchId = ?
              AND provider = ?
              AND model = ?
              AND embeddingInputHash IN (${buildPlaceholders(hashBatch.length)})
          `,
          scope.branchId,
          scope.provider,
          scope.model,
          ...hashBatch,
        )
      }
    })
  }

  return hashes.map((hash) => validEntries.get(hash)).filter((entry): entry is RawTextEmbeddingCacheEntry => Boolean(entry))
}

export async function upsertRawTextEmbeddingCacheEntries(params: {
  scope: RawTextEmbeddingCacheScope
  entries: RawTextEmbeddingCacheUpsertEntry[]
}) {
  if (!params.entries.length) {
    return 0
  }

  const scope = normalizeScope(params.scope)
  let expectedDimension: number | undefined
  const dedupedEntries = new Map<string, { bytes: Uint8Array; dimension: number }>()

  for (const entry of params.entries) {
    const embeddingInput = requireTrimmedValue(entry.embeddingInput, 'Embedding input')
    const vector = validateVector(entry.vector, expectedDimension)
    expectedDimension ??= vector.length
    dedupedEntries.set(buildEmbeddingInputHash(embeddingInput), { bytes: encodeEmbeddingVector(vector), dimension: vector.length })
  }

  await withTransaction(() => {
    for (const [embeddingInputHash, entry] of dedupedEntries) {
      execute(
        `
          INSERT INTO RawTextEmbeddingCache (
            branchId,
            provider,
            model,
            embeddingInputHash,
            vectorBlob,
            vectorDimension,
            lastSeenAt,
            createdAt,
            updatedAt
          )
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(branchId, provider, model, embeddingInputHash) DO UPDATE SET
            vectorBlob = excluded.vectorBlob,
            vectorDimension = excluded.vectorDimension,
            lastSeenAt = CURRENT_TIMESTAMP,
            updatedAt = CURRENT_TIMESTAMP
        `,
        scope.branchId,
        scope.provider,
        scope.model,
        embeddingInputHash,
        entry.bytes,
        entry.dimension,
      )
    }
  })

  return dedupedEntries.size
}

export async function deleteRawTextEmbeddingCacheEntries(params: {
  scope: RawTextEmbeddingCacheScope
  embeddingInputHashes: string[]
}) {
  const hashes = uniqueNonEmptyHashes(params.embeddingInputHashes)
  if (!hashes.length) {
    return 0
  }

  const scope = normalizeScope(params.scope)
  let deletedCount = 0
  await withTransaction(() => {
    for (const hashBatch of chunkValues(hashes)) {
      deletedCount += deleteRawTextEmbeddingCacheHashBatch(scope, hashBatch)
    }
  })

  return deletedCount
}

export async function garbageCollectRawTextEmbeddingCacheEntries(params: {
  scope: RawTextEmbeddingCacheScope
  reachableEmbeddingInputHashes: string[]
}) {
  const scope = normalizeScope(params.scope)
  const hashes = uniqueNonEmptyHashes(params.reachableEmbeddingInputHashes)

  if (!hashes.length) {
    const result = execute(
      `
        DELETE FROM RawTextEmbeddingCache
        WHERE branchId = ?
          AND provider = ?
          AND model = ?
      `,
      scope.branchId,
      scope.provider,
      scope.model,
    )
    return Number(result.changes ?? 0)
  }

  const reachableHashes = new Set(hashes)
  const cachedRows = queryAll<{ embeddingInputHash: string }>(
    `
      SELECT embeddingInputHash
      FROM RawTextEmbeddingCache
      WHERE branchId = ?
        AND provider = ?
        AND model = ?
    `,
    scope.branchId,
    scope.provider,
    scope.model,
  )
  const staleHashes = cachedRows
    .map((row) => row.embeddingInputHash)
    .filter((hash) => !reachableHashes.has(hash))
  let deletedCount = 0
  await withTransaction(() => {
    for (const hashBatch of chunkValues(staleHashes)) {
      deletedCount += deleteRawTextEmbeddingCacheHashBatch(scope, hashBatch)
    }
  })

  return deletedCount
}

export async function pruneInactiveRawTextEmbeddingCache(params: {
  novelId: string
  currentIdentities: readonly EmbeddingCacheIdentity[] | (() => readonly EmbeddingCacheIdentity[])
}) {
  // Run at rebuild completion, not on individual cache hits. Bound each pass so
  // large inactive caches are reclaimed gradually without a single huge DELETE.
  const currentIdentities = () => typeof params.currentIdentities === 'function'
    ? params.currentIdentities() : params.currentIdentities
  const preview = previewEmbeddingCacheRetention({ queryAll }, params.novelId, currentIdentities())
  let deletedRows = 0
  for (const scope of preview.scopes.filter((scope) => scope.eligible)) {
    if (deletedRows >= 2000) break
    await withTransaction(() => {
      const jobs = readEmbeddingCacheJobReferences({ queryAll }, params.novelId)
      if (isEmbeddingCacheScopeProtected(scope, currentIdentities(), jobs)) return
      const changed = queryAll<{ lastSeenAt: string }>(
        'SELECT MAX(lastSeenAt) AS lastSeenAt FROM RawTextEmbeddingCache WHERE branchId = ? AND provider = ? AND model = ?',
        scope.branchId, scope.provider, scope.model,
      )[0]
      if (changed?.lastSeenAt !== scope.lastSeenAt) return
      const result = execute(
        `DELETE FROM RawTextEmbeddingCache WHERE rowid IN (
           SELECT rowid FROM RawTextEmbeddingCache WHERE branchId = ? AND provider = ? AND model = ? LIMIT ?
         )`,
        scope.branchId, scope.provider, scope.model, Math.min(500, 2000 - deletedRows),
      )
      deletedRows += Number(result.changes)
    })
  }
  return { preview, deletedRows }
}

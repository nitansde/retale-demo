// Dependency-free policy and metadata queries shared by the app and read-only CLI.
type RetentionReader = {
  queryAll: <T>(sql: string, ...params: string[]) => T[]
}

function positiveInteger(value: string | undefined, fallback: number, name: string) {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return parsed
}

export function readStorageRetentionPolicy(env: Record<string, string | undefined> = process.env) {
  return {
    backupMaxCount: positiveInteger(env.RETALE_BACKUP_MAX_COUNT, 20, 'RETALE_BACKUP_MAX_COUNT'),
    backupMaxBytes: positiveInteger(env.RETALE_BACKUP_MAX_BYTES, 200 * 1024 ** 2, 'RETALE_BACKUP_MAX_BYTES'),
    cacheMaxBytes: positiveInteger(env.RETALE_EMBEDDING_CACHE_MAX_BYTES, 1024 ** 3, 'RETALE_EMBEDDING_CACHE_MAX_BYTES'),
    cacheMaxAgeDays: positiveInteger(env.RETALE_EMBEDDING_CACHE_MAX_AGE_DAYS, 30, 'RETALE_EMBEDDING_CACHE_MAX_AGE_DAYS'),
    cacheGraceDays: positiveInteger(env.RETALE_EMBEDDING_CACHE_GRACE_DAYS, 7, 'RETALE_EMBEDDING_CACHE_GRACE_DAYS'),
  }
}

export type StorageRetentionPolicy = ReturnType<typeof readStorageRetentionPolicy>

export function previewWorkspaceBackupRetention(
  db: RetentionReader,
  workspaceStateId = 'singleton',
  policy = readStorageRetentionPolicy(),
) {
  const rows = db.queryAll<{ id: string; bytes: number }>(
    // octet_length gives the same UTF-8 byte count as LENGTH(CAST(... AS BLOB))
    // using SQLite record metadata, without materializing every large payload.
    `SELECT id, COALESCE(octet_length(payload), 0) AS bytes
     FROM WorkspaceStateBackup WHERE workspaceStateId = ?
     ORDER BY createdAt DESC, rowid DESC`,
    workspaceStateId,
  )
  let retainedBytes = rows.reduce((sum, row) => sum + row.bytes, 0)
  let retainedCount = rows.length
  const candidates: typeof rows = []
  // Always preserve the newest recovery point, even when it alone exceeds budget.
  while (retainedCount > 1 && (retainedCount > policy.backupMaxCount || retainedBytes > policy.backupMaxBytes)) {
    const row = rows[retainedCount - 1]!
    candidates.push(row)
    retainedBytes -= row.bytes
    retainedCount -= 1
  }
  return {
    workspaceStateId,
    totalCount: rows.length,
    totalBytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    candidates,
    eligibleBytes: candidates.reduce((sum, row) => sum + row.bytes, 0),
    retainedCount,
    retainedBytes,
    overBudgetBytes: Math.max(0, retainedBytes - policy.backupMaxBytes),
  }
}

export type EmbeddingCacheIdentity = { provider: string; model: string }
type CacheScope = EmbeddingCacheIdentity & { branchId: string; rows: number; bytes: number; lastSeenAt: string }
type JobReference = {
  branchId: string | null
  provider: string | null
  model: string | null
  cacheModelIdentity: string | null
}

export function readEmbeddingCacheJobReferences(db: RetentionReader, novelId: string) {
  return db.queryAll<JobReference>(
    `SELECT branchId,
       CASE WHEN json_valid(payloadJson) THEN json_extract(payloadJson, '$.embeddingSettingsSnapshot.provider') END AS provider,
       CASE WHEN json_valid(payloadJson) THEN json_extract(payloadJson, '$.embeddingSettingsSnapshot.model') END AS model,
       CASE WHEN json_valid(payloadJson) THEN json_extract(payloadJson, '$.embeddingSettingsSnapshot.cacheModelIdentity') END AS cacheModelIdentity
     FROM KnowledgeJob WHERE novelId = ?
       AND jobType IN ('extract_chapter_knowledge', 'rebuild_retrieval_index')
       AND status IN ('queued', 'running', 'paused')`,
    novelId,
  )
}

export function isEmbeddingCacheScopeProtected(
  scope: EmbeddingCacheIdentity & { branchId: string },
  currentIdentities: readonly EmbeddingCacheIdentity[],
  jobs: readonly JobReference[],
) {
  if (currentIdentities.some((identity) => identity.provider === scope.provider && identity.model === scope.model)) return true
  return jobs.some((job) => {
    if (job.branchId && job.branchId !== scope.branchId) return false
    // Old/incomplete snapshots must not cause active or resumable work to lose its cache.
    if (typeof job.provider !== 'string' || !job.provider || typeof job.model !== 'string' || !job.model) return true
    if (job.provider !== scope.provider) return false
    if (typeof job.cacheModelIdentity === 'string' && job.cacheModelIdentity) return job.cacheModelIdentity === scope.model
    return job.model === scope.model || scope.model.startsWith(`${job.model}|`)
  })
}

export function previewEmbeddingCacheRetention(
  db: RetentionReader,
  novelId: string,
  currentIdentities: readonly EmbeddingCacheIdentity[],
  policy = readStorageRetentionPolicy(),
  now = Date.now(),
) {
  const scopes = db.queryAll<CacheScope>(
    `SELECT cache.branchId, provider, model, COUNT(*) AS rows,
       SUM(octet_length(vectorBlob)) AS bytes, MAX(lastSeenAt) AS lastSeenAt
     FROM RawTextEmbeddingCache cache JOIN StoryBranch branch ON branch.id = cache.branchId
     WHERE branch.novelId = ? GROUP BY cache.branchId, provider, model
     ORDER BY MAX(lastSeenAt), cache.branchId, provider, model`,
    novelId,
  )
  const jobs = readEmbeddingCacheJobReferences(db, novelId)
  const totalBytes = scopes.reduce((sum, scope) => sum + scope.bytes, 0)
  let retainedBytes = totalBytes
  const assessedScopes = scopes.map((scope) => {
    const timestamp = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(scope.lastSeenAt)
      ? scope.lastSeenAt : `${scope.lastSeenAt.replace(' ', 'T')}Z`)
    const ageDays = (now - timestamp) / 86_400_000
    const protectedScope = isEmbeddingCacheScopeProtected(scope, currentIdentities, jobs)
    const eligible = !protectedScope && Number.isFinite(ageDays) && ageDays >= policy.cacheGraceDays
      && (ageDays >= policy.cacheMaxAgeDays || retainedBytes > policy.cacheMaxBytes)
    if (eligible) retainedBytes -= scope.bytes
    return { ...scope, protected: protectedScope, eligible }
  })
  return {
    novelId,
    scopes: assessedScopes,
    totalBytes,
    eligibleBytes: totalBytes - retainedBytes,
    eligibleRows: assessedScopes.reduce((sum, scope) => sum + (scope.eligible ? scope.rows : 0), 0),
    retainedBytes,
    overBudgetBytes: Math.max(0, retainedBytes - policy.cacheMaxBytes),
  }
}

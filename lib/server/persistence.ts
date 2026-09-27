import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { safeParseJson } from '@/lib/server/json-parse'
import { CURRENT_NOVEL_SCHEMA_VERSION, PROTECTED_RESET_APP_SETTING_KEYS } from '@/lib/server/schema'
import { serializeNovelResourceState } from '@/lib/workspace-state'
import {
  createControlDatabaseAccess,
  createNovelDatabaseAccess,
  execute,
  queryAll,
  type DatabaseAccess,
  withTransaction,
} from '@/lib/server/database-access'
import {
  evictNovelStorageCache,
  getNovelStoragePaths,
  purgeNovelQuarantine,
  quarantineNovelStorage,
  validateNovelDeletionPaths,
  validateNovelId,
} from '@/lib/server/db-resolver'
import { runWithPerNovelWriteGate } from '@/lib/server/per-novel-write-gate'
import { parseScopedWorkspacePayload } from '@/lib/server/workspace-novel-scope'
import { previewWorkspaceBackupRetention } from '@/lib/server/storage-retention'

type WorkspaceStateRow = {
  id: string
  payload: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

type WorkspaceStateWriteOptions = {
  backupReason?: string
  novelId?: string
  db?: DatabaseAccess
}

type WorkspaceDbContext = {
  novelId?: string
  db?: DatabaseAccess
}

type WorkspaceKnowledgeSyncStateRow = {
  workspaceStateId: string
  requestedRevision: number
  startedRevision: number | null
  syncedRevision: number
  requestedSourceUpdatedAt: string | null
  startedSourceUpdatedAt: string | null
  startedAt: string | null
  claimToken: string | null
  syncedSourceUpdatedAt: string | null
  lastError: string | null
}

export type WorkspaceKnowledgeSyncClaim = {
  workspaceStateId: string
  revision: number
  sourceUpdatedAt: string
  claimToken: string
}

type AppSettingRow = {
  id: string
  key: string
  value: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceNovelRegistryRow = {
  novelId: string
  safeNovelId: string
  title: string | null
  author?: string | null
  dbFilePath: string
  lanceDbPath: string
  schemaVersion: string
  migrationStatus: 'ready' | 'deleting' | 'deleted' | string
  lifecycleToken: string | null
  leaseExpiresAt: string | null
  claimedAt: string | null
  createdAt: string
  updatedAt: string
}

export type WorkspaceNovelLifecycleClock = Date | string

const WORKSPACE_NOVEL_CREATOR_LEASE_MS = 15 * 60 * 1000
const WORKSPACE_NOVEL_CLEANUP_LEASE_MS = 2 * 60 * 1000

function lifecycleNow(clock?: WorkspaceNovelLifecycleClock) {
  const now = clock instanceof Date ? clock : clock ? new Date(clock) : new Date()
  if (Number.isNaN(now.getTime())) throw new Error('Invalid workspace novel lifecycle clock')
  return now
}

function lifecycleTimestamp(clock?: WorkspaceNovelLifecycleClock) {
  return lifecycleNow(clock).toISOString()
}

function lifecycleLeaseTimestamp(clock: WorkspaceNovelLifecycleClock | undefined, leaseMs: number) {
  return new Date(lifecycleNow(clock).getTime() + leaseMs).toISOString()
}

function createLifecycleToken() {
  return randomBytes(32).toString('hex')
}

export function beginWorkspaceNovelCreation(params: { novelId: string; title?: string | null; now?: WorkspaceNovelLifecycleClock }) {
  const novelId = validateNovelId(params.novelId)
  const paths = getNovelStoragePaths(novelId)
  const controlDb = createControlDatabaseAccess()
  const creatorToken = createLifecycleToken()
  const now = lifecycleTimestamp(params.now)
  const leaseExpiresAt = lifecycleLeaseTimestamp(params.now, WORKSPACE_NOVEL_CREATOR_LEASE_MS)
  return controlDb.withTransaction(() => {
    const existing = findWorkspaceNovelRegistryRow(novelId)
    if (existing) throw new WorkspaceNovelStateConflictError(`Novel "${novelId}" already exists`)
    controlDb.execute(
      `INSERT INTO NovelRegistry (
         novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus,
         lifecycleToken, leaseExpiresAt, claimedAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?, ?)`,
      novelId,
      novelId,
      params.title?.trim() || null,
      paths.databasePath,
      paths.lanceDbPath,
      CURRENT_NOVEL_SCHEMA_VERSION,
      creatorToken,
      leaseExpiresAt,
      now,
      now,
    )
    return creatorToken
  })
}

export async function renewWorkspaceNovelCreation(
  novelId: string,
  creatorToken: string,
  clock?: WorkspaceNovelLifecycleClock,
) {
  const stableNovelId = validateNovelId(novelId)
  const controlDb = createControlDatabaseAccess()
  const now = lifecycleTimestamp(clock)
  const leaseExpiresAt = lifecycleLeaseTimestamp(clock, WORKSPACE_NOVEL_CREATOR_LEASE_MS)
  const transition = await controlDb.withTransaction(() => controlDb.execute(
    `UPDATE NovelRegistry
     SET leaseExpiresAt = ?, updatedAt = ?
     WHERE novelId = ? AND migrationStatus = 'creating' AND lifecycleToken = ?
       AND leaseExpiresAt > ?`,
    leaseExpiresAt,
    now,
    stableNovelId,
    creatorToken,
    now,
  ))
  if (transition.changes !== 1) {
    throw new WorkspaceNovelStateConflictError(`Novel "${stableNovelId}" creation lease is no longer owned`)
  }
}

export function publishWorkspaceNovelCreation(
  novelId: string,
  creatorToken: string,
  clock?: WorkspaceNovelLifecycleClock,
) {
  const stableNovelId = validateNovelId(novelId)
  const controlDb = createControlDatabaseAccess()
  const now = lifecycleTimestamp(clock)
  return controlDb.withTransaction(() => {
    const transition = controlDb.execute(
      `UPDATE NovelRegistry
       SET migrationStatus = 'ready', lifecycleToken = NULL, leaseExpiresAt = NULL,
           claimedAt = NULL, updatedAt = ?
       WHERE novelId = ? AND migrationStatus = 'creating' AND lifecycleToken = ?
         AND leaseExpiresAt > ?`,
      now,
      stableNovelId,
      creatorToken,
      now,
    )
    if (transition.changes !== 1) {
      throw new WorkspaceNovelStateConflictError(`Novel "${stableNovelId}" creation is no longer publishable`)
    }
  })
}

export async function abortWorkspaceNovelCreation(
  novelId: string,
  creatorToken: string,
  clock?: WorkspaceNovelLifecycleClock,
) {
  const stableNovelId = validateNovelId(novelId)
  const controlDb = createControlDatabaseAccess()
  const cleanupToken = createLifecycleToken()
  const now = lifecycleTimestamp(clock)
  const leaseExpiresAt = lifecycleLeaseTimestamp(clock, WORKSPACE_NOVEL_CLEANUP_LEASE_MS)
  const claimed = await controlDb.withTransaction(() => controlDb.execute(
      `UPDATE NovelRegistry
       SET migrationStatus = 'deleting', lifecycleToken = ?, leaseExpiresAt = ?,
           claimedAt = ?, updatedAt = ?
       WHERE novelId = ? AND migrationStatus = 'creating' AND lifecycleToken = ?
         AND leaseExpiresAt > ?`,
       cleanupToken,
       leaseExpiresAt,
       now,
       now,
       stableNovelId,
       creatorToken,
       now,
    ))
  if (claimed.changes !== 1) return null
  return cleanupWorkspaceNovelUnderGate(stableNovelId, cleanupToken, clock)
}

export class WorkspaceNovelDeletionError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message)
    this.name = 'WorkspaceNovelDeletionError'
  }
}

export class WorkspaceNovelStateConflictError extends Error {
  readonly status = 409

  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceNovelStateConflictError'
  }
}

export type WorkspaceNovelDeletionResult = {
  deletedNovelId: string
  nextNovelId: string | null
  deletionState: 'deleted'
  cleanupPending: boolean
}

export type WorkspaceNovelDeletionState = 'ready' | 'deleting' | 'deleted'

type SqliteTableRow = {
  name: string
}

const [PRESET_COMPAT_LIBRARY_V1_KEY, AI_SETTINGS_V2_KEY, OLLAMA_TIMEOUT_MS_KEY] = PROTECTED_RESET_APP_SETTING_KEYS
const WORKSPACE_KNOWLEDGE_SYNC_STALE_MS = 5 * 60 * 1000
const WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT = 25
let workspaceNovelDeletedPurgeCursor: Pick<WorkspaceNovelRegistryRow, 'updatedAt' | 'novelId'> | null = null

export type ProtectedAppSettingsResetSnapshot = {
  presetCompatLibraryV1: string | null
  aiSettingsV2: string | null
  ollamaTimeoutMs: string | null
}

function getNovelDatabaseAccess(novelId: string) {
  return createNovelDatabaseAccess(novelId)
}

function resolveWorkspaceDbContext(context: WorkspaceDbContext = {}) {
  if (context.db) {
    return context.db
  }

  const novelId = context.novelId
  if (!novelId) {
    return null
  }

  return getNovelDatabaseAccess(novelId)
}

export function readWorkspaceNovelDeletionState(novelId: string): WorkspaceNovelDeletionState {
  let stableNovelId: string
  try {
    stableNovelId = validateNovelId(novelId)
  } catch (error) {
    throw new WorkspaceNovelDeletionError(error instanceof Error ? error.message : 'Invalid novel ID', 400)
  }

  const row = createControlDatabaseAccess().queryOne<{ migrationStatus: string }>(
    'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
    stableNovelId,
  )
  if (!row) {
    throw new WorkspaceNovelDeletionError('Novel not found', 404)
  }
  if (!['ready', 'deleting', 'deleted'].includes(row.migrationStatus)) {
    throw new WorkspaceNovelDeletionError('Novel deletion state is unavailable', 409)
  }
  return row.migrationStatus as WorkspaceNovelDeletionState
}

function upsertWorkspaceNovelRegistryInDb(
  controlDb: DatabaseAccess,
  params: { novelId: string; title?: string | null },
) {
  const paths = getNovelStoragePaths(params.novelId)
  controlDb.execute(
    `INSERT INTO NovelRegistry (
       novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus
     ) VALUES (?, ?, ?, ?, ?, ?, 'ready')
     ON CONFLICT(novelId) DO UPDATE SET
       title = COALESCE(excluded.title, NovelRegistry.title),
        dbFilePath = excluded.dbFilePath,
        lanceDbPath = excluded.lanceDbPath,
        schemaVersion = excluded.schemaVersion,
        updatedAt = CURRENT_TIMESTAMP
      WHERE NovelRegistry.migrationStatus = 'ready'`,
    params.novelId,
    params.novelId,
    params.title?.trim() || null,
    paths.databasePath,
    paths.lanceDbPath,
    CURRENT_NOVEL_SCHEMA_VERSION,
  )
}

export async function upsertWorkspaceNovelRegistry(params: { novelId: string; title?: string | null }) {
  const controlDb = createControlDatabaseAccess()
  return controlDb.withTransaction(() => upsertWorkspaceNovelRegistryInDb(controlDb, params))
}

export async function publishWorkspaceNovelWriteTarget(params: { novelId: string; title?: string | null }) {
  const novelId = validateNovelId(params.novelId)
  const controlDb = createControlDatabaseAccess()
  return controlDb.withTransaction(() => {
    const existing = controlDb.queryOne<{ migrationStatus: string }>(
      'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
      novelId,
    )
    if (existing && existing.migrationStatus !== 'ready') {
      throw new WorkspaceNovelStateConflictError('Novel deletion is already in progress or complete')
    }
    upsertWorkspaceNovelRegistryInDb(controlDb, { ...params, novelId })
  })
}

export function assertWorkspaceNovelReadyForWrite(novelId: string) {
  const row = createControlDatabaseAccess().queryOne<{ migrationStatus: string }>(
    'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
    novelId,
  )
  if (row && row.migrationStatus !== 'ready') {
    throw new WorkspaceNovelStateConflictError('Novel deletion is already in progress or complete')
  }
}

export function listReadyWorkspaceNovelRegistry() {
  return createControlDatabaseAccess().queryAll<WorkspaceNovelRegistryRow>(
    `SELECT novelId, safeNovelId, title, author, dbFilePath, lanceDbPath, schemaVersion, migrationStatus,
            lifecycleToken, leaseExpiresAt, claimedAt, createdAt, updatedAt
     FROM NovelRegistry
     WHERE migrationStatus = 'ready'
     ORDER BY createdAt ASC, novelId ASC`
  )
}

export type WorkspaceNovelLibraryMetadata = {
  novelId: string
  title: string
  author: string
}

export function readWorkspaceNovelLibraryMetadata(novelId: string): WorkspaceNovelLibraryMetadata {
  const stableNovelId = validateNovelId(novelId)
  const row = createControlDatabaseAccess().queryOne<{
    novelId: string
    title: string | null
    author: string | null
    migrationStatus: string
  }>(
    `SELECT novelId, title, author, migrationStatus
     FROM NovelRegistry
     WHERE novelId = ?`,
    stableNovelId,
  )
  if (!row) {
    throw new WorkspaceNovelDeletionError('Novel not found', 404)
  }
  if (row.migrationStatus !== 'ready') {
    throw new WorkspaceNovelDeletionError('Novel is not available for metadata updates', 409)
  }
  return {
    novelId: row.novelId,
    title: row.title?.trim() ?? '',
    author: row.author?.trim() ?? '',
  }
}

export async function updateWorkspaceNovelLibraryMetadata(metadata: WorkspaceNovelLibraryMetadata) {
  const stableNovelId = validateNovelId(metadata.novelId)
  const controlDb = createControlDatabaseAccess()
  return controlDb.withTransaction(() => {
    const result = controlDb.execute(
      `UPDATE NovelRegistry
       SET title = ?, author = ?, updatedAt = CURRENT_TIMESTAMP
       WHERE novelId = ? AND migrationStatus = 'ready'`,
      metadata.title.trim(),
      metadata.author.trim() || null,
      stableNovelId,
    )
    if (result.changes !== 1) {
      const row = controlDb.queryOne<{ migrationStatus: string }>(
        'SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?',
        stableNovelId,
      )
      throw new WorkspaceNovelDeletionError(
        row ? 'Novel is not available for metadata updates' : 'Novel not found',
        row ? 409 : 404,
      )
    }
  })
}

function assertCanonicalRegistryStoragePaths(row: WorkspaceNovelRegistryRow) {
  const expectedPaths = getNovelStoragePaths(row.novelId)
  if (
    row.safeNovelId !== row.novelId
    || path.resolve(row.dbFilePath) !== path.resolve(expectedPaths.databasePath)
    || path.resolve(row.lanceDbPath) !== path.resolve(expectedPaths.lanceDbPath)
  ) {
    throw new Error(`Novel registry storage paths do not match the canonical paths for "${row.novelId}"`)
  }
}

function findWorkspaceNovelRegistryRow(novelId: string) {
  return createControlDatabaseAccess().queryOne<WorkspaceNovelRegistryRow>(
    `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus,
            lifecycleToken, leaseExpiresAt, claimedAt, createdAt, updatedAt
     FROM NovelRegistry
     WHERE novelId = ?`,
    novelId,
  )
}

async function cleanupWorkspaceNovelUnderGate(
  novelId: string,
  cleanupToken: string,
  clock?: WorkspaceNovelLifecycleClock,
  readyCompensation: {
    target: WorkspaceNovelRegistryRow
  } | null = null,
) {
  const controlDb = createControlDatabaseAccess()
  const target = findWorkspaceNovelRegistryRow(novelId)
  const now = lifecycleTimestamp(clock)
  if (
    !target
    || target.migrationStatus !== 'deleting'
    || target.lifecycleToken !== cleanupToken
    || !target.leaseExpiresAt
    || target.leaseExpiresAt <= now
  ) {
    return null
  }

  const storagePaths = validateNovelDeletionPaths(novelId)
  assertCanonicalRegistryStoragePaths(target)

  try {
    const renewed = await renewWorkspaceNovelCleanup(novelId, cleanupToken, clock)
    if (!renewed) return null
    evictNovelStorageCache(novelId)
    const renewedBeforeMove = await renewWorkspaceNovelCleanup(novelId, cleanupToken, clock)
    if (!renewedBeforeMove) return null
    quarantineNovelStorage(storagePaths)
    const renewedAfterMove = await renewWorkspaceNovelCleanup(novelId, cleanupToken, clock)
    if (!renewedAfterMove) return null
  } catch (error) {
    if (
      readyCompensation
      && fs.existsSync(storagePaths.novelDirectory)
      && !fs.existsSync(storagePaths.quarantinePath)
    ) {
      await controlDb.withTransaction(() => {
        const compensated = controlDb.execute(
          `UPDATE NovelRegistry
            SET safeNovelId = ?, title = ?, dbFilePath = ?, lanceDbPath = ?, schemaVersion = ?,
                migrationStatus = ?, lifecycleToken = ?, leaseExpiresAt = ?, claimedAt = ?,
                createdAt = ?, updatedAt = ?
            WHERE novelId = ? AND migrationStatus = 'deleting' AND lifecycleToken = ?`,
          readyCompensation.target.safeNovelId,
          readyCompensation.target.title,
          readyCompensation.target.dbFilePath,
          readyCompensation.target.lanceDbPath,
          readyCompensation.target.schemaVersion,
          readyCompensation.target.migrationStatus,
          readyCompensation.target.lifecycleToken,
          readyCompensation.target.leaseExpiresAt,
          readyCompensation.target.claimedAt,
          readyCompensation.target.createdAt,
          readyCompensation.target.updatedAt,
          novelId,
          cleanupToken,
        )
        if (compensated.changes !== 1) {
          return
        }
      })
    }
    throw error
  }

  const finalNow = lifecycleTimestamp(clock)
  await controlDb.withTransaction(() => {
      const finalized = controlDb.execute(
        `UPDATE NovelRegistry
          SET migrationStatus = 'deleted', lifecycleToken = NULL, leaseExpiresAt = NULL,
              claimedAt = NULL, updatedAt = ?
          WHERE novelId = ? AND migrationStatus = 'deleting' AND lifecycleToken = ?
            AND leaseExpiresAt > ?`,
        finalNow,
        novelId,
        cleanupToken,
        finalNow,
      )
      if (finalized.changes !== 1) {
        throw new Error(`Failed to finalize deletion tombstone for "${novelId}"`)
      }
  })

  let cleanupPending = false
  try {
    purgeNovelQuarantine(storagePaths)
  } catch (error) {
    cleanupPending = true
    console.error('Failed to purge quarantined novel storage:', error)
  }

  return { cleanupPending }
}

async function renewWorkspaceNovelCleanup(
  novelId: string,
  cleanupToken: string,
  clock?: WorkspaceNovelLifecycleClock,
) {
  const controlDb = createControlDatabaseAccess()
  const now = lifecycleTimestamp(clock)
  const leaseExpiresAt = lifecycleLeaseTimestamp(clock, WORKSPACE_NOVEL_CLEANUP_LEASE_MS)
  const renewed = await controlDb.withTransaction(() => controlDb.execute(
    `UPDATE NovelRegistry
     SET leaseExpiresAt = ?, updatedAt = ?
     WHERE novelId = ? AND migrationStatus = 'deleting' AND lifecycleToken = ?
       AND leaseExpiresAt > ?`,
    leaseExpiresAt,
    now,
    novelId,
    cleanupToken,
    now,
  ))
  return renewed.changes === 1
}

async function claimExpiredWorkspaceNovelCreation(novelId: string, clock?: WorkspaceNovelLifecycleClock) {
  const controlDb = createControlDatabaseAccess()
  const cleanupToken = createLifecycleToken()
  const now = lifecycleTimestamp(clock)
  const leaseExpiresAt = lifecycleLeaseTimestamp(clock, WORKSPACE_NOVEL_CLEANUP_LEASE_MS)
  const claimed = await controlDb.withTransaction(() => controlDb.execute(
    `UPDATE NovelRegistry
     SET migrationStatus = 'deleting', lifecycleToken = ?, leaseExpiresAt = ?,
         claimedAt = ?, updatedAt = ?
     WHERE novelId = ? AND migrationStatus = 'creating'
       AND (leaseExpiresAt IS NULL OR leaseExpiresAt <= ?)`,
    cleanupToken,
    leaseExpiresAt,
    now,
    now,
    novelId,
    now,
  ))
  return claimed.changes === 1 ? cleanupToken : null
}

async function claimWorkspaceNovelCleanupTakeover(novelId: string, clock?: WorkspaceNovelLifecycleClock) {
  const controlDb = createControlDatabaseAccess()
  const cleanupToken = createLifecycleToken()
  const now = lifecycleTimestamp(clock)
  const leaseExpiresAt = lifecycleLeaseTimestamp(clock, WORKSPACE_NOVEL_CLEANUP_LEASE_MS)
  const claimed = await controlDb.withTransaction(() => controlDb.execute(
    `UPDATE NovelRegistry
     SET lifecycleToken = ?, leaseExpiresAt = ?, claimedAt = ?, updatedAt = ?
     WHERE novelId = ? AND migrationStatus = 'deleting'
       AND (lifecycleToken IS NULL OR leaseExpiresAt IS NULL OR leaseExpiresAt <= ?)`,
    cleanupToken,
    leaseExpiresAt,
    now,
    now,
    novelId,
    now,
  ))
  return claimed.changes === 1 ? cleanupToken : null
}

export async function resumeWorkspaceNovelCleanup(novelId: string, clock?: WorkspaceNovelLifecycleClock) {
  const stableNovelId = validateNovelId(novelId)
  return runWithPerNovelWriteGate(stableNovelId, async () => {
    const row = findWorkspaceNovelRegistryRow(stableNovelId)
    if (!row) return null
    if (row.migrationStatus === 'deleted') {
      const storagePaths = validateNovelDeletionPaths(stableNovelId)
      assertCanonicalRegistryStoragePaths(row)
      let cleanupPending = false
      try {
        purgeNovelQuarantine(storagePaths)
      } catch (error) {
        cleanupPending = true
        console.error('Failed to purge quarantined novel storage:', error)
      }
      return { cleanupPending }
    }
    const cleanupToken = row.migrationStatus === 'creating'
      ? await claimExpiredWorkspaceNovelCreation(stableNovelId, clock)
      : row.migrationStatus === 'deleting'
        ? await claimWorkspaceNovelCleanupTakeover(stableNovelId, clock)
        : null
    if (!cleanupToken) return null
    return cleanupWorkspaceNovelUnderGate(stableNovelId, cleanupToken, clock)
  })
}

export async function resumePendingWorkspaceNovelCleanup(clock?: WorkspaceNovelLifecycleClock) {
  const controlDb = createControlDatabaseAccess()
  const now = lifecycleTimestamp(clock)
  const creatingRows = controlDb.queryAll<WorkspaceNovelRegistryRow>(
    `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus,
            lifecycleToken, leaseExpiresAt, claimedAt, createdAt, updatedAt
     FROM NovelRegistry
     WHERE migrationStatus = 'creating' AND (leaseExpiresAt IS NULL OR leaseExpiresAt <= ?)
     ORDER BY COALESCE(leaseExpiresAt, updatedAt) ASC, novelId ASC
     LIMIT ?`,
    now,
    WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT,
  )
  const deletingRows = controlDb.queryAll<WorkspaceNovelRegistryRow>(
    `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus,
            lifecycleToken, leaseExpiresAt, claimedAt, createdAt, updatedAt
     FROM NovelRegistry
     WHERE migrationStatus = 'deleting'
       AND (lifecycleToken IS NULL OR leaseExpiresAt IS NULL OR leaseExpiresAt <= ?)
     ORDER BY COALESCE(leaseExpiresAt, updatedAt) ASC, novelId ASC
     LIMIT ?`,
    now,
    WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT,
  )
  const cursor = workspaceNovelDeletedPurgeCursor
  const deletedRows = cursor
    ? controlDb.queryAll<WorkspaceNovelRegistryRow>(
        `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus,
                lifecycleToken, leaseExpiresAt, claimedAt, createdAt, updatedAt
         FROM NovelRegistry
          WHERE migrationStatus = 'deleted'
            AND (
               updatedAt > ? OR (updatedAt = ? AND novelId > ?)
            )
          ORDER BY updatedAt ASC, novelId ASC
         LIMIT ?`,
        cursor.updatedAt,
        cursor.updatedAt,
        cursor.novelId,
        WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT,
      )
    : controlDb.queryAll<WorkspaceNovelRegistryRow>(
        `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus,
                lifecycleToken, leaseExpiresAt, claimedAt, createdAt, updatedAt
         FROM NovelRegistry
          WHERE migrationStatus = 'deleted'
          ORDER BY updatedAt ASC, novelId ASC
         LIMIT ?`,
        WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT,
      )

  workspaceNovelDeletedPurgeCursor = deletedRows.length < WORKSPACE_NOVEL_CLEANUP_SCAN_LIMIT
    ? null
    : deletedRows.at(-1) ?? null

  for (const row of [...creatingRows, ...deletingRows, ...deletedRows]) {
    try {
      if (row.migrationStatus === 'deleted') {
        const storagePaths = getNovelStoragePaths(row.novelId)
        if (!fs.existsSync(storagePaths.novelDirectory) && !fs.existsSync(storagePaths.quarantinePath)) {
          continue
        }
      }

      await resumeWorkspaceNovelCleanup(row.novelId, clock)
    } catch (error) {
      console.error('Failed to resume quarantined novel cleanup:', row.novelId, error)
    }
  }
}

export async function deleteWorkspaceNovel(params: {
  novelId: string
  nextNovelId?: string | null
  now?: WorkspaceNovelLifecycleClock
}): Promise<WorkspaceNovelDeletionResult> {
  let novelId: string
  try {
    novelId = validateNovelId(params.novelId)
  } catch (error) {
    throw new WorkspaceNovelDeletionError(error instanceof Error ? error.message : 'Invalid novel ID', 400)
  }

  let requestedNextNovelId: string | null = null
  if (params.nextNovelId !== undefined && params.nextNovelId !== null) {
    try {
      requestedNextNovelId = validateNovelId(params.nextNovelId)
    } catch (error) {
      throw new WorkspaceNovelDeletionError(error instanceof Error ? error.message : 'Invalid survivor novel ID', 409)
    }

    if (requestedNextNovelId === novelId) {
      throw new WorkspaceNovelDeletionError('The survivor novel must differ from the deleted novel', 409)
    }
  }

  return runWithPerNovelWriteGate(novelId, async () => {
    const controlDb = createControlDatabaseAccess()
    const target = findWorkspaceNovelRegistryRow(novelId)
    if (!target) {
      throw new WorkspaceNovelDeletionError('Novel not found', 404)
    }
    if (!['ready', 'deleting', 'deleted'].includes(target.migrationStatus)) {
      throw new WorkspaceNovelDeletionError('Novel not found', 404)
    }

    const storagePaths = validateNovelDeletionPaths(novelId)
    assertCanonicalRegistryStoragePaths(target)

    let nextNovelId: string | null = null
    let readyCompensation: {
      target: WorkspaceNovelRegistryRow
    } | null = null
    let cleanupToken: string | null = null

    if (target.migrationStatus === 'ready') {
      if (fs.existsSync(storagePaths.databasePath)) {
        const novelDb = getNovelDatabaseAccess(novelId)
        const activeJob = novelDb.queryOne<{ status: string }>(
          `SELECT status FROM KnowledgeJob
           WHERE status IN ('queued', 'running', 'paused')
           LIMIT 1`,
        )
        if (activeJob) {
          throw new WorkspaceNovelDeletionError(`Novel has active knowledge work (${activeJob.status})`, 409)
        }
        const activeSync = novelDb.queryOne<{ requestedRevision: number; syncedRevision: number; startedRevision: number | null }>(
          `SELECT requestedRevision, syncedRevision, startedRevision
           FROM WorkspaceKnowledgeSyncState
           WHERE requestedRevision > syncedRevision OR startedRevision IS NOT NULL
           LIMIT 1`,
        )
        if (activeSync) {
          throw new WorkspaceNovelDeletionError('Novel has pending workspace knowledge synchronization', 409)
        }
      }

      const transition = await controlDb.withTransaction(() => {
        const currentTarget = findWorkspaceNovelRegistryRow(novelId)
        if (!currentTarget || currentTarget.migrationStatus !== 'ready') {
          throw new WorkspaceNovelDeletionError('Novel deletion is already in progress or complete', 409)
        }
        const survivors = controlDb.queryAll<WorkspaceNovelRegistryRow>(
          `SELECT novelId, safeNovelId, title, dbFilePath, lanceDbPath, schemaVersion, migrationStatus,
                  lifecycleToken, leaseExpiresAt, claimedAt, createdAt, updatedAt
           FROM NovelRegistry
           WHERE novelId != ? AND migrationStatus = 'ready'
           ORDER BY createdAt ASC, novelId ASC`,
          novelId,
        )
        const requestedSurvivor = requestedNextNovelId
          ? survivors.find((row) => row.novelId === requestedNextNovelId) ?? null
          : null
        if (requestedNextNovelId && !requestedSurvivor) {
          throw new WorkspaceNovelDeletionError('The requested survivor novel is not available', 409)
        }
        const canonicalNextNovelId = requestedSurvivor?.novelId
          ?? survivors[0]?.novelId
          ?? null
        const canonicalNextNovel = survivors.find((row) => row.novelId === canonicalNextNovelId) ?? null
        if (canonicalNextNovel) {
          assertCanonicalRegistryStoragePaths(canonicalNextNovel)
        }

        const nextCleanupToken = createLifecycleToken()
        const now = lifecycleTimestamp(params.now)
        const leaseExpiresAt = lifecycleLeaseTimestamp(params.now, WORKSPACE_NOVEL_CLEANUP_LEASE_MS)
        const claimed = controlDb.execute(
          `UPDATE NovelRegistry
            SET migrationStatus = 'deleting', lifecycleToken = ?, leaseExpiresAt = ?,
                claimedAt = ?, updatedAt = ?
            WHERE novelId = ? AND migrationStatus = 'ready'`,
          nextCleanupToken,
          leaseExpiresAt,
          now,
          now,
          novelId,
        )
        if (claimed.changes !== 1) {
          throw new WorkspaceNovelDeletionError('Novel deletion is already in progress or complete', 409)
        }
        return {
          nextNovelId: canonicalNextNovelId,
          cleanupToken: nextCleanupToken,
          compensation: {
            target: currentTarget,
          },
        }
      })
      nextNovelId = transition.nextNovelId
      cleanupToken = transition.cleanupToken
      readyCompensation = transition.compensation
    } else if (target.migrationStatus === 'deleting') {
      cleanupToken = await claimWorkspaceNovelCleanupTakeover(novelId, params.now)
    } else {
      const resumed = await resumeWorkspaceNovelCleanup(novelId, params.now)
      return {
        deletedNovelId: novelId,
        nextNovelId,
        deletionState: 'deleted',
        cleanupPending: resumed?.cleanupPending ?? false,
      }
    }

    if (!cleanupToken) {
      throw new WorkspaceNovelDeletionError('Novel deletion is already in progress or complete', 409)
    }
    const cleanup = await cleanupWorkspaceNovelUnderGate(novelId, cleanupToken, params.now, readyCompensation)
    if (!cleanup) {
      throw new WorkspaceNovelDeletionError('Novel deletion is already in progress or complete', 409)
    }

    return {
      deletedNovelId: novelId,
      nextNovelId,
      deletionState: 'deleted',
      cleanupPending: cleanup.cleanupPending,
    }
  })
}

export function findWorkspaceState(id = 'singleton', context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) return null
  return readWorkspaceStateFromDb(db, id)
}

export function readWorkspaceStateFromDb(db: DatabaseAccess, id = 'singleton') {
  return db.queryOne<WorkspaceStateRow>('SELECT id, payload, revision, createdAt, updatedAt FROM WorkspaceState WHERE id = ?', id)
}

export function createWorkspaceState(id: string, payload: string, context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) {
    throw new Error('Cannot create workspace state without a target novel database')
  }

  db.execute('INSERT INTO WorkspaceState (id, payload) VALUES (?, ?)', id, payload)
  const created = findWorkspaceState(id, { db })
  if (!created) {
    throw new Error('Failed to create workspace state')
  }
  return created
}

export function createWorkspaceStateBackupInDb(db: DatabaseAccess, row: WorkspaceStateRow, reason: string) {
  db.execute(
    `INSERT INTO WorkspaceStateBackup (id, workspaceStateId, payload, revision, reason, sourceUpdatedAt)
     VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)`,
    row.id,
    row.payload,
    row.revision,
    reason,
    row.updatedAt
  )
}

export function pruneWorkspaceStateBackupsInDb(db: DatabaseAccess, id = 'singleton') {
  const preview = previewWorkspaceBackupRetention(db, id)
  for (const candidate of preview.candidates) {
    db.execute('DELETE FROM WorkspaceStateBackup WHERE workspaceStateId = ? AND id = ?', id, candidate.id)
  }
  return preview
}

export function writeWorkspaceStateInDb(db: DatabaseAccess, id: string, payload: string, revision?: number) {
  const resolvedRevision = revision ?? db.queryOne<{ revision: number }>(
    `SELECT COALESCE(
       (SELECT revision FROM WorkspaceRuntimeState WHERE id = ?),
       (SELECT revision FROM WorkspaceState WHERE id = ?),
       0
     ) AS revision`,
    id,
    id,
  )?.revision ?? 0
  db.execute(
    `INSERT INTO WorkspaceState (id, payload, revision)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       revision = excluded.revision,
       updatedAt = CURRENT_TIMESTAMP`,
    id,
    payload,
    resolvedRevision,
  )
  const saved = readWorkspaceStateFromDb(db, id)
  if (!saved) {
    throw new Error('Failed to save workspace state')
  }
  return saved
}

export async function upsertWorkspaceState(id: string, payload: string, options: WorkspaceStateWriteOptions = {}) {
  const scopedPayload = options.db || options.novelId
    ? { serializedPayload: payload, novelId: options.novelId ?? null, title: null as string | null }
    : (() => {
        const parsed = parseScopedWorkspacePayload(payload)
        return {
          serializedPayload: JSON.stringify(serializeNovelResourceState(parsed.scoped)),
          novelId: parsed.novelId,
          title: parsed.scoped.localNovels[0]?.title ?? null,
        }
      })()

  const novelId = options.novelId ?? scopedPayload.novelId
  if (!novelId && !options.db) {
    throw new Error('Cannot save workspace payload without a target novel')
  }

  if (novelId) {
    assertWorkspaceNovelReadyForWrite(novelId)
    await publishWorkspaceNovelWriteTarget({ novelId, title: scopedPayload.title })
  }

  const db = options.db ?? (novelId ? getNovelDatabaseAccess(novelId) : null)
  if (!db) {
    throw new Error('Cannot save workspace payload without a novel database')
  }

  await db.withTransaction(() => {
    const existing = readWorkspaceStateFromDb(db, id)
    if (existing && existing.payload !== scopedPayload.serializedPayload) {
      createWorkspaceStateBackupInDb(db, existing, options.backupReason ?? 'overwrite')
    }
    writeWorkspaceStateInDb(db, id, scopedPayload.serializedPayload)
    pruneWorkspaceStateBackupsInDb(db, id)
  })

  const saved = findWorkspaceState(id, { db })
  if (!saved) {
    throw new Error('Failed to save workspace state')
  }
  return saved
}

function findWorkspaceKnowledgeSyncState(id: string, db: DatabaseAccess) {
  return db.queryOne<WorkspaceKnowledgeSyncStateRow>(
    `SELECT workspaceStateId, requestedRevision, startedRevision, syncedRevision,
            requestedSourceUpdatedAt, startedSourceUpdatedAt, startedAt, claimToken, syncedSourceUpdatedAt, lastError
     FROM WorkspaceKnowledgeSyncState
     WHERE workspaceStateId = ?`,
    id
  )
}

function parseSqliteTimestamp(value: string | null) {
  if (!value) return Number.NaN
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/u.test(normalized) ? normalized : `${normalized}Z`)
}

function hasFreshWorkspaceKnowledgeSyncStart(startedAt: string | null) {
  const startedAtMs = parseSqliteTimestamp(startedAt)
  if (!Number.isFinite(startedAtMs)) return false
  return Date.now() - startedAtMs < WORKSPACE_KNOWLEDGE_SYNC_STALE_MS
}

export function workspaceKnowledgeSyncNeedsScheduling(id = 'singleton', context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) return false

  const syncState = findWorkspaceKnowledgeSyncState(id, db)
  if (
    !syncState?.requestedSourceUpdatedAt
    || syncState.requestedRevision <= syncState.syncedRevision
  ) {
    return false
  }

  return syncState.startedRevision !== syncState.requestedRevision
    || !hasFreshWorkspaceKnowledgeSyncStart(syncState.startedAt)
}

export function markWorkspaceKnowledgeSyncRequested(id: string, sourceUpdatedAt: string, context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) {
    throw new Error('Cannot queue workspace knowledge sync without a target novel database')
  }

  markWorkspaceKnowledgeSyncRequestedInDb(db, id, sourceUpdatedAt)
}

export function markWorkspaceKnowledgeSyncRequestedInDb(db: DatabaseAccess, id: string, sourceUpdatedAt: string) {
  db.execute(
     `INSERT INTO WorkspaceKnowledgeSyncState (
       workspaceStateId,
       requestedRevision,
       requestedSourceUpdatedAt,
       startedSourceUpdatedAt,
       startedAt,
       claimToken,
       syncedSourceUpdatedAt,
       lastError
     ) VALUES (?, 1, ?, NULL, NULL, NULL, NULL, NULL)
     ON CONFLICT(workspaceStateId) DO UPDATE SET
       requestedRevision = WorkspaceKnowledgeSyncState.requestedRevision + 1,
       requestedSourceUpdatedAt = excluded.requestedSourceUpdatedAt,
       updatedAt = CURRENT_TIMESTAMP`,
     id,
     sourceUpdatedAt
  )
}

export async function claimPendingWorkspaceKnowledgeSync(
  id = 'singleton',
  context: WorkspaceDbContext = {},
): Promise<WorkspaceKnowledgeSyncClaim | null> {
  const db = resolveWorkspaceDbContext(context)
  if (!db) return null

  return db.withTransaction(() => {
    const syncState = findWorkspaceKnowledgeSyncState(id, db)
    const requestedSourceUpdatedAt = syncState?.requestedSourceUpdatedAt ?? null
    const requestedRevision = syncState?.requestedRevision ?? 0

    if (!requestedSourceUpdatedAt || requestedRevision <= (syncState?.syncedRevision ?? 0)) {
      return null
    }

    if (
      syncState?.startedRevision === requestedRevision
      && hasFreshWorkspaceKnowledgeSyncStart(syncState.startedAt)
    ) {
      return null
    }

    const claimToken = randomBytes(32).toString('hex')
    db.execute(
      `INSERT INTO WorkspaceKnowledgeSyncState (
         workspaceStateId,
         requestedRevision,
         startedRevision,
         syncedRevision,
         requestedSourceUpdatedAt,
         startedSourceUpdatedAt,
         startedAt,
         claimToken,
         syncedSourceUpdatedAt,
         lastError
       ) VALUES (?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP, ?, NULL, NULL)
       ON CONFLICT(workspaceStateId) DO UPDATE SET
         startedRevision = excluded.startedRevision,
         startedSourceUpdatedAt = excluded.startedSourceUpdatedAt,
         startedAt = CURRENT_TIMESTAMP,
         claimToken = excluded.claimToken,
         lastError = NULL,
         updatedAt = CURRENT_TIMESTAMP`,
      id,
      requestedRevision,
      requestedRevision,
      requestedSourceUpdatedAt,
      requestedSourceUpdatedAt,
      claimToken
    )

    return {
      workspaceStateId: id,
      revision: requestedRevision,
      sourceUpdatedAt: requestedSourceUpdatedAt,
      claimToken,
    }
  })
}

export async function completeWorkspaceKnowledgeSync(claim: WorkspaceKnowledgeSyncClaim, context: WorkspaceDbContext = {}) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) {
    throw new Error('Cannot complete workspace knowledge sync without a target novel database')
  }

  return db.withTransaction(() => {
    const result = db.execute(
      `UPDATE WorkspaceKnowledgeSyncState
       SET syncedRevision = MAX(syncedRevision, ?),
           syncedSourceUpdatedAt = CASE
             WHEN ? >= syncedRevision THEN ?
             ELSE syncedSourceUpdatedAt
           END,
           startedRevision = NULL,
           startedSourceUpdatedAt = NULL,
           startedAt = NULL,
           claimToken = NULL,
           lastError = NULL,
           updatedAt = CURRENT_TIMESTAMP
       WHERE workspaceStateId = ?
         AND startedRevision = ?
         AND startedSourceUpdatedAt = ?
         AND claimToken = ?`,
      claim.revision,
      claim.revision,
      claim.sourceUpdatedAt,
      claim.workspaceStateId,
      claim.revision,
      claim.sourceUpdatedAt,
      claim.claimToken,
    )
    return result.changes === 1
  })
}

export async function failWorkspaceKnowledgeSync(
  claim: WorkspaceKnowledgeSyncClaim,
  errorMessage: string,
  context: WorkspaceDbContext = {},
) {
  const db = resolveWorkspaceDbContext(context)
  if (!db) {
    throw new Error('Cannot fail workspace knowledge sync without a target novel database')
  }

  return db.withTransaction(() => {
    const result = db.execute(
      `UPDATE WorkspaceKnowledgeSyncState
       SET startedRevision = NULL,
           startedSourceUpdatedAt = NULL,
           startedAt = NULL,
           claimToken = NULL,
           lastError = ?,
           updatedAt = CURRENT_TIMESTAMP
       WHERE workspaceStateId = ?
         AND startedRevision = ?
         AND startedSourceUpdatedAt = ?
         AND claimToken = ?`,
      errorMessage,
      claim.workspaceStateId,
      claim.revision,
      claim.sourceUpdatedAt,
      claim.claimToken,
    )
    return result.changes === 1
  })
}

export function findAppSettings(keys: readonly string[]) {
  if (!keys.length) return [] as AppSettingRow[]
  const controlDb = createControlDatabaseAccess()
  const placeholders = keys.map(() => '?').join(', ')
  return controlDb.queryAll<AppSettingRow>(
    `SELECT id, key, value, createdAt, updatedAt FROM AppSetting WHERE key IN (${placeholders})`,
    ...keys
  )
}

export async function upsertAppSettings(entries: ReadonlyArray<readonly [string, string]>) {
  const controlDb = createControlDatabaseAccess()
  await controlDb.withTransaction(async () => {
    for (const [key, value] of entries) {
      controlDb.execute(
        `
          INSERT INTO AppSetting (id, key, value)
          VALUES (lower(hex(randomblob(16))), ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updatedAt = CURRENT_TIMESTAMP
        `,
        key,
        value
      )
    }
  })
}

function quoteSqlIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonBlob(value: string | null) {
  return safeParseJson(value)
}

function isPositiveIntegerString(value: string) {
  return /^[1-9]\d*$/.test(value.trim())
}

function readProtectedAppSettingsResetSnapshot(controlDb: DatabaseAccess): ProtectedAppSettingsResetSnapshot {
  const placeholders = PROTECTED_RESET_APP_SETTING_KEYS.map(() => '?').join(', ')
  const entries = controlDb.queryAll<AppSettingRow>(
    `SELECT id, key, value, createdAt, updatedAt FROM AppSetting WHERE key IN (${placeholders})`,
    ...PROTECTED_RESET_APP_SETTING_KEYS
  )
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value])) as Partial<Record<(typeof PROTECTED_RESET_APP_SETTING_KEYS)[number], string>>
  return {
    presetCompatLibraryV1: map.PRESET_COMPAT_LIBRARY_V1 ?? null,
    aiSettingsV2: map.AI_SETTINGS_V2 ?? null,
    ollamaTimeoutMs: map.OLLAMA_TIMEOUT_MS ?? null,
  }
}

function validateProtectedAppSettingsResetSnapshot(snapshot: ProtectedAppSettingsResetSnapshot) {
  if (snapshot.presetCompatLibraryV1 !== null && !isRecord(parseJsonBlob(snapshot.presetCompatLibraryV1))) {
    throw new Error('Protected reset snapshot for PRESET_COMPAT_LIBRARY_V1 is invalid')
  }

  if (snapshot.aiSettingsV2 !== null && parseJsonBlob(snapshot.aiSettingsV2) === null) {
    throw new Error('Protected reset snapshot for AI_SETTINGS_V2 is invalid')
  }

  if (snapshot.ollamaTimeoutMs !== null && !isPositiveIntegerString(snapshot.ollamaTimeoutMs)) {
    throw new Error('Protected reset snapshot for OLLAMA_TIMEOUT_MS is invalid')
  }
}

function listResettableTables() {
  return queryAll<SqliteTableRow>(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name != 'AppSetting'
      ORDER BY name ASC
    `
  ).map((row) => row.name)
}

function clearBusinessDataTables() {
  const tables = listResettableTables()
  execute('PRAGMA foreign_keys = OFF')
  try {
    for (const tableName of tables) {
      execute(`DELETE FROM ${quoteSqlIdentifier(tableName)}`)
    }
  } finally {
    execute('PRAGMA foreign_keys = ON')
  }
}

function clearNonProtectedAppSettings(controlDb: DatabaseAccess) {
  const placeholders = PROTECTED_RESET_APP_SETTING_KEYS.map(() => '?').join(', ')
  controlDb.execute(
    `DELETE FROM AppSetting WHERE key NOT IN (${placeholders})`,
    ...PROTECTED_RESET_APP_SETTING_KEYS
  )
}

function restoreProtectedAppSettings(controlDb: DatabaseAccess, snapshot: ProtectedAppSettingsResetSnapshot) {
  const nextEntries: Array<readonly [string, string]> = []
  if (snapshot.presetCompatLibraryV1 !== null) {
    nextEntries.push([PRESET_COMPAT_LIBRARY_V1_KEY, snapshot.presetCompatLibraryV1])
  }
  if (snapshot.aiSettingsV2 !== null) {
    nextEntries.push([AI_SETTINGS_V2_KEY, snapshot.aiSettingsV2])
  }
  if (snapshot.ollamaTimeoutMs !== null) {
    nextEntries.push([OLLAMA_TIMEOUT_MS_KEY, snapshot.ollamaTimeoutMs])
  }

  for (const key of PROTECTED_RESET_APP_SETTING_KEYS) {
    const shouldExist = nextEntries.some(([entryKey]) => entryKey === key)
    if (!shouldExist) {
      controlDb.execute('DELETE FROM AppSetting WHERE key = ?', key)
    }
  }

  for (const [key, value] of nextEntries) {
    controlDb.execute(
      `
        INSERT INTO AppSetting (id, key, value)
        VALUES (lower(hex(randomblob(16))), ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updatedAt = CURRENT_TIMESTAMP
      `,
      key,
      value
    )
  }
}

function assertProtectedAppSettingsRestored(controlDb: DatabaseAccess, snapshot: ProtectedAppSettingsResetSnapshot) {
  const restored = readProtectedAppSettingsResetSnapshot(controlDb)
  validateProtectedAppSettingsResetSnapshot(restored)

  if (
    restored.presetCompatLibraryV1 !== snapshot.presetCompatLibraryV1
    || restored.aiSettingsV2 !== snapshot.aiSettingsV2
    || restored.ollamaTimeoutMs !== snapshot.ollamaTimeoutMs
  ) {
    throw new Error('Protected reset restore validation failed')
  }
}

export async function resetBusinessDataPreservingProtectedSettings() {
  const controlDb = createControlDatabaseAccess()
  const controlMutation = await controlDb.withTransaction(() => {
    const fullSnapshot = controlDb.queryAll<AppSettingRow>(
      'SELECT id, key, value, createdAt, updatedAt FROM AppSetting ORDER BY rowid ASC',
    )
    const snapshot = readProtectedAppSettingsResetSnapshot(controlDb)
    validateProtectedAppSettingsResetSnapshot(snapshot)
    controlDb.execute('DELETE FROM WritingSkillDistillationJob')
    controlDb.execute('DELETE FROM WritingSkillCard')
    clearNonProtectedAppSettings(controlDb)
    restoreProtectedAppSettings(controlDb, snapshot)
    assertProtectedAppSettingsRestored(controlDb, snapshot)
    return { snapshot, fullSnapshot }
  })

  try {
    await withTransaction(async () => {
      clearBusinessDataTables()
    })
  } catch (originalFailure) {
    try {
      await controlDb.withTransaction(() => {
        controlDb.execute('DELETE FROM AppSetting')
        for (const row of controlMutation.fullSnapshot) {
          controlDb.execute(
            `INSERT INTO AppSetting (id, key, value, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?)`,
            row.id,
            row.key,
            row.value,
            row.createdAt,
            row.updatedAt,
          )
        }
      })
    } catch (compensationFailure) {
      throw new AggregateError(
        [originalFailure, compensationFailure],
        'Novel business reset failed and control settings compensation also failed',
      )
    }
    throw originalFailure
  }
  return controlMutation.snapshot
}

import { InputValidationError } from '@/lib/server/domain-errors'
import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import type * as NodeSqlite from 'node:sqlite'
import { CONTROL_SCHEMA_SQL } from '@/lib/server/schema'
import { initializeDatabase, openSqliteDatabase } from '@/lib/server/sqlite'
import { assertOwnedTestPath } from '../../scripts/test-path-safety.mjs'

type DatabaseSync = NodeSqlite.DatabaseSync

export type NovelRegistryMigrationStatus = 'creating' | 'ready' | 'deleting' | 'deleted' | string

export type NovelStoragePaths = {
  dataRootPath: string
  novelsRootPath: string
  quarantineRootPath: string
  novelDirectory: string
  databasePath: string
  lanceDbPath: string
  quarantinePath: string
}

export class NovelRegistryNotReadyError extends Error {
  constructor(readonly novelId: string, readonly migrationStatus: NovelRegistryMigrationStatus) {
    super(`Novel "${novelId}" is not available while its registry status is "${migrationStatus}"`)
    this.name = 'NovelRegistryNotReadyError'
  }
}

const globalForDbResolver = globalThis as {
  __retaleNovelDatabaseOverrides?: Map<string, DatabaseSync>
  __retaleResolvedDbs?: Map<string, DatabaseSync>
}

const creatingNovelResolutionScope = new AsyncLocalStorage<ReadonlySet<string>>()

export function runWithCreatingNovelResolution<T>(novelId: string, callback: () => T): T
export function runWithCreatingNovelResolution<T>(novelId: string, callback: () => Promise<T>): Promise<T>
export function runWithCreatingNovelResolution<T>(novelId: string, callback: () => T | Promise<T>) {
  const stableNovelId = validateNovelId(novelId)
  const authorizedNovelIds = new Set(creatingNovelResolutionScope.getStore() ?? [])
  authorizedNovelIds.add(stableNovelId)
  return creatingNovelResolutionScope.run(authorizedNovelIds, callback)
}

function getNovelDatabaseOverrides() {
  if (!globalForDbResolver.__retaleNovelDatabaseOverrides) {
    globalForDbResolver.__retaleNovelDatabaseOverrides = new Map<string, DatabaseSync>()
  }

  return globalForDbResolver.__retaleNovelDatabaseOverrides
}

function getResolverCache() {
  if (!globalForDbResolver.__retaleResolvedDbs) {
    globalForDbResolver.__retaleResolvedDbs = new Map<string, DatabaseSync>()
  }

  return globalForDbResolver.__retaleResolvedDbs
}

export function getDataRootPath() {
  const configuredBasePath = process.env.RETALE_DATA_DIR?.trim()
  const resolvedPath = configuredBasePath && configuredBasePath.length > 0
    ? path.resolve(process.cwd(), configuredBasePath)
    : (() => {
        const isBuildPhase = process.env.npm_lifecycle_event === 'build'
          || process.env.NEXT_PHASE === 'phase-production-build'
          || process.env.__NEXT_PRIVATE_BUILD_WORKER === '1'

        return path.resolve(process.cwd(), isBuildPhase ? 'build/runtime/next-build-data' : 'data')
      })()

  if (process.env.VITEST === 'true') {
    const testRoot = process.env.RETALE_TEST_ROOT
    if (!testRoot) {
      throw new Error('Vitest database resolution requires RETALE_TEST_ROOT')
    }
    return assertOwnedTestPath(testRoot, resolvedPath, {
      repoRoot: process.cwd(),
      label: 'Vitest RETALE_DATA_DIR',
    })
  }

  return resolvedPath
}

function assertContainedPath(basePath: string, candidatePath: string, label: string) {
  const relativePath = path.relative(basePath, candidatePath)
  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return
  }

  throw new Error(`${label} resolves outside the configured data directory`)
}

function canonicalizePotentialPath(candidatePath: string) {
  const unresolvedParts: string[] = []
  let existingPath = path.resolve(candidatePath)

  while (!fs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath)
    if (parentPath === existingPath) {
      break
    }
    unresolvedParts.unshift(path.basename(existingPath))
    existingPath = parentPath
  }

  const canonicalExistingPath = fs.existsSync(existingPath)
    ? fs.realpathSync.native(existingPath)
    : existingPath
  return path.join(canonicalExistingPath, ...unresolvedParts)
}

function readPathStats(candidatePath: string) {
  try {
    return fs.lstatSync(candidatePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertExistingPathIsNotSymlink(candidatePath: string, label: string) {
  if (readPathStats(candidatePath)?.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`)
  }
}

export function validateNovelId(novelId: string) {
  if (typeof novelId !== 'string') {
    throw new InputValidationError('Invalid novel ID: expected a string')
  }

  if (novelId.trim().length === 0) {
    throw new InputValidationError('Invalid novel ID: value cannot be blank')
  }

  if (novelId !== novelId.trim()) {
    throw new InputValidationError('Invalid novel ID: value cannot include leading or trailing whitespace')
  }

  if (novelId === '.' || novelId === '..') {
    throw new InputValidationError(`Invalid novel ID: "${novelId}" is not allowed`)
  }

  if (novelId.includes('/') || novelId.includes('\\')) {
    throw new InputValidationError(`Invalid novel ID: "${novelId}" cannot contain path separators`)
  }

  if (!/^[A-Za-z0-9._-]+$/.test(novelId)) {
    throw new InputValidationError(`Invalid novel ID: "${novelId}" contains unsupported characters`)
  }

  return novelId
}

function getCanonicalCacheKey(filePath: string) {
  const absolutePath = path.resolve(filePath)
  if (!fs.existsSync(absolutePath)) {
    return absolutePath
  }

  return fs.realpathSync.native(absolutePath)
}

export function getNovelRegistryMigrationStatus(novelId: string) {
  const stableNovelId = validateNovelId(novelId)
  return getControlDb().prepare('SELECT migrationStatus FROM NovelRegistry WHERE novelId = ?').get(stableNovelId) as {
    migrationStatus: NovelRegistryMigrationStatus
  } | undefined
}

function assertNovelRegistryReadyOrMissing(novelId: string) {
  const registry = getNovelRegistryMigrationStatus(novelId)
  const creatingAuthorized = registry?.migrationStatus === 'creating'
    && creatingNovelResolutionScope.getStore()?.has(novelId)
  if (registry && registry.migrationStatus !== 'ready' && !creatingAuthorized) {
    throw new NovelRegistryNotReadyError(novelId, registry.migrationStatus)
  }
}

function openResolvedDatabase(databasePath: string, options?: { schemaSql?: string; mode?: 'full' | 'control' }) {
  if (process.env.VITEST === 'true') {
    const testRoot = process.env.RETALE_TEST_ROOT
    if (!testRoot) {
      throw new Error('Vitest database resolution requires RETALE_TEST_ROOT')
    }
    assertOwnedTestPath(testRoot, databasePath, {
      repoRoot: process.cwd(),
      label: 'Vitest resolved database',
    })
  }
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  const cacheKey = getCanonicalCacheKey(databasePath)
  const cache = getResolverCache()
  const cached = cache.get(cacheKey)
  if (cached) {
    return cached
  }

  const database = openSqliteDatabase(databasePath)
  try {
    initializeDatabase(database, options)
    cache.set(cacheKey, database)
    return database
  } catch (error) { database.close(); throw error }
}

function getNovelDirectory(novelId: string) {
  const stableNovelId = validateNovelId(novelId)
  const novelsRootPath = path.join(getDataRootPath(), 'novels')
  const novelDirectory = path.resolve(novelsRootPath, stableNovelId)
  assertContainedPath(novelsRootPath, novelDirectory, `Novel ID "${novelId}"`)
  return novelDirectory
}

export function getNovelStoragePaths(novelId: string): NovelStoragePaths {
  const stableNovelId = validateNovelId(novelId)
  const dataRootPath = getDataRootPath()
  const novelsRootPath = path.join(dataRootPath, 'novels')
  const quarantineRootPath = path.join(dataRootPath, '.novel-quarantine')
  const novelDirectory = getNovelDirectory(stableNovelId)
  return {
    dataRootPath,
    novelsRootPath,
    quarantineRootPath,
    novelDirectory,
    databasePath: path.join(novelDirectory, 'novel.db'),
    lanceDbPath: path.join(novelDirectory, 'lancedb'),
    quarantinePath: path.resolve(quarantineRootPath, stableNovelId),
  }
}

export function validateNovelDeletionPaths(novelId: string) {
  const paths = getNovelStoragePaths(novelId)
  assertExistingPathIsNotSymlink(paths.dataRootPath, 'Configured data directory')
  assertExistingPathIsNotSymlink(paths.novelsRootPath, 'Novel storage root')
  assertExistingPathIsNotSymlink(paths.quarantineRootPath, 'Novel quarantine root')
  assertExistingPathIsNotSymlink(paths.novelDirectory, `Novel storage for "${novelId}"`)
  assertExistingPathIsNotSymlink(paths.quarantinePath, `Novel quarantine for "${novelId}"`)

  const canonicalDataRoot = canonicalizePotentialPath(paths.dataRootPath)
  const canonicalNovelsRoot = canonicalizePotentialPath(paths.novelsRootPath)
  const canonicalQuarantineRoot = canonicalizePotentialPath(paths.quarantineRootPath)
  const canonicalNovelDirectory = canonicalizePotentialPath(paths.novelDirectory)
  const canonicalQuarantinePath = canonicalizePotentialPath(paths.quarantinePath)
  assertContainedPath(canonicalDataRoot, canonicalNovelsRoot, 'Novel storage root')
  assertContainedPath(canonicalDataRoot, canonicalQuarantineRoot, 'Novel quarantine root')
  assertContainedPath(canonicalNovelsRoot, canonicalNovelDirectory, `Novel storage for "${novelId}"`)
  assertContainedPath(canonicalQuarantineRoot, canonicalQuarantinePath, `Novel quarantine for "${novelId}"`)
  return paths
}

export function evictNovelStorageCache(novelId: string) {
  const { databasePath } = getNovelStoragePaths(novelId)
  const cache = getResolverCache()
  const cacheKeys = new Set([path.resolve(databasePath), getCanonicalCacheKey(databasePath)])
  const cachedDatabases = new Set(
    [...cacheKeys]
      .map((cacheKey) => cache.get(cacheKey))
      .filter((database): database is DatabaseSync => Boolean(database)),
  )

  let closeFailure: unknown = null
  try {
    for (const cached of cachedDatabases) {
      try {
        ;(cached as DatabaseSync & { close?: () => void }).close?.()
      } catch (error) {
        closeFailure ??= error
      }
    }
  } finally {
    for (const cacheKey of cacheKeys) {
      cache.delete(cacheKey)
    }
  }
  if (closeFailure) throw closeFailure
}

export function quarantineNovelStorage(paths: NovelStoragePaths) {
  const sourceExists = readPathStats(paths.novelDirectory) !== null
  const quarantineExists = readPathStats(paths.quarantinePath) !== null
  if (sourceExists && quarantineExists) {
    throw new Error(`Novel storage and quarantine both exist for "${path.basename(paths.novelDirectory)}"`)
  }
  if (!sourceExists) {
    return quarantineExists ? 'resumed' as const : 'absent' as const
  }

  fs.mkdirSync(paths.quarantineRootPath, { recursive: true })
  assertExistingPathIsNotSymlink(paths.quarantineRootPath, 'Novel quarantine root')
  assertExistingPathIsNotSymlink(paths.novelDirectory, `Novel storage for "${path.basename(paths.novelDirectory)}"`)
  assertExistingPathIsNotSymlink(paths.quarantinePath, `Novel quarantine for "${path.basename(paths.novelDirectory)}"`)
  fs.renameSync(paths.novelDirectory, paths.quarantinePath)
  return 'moved' as const
}

export function purgeNovelQuarantine(paths: NovelStoragePaths) {
  assertExistingPathIsNotSymlink(paths.quarantineRootPath, 'Novel quarantine root')
  assertExistingPathIsNotSymlink(paths.quarantinePath, `Novel quarantine for "${path.basename(paths.quarantinePath)}"`)
  fs.rmSync(paths.quarantinePath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  })
}

export function getNovelLanceDbPath(novelId: string) {
  const stableNovelId = validateNovelId(novelId)
  assertNovelRegistryReadyOrMissing(stableNovelId)
  return getNovelStoragePaths(stableNovelId).lanceDbPath
}

export function getNovelDb(novelId: string) {
  const stableNovelId = validateNovelId(novelId)
  assertNovelRegistryReadyOrMissing(stableNovelId)
  const override = globalForDbResolver.__retaleNovelDatabaseOverrides?.get(stableNovelId)
  if (override) {
    return override
  }

  return openResolvedDatabase(getNovelStoragePaths(stableNovelId).databasePath)
}

export function getCreatingNovelDb(novelId: string) {
  const stableNovelId = validateNovelId(novelId)
  const registry = getNovelRegistryMigrationStatus(stableNovelId)
  if (registry?.migrationStatus !== 'creating') {
    throw new NovelRegistryNotReadyError(stableNovelId, registry?.migrationStatus ?? 'missing')
  }
  const override = globalForDbResolver.__retaleNovelDatabaseOverrides?.get(stableNovelId)
  if (override) return override
  return openResolvedDatabase(getNovelStoragePaths(stableNovelId).databasePath)
}

export function setNovelDatabaseOverrideForTests(novelId: string, database: DatabaseSync) {
  const stableNovelId = validateNovelId(novelId)
  if (process.env.VITEST !== 'true') {
    throw new Error('Novel database overrides are only available when VITEST is true')
  }

  const testRoot = process.env.RETALE_TEST_ROOT
  if (!testRoot) {
    throw new Error('Novel database overrides require RETALE_TEST_ROOT')
  }

  const databaseRows = database.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>
  const mainDatabasePath = databaseRows.find((row) => row.name === 'main')?.file
  if (!mainDatabasePath) {
    throw new Error('Novel database overrides require a file-backed database')
  }

  const ownedDatabasePath = assertOwnedTestPath(testRoot, mainDatabasePath, {
    repoRoot: process.cwd(),
    label: `Novel database override for "${stableNovelId}"`,
  })
  const databaseStats = fs.statSync(ownedDatabasePath)
  if (!databaseStats.isFile()) {
    throw new Error(`Novel database override is not a file: ${ownedDatabasePath}`)
  }

  const overrides = getNovelDatabaseOverrides()
  const existingDatabase = overrides.get(stableNovelId)
  if (existingDatabase && existingDatabase !== database) {
    throw new Error(`Novel database override already registered for "${stableNovelId}"`)
  }
  overrides.set(stableNovelId, database)

  let disposed = false
  return () => {
    if (disposed) {
      return
    }
    disposed = true

    if (overrides.get(stableNovelId) === database) {
      overrides.delete(stableNovelId)
    }
  }
}

export function resetNovelDatabaseOverridesForTests() {
  const overrides = globalForDbResolver.__retaleNovelDatabaseOverrides
  if (!overrides) {
    return
  }

  overrides.clear()
  delete globalForDbResolver.__retaleNovelDatabaseOverrides
}

export function getControlDb() {
  const dataRootPath = getDataRootPath()
  fs.mkdirSync(dataRootPath, { recursive: true })
  return openResolvedDatabase(path.join(dataRootPath, 'control.db'), {
    schemaSql: CONTROL_SCHEMA_SQL,
    mode: 'control',
  })
}

export function resetResolvedDatabasesForTests() {
  const cache = globalForDbResolver.__retaleResolvedDbs
  if (!cache) {
    return
  }

  for (const database of cache.values()) {
    try {
      ;(database as DatabaseSync & { close?: () => void }).close?.()
    } catch (_closeError) {
      void _closeError
      // Ignore close cleanup failures so test teardown can keep clearing the resolver cache.
    }
  }

  cache.clear()
  delete globalForDbResolver.__retaleResolvedDbs
}

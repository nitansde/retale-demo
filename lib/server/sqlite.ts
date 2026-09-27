import { isSqliteLockError, runWithSqliteBusyRetry } from '@/lib/server/sqlite-busy'
export { isSqliteLockError, runWithSqliteBusyRetry } from '@/lib/server/sqlite-busy'
import fs from 'node:fs'
import path from 'node:path'
import type * as NodeSqlite from 'node:sqlite'
import { SCHEMA_SQL, CONTROL_SCHEMA_SQL } from '@/lib/server/schema'
import { assertOwnedTestPath } from '../../scripts/test-path-safety.mjs'

type DatabaseSync = NodeSqlite.DatabaseSync
export type SqlParam = string | number | bigint | Uint8Array | null
type DatabaseListRow = { name: string; file: string }
export type DatabaseKind = 'full' | 'control'
export const DATABASE_SCHEMA_VERSION = 4
export const DATABASE_APPLICATION_IDS = { full: 0x52544e56, control: 0x5254434c } as const

const processWithBuiltins = process as typeof process & {
  getBuiltinModule?: (moduleName: 'node:sqlite') => typeof NodeSqlite
}

function loadNodeSqlite() {
  const sqliteModule = processWithBuiltins.getBuiltinModule?.('node:sqlite')
  if (!sqliteModule) {
    throw new Error('node:sqlite is required but is not available in this Node.js runtime')
  }

  return sqliteModule
}

const { DatabaseSync } = loadNodeSqlite()

export const SQLITE_BUSY_TIMEOUT_MS = 15_000
const SQLITE_WAL_ATTEMPT_BUSY_TIMEOUT_MS = 250

function resolveDatabasePath(databaseUrl: string) {
  if (databaseUrl === ':memory:') return databaseUrl

  if (databaseUrl === 'file:./dev.db' || databaseUrl === './dev.db' || databaseUrl === 'dev.db') {
    return path.join(process.cwd(), 'dev.db')
  }

  if (databaseUrl.startsWith('file:')) {
    const rawPath = databaseUrl.slice('file:'.length)
    if (!rawPath || rawPath === ':memory:') {
      return ':memory:'
    }

    if (path.isAbsolute(rawPath)) {
      return rawPath
    }

    return path.join(/* turbopackIgnore: true */ process.cwd(), rawPath.replace(/^\.\//, ''))
  }

  if (path.isAbsolute(databaseUrl)) {
    return databaseUrl
  }

  throw new Error(`Unsupported SQLite DATABASE_URL: ${databaseUrl}`)
}

export function openSqliteDatabase(filename: string) {
  const resolvedFilename = resolveDatabasePath(filename)
  if (process.env.VITEST === 'true' && resolvedFilename !== ':memory:') {
    const testRoot = process.env.RETALE_TEST_ROOT
    if (!testRoot) {
      throw new Error('Vitest SQLite access requires RETALE_TEST_ROOT')
    }
    assertOwnedTestPath(testRoot, resolvedFilename, {
      repoRoot: process.cwd(),
      label: 'Vitest SQLite database',
    })
  }
  if (resolvedFilename !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedFilename), { recursive: true })
  }

  return new DatabaseSync(resolvedFilename)
}


export class DatabaseSchemaVersionError extends Error {
  constructor(readonly kind: DatabaseKind, readonly version: number, detail: string) {
    super(`Unsupported Retale ${kind} database (version ${version}): ${detail}. This application requires schema version ${DATABASE_SCHEMA_VERSION} and the matching database kind. Restore a verified compatible backup or use the application version matching this database. Automatic upgrades are not supported; the one-time schema migration tool has been retired.`)
    this.name = 'DatabaseSchemaVersionError'
  }
}

export function readDatabaseSchemaVersion(database: DatabaseSync) {
  return {
    version: (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    applicationId: (database.prepare('PRAGMA application_id').get() as { application_id: number }).application_id,
  }
}

const expectedSchemas = new Map<DatabaseKind, Array<{ type: string; name: string; sql: string }>>()
function schemaObjects(database: DatabaseSync) {
  return database.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type, name").all() as Array<{ type: string; name: string; sql: string }>
}
function getExpectedSchema(kind: DatabaseKind) {
  const cached = expectedSchemas.get(kind)
  if (cached) return cached
  const reference = new DatabaseSync(':memory:')
  try {
    reference.exec(kind === 'control' ? CONTROL_SCHEMA_SQL : SCHEMA_SQL)
    const objects = schemaObjects(reference)
    expectedSchemas.set(kind, objects)
    return objects
  } finally { reference.close() }
}
function normalizeSql(sql: string) { return sql.replace(/\s+/g, ' ').trim() }

export function assertCurrentDatabaseSchema(database: DatabaseSync, kind: DatabaseKind = 'full') {
  const { version, applicationId } = readDatabaseSchemaVersion(database)
  if (version !== DATABASE_SCHEMA_VERSION || applicationId !== DATABASE_APPLICATION_IDS[kind]) {
    throw new DatabaseSchemaVersionError(kind, version, 'schema version or database kind does not match')
  }
  const actual = new Map(schemaObjects(database).map((object) => [`${object.type}:${object.name}`, normalizeSql(object.sql)]))
  for (const object of getExpectedSchema(kind)) {
    if (actual.get(`${object.type}:${object.name}`) !== normalizeSql(object.sql)) {
      throw new DatabaseSchemaVersionError(kind, version, `missing or changed ${object.type} ${object.name}`)
    }
  }
}

export function initializeDatabase(database: DatabaseSync, options: { mode?: DatabaseKind; schemaSql?: string } = {}) {
  const kind = options.mode ?? 'full'
  const schemaSql = kind === 'control' ? CONTROL_SCHEMA_SQL : SCHEMA_SQL
  if (options.schemaSql !== undefined && options.schemaSql !== schemaSql) {
    throw new Error('Custom runtime schemas are not supported; choose the novel or control database kind')
  }
  const version = readDatabaseSchemaVersion(database)
  const empty = schemaObjects(database).length === 0
  if (empty && version.version === 0 && version.applicationId === 0) {
    applyConnectionPragmas(database)
    runWithSqliteBusyRetry(() => database.exec('BEGIN IMMEDIATE'))
    try {
      // Another process may have initialized this file while we waited for the lock.
      if (schemaObjects(database).length === 0) {
        const lockedVersion = readDatabaseSchemaVersion(database)
        if (lockedVersion.version !== 0 || lockedVersion.applicationId !== 0) {
          throw new DatabaseSchemaVersionError(kind, lockedVersion.version, 'empty database has incompatible metadata')
        }
        database.exec(schemaSql)
        database.exec(`PRAGMA application_id = ${DATABASE_APPLICATION_IDS[kind]}`)
        database.exec(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION}`)
      }
      assertCurrentDatabaseSchema(database, kind)
      database.exec('COMMIT')
    } catch (error) { database.exec('ROLLBACK'); throw error }
    return database
  }
  // Read-only validation precedes WAL/connection changes: reject old files without upgrading them.
  assertCurrentDatabaseSchema(database, kind)
  applyConnectionPragmas(database)
  return database
}

function databaseIsFileBacked(database: DatabaseSync) {
  const rows = database.prepare('PRAGMA database_list').all() as DatabaseListRow[]
  const mainDatabase = rows.find((row) => row.name === 'main')
  return Boolean(mainDatabase?.file)
}

function tryEnableWal(database: DatabaseSync) {
  if (!databaseIsFileBacked(database)) {
    return
  }

  try {
    database.exec('PRAGMA journal_mode = WAL')
  } catch (error) {
    if (isSqliteLockError(error)) {
      console.warn('Skipping SQLite WAL enable because the database is currently locked.', error)
      return
    }
    throw error
  }
}

export function applyConnectionPragmas(database: DatabaseSync) {
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(`PRAGMA busy_timeout = ${SQLITE_WAL_ATTEMPT_BUSY_TIMEOUT_MS}`)
  tryEnableWal(database)
  database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
}

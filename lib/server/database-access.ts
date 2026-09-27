import { AsyncLocalStorage } from 'node:async_hooks'
import type * as NodeSqlite from 'node:sqlite'
import { getControlDb, getCreatingNovelDb, getNovelDb } from '@/lib/server/db-resolver'
import { runWithSqliteBusyRetry, type SqlParam } from '@/lib/server/sqlite'
import { assertDatabaseTransactionAccess, beginSqliteTransaction, getDatabaseTransactionKey, observeOutwardNestedTransaction, runSerializedDatabaseTransaction, type DatabaseTransactionKey } from '@/lib/server/database-transactions'
export { resetControlDatabaseTransactionQueueForTests } from '@/lib/server/database-transactions'
import { runWithPerNovelWriteGate } from '@/lib/server/per-novel-write-gate'

type DatabaseSync = NodeSqlite.DatabaseSync

export type DatabaseAccess = {
  execute: (sql: string, ...params: SqlParam[]) => ReturnType<ReturnType<DatabaseSync['prepare']>['run']>
  queryOne: <T>(sql: string, ...params: SqlParam[]) => T | null
  queryAll: <T>(sql: string, ...params: SqlParam[]) => T[]
  withTransaction: <T>(callback: () => T | Promise<T>) => Promise<T>
}

type ExecuteLike = DatabaseAccess['execute']

// Preserve only the async context across server module reloads, never a default connection.
const scopeHost = globalThis as typeof globalThis & { __retaleDatabaseAccessScope?: AsyncLocalStorage<DatabaseAccess> }
const databaseAccessScope = scopeHost.__retaleDatabaseAccessScope ??= new AsyncLocalStorage<DatabaseAccess>()

export async function withPerNovelWriteTransaction<T>(params: {
  novelId: string
  execute: ExecuteLike
  callback: () => T | Promise<T>
  transactionKey?: DatabaseTransactionKey
  begin?: () => Promise<void>
}) {
  return runWithPerNovelWriteGate(params.novelId, () => runSerializedDatabaseTransaction(
    params.transactionKey ?? getDatabaseTransactionKey(getNovelDb(params.novelId)),
    params.execute,
    params.callback,
    params.begin ?? (() => beginSqliteTransaction(getNovelDb(params.novelId))),
  ))
}

export function createDatabaseAccess(database: DatabaseSync, options?: {
  novelId?: string
  transactionKey?: DatabaseTransactionKey
}): DatabaseAccess {
  const execute: DatabaseAccess['execute'] = (sql, ...params) => {
    assertDatabaseTransactionAccess(database)
    return runWithSqliteBusyRetry(() => database.prepare(sql).run(...params))
  }

  const queryOne: DatabaseAccess['queryOne'] = <T>(sql: string, ...params: SqlParam[]) => {
    assertDatabaseTransactionAccess(database)
    const row = runWithSqliteBusyRetry(() => database.prepare(sql).get(...params))
    return (row ?? null) as T | null
  }

  const queryAll: DatabaseAccess['queryAll'] = <T>(sql: string, ...params: SqlParam[]) => {
    assertDatabaseTransactionAccess(database)
    return runWithSqliteBusyRetry(() => database.prepare(sql).all(...params)) as T[]
  }

  const withTransaction: DatabaseAccess['withTransaction'] = <T>(callback: () => T | Promise<T>) => {
    if (options?.novelId) {
      const transactionKey = options.transactionKey ?? getDatabaseTransactionKey(database)
      return observeOutwardNestedTransaction(transactionKey, withPerNovelWriteTransaction({
        novelId: options.novelId,
        execute,
        callback,
        transactionKey,
        begin: () => beginSqliteTransaction(database),
      }))
    }

    const transactionKey = options?.transactionKey ?? getDatabaseTransactionKey(database)
    return observeOutwardNestedTransaction(
      transactionKey,
      runSerializedDatabaseTransaction(transactionKey, execute, callback, () => beginSqliteTransaction(database)),
    )
  }

  return {
    execute,
    queryOne,
    queryAll,
    withTransaction,
  }
}

export function createNovelDatabaseAccess(novelId: string) {
  return createDatabaseAccess(getNovelDb(novelId), { novelId })
}

export function createCreatingNovelDatabaseAccess(novelId: string) {
  return createDatabaseAccess(getCreatingNovelDb(novelId), { novelId })
}

export function createControlDatabaseAccess() {
  const database = getControlDb()
  return createDatabaseAccess(database, {
    transactionKey: getDatabaseTransactionKey(database),
  })
}

function getScopedDatabaseAccess() {
  const db = databaseAccessScope.getStore()
  if (!db) throw new Error('Database access requires an explicit database scope; use runWithNovelDatabaseAccess or inject DatabaseAccess')
  return db
}

export function runWithDatabaseAccessScope<T>(db: DatabaseAccess, callback: () => T): T
export function runWithDatabaseAccessScope<T>(db: DatabaseAccess, callback: () => Promise<T>): Promise<T>
export function runWithDatabaseAccessScope<T>(db: DatabaseAccess, callback: () => T | Promise<T>) {
  return databaseAccessScope.run(db, callback)
}

export function runWithNovelDatabaseAccess<T>(novelId: string, callback: () => T): T
export function runWithNovelDatabaseAccess<T>(novelId: string, callback: () => Promise<T>): Promise<T>
export function runWithNovelDatabaseAccess<T>(novelId: string, callback: () => T | Promise<T>) {
  return runWithDatabaseAccessScope(createNovelDatabaseAccess(novelId), callback)
}

export const execute: DatabaseAccess['execute'] = (sql, ...params) => getScopedDatabaseAccess().execute(sql, ...params)
export const queryOne: DatabaseAccess['queryOne'] = (sql, ...params) => getScopedDatabaseAccess().queryOne(sql, ...params)
export const queryAll: DatabaseAccess['queryAll'] = (sql, ...params) => getScopedDatabaseAccess().queryAll(sql, ...params)
export const withTransaction: DatabaseAccess['withTransaction'] = (callback) => getScopedDatabaseAccess().withTransaction(callback)

export type { SqlParam }

import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseSync } from 'node:sqlite'
import { isSqliteLockError } from '@/lib/server/sqlite-busy'

type ExecuteLike = (sql: string) => unknown

/** Retry lock acquisition asynchronously, without replaying the transaction callback. */
export async function beginSqliteTransaction(database: DatabaseSync) {
  const row = database.prepare('PRAGMA busy_timeout').get() as { timeout: number }
  const timeout = row.timeout
  const deadline = performance.now() + timeout
  let delay = 10
  for (;;) {
    try {
      // Restore before yielding: this connection may serve other synchronous work.
      database.exec('PRAGMA busy_timeout = 0')
      database.exec('BEGIN IMMEDIATE')
      return
    } catch (error) {
      if (!isSqliteLockError(error) || performance.now() >= deadline) throw error
    } finally {
      database.exec(`PRAGMA busy_timeout = ${timeout}`)
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - performance.now()))))
    delay = Math.min(delay * 2, 100)
  }
}

/** Synchronous singleton calls cannot queue; refuse to join another caller's transaction. */
export function assertDatabaseTransactionAccess(database: DatabaseSync) {
  const owner = serializedDatabaseTransactionState.ownerByKey.get(getDatabaseTransactionKey(database))
  if (owner && owner !== serializedDatabaseTransactionState.scope.getStore()) {
    throw new Error('This database is in use by another transaction; use withTransaction for concurrent work')
  }
}

type SerializedDatabaseTransactionScope = {
  transactionKey: DatabaseTransactionKey
  active: boolean
  nestedTransactions: Set<Promise<unknown>>
  nestedFailures: unknown[]
}

type SerializedDatabaseTransactionQueue = {
  tail: Promise<void>
  pending: number
}

export type DatabaseTransactionKey = object

type SerializedDatabaseTransactionState = {
  scope: AsyncLocalStorage<SerializedDatabaseTransactionScope>
  queues: WeakMap<DatabaseTransactionKey, SerializedDatabaseTransactionQueue>
  keyByDatabaseFile: Map<string, DatabaseTransactionKey>
  activeQueues: Set<SerializedDatabaseTransactionQueue>
  keyByHandle: WeakMap<DatabaseSync, DatabaseTransactionKey>
  ownerByKey: WeakMap<DatabaseTransactionKey, SerializedDatabaseTransactionScope>
}

const SERIALIZED_DATABASE_TRANSACTION_STATE = Symbol.for('retale.serialized-database-transaction-state-v4')
const globalForSerializedDatabaseTransactions = globalThis as typeof globalThis & {
  [SERIALIZED_DATABASE_TRANSACTION_STATE]?: SerializedDatabaseTransactionState
}
const serializedDatabaseTransactionState = globalForSerializedDatabaseTransactions[SERIALIZED_DATABASE_TRANSACTION_STATE] ??= {
  scope: new AsyncLocalStorage<SerializedDatabaseTransactionScope>(),
  queues: new WeakMap<DatabaseTransactionKey, SerializedDatabaseTransactionQueue>(),
  keyByDatabaseFile: new Map<string, DatabaseTransactionKey>(),
  activeQueues: new Set<SerializedDatabaseTransactionQueue>(),
  keyByHandle: new WeakMap(),
  ownerByKey: new WeakMap(),
}

export function getDatabaseTransactionKey(database: DatabaseSync): DatabaseTransactionKey {
  const cached = serializedDatabaseTransactionState.keyByHandle.get(database)
  if (cached) return cached
  const main = database.prepare('PRAGMA database_list').all().find((row) => (
    (row as { name?: unknown }).name === 'main'
  )) as { file?: unknown } | undefined
  const databaseFile = typeof main?.file === 'string' ? main.file : ''
  if (!databaseFile) {
    serializedDatabaseTransactionState.keyByHandle.set(database, database)
    return database
  }

  let key = serializedDatabaseTransactionState.keyByDatabaseFile.get(databaseFile)
  if (!key) {
    key = {}
    serializedDatabaseTransactionState.keyByDatabaseFile.set(databaseFile, key)
  }
  serializedDatabaseTransactionState.keyByHandle.set(database, key)
  return key
}

export async function runSerializedDatabaseTransaction<T>(
  transactionKey: DatabaseTransactionKey,
  execute: ExecuteLike,
  callback: () => T | Promise<T>,
  begin: () => void | Promise<void>,
) {
  const inheritedScope = serializedDatabaseTransactionState.scope.getStore()
  if (inheritedScope?.active && inheritedScope.transactionKey === transactionKey) {
    const nestedTransaction = (async () => callback())()
    const observedNestedTransaction = nestedTransaction.catch((error) => {
      inheritedScope.nestedFailures.push(error)
    })
    inheritedScope.nestedTransactions.add(observedNestedTransaction)
    return nestedTransaction
  }

  let queue = serializedDatabaseTransactionState.queues.get(transactionKey)
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0 }
    serializedDatabaseTransactionState.queues.set(transactionKey, queue)
  }
  serializedDatabaseTransactionState.activeQueues.add(queue)

  const previousTail = queue.tail.catch(() => undefined)
  let releaseCurrentTail!: () => void
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrentTail = resolve
  })
  queue.pending += 1
  queue.tail = previousTail.then(() => currentTail)

  await previousTail
  const transactionScope: SerializedDatabaseTransactionScope = {
    transactionKey,
    active: true,
    nestedTransactions: new Set(),
    nestedFailures: [],
  }
  try {
    return await serializedDatabaseTransactionState.scope.run(
      transactionScope,
      async () => {
        let began = false
        try {
          serializedDatabaseTransactionState.ownerByKey.set(transactionKey, transactionScope)
          await begin()
          began = true
          let callbackResult!: T
          let callbackFailure: { error: unknown } | null = null
          try {
            callbackResult = await callback()
          } catch (error) {
            callbackFailure = { error }
          }
          await Promise.resolve()
          while (transactionScope.nestedTransactions.size > 0) {
            const pendingNestedTransactions = [...transactionScope.nestedTransactions]
            transactionScope.nestedTransactions.clear()
            await Promise.allSettled(pendingNestedTransactions)
          }
          if (callbackFailure) {
            throw callbackFailure.error
          }
          if (transactionScope.nestedFailures.length > 0) {
            throw transactionScope.nestedFailures[0]
          }
          transactionScope.active = false
          execute('COMMIT')
          began = false
          return callbackResult
        } catch (error) {
          transactionScope.active = false
          if (began) {
            try {
              execute('ROLLBACK')
            } catch (_rollbackError) {
              void _rollbackError
              // Ignore rollback cleanup failures so the original transaction error is rethrown.
            }
          }
          throw error
        } finally {
          serializedDatabaseTransactionState.ownerByKey.delete(transactionKey)
          transactionScope.active = false
        }
      },
    )
  } finally {
    queue.pending -= 1
    releaseCurrentTail()
    if (queue.pending === 0) {
      serializedDatabaseTransactionState.activeQueues.delete(queue)
    }
  }
}

export function observeOutwardNestedTransaction<T>(
  transactionKey: DatabaseTransactionKey,
  transaction: Promise<T>,
) {
  const inheritedScope = serializedDatabaseTransactionState.scope.getStore()
  if (inheritedScope?.active && inheritedScope.transactionKey === transactionKey) {
    // The transaction runner observes its internal callback promise so the outer
    // transaction can roll back. Observe the exact promise returned to this
    // caller as well: async wrappers otherwise create a new rejected promise
    // that becomes unhandled when a nested transaction is intentionally voided.
    // Attaching a handler does not change the rejected state for callers that
    // await the original promise.
    void transaction.catch(() => undefined)
  }
  return transaction
}

export async function resetControlDatabaseTransactionQueueForTests() {
  const queues = Array.from(serializedDatabaseTransactionState.activeQueues)
  await Promise.all(queues.map((queue) => queue.tail.catch(() => undefined)))
  for (const queue of queues) {
    if (queue.pending !== 0) {
      throw new Error('Cannot reset the control database transaction queue while work is pending')
    }
    queue.tail = Promise.resolve()
    serializedDatabaseTransactionState.activeQueues.delete(queue)
  }
}

const SQLITE_BUSY_RETRY_DELAYS_MS = [25, 50, 100, 200] as const

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return ''
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function isSqliteLockError(error: unknown) {
  const code = getErrorCode(error)
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
    return true
  }

  const message = getErrorMessage(error).toLowerCase()
  return message.includes('database is locked')
    || message.includes('database table is locked')
    || message.includes('sqlite_busy')
    || message.includes('sqlite_locked')
}

function sleepSync(ms: number) {
  if (ms <= 0) return
  const buffer = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buffer), 0, 0, ms)
}

export function runWithSqliteBusyRetry<T>(operation: () => T, options: { delaysMs?: readonly number[] } = {}) {
  const delaysMs = options.delaysMs ?? SQLITE_BUSY_RETRY_DELAYS_MS
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return operation()
    } catch (error) {
      if (!isSqliteLockError(error) || attempt === delaysMs.length) {
        throw error
      }
      sleepSync(delaysMs[attempt])
    }
  }

  throw new Error('SQLite busy retry exhausted')
}

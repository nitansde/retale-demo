declare module 'node:sqlite' {
  export type SQLiteValue = string | number | bigint | Uint8Array | null

  export type StatementRunResult = {
    changes: number
    lastInsertRowid: number | bigint
  }

  export class StatementSync {
    run(...params: SQLiteValue[]): StatementRunResult
    get(...params: SQLiteValue[]): Record<string, unknown> | undefined
    all(...params: SQLiteValue[]): Record<string, unknown>[]
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean })
    close(): void
    exec(sql: string): void
    prepare(sql: string): StatementSync
  }
}

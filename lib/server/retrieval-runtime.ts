import * as lancedb from '@lancedb/lancedb'
import { getNovelLanceDbPath } from '@/lib/server/db-resolver'

export function getRetrievalDatabaseDir(novelId: string) {
  return getNovelLanceDbPath(novelId)
}

export async function connectRetrievalDatabase(novelId: string) {
  return lancedb.connect(getRetrievalDatabaseDir(novelId))
}

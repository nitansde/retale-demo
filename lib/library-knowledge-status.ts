export const LIBRARY_KNOWLEDGE_STATUSES = [
  'ready', 'building', 'missing', 'partial', 'paused', 'failed', 'unknown',
] as const

export type LibraryKnowledgeStatus = typeof LIBRARY_KNOWLEDGE_STATUSES[number]

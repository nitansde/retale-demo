import { z } from 'zod'

export const CHARACTER_IMPORTANCE_TIERS = [
  'protagonist',
  'important',
  'arc',
  'candidate',
  'ignored',
] as const

export type CharacterImportanceTier = (typeof CHARACTER_IMPORTANCE_TIERS)[number]

export const CHARACTER_CLASSIFICATION_METADATA = {
  protagonist: { key: 'tier0', label: 'Tier 0' },
  important: { key: 'tier1', label: 'Tier 1' },
  arc: { key: 'tier2', label: 'Tier 2' },
  candidate: { key: 'candidate', label: 'Candidate' },
  ignored: { key: 'ignored', label: 'Ignored' },
} as const

export function getCharacterClassificationMetadata(tier: CharacterImportanceTier | null | undefined) {
  if (!tier) return null
  return CHARACTER_CLASSIFICATION_METADATA[tier] ?? null
}

export const characterImportanceTierSchema = z.enum(CHARACTER_IMPORTANCE_TIERS)

export const HANLP_BOOTSTRAP_CACHE_STATUSES = ['pending', 'ready', 'failed'] as const
export const hanlpBootstrapCacheStatusSchema = z.enum(HANLP_BOOTSTRAP_CACHE_STATUSES)

export const HANLP_BOOTSTRAP_RESULT_KINDS = ['bootstrap'] as const
export const hanlpBootstrapResultKindSchema = z.enum(HANLP_BOOTSTRAP_RESULT_KINDS)

export const ENTITY_ALIAS_CONFLICT_REASONS = ['branch_alias_already_claimed'] as const
export const entityAliasConflictReasonSchema = z.enum(ENTITY_ALIAS_CONFLICT_REASONS)

export const characterCandidateRecordSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  surfaceText: z.string().min(1),
  firstSeenChapter: z.number().int().positive(),
  lastSeenChapter: z.number().int().positive(),
  chapterCount: z.number().int().positive(),
  mentionCount: z.number().int().positive(),
  observationsJson: z.string().nullable(),
  status: z.string().min(1),
  promotedEntityId: z.string().min(1).nullable(),
  mergedEntityId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  displayName: z.string().min(1).optional(),
  normalizedName: z.string().min(1).optional(),
})

export const characterCandidateChapterRecordSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  candidateId: z.string().min(1),
  chapterNo: z.number().int().positive(),
  mentionCount: z.number().int().positive(),
  bestObservation: z.string().nullable(),
  bestEvidence: z.string().nullable(),
  createdAt: z.string().min(1),
  chapterId: z.string().min(1).nullable().optional(),
})

export const entityAliasMappingRecordSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  alias: z.string().min(1),
  entityId: z.string().min(1),
  sourceAliasId: z.string().min(1).nullable(),
  sourceChapter: z.number().int().positive().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const entityAliasConflictRecordSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  alias: z.string().min(1),
  existingEntityId: z.string().min(1).nullable(),
  attemptedEntityId: z.string().min(1).nullable(),
  existingCanonicalName: z.string().min(1).nullable(),
  attemptedCanonicalName: z.string().min(1).nullable(),
  sourceAliasId: z.string().min(1).nullable(),
  sourceChapter: z.number().int().positive().nullable(),
  conflictReason: entityAliasConflictReasonSchema,
  detailsJson: z.string().nullable(),
  createdAt: z.string().min(1),
})

export const hanlpBootstrapCacheRecordSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  chapterId: z.string().min(1).nullable(),
  chapterNo: z.number().int().positive().nullable(),
  chapterTextHash: z.string().min(1),
  hanlpScriptVersionHash: z.string().min(1),
  hanlpModelOrConfigHash: z.string().min(1),
  outputSchemaVersion: z.string().min(1),
  cacheKey: z.string().min(1),
  inputHash: z.string().min(1),
  pipelineVersion: z.string().min(1),
  sourceChapterId: z.string().min(1).nullable(),
  sourceChapterNo: z.number().int().positive().nullable(),
  requestJson: z.string().min(1),
  resultJson: z.string().min(1),
  status: hanlpBootstrapCacheStatusSchema,
  lastSeenAt: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export type HanlpBootstrapCacheRecord = z.infer<typeof hanlpBootstrapCacheRecordSchema>

export const hanlpBootstrapEntityRecordSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  chapterId: z.string().min(1).nullable(),
  chapterNo: z.number().int().positive().nullable(),
  entityText: z.string().min(1),
  entityType: z.string().min(1),
  totalCount: z.number().int().positive(),
  chapterCount: z.number().int().positive(),
  coverageRatio: z.number(),
  score: z.number(),
  sourceCacheId: z.string().min(1).nullable(),
  sourceResultId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const hanlpBootstrapResultRecordSchema = z.object({
  id: z.string().min(1),
  novelId: z.string().min(1),
  branchId: z.string().min(1),
  knowledgeJobId: z.string().min(1).nullable(),
  chapterId: z.string().min(1).nullable(),
  chapterNo: z.number().int().positive().nullable(),
  chapterSourceHash: z.string().min(1),
  resultKind: hanlpBootstrapResultKindSchema,
  provider: z.string().nullable(),
  model: z.string().nullable(),
  resultJson: z.string().min(1),
  status: hanlpBootstrapCacheStatusSchema,
  errorMessage: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export type HanlpBootstrapResultRecord = z.infer<typeof hanlpBootstrapResultRecordSchema>

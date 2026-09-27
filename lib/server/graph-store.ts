import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/database-access'
import type { DatabaseAccess } from '@/lib/server/database-access'
import { INF_CHAPTER } from '@/lib/server/chapter-interval'
import { deleteBranchRetrievalIndexFromChapter } from '@/lib/server/retrieval-index'
import type {
  EntityLinkRow,
  EntityStateRow,
} from '@/lib/server/graph-types'

type ActiveGraphQueryParams = {
  novelId: string
  branchId: string
  chapterNo: number
  includeLowConfidence?: boolean
  includePotentiallyStale?: boolean
  confirmedOnly?: boolean
}

type KnowledgeRelationMatchRow = {
  id: string
}

type EntityLinkEditParams = {
  id: string
  linkType?: string
  label?: string | null
  description?: string | null
  polarity?: EntityLinkRow['polarity']
  strength?: number
  validFromChapter?: number
  validUntilChapter?: number | null
  includeByDefault?: boolean
}

function normalizeValidFromChapter(value: number) {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('validFromChapter must be a positive chapter number')
  }

  return Math.floor(value)
}

function normalizeValidUntilChapter(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return INF_CHAPTER
  }
  if (!Number.isFinite(value) || value < 1) {
    throw new Error('validUntilChapter must be a positive chapter number or omitted for open-ended intervals')
  }

  return Math.floor(value)
}

export function loadEntityLinkById(id: string) {
  return queryOne<EntityLinkRow>(
    `
      SELECT id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
             polarity, strength, weight, sourceChapter, validFromChapter, validUntilChapter,
             evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
      FROM EntityLink
      WHERE id = ?
      LIMIT 1
    `,
    id
  )
}

function loadMatchingKnowledgeRelationIds(link: EntityLinkRow) {
  return queryAll<KnowledgeRelationMatchRow>(
    `
      SELECT id
      FROM KnowledgeRelation
      WHERE novelId = ?
        AND branchId = ?
        AND sourceEntityId = ?
        AND targetEntityId = ?
        AND relationType = ?
        AND sourceChapter = ?
        AND validFromChapter = ?
        AND validUntilChapter = ?
        AND ((evidenceSpanId IS NULL AND ? IS NULL) OR evidenceSpanId = ?)
    `,
    link.novelId,
    link.branchId,
    link.sourceEntityId,
    link.targetEntityId,
    link.linkType,
    link.sourceChapter,
    link.validFromChapter,
    normalizeValidUntilChapter(link.validUntilChapter),
    link.evidenceSpanId,
    link.evidenceSpanId
  )
}

async function markDownstreamGraphArtifactsStale(params: { novelId: string; branchId: string; fromChapterNo: number }) {
  await deleteBranchRetrievalIndexFromChapter(params.novelId, params.branchId, params.fromChapterNo)
}

function requireSingleKnowledgeRelationId(link: EntityLinkRow) {
  const matches = loadMatchingKnowledgeRelationIds(link)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one matching KnowledgeRelation for edge ${link.id}, found ${matches.length}`)
  }

  return matches[0]!.id
}

export async function confirmEntityLink(id: string) {
  const link = loadEntityLinkById(id)
  if (!link) return null

  await withTransaction(async () => {
    const relationId = requireSingleKnowledgeRelationId(link)

    execute(
      `
        UPDATE EntityLink
        SET status = 'user_confirmed',
            confidence = CASE WHEN confidence < 0.95 THEN 0.95 ELSE confidence END,
            includeByDefault = 1,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      id
    )

    execute(
      `
        UPDATE KnowledgeRelation
        SET status = 'user_confirmed',
            confidence = CASE WHEN confidence < 0.95 THEN 0.95 ELSE confidence END,
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      relationId
    )

    await markDownstreamGraphArtifactsStale({
      novelId: link.novelId,
      branchId: link.branchId,
      fromChapterNo: link.validFromChapter,
    })
  })

  return loadEntityLinkById(id)
}

export async function rejectEntityLink(id: string) {
  const link = loadEntityLinkById(id)
  if (!link) return null

  await withTransaction(async () => {
    const relationId = requireSingleKnowledgeRelationId(link)

    execute(
      `
        UPDATE EntityLink
        SET status = 'rejected', includeByDefault = 0, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      id
    )

    execute(
      `
        UPDATE KnowledgeRelation
        SET status = 'rejected', updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      relationId
    )

    await markDownstreamGraphArtifactsStale({
      novelId: link.novelId,
      branchId: link.branchId,
      fromChapterNo: link.validFromChapter,
    })
  })

  return loadEntityLinkById(id)
}

export async function editEntityLink(params: EntityLinkEditParams) {
  const link = loadEntityLinkById(params.id)
  if (!link) return null

  const nextLinkType = params.linkType ?? link.linkType
  const nextPolarity = params.polarity === undefined ? link.polarity : params.polarity
  const nextStrength = params.strength ?? link.strength
  const nextValidFromChapter = normalizeValidFromChapter(params.validFromChapter ?? link.validFromChapter)
  const nextValidUntilChapter = normalizeValidUntilChapter(
    params.validUntilChapter === undefined ? link.validUntilChapter : params.validUntilChapter
  )
  const nextLabel = params.label === undefined ? link.label : params.label
  const nextDescription = params.description === undefined ? link.description : params.description
  const nextIncludeByDefault = params.includeByDefault === undefined ? link.includeByDefault : params.includeByDefault ? 1 : 0

  if (nextValidUntilChapter <= nextValidFromChapter) {
    throw new Error('validUntilChapter must be greater than validFromChapter')
  }

  const affectedFromChapter = Math.min(link.validFromChapter, nextValidFromChapter)

  await withTransaction(async () => {
    const relationId = requireSingleKnowledgeRelationId(link)

    execute(
      `
        UPDATE EntityLink
        SET linkType = ?,
            label = ?,
            description = ?,
            polarity = ?,
            strength = ?,
            validFromChapter = ?,
             validUntilChapter = ?,
             includeByDefault = ?,
            status = 'user_confirmed',
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      nextLinkType,
      nextLabel,
      nextDescription,
      nextPolarity,
      nextStrength,
      nextValidFromChapter,
      nextValidUntilChapter,
      nextIncludeByDefault,
      params.id
    )

    execute(
      `
        UPDATE KnowledgeRelation
        SET relationType = ?,
            polarity = ?,
            strength = ?,
            validFromChapter = ?,
            validUntilChapter = ?,
            status = 'user_confirmed',
            updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      nextLinkType,
      nextPolarity,
      nextStrength,
      nextValidFromChapter,
      nextValidUntilChapter,
      relationId
    )

    await markDownstreamGraphArtifactsStale({
      novelId: link.novelId,
      branchId: link.branchId,
      fromChapterNo: affectedFromChapter,
    })
  })

  return loadEntityLinkById(params.id)
}

export function loadEntityLinksByEntityIds(params: ActiveGraphQueryParams & { entityIds: string[]; limit?: number }) {
  const limit = params.limit ?? 40
  const entityFilter = params.entityIds.length
    ? `AND (sourceEntityId IN (${params.entityIds.map(() => '?').join(', ')}) OR targetEntityId IN (${params.entityIds.map(() => '?').join(', ')}))`
    : ''
  const statusFilter = params.includePotentiallyStale ?? false
    ? "status NOT IN ('rejected', 'outdated')"
    : "status NOT IN ('rejected', 'outdated', 'potentially_stale')"
  const confidenceFilter = params.includeLowConfidence ?? false ? '' : 'AND confidence >= 0.4'
  const confirmedOnlyFilter = params.confirmedOnly ? "AND status = 'user_confirmed'" : ''
  const genericRelationFilter = "AND TRIM(linkType) NOT IN ('', '关系', '人物关系', '角色关系', '关联', '联系', '相关')"

  return queryAll<EntityLinkRow>(
    `
      SELECT id, novelId, branchId, sourceEntityId, targetEntityId, linkType, label, description,
             polarity, strength, weight, sourceChapter, validFromChapter, validUntilChapter,
             evidenceSpanId, evidenceQuote, confidence, status, includeByDefault
      FROM EntityLink
      WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
        AND validUntilChapter > ?
        AND ${statusFilter}
        ${confidenceFilter}
        ${confirmedOnlyFilter}
        ${genericRelationFilter}
        ${entityFilter}
      ORDER BY sourceChapter DESC, strength DESC, confidence DESC
      LIMIT ?
    `,
    params.novelId,
    params.branchId,
    params.chapterNo,
    params.chapterNo,
    ...params.entityIds,
    ...params.entityIds,
    limit
  )
}

export function loadEntityStatesByEntityIds(
  params: ActiveGraphQueryParams & { entityIds: string[]; limit?: number; db?: Pick<DatabaseAccess, 'queryAll'> }
) {
  const limit = params.limit ?? 40
  const db = params.db ?? { queryAll }
  const entityFilter = params.entityIds.length
    ? `AND entityId IN (${params.entityIds.map(() => '?').join(', ')})`
    : ''
  const statusFilter = params.includePotentiallyStale ?? false
    ? "status NOT IN ('rejected', 'outdated')"
    : "status NOT IN ('rejected', 'outdated', 'potentially_stale')"
  const confidenceFilter = params.includeLowConfidence ?? false ? '' : 'AND confidence >= 0.4'
  const confirmedOnlyFilter = params.confirmedOnly ? "AND status = 'user_confirmed'" : ''

  return db.queryAll<EntityStateRow>(
    `
      SELECT id, novelId, branchId, entityId, stateType, stateValue, description, sourceChapter,
             validFromChapter, evidenceSpanId, evidenceQuote, confidence, status, includeByDefault,
             validUntilChapter
      FROM EntityState
      WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
        AND validUntilChapter > ?
        AND ${statusFilter}
        ${confidenceFilter}
        ${confirmedOnlyFilter}
        ${entityFilter}
      ORDER BY sourceChapter DESC, confidence DESC
      LIMIT ?
    `,
    params.novelId,
    params.branchId,
    params.chapterNo,
    params.chapterNo,
    ...params.entityIds,
    limit
  )
}

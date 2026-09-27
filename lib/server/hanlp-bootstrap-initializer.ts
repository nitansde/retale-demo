import type { CharacterImportanceTier } from '@/lib/server/hanlp-contracts'
import {
  classifyHanlpBootstrapCharacters,
  shouldBootstrapFormalCharacterEntity,
} from '@/lib/server/character-tier'
import { upsertHanlpBootstrapCharacterEntity } from '@/lib/server/knowledge-rebuild'
import { queryAll, queryOne } from '@/lib/server/database-access'

type HanlpBootstrapEntityAggregateRow = {
  entityText: string
  entityType: 'person' | 'location' | 'organization' | 'setting'
  totalCount: number
  chapterCount: number
  score: number
  firstSeenChapter: number | null
  lastSeenChapter: number | null
}

export type HanlpBootstrapAggregateEntity = HanlpBootstrapEntityAggregateRow & {
  coverageRatio: number
}

function sortAggregateEntities(left: HanlpBootstrapEntityAggregateRow, right: HanlpBootstrapEntityAggregateRow) {
  if (right.totalCount !== left.totalCount) return right.totalCount - left.totalCount
  if (right.chapterCount !== left.chapterCount) return right.chapterCount - left.chapterCount
  if (right.score !== left.score) return right.score - left.score
  return left.entityText.localeCompare(right.entityText, 'zh-Hans-CN')
}

function withCoverage(entity: HanlpBootstrapEntityAggregateRow, totalChapters: number): HanlpBootstrapAggregateEntity {
  return {
    ...entity,
    coverageRatio: totalChapters > 0 ? entity.chapterCount / totalChapters : 0,
  }
}

export function listHanlpBootstrapAggregateEntities(params: { branchId: string }) {
  const totalChapters = queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM KnowledgeChapter WHERE branchId = ?',
    params.branchId,
  )?.count ?? 0

  const rows = queryAll<HanlpBootstrapEntityAggregateRow>(
    `
      SELECT
        entity_text AS entityText,
        entity_type AS entityType,
        SUM(total_count) AS totalCount,
        COUNT(DISTINCT chapter_no) AS chapterCount,
        MAX(score) AS score,
        MIN(chapter_no) AS firstSeenChapter,
        MAX(chapter_no) AS lastSeenChapter
      FROM hanlp_bootstrap_entities
      WHERE branch_id = ?
      GROUP BY entity_type, entity_text
      ORDER BY entity_type ASC, SUM(total_count) DESC, COUNT(DISTINCT chapter_no) DESC, MAX(score) DESC, entity_text ASC
    `,
    params.branchId,
  )

  return {
    totalChapters,
    entities: rows.map((row) => withCoverage(row, totalChapters)),
  }
}

export function prepareHanlpBootstrapPromptContext(params: {
  branchId: string
  configuredProtagonistName?: string | null
  importantNames?: ReadonlyArray<string>
}) {
  const snapshot = listHanlpBootstrapAggregateEntities({ branchId: params.branchId })
  const people = snapshot.entities.filter((entity) => entity.entityType === 'person')
  const characters = classifyHanlpBootstrapCharacters({
    people: people.map((entity) => ({
      name: entity.entityText,
      totalCount: entity.totalCount,
      chapterCount: entity.chapterCount,
      score: entity.score,
      coverageRatio: entity.coverageRatio,
      firstSeenChapter: entity.firstSeenChapter,
      lastSeenChapter: entity.lastSeenChapter,
    })),
    totalChapters: snapshot.totalChapters,
    configuredProtagonistName: params.configuredProtagonistName,
    importantNames: params.importantNames,
  })

  const locations = snapshot.entities.filter((entity) => entity.entityType === 'location').sort(sortAggregateEntities)
  const organizations = snapshot.entities.filter((entity) => entity.entityType === 'organization').sort(sortAggregateEntities)
  const settings = snapshot.entities.filter((entity) => entity.entityType === 'setting').sort(sortAggregateEntities)

  return { characters, locations, organizations, settings }
}

export async function initializeHanlpBootstrapCharacterEntities(params: {
  novelId: string
  branchId: string
  configuredProtagonistName?: string | null
  importantNames?: ReadonlyArray<string>
  status?: string
}) {
  const promptContext = prepareHanlpBootstrapPromptContext({
    branchId: params.branchId,
    configuredProtagonistName: params.configuredProtagonistName,
    importantNames: params.importantNames,
  })

  const createdOrUpdatedEntityIds: string[] = []

  for (const decision of promptContext.characters) {
    if (!shouldBootstrapFormalCharacterEntity(decision)) continue

    const chapterNo = decision.lastSeenChapter ?? decision.firstSeenChapter ?? 1
    const entityId = upsertHanlpBootstrapCharacterEntity({
      novelId: params.novelId,
      branchId: params.branchId,
      name: decision.normalizedName,
      firstSeenChapter: decision.firstSeenChapter ?? chapterNo,
      lastSeenChapter: decision.lastSeenChapter ?? chapterNo,
      importanceTier: decision.tier,
      status: params.status ?? 'hanlp_bootstrap',
      description: null,
    })

    if (entityId) {
      createdOrUpdatedEntityIds.push(entityId)
    }
  }

  return {
    createdOrUpdatedEntityIds,
    characterDecisions: promptContext.characters,
    promptContext,
  }
}

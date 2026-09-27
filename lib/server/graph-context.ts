import { loadEntityLinksByEntityIds, loadEntityStatesByEntityIds } from '@/lib/server/graph-store'
import { getCharacterClassificationMetadata, type CharacterImportanceTier } from '@/lib/server/hanlp-contracts'

import type { GraphAwareRequest, GraphAwareResult, GraphEdge, GraphNode, GraphSubgraphRequest } from '@/lib/server/graph-types'
import { queryAll } from '@/lib/server/database-access'
import { estimateTokenCount } from '@/lib/utils'

type KnowledgeEntityRow = {
  id: string
  entityType: GraphNode['entityType']
  canonicalName: string
  importanceTier: CharacterImportanceTier | null
  importance: number
  userConfirmed: number
  firstSeenChapter: number | null
  lastSeenChapter: number | null
}

type AliasRow = {
  entityId: string
  alias: string
  confidence: number
}

type EvidenceSpanRow = {
  id: string
  chapterNo: number
  lineStart: number
  lineEnd: number
}

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase('en-US')
}

function toGraphNode(row: KnowledgeEntityRow, score = 0): GraphNode {
  const classification = row.entityType === 'character'
    ? getCharacterClassificationMetadata(row.importanceTier)
    : null
  return {
    id: row.id,
    entityType: row.entityType,
    label: row.canonicalName,
    importanceTier: row.importanceTier ?? undefined,
    classificationKey: classification?.key,
    classificationLabel: classification?.label,
    importance: row.importance,
    confidence: 1,
    userConfirmed: Boolean(row.userConfirmed),
    firstSeenChapter: row.firstSeenChapter ?? undefined,
    lastSeenChapter: row.lastSeenChapter ?? undefined,
    score,
  }
}

function loadAliasesByEntityId(entityIds: string[]) {
  if (!entityIds.length) return new Map<string, string[]>()
  const rows = queryAll<{ entityId: string; alias: string }>(
    `
      SELECT entityId, alias
      FROM EntityAlias
      WHERE entityId IN (${entityIds.map(() => '?').join(', ')})
      UNION ALL
      SELECT entityId, alias
      FROM EntityAliasMapping
      WHERE entityId IN (${entityIds.map(() => '?').join(', ')})
    `,
    ...entityIds,
    ...entityIds,
  )
  const aliasesByEntityId = new Map<string, string[]>()
  for (const row of rows) {
    const current = aliasesByEntityId.get(row.entityId) ?? []
    if (!current.includes(row.alias)) current.push(row.alias)
    aliasesByEntityId.set(row.entityId, current)
  }
  return aliasesByEntityId
}

function attachAliasesToGraphNodes(nodes: GraphNode[]) {
  const aliasesByEntityId = loadAliasesByEntityId(nodes.map((node) => node.id))
  return nodes.map((node) => ({
    ...node,
    aliases: aliasesByEntityId.get(node.id) ?? [],
  }))
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function loadChapterSeedEntities(params: { novelId: string; branchId: string; chapterId?: string; chapterNo: number }) {
  const chapterEntityScope = params.chapterId
    ? {
        sql: `
          SELECT entityId
          FROM EntityMention
          WHERE branchId = ? AND chapterId = ?
            AND resolutionKind = 'resolved' AND entityId IS NOT NULL
          UNION
          SELECT a.entityId
          FROM EntityAppearance a
          JOIN KnowledgeEntity appearanceEntity ON appearanceEntity.id = a.entityId
          WHERE appearanceEntity.novelId = ? AND appearanceEntity.branchId = ? AND a.chapterId = ?
        `,
        values: [params.branchId, params.chapterId, params.novelId, params.branchId, params.chapterId],
      }
    : {
        sql: `
          SELECT entityId
          FROM EntityMention
          WHERE branchId = ? AND chapterNo = ?
            AND resolutionKind = 'resolved' AND entityId IS NOT NULL
          UNION
          SELECT a.entityId
          FROM EntityAppearance a
          JOIN KnowledgeEntity appearanceEntity ON appearanceEntity.id = a.entityId
          WHERE appearanceEntity.novelId = ? AND appearanceEntity.branchId = ? AND a.chapterNo = ?
        `,
        values: [params.branchId, params.chapterNo, params.novelId, params.branchId, params.chapterNo],
      }
  const chapterEntities = queryAll<KnowledgeEntityRow>(
    `
      SELECT e.id, e.entityType, e.canonicalName, e.importanceTier, e.importance, e.userConfirmed, e.firstSeenChapter, e.lastSeenChapter
      FROM KnowledgeEntity e
      JOIN (${chapterEntityScope.sql}) chapterEntity ON chapterEntity.entityId = e.id
      WHERE e.novelId = ? AND e.branchId = ? AND e.entityType = 'character'
      ORDER BY e.importance DESC, e.lastSeenChapter DESC, e.canonicalName ASC
    `,
    ...chapterEntityScope.values,
    params.novelId,
    params.branchId,
  )

  return attachAliasesToGraphNodes(
    dedupeById(chapterEntities.map((row, index) => toGraphNode(row, Math.max(chapterEntities.length - index, 1))))
  )
}

function scoreSeedEntity(params: {
  canonicalMatched: boolean
  aliasMatched: boolean
  aliasConfidence: number
  importance: number
  userConfirmed: boolean
  nameLength: number
}) {
  let score = 0
  if (params.canonicalMatched) score += 10
  if (params.aliasMatched) score += 6
  score += params.aliasConfidence * 2
  score += Math.min(params.importance, 5)
  score += Math.min(params.nameLength, 12) * 0.1
  if (params.userConfirmed) score += 3
  return score
}

function scoreGraphEdge(edge: GraphEdge, seedIds: Set<string>, chapterNo: number) {
  let score = 0
  if (seedIds.has(edge.source)) score += 10
  if (seedIds.has(edge.target)) score += 10
  if (edge.status === 'user_confirmed') score += 8
  if (edge.evidenceQuote) score += 3
  score += Math.min(edge.strength, 5) * 2
  score += edge.confidence * 5
  const chapterDistance = chapterNo - edge.validFromChapter
  if (chapterDistance <= 3) score += 6
  else if (chapterDistance <= 10) score += 3
  else if (chapterDistance > 100) score -= 2
  if (edge.hop === 2) score -= 4
  if (edge.confidence < 0.5) score -= 5
  if (edge.status === 'potentially_stale') score -= 8
  return score
}

function summarizeState(stateType: string, stateValue: string, description: string | null) {
  return description?.trim() ? `${stateType}：${stateValue}｜${description}` : `${stateType}：${stateValue}`
}

async function resolveSeedEntities(request: GraphAwareRequest) {
  const text = normalizeText(`${request.selectedText}\n${request.nearbyText}`)
  const entities = queryAll<KnowledgeEntityRow>(
    `
      SELECT id, entityType, canonicalName, importanceTier, importance, userConfirmed, firstSeenChapter, lastSeenChapter
      FROM KnowledgeEntity
      WHERE novelId = ? AND branchId = ? AND firstSeenChapter <= ?
      ORDER BY importance DESC, canonicalName ASC
      LIMIT 200
    `,
    request.novelId,
    request.branchId,
    request.chapterNo
  )

  if (!entities.length) return [] as GraphNode[]

  const aliases = queryAll<AliasRow & { sourceChapter: number | null }>(
    `
      SELECT entityId, alias, confidence, sourceChapter
      FROM EntityAlias
      WHERE entityId IN (${entities.map(() => '?').join(', ')})
        AND (sourceChapter IS NULL OR sourceChapter <= ?)
    `,
    ...entities.map((entity) => entity.id),
    request.chapterNo
  )

  const aliasesByEntityId = new Map<string, AliasRow[]>()
  for (const alias of aliases) {
    const current = aliasesByEntityId.get(alias.entityId) ?? []
    current.push(alias)
    aliasesByEntityId.set(alias.entityId, current)
  }

  const matches = entities.flatMap((entity) => {
    const canonicalMatched = text.includes(normalizeText(entity.canonicalName))
    const aliasMatched = (aliasesByEntityId.get(entity.id) ?? [])
      .filter((alias) => alias.alias.trim().length >= 2)
      .sort((left, right) => right.alias.length - left.alias.length)
      .find((alias) => text.includes(normalizeText(alias.alias)))

    if (!canonicalMatched && !aliasMatched) return []

    return [
      toGraphNode(
        entity,
        scoreSeedEntity({
          canonicalMatched,
          aliasMatched: Boolean(aliasMatched),
          aliasConfidence: aliasMatched?.confidence ?? 0,
          importance: entity.importance,
          userConfirmed: Boolean(entity.userConfirmed),
          nameLength: entity.canonicalName.length,
        })
      ),
    ]
  })

  if (matches.length) {
      return attachAliasesToGraphNodes(dedupeById(matches))
        .sort((left, right) => right.score - left.score || right.importance - left.importance)
        .slice(0, 8)
  }

  return loadChapterSeedEntities({
    novelId: request.novelId,
    branchId: request.branchId,
    chapterNo: request.chapterNo,
  })
}

function buildGraphContextText(params: {
  seedEntities: GraphNode[]
  nodesById: Map<string, GraphNode>
  edges: GraphEdge[]
  latestStateByEntityId: Map<string, string>
  chapterNo: number
}) {
  const stateLines = params.seedEntities.flatMap((entity) => {
    const summary = params.latestStateByEntityId.get(entity.id) ?? ''
    const aliasText = entity.aliases?.length ? `｜别名：${entity.aliases.join('、')}` : ''
    const classificationText = entity.classificationLabel ? `（${entity.classificationLabel}）` : ''
    return summary ? [`- ${entity.label}${classificationText}：截至第${params.chapterNo}章，${summary}${aliasText}`] : []
  })

  const relationLines = params.edges.slice(0, 10).map((edge) => {
    const source = params.nodesById.get(edge.source)?.label ?? edge.source
    const target = params.nodesById.get(edge.target)?.label ?? edge.target
    const description = edge.description ? `｜${edge.description}` : ''
    const evidence = edge.evidenceQuote ? `｜证据：${edge.evidenceQuote}` : ''
    return `- ${source} 与 ${target}：${edge.linkType}${description}${evidence}`
  })

  return [
    '【GraphRAG 相关人物状态】',
    ...(stateLines.length ? stateLines : ['- 未命中明确人物状态。']),
    '',
    '【GraphRAG 关键关系】',
    ...(relationLines.length ? relationLines : ['- 未命中明确关系边。']),
    '',
    '【禁止】',
    `- 不要使用第 ${params.chapterNo} 章之后的事实。`,
  ].join('\n')
}

function finalizeGraphAwareResult(params: {
  seedEntities: GraphNode[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  latestStateByEntityId: Map<string, string>
  chapterNo: number
  warnings: string[]
}) {
  const contextText = buildGraphContextText({
    seedEntities: params.seedEntities,
    nodesById: new Map(params.nodes.map((node) => [node.id, node])),
    edges: params.edges,
    latestStateByEntityId: params.latestStateByEntityId,
    chapterNo: params.chapterNo,
  })

  return {
    seedEntities: params.seedEntities,
    nodes: params.nodes,
    edges: params.edges,
    contextText,
    warnings: params.warnings,
    tokenEstimate: params.seedEntities.length ? estimateTokenCount(contextText) : 0,
    status: 'ready',
  } satisfies GraphAwareResult
}

async function buildGraphAwareResultFromSeeds(params: {
  novelId: string
  branchId: string
  chapterNo: number
  maxHops?: 1 | 2
  includeLowConfidence?: boolean
  confirmedOnly?: boolean
  seedEntities: GraphNode[]
  warnings?: string[]
}) {
  const warnings = [...(params.warnings ?? [])]
  if (!params.seedEntities.length) {
    warnings.push('GraphRAG 未命中明确实体，已降级为空图谱上下文。')
    return finalizeGraphAwareResult({
      seedEntities: [],
      nodes: [],
      edges: [],
      latestStateByEntityId: new Map(),
      chapterNo: params.chapterNo,
      warnings,
    })
  }

  const seedEntityIds = params.seedEntities.map((entity) => entity.id)
  const firstHop = loadEntityLinksByEntityIds({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterNo: params.chapterNo,
    includeLowConfidence: params.includeLowConfidence,
    confirmedOnly: params.confirmedOnly,
    entityIds: seedEntityIds,
    limit: 24,
  })

  const secondHopSeeds = Array.from(new Set(firstHop.flatMap((edge) => [edge.sourceEntityId, edge.targetEntityId])))
    .filter((entityId) => !seedEntityIds.includes(entityId))
    .slice(0, 8)
  const secondHop = (params.maxHops ?? 1) > 1 && secondHopSeeds.length
    ? loadEntityLinksByEntityIds({
        novelId: params.novelId,
        branchId: params.branchId,
        chapterNo: params.chapterNo,
        includeLowConfidence: params.includeLowConfidence,
        confirmedOnly: params.confirmedOnly,
        entityIds: secondHopSeeds,
        limit: 24,
      })
    : []

  const allEntityIds = Array.from(new Set([
    ...seedEntityIds,
    ...firstHop.flatMap((edge) => [edge.sourceEntityId, edge.targetEntityId]),
    ...secondHop.flatMap((edge) => [edge.sourceEntityId, edge.targetEntityId]),
  ])).slice(0, 25)

  const entityRows = allEntityIds.length
    ? queryAll<KnowledgeEntityRow>(
        `
          SELECT id, entityType, canonicalName, importanceTier, importance, userConfirmed, firstSeenChapter, lastSeenChapter
          FROM KnowledgeEntity
          WHERE id IN (${allEntityIds.map(() => '?').join(', ')})
          ORDER BY importance DESC, canonicalName ASC
        `,
        ...allEntityIds
      )
    : []
  const nodesById = new Map(entityRows.map((row) => [row.id, toGraphNode(row)]))
  const seedEntityIdSet = new Set(seedEntityIds)
  const evidenceSpanIds = Array.from(new Set([
    ...firstHop.map((edge) => edge.evidenceSpanId).filter(Boolean),
    ...secondHop.map((edge) => edge.evidenceSpanId).filter(Boolean),
  ])) as string[]
  const evidenceLocationBySpanId = evidenceSpanIds.length
    ? new Map(
        queryAll<EvidenceSpanRow>(
          `
            SELECT id, chapterNo, lineStart, lineEnd
            FROM TextSpan
            WHERE id IN (${evidenceSpanIds.map(() => '?').join(', ')})
              AND branchId = ?
              AND chapterNo <= ?
          `,
          ...evidenceSpanIds,
          params.branchId,
          params.chapterNo
        ).map((span) => [span.id, span] as const)
      )
    : new Map<string, EvidenceSpanRow>()

  const edges = dedupeById(
    [...firstHop, ...secondHop].map<GraphEdge>((edge) => ({
      id: edge.id,
      source: edge.sourceEntityId,
      target: edge.targetEntityId,
      linkType: edge.linkType,
      label: edge.label ?? undefined,
      description: edge.description ?? undefined,
      polarity: edge.polarity ?? undefined,
      strength: edge.strength,
      confidence: edge.confidence,
      validFromChapter: edge.validFromChapter,
      validUntilChapter: edge.validUntilChapter,
      evidenceQuote: edge.evidenceQuote ?? undefined,
      evidenceLocation: edge.evidenceSpanId
        ? (() => {
            const location = evidenceLocationBySpanId.get(edge.evidenceSpanId)
            return location
              ? {
                  chapterNo: location.chapterNo,
                  lineStart: location.lineStart,
                  lineEnd: location.lineEnd,
                }
              : undefined
          })()
        : undefined,
      status: edge.status,
      hop: seedEntityIdSet.has(edge.sourceEntityId) || seedEntityIdSet.has(edge.targetEntityId) ? 1 : 2,
      score: 0,
      includeInPrompt: Boolean(edge.includeByDefault),
    }))
  )
    .map((edge) => ({
      ...edge,
      score: scoreGraphEdge(edge, seedEntityIdSet, params.chapterNo),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 40)

  const stateRows = allEntityIds.length
    ? loadEntityStatesByEntityIds({
        novelId: params.novelId,
        branchId: params.branchId,
        chapterNo: params.chapterNo,
        includeLowConfidence: params.includeLowConfidence,
        confirmedOnly: params.confirmedOnly,
        entityIds: allEntityIds,
        limit: 40,
      })
    : []

  const latestStateByEntityId = new Map<string, string>()
  for (const state of stateRows) {
    if (latestStateByEntityId.has(state.entityId)) continue
    latestStateByEntityId.set(state.entityId, summarizeState(state.stateType, state.stateValue, state.description))
  }

  const finalNodes = attachAliasesToGraphNodes(dedupeById([
    ...params.seedEntities,
    ...Array.from(nodesById.values()).map((node) => ({
      ...node,
      score: seedEntityIdSet.has(node.id)
        ? Math.max(node.score, 20)
        : edges.reduce((best, edge) => {
            if (edge.source !== node.id && edge.target !== node.id) return best
            return Math.max(best, edge.score)
          }, node.score),
    })),
  ]))
    .sort((left, right) => right.score - left.score || right.importance - left.importance)
    .slice(0, 25)

  const finalNodeIds = new Set(finalNodes.map((node) => node.id))
  const finalEdges = edges.filter((edge) => finalNodeIds.has(edge.source) && finalNodeIds.has(edge.target))

  return finalizeGraphAwareResult({
    seedEntities: params.seedEntities,
    nodes: finalNodes,
    edges: finalEdges,
    latestStateByEntityId,
    chapterNo: params.chapterNo,
    warnings,
  })
}

export async function buildGraphAwareContext(request: GraphAwareRequest): Promise<GraphAwareResult> {
  const seedEntities = await resolveSeedEntities(request)
  return buildGraphAwareResultFromSeeds({
    novelId: request.novelId,
    branchId: request.branchId,
    chapterNo: request.chapterNo,
    maxHops: request.maxHops,
    includeLowConfidence: request.includeLowConfidence,
    confirmedOnly: request.confirmedOnly,
    seedEntities,
  })
}

export async function buildChapterScopedGraphContext(params: {
  novelId: string
  branchId: string
  chapterId?: string
  chapterNo: number
  maxHops?: 1 | 2
  includeLowConfidence?: boolean
  confirmedOnly?: boolean
}) {
  const seedEntities = loadChapterSeedEntities({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterId: params.chapterId,
    chapterNo: params.chapterNo,
  })

  return buildGraphAwareResultFromSeeds({
    novelId: params.novelId,
    branchId: params.branchId,
    chapterNo: params.chapterNo,
    maxHops: params.maxHops,
    includeLowConfidence: params.includeLowConfidence,
    confirmedOnly: params.confirmedOnly,
    seedEntities,
    warnings: seedEntities.length ? [] : ['当前章节在知识图谱里还没有可用的实体出场记录。'],
  })
}

export async function buildGraphSubgraph(request: GraphSubgraphRequest): Promise<GraphAwareResult> {
  const requestedEntityIds = Array.from(new Set(request.entityIds.map((entityId) => entityId.trim()).filter(Boolean)))
  const warnings: string[] = []

  if (!requestedEntityIds.length) {
    warnings.push('Graph subgraph 请求缺少 entityIds。')
    return finalizeGraphAwareResult({
      seedEntities: [],
      nodes: [],
      edges: [],
      latestStateByEntityId: new Map(),
      chapterNo: request.chapterNo,
      warnings,
    })
  }

  const seedRows = queryAll<KnowledgeEntityRow>(
    `
      SELECT id, entityType, canonicalName, importanceTier, importance, userConfirmed, firstSeenChapter, lastSeenChapter
      FROM KnowledgeEntity
      WHERE novelId = ? AND branchId = ? AND firstSeenChapter <= ?
        AND id IN (${requestedEntityIds.map(() => '?').join(', ')})
      ORDER BY importance DESC, canonicalName ASC
    `,
    request.novelId,
    request.branchId,
    request.chapterNo,
    ...requestedEntityIds
  )

  const foundEntityIds = new Set(seedRows.map((row) => row.id))
  const missingEntityIds = requestedEntityIds.filter((entityId) => !foundEntityIds.has(entityId))
  if (missingEntityIds.length) {
    warnings.push(`以下实体在当前章节之前不可用，已跳过：${missingEntityIds.join(', ')}`)
  }

  const seedEntities = attachAliasesToGraphNodes(seedRows.map((row, index) => toGraphNode(row, Math.max(20 - index, 1))))
  return buildGraphAwareResultFromSeeds({
    novelId: request.novelId,
    branchId: request.branchId,
    chapterNo: request.chapterNo,
    maxHops: request.maxHops,
    includeLowConfidence: request.includeLowConfidence,
    confirmedOnly: request.confirmedOnly,
    seedEntities,
    warnings,
  })
}

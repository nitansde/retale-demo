import type { ContextCompressionPreview } from '@/lib/context-compression'
import { createHash } from 'node:crypto'
import { findSelectionSpan, inferSelectionRange, splitContextLines } from '@/lib/selection-range'
import { buildChapterScopedGraphContext, buildGraphAwareContext } from '@/lib/server/graph-context'
import { loadExplicitAuthoredContext, type ExplicitAuthoredContext } from '@/lib/server/authored-context'
import { loadEntityStatesByEntityIds } from '@/lib/server/graph-store'
import { getGeneratedHistory } from '@/lib/server/generated-history'
import type { GraphAwareResult } from '@/lib/server/graph-types'
import { normalizeBranchId } from '@/lib/server/knowledge-store'
import { searchLanceEvidence, type RetrievalDocSourceType } from '@/lib/server/retrieval-index'
import { buildRewriteTaskPromptLines, isContinuationRewriteTask } from '@/lib/server/rewrite-task-prompt'
import { queryAll, queryOne } from '@/lib/server/database-access'
import { resolveWritingSkillRuntimes } from '@/lib/server/writing-skill-runtime'
import type { DatabaseAccess } from '@/lib/server/database-access'
import {
  buildCharacterDescriptionDelta,
  buildCharacterRoleCardLines,
  hasCharacterRoleCardProfile,
  mergeCharacterRoleCardProfiles,
  normalizeCharacterRoleCardProfile,
  type CharacterRoleCardProfile,
} from '@/lib/story-knowledge'
import type { ProductSurfaceId } from '@/lib/types'
import { estimateTokenCount, uniqueStrings } from '@/lib/utils'
import { buildRoleplayContextBlock, type RoleplayContextMessage } from '@/lib/roleplay-context'
export { buildRoleplayContextBlock, normalizeRoleplayContextMessages, type RoleplayContextMessage } from '@/lib/roleplay-context'

type BranchLineageInclusion = 'ancestors_only' | 'include_selected'

export type GenerationContextRequest = {
  novelId: string
  branchId?: string
  chapterId: string
  selectedText: string
  sourceText?: string
  operationType: ProductSurfaceId
  userInstruction: string
  roleplayMessages?: RoleplayContextMessage[]
  excludedGraphEdgeIds?: string[]
  excludedEvidenceIds?: string[]
  whatIfSessionId?: string
  futureJumpRunId?: string
  branchContextNodeId?: string
  branchContextInclusion?: BranchLineageInclusion
  writingSkillCardIds?: string[]
  writingSkillExampleCount?: number
  writingSkillSeed?: number
}

export function resolveGenerationContextOperationType(operationType: ProductSurfaceId): ProductSurfaceId {
  return operationType === 'roleplay' ? 'roleplay' : 'rewrite'
}

export type GenerationContextBlock = {
  id: string
  label: string
  enabled: boolean
  priority: 'highest' | 'high' | 'medium'
  content: string
}

export type GenerationContextPreview = {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  selectedLineStart: number | null
  selectedLineEnd: number | null
  warnings: string[]
  blocks: GenerationContextBlock[]
  assembledContext: string
}

export type GenerationContextEvidence = {
  id: string
  sourceType: RetrievalDocSourceType
  sourceId: string
  chapterId: string | null
  chapterNo: number
  lineStart: number | null
  lineEnd: number | null
  title: string | null
  sourceLabel: string
  text: string
  score: number
}

export type GenerationContextBuildResult = {
  compression?: ContextCompressionPreview | null
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  selectedLineStart: number | null
  selectedLineEnd: number | null
  warnings: string[]
  promptBlocks: GenerationContextBlock[]
  assembledContext: string
  graphContext: GraphAwareResult
  lanceEvidence: GenerationContextEvidence[]
  tokenEstimate: number
}

export type GenerationContextRagArtifacts = {
  version: 1
  graph: {
    cacheKey: string
    knowledgeFingerprint: string
    context: GraphAwareResult
  }
  evidence: {
    cacheKey: string
    retrievalFingerprint: string
    matches: GenerationContextEvidence[]
    warning?: string
  }
}

export type GenerationContextRagCacheUsage = {
  graph: 'hit' | 'miss'
  evidence: 'hit' | 'miss'
}

export type GenerationContextBuildOptions = {
  writingSkillBundle?: ReturnType<typeof resolveWritingSkillRuntimes> | null
  cachedRagArtifacts?: GenerationContextRagArtifacts | null
  onRagArtifacts?: (
    artifacts: GenerationContextRagArtifacts,
    usage: GenerationContextRagCacheUsage,
  ) => void
}

export type ChapterGraphContextRequest = {
  novelId: string
  chapterId: string
  maxHops?: 1 | 2
  includeLowConfidence?: boolean
  confirmedOnly?: boolean
}

export type ChapterGraphContextResult = {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
  chapterTitle: string
  warnings: string[]
  graphContext: GraphAwareResult
  lanceEvidence: GenerationContextEvidence[]
  tokenEstimate: number
}

type EntityRow = {
  id: string
  canonicalName: string
  aliases: Array<{ alias: string }>
  lastSeenChapter?: number | null
  profile?: CharacterRoleCardProfile
}

type FactRow = {
  subjectEntityId: string | null
  objectEntityId: string | null
  predicate: string
  valueJson: string | null
  subjectCanonicalName: string | null
  objectCanonicalName: string | null
}

type EntityStatePreviewRow = {
  entityId: string
  stateValue: string
  description: string | null
}

type ChapterStateCharacter = {
  name: string
  aliases?: string[]
  status?: string
  lastSeenChapter?: number
  profile?: CharacterRoleCardProfile
}

type ChapterStateRelationship = {
  source: string
  target: string
  type: string
  polarity?: string
  validFromChapter?: number
  evidenceChapter?: number
}

type ChapterStateEvent = {
  chapter: number
  name: string
  summary: string
}

type ChapterStateRule = {
  term: string
  definition: string
  firstSeenChapter?: number
}

type ChapterStateThread = {
  name: string
  description: string
}

type ChapterStatePromptData = {
  major_characters: ChapterStateCharacter[]
  active_relationships: ChapterStateRelationship[]
  recent_events: ChapterStateEvent[]
  world_rules: ChapterStateRule[]
  open_threads: ChapterStateThread[]
  forbidden_future_facts: string
}

export type KnowledgeExtractionStoryStateRequest = {
  novelId: string
  branchId: string
  asOfChapter: number
  currentChapterText?: string
  maxCharacters?: number
  recentEventLimit?: number
  db?: Pick<DatabaseAccess, 'queryAll'>
}

type KnowledgeExtractionStoryStateDb = Pick<DatabaseAccess, 'queryAll'>

export function formatOutputConstraints(operationType: GenerationContextRequest['operationType']) {
  if (operationType === 'roleplay') {
    return [
      '- 输出由 narration（旁白）、player（我方台词）、counterpart（对方台词）组成的 JSON 脚本块。',
      '- 承接用户的开场台词，允许继续编写双方多轮对话及行动旁白；篇幅接近本次目标字数即可，以自然收尾为先。',
      '- 保持与已有角色扮演历史连续。',
      '- 人物块可以包含该角色的台词、神态、语气和动作描写；连续旁白段落合并为一块，不跨过对话合并。不要输出剧情大纲或格式说明。',
      '- 不要自动应用、改写或续写 chapter 正文。',
      '- 不要输出分析。',
      '- 不要输出 Markdown 标题。',
      '- 不要使用当前章节之后的事实。',
    ].join('\n')
  }

  const modeSpecific =
    operationType === 'rewrite'
      ? '- 如果是魔改/重写：允许改变当前片段走向，但要保持前文一致。'
      : operationType === 'future_jump'
        ? '- 如果是未来跳转：允许朝目标未来推进，但要保持已知上下文自洽。'
        : '- 保持前文连续性，不要引入未来章节事实。'

  return [
    '- 只输出小说正文。',
    '- 不要输出分析。',
    '- 不要输出 Markdown 标题。',
    '- 保持原文叙事视角。',
    '- 不要使用当前章节之后的事实。',
    modeSpecific,
  ].join('\n')
}

function selectWindow<T>(items: T[], start: number, end: number) {
  return items.slice(Math.max(0, start), Math.min(items.length, end))
}
function buildNeighborhoodText(lines: Array<{ lineNo: number; text: string }>, lineStart: number | null, lineEnd: number | null) {
  if (lineStart === null || lineEnd === null) {
    return lines.slice(0, 20).map((line) => `${line.lineNo}. ${line.text}`).join('\n')
  }

  const startIndex = Math.max(0, lineStart - 1 - 20)
  const endIndex = Math.min(lines.length, lineEnd + 20)
  return selectWindow(lines, startIndex, endIndex).map((line) => `${line.lineNo}. ${line.text}`).join('\n')
}
function buildChapterTextThroughSelection(
  chapterText: string,
  selectedText: string,
  selectedLineEnd: number | null,
) {
  const normalizedChapterText = chapterText.replace(/\r\n?/g, '\n').trim()
  if (!normalizedChapterText) return '（当前章节暂无正文）'

  const selectionEndOffset = findSelectionSpan(normalizedChapterText, selectedText)?.end ?? null
  if (selectionEndOffset !== null) {
    return normalizedChapterText.slice(0, selectionEndOffset).trimEnd()
  }

  if (selectedLineEnd !== null) {
    return normalizedChapterText.split('\n').slice(0, selectedLineEnd).join('\n').trimEnd()
  }

  return normalizedChapterText
}

function parseJsonObject<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function renderBlock(label: string, lines: string[]) {
  return [`# ${label}`, ...lines].join('\n')
}

function buildFullChapterText(rawText: string | null, lines: Array<{ lineNo: number; text: string }>) {
  const trimmedRawText = rawText?.trim()
  if (trimmedRawText) return trimmedRawText
  return lines.map((line) => line.text.trimEnd()).join('\n').trim()
}

function buildCompactExcerpt(text: string, maxLength = 280) {
  const normalized = text.split(/\s+/).filter(Boolean).join(' ').trim()
  if (!normalized) return ''
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`
}

function stableCacheValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCacheValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([key, nestedValue]) => [key, stableCacheValue(nestedValue)])
  )
}

function hashGenerationContextCacheValue(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stableCacheValue(value))).digest('hex')
}

function loadAggregateVersion(sql: string, ...params: Array<string | number>) {
  return queryOne<Record<string, unknown>>(sql, ...params) ?? {}
}

function buildGraphKnowledgeFingerprint(params: {
  novelId: string
  branchId: string
  chapterId: string
  chapterNo: number
}) {
  return hashGenerationContextCacheValue({
    chapter: queryOne<Record<string, unknown>>(
      `
        SELECT id, sourceHash, revision, knowledgeStatus
        FROM KnowledgeChapter
        WHERE id = ? AND novelId = ? AND branchId = ?
        LIMIT 1
      `,
      params.chapterId,
      params.novelId,
      params.branchId,
    ),
    chapterMentions: queryAll<Record<string, unknown>>(
      `
        SELECT id, entityId, mentionText, resolutionKind, evidenceSpanId, evidenceQuote
        FROM EntityMention
        WHERE novelId = ? AND branchId = ? AND chapterId = ?
        ORDER BY id ASC
      `,
      params.novelId,
      params.branchId,
      params.chapterId,
    ),
    chapterAppearances: queryAll<Record<string, unknown>>(
      `
        SELECT a.id, a.entityId, a.lineStart, a.lineEnd, a.evidenceSpanId
        FROM EntityAppearance a
        JOIN KnowledgeEntity e ON e.id = a.entityId
        WHERE e.novelId = ? AND e.branchId = ? AND a.chapterId = ?
        ORDER BY a.id ASC
      `,
      params.novelId,
      params.branchId,
      params.chapterId,
    ),
    entities: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt
       FROM KnowledgeEntity
       WHERE novelId = ? AND branchId = ? AND firstSeenChapter <= ?`,
      params.novelId,
      params.branchId,
      params.chapterNo,
    ),
    aliases: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(a.updatedAt) AS updatedAt
       FROM EntityAlias a
       JOIN KnowledgeEntity e ON e.id = a.entityId
       WHERE e.novelId = ? AND e.branchId = ?
         AND (a.sourceChapter IS NULL OR a.sourceChapter <= ?)`,
      params.novelId,
      params.branchId,
      params.chapterNo,
    ),
    aliasMappings: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt
       FROM EntityAliasMapping
       WHERE novelId = ? AND branchId = ?
         AND (sourceChapter IS NULL OR sourceChapter <= ?)`,
      params.novelId,
      params.branchId,
      params.chapterNo,
    ),
    links: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt
       FROM EntityLink
       WHERE novelId = ? AND branchId = ?
         AND validFromChapter <= ? AND validUntilChapter > ?
         AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
         AND confidence >= 0.4
         AND TRIM(linkType) NOT IN ('', '关系', '人物关系', '角色关系', '关联', '联系', '相关')`,
      params.novelId,
      params.branchId,
      params.chapterNo,
      params.chapterNo,
    ),
    states: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt
       FROM EntityState
       WHERE novelId = ? AND branchId = ?
         AND validFromChapter <= ? AND validUntilChapter > ?
         AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
         AND confidence >= 0.4`,
      params.novelId,
      params.branchId,
      params.chapterNo,
      params.chapterNo,
    ),
  })
}

function buildRetrievalFingerprint(params: {
  novelId: string
  branchId: string
  chapterNo: number
  authoredContext: ExplicitAuthoredContext | null
}) {
  return hashGenerationContextCacheValue({
    activeIndex: queryAll<Record<string, unknown>>(
      `
        SELECT scopeKey, tableName, scopeStartChapter, scopeEndChapter, updatedAt
        FROM ActiveRetrievalIndex
        WHERE branchId = ?
        ORDER BY scopeKey ASC
      `,
      params.branchId,
    ),
    pendingIndex: queryAll<Record<string, unknown>>(
      `
        SELECT scopeKey, tableName, phase, rowCount, textIndexCompleted, vectorIndexCompleted,
               rebuildFingerprint, updatedAt
        FROM PendingRetrievalIndex
        WHERE branchId = ?
        ORDER BY scopeKey ASC
      `,
      params.branchId,
    ),
    facts: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt
       FROM KnowledgeFact
       WHERE novelId = ? AND branchId = ? AND validFromChapter <= ? AND validUntilChapter > ?`,
      params.novelId,
      params.branchId,
      params.chapterNo,
      params.chapterNo,
    ),
    links: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt
       FROM EntityLink
       WHERE novelId = ? AND branchId = ? AND validFromChapter <= ? AND validUntilChapter > ?`,
      params.novelId,
      params.branchId,
      params.chapterNo,
      params.chapterNo,
    ),
    events: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt
       FROM KnowledgeEvent
       WHERE novelId = ? AND branchId = ? AND chapterNo <= ?`,
      params.novelId,
      params.branchId,
      params.chapterNo,
    ),
    worlds: loadAggregateVersion(
      `SELECT COUNT(*) AS count, MAX(updatedAt) AS updatedAt
       FROM KnowledgeWorld
       WHERE novelId = ? AND branchId = ? AND validFromChapter <= ? AND validUntilChapter > ?`,
      params.novelId,
      params.branchId,
      params.chapterNo,
      params.chapterNo,
    ),
    authoredSeeds: params.authoredContext?.retrievalSeeds ?? [],
  })
}

function buildNeighborhoodExcerpt(text: string, maxLines = 10) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join(' ')
}

function buildBranchLineageContextBlock(params: {
  novelId: string
  branchId: string
  chapterText: string
  branchContextNodeId?: string
  branchContextInclusion?: BranchLineageInclusion
}) {
  if (!params.branchContextNodeId) return null
  const history = getGeneratedHistory({
    novelId: params.novelId, branchId: params.branchId,
    branchContextNodeId: params.branchContextNodeId,
    branchContextInclusion: params.branchContextInclusion,
  })
  if (!history.content) return null
  return {
    compression: history.preview,
    block: {
      id: 'branch-lineage-full-text',
      label: '当前分支生成历史',
      enabled: true,
      priority: 'highest' as const,
      content: renderBlock('当前分支谱系全文', ['原始章节正文：', params.chapterText.trim(), '', history.content]),
    },
  }
}

function looksLikeRelationshipDelta(deltaType: string, key: string) {
  return /relationship|bond|alliance|romance|trust/i.test(`${deltaType} ${key}`)
}

function looksLikeWorldDelta(deltaType: string, key: string) {
  return /world|rule|setting|power|ability|artifact|location|faction/i.test(`${deltaType} ${key}`)
}

function looksLikeCharacterStateDelta(deltaType: string, key: string) {
  return /state|status|identity|goal|stance|emotion|injury/i.test(`${deltaType} ${key}`)
}

function mergeExplicitAuthoredContextIntoChapterState(chapterState: ChapterStatePromptData, authoredContext: ExplicitAuthoredContext) {
  for (const delta of authoredContext.whatIfSession?.deltas ?? []) {
    const nextDescription = delta.description.trim() || delta.newValue?.trim() || delta.key.trim() || delta.deltaType.trim()
    if (!nextDescription) continue

    if (looksLikeRelationshipDelta(delta.deltaType, delta.key) && delta.subjectName?.trim() && delta.targetName?.trim()) {
      chapterState.active_relationships.unshift({
        source: delta.subjectName.trim(),
        target: delta.targetName.trim(),
        type: delta.key.trim() || delta.deltaType.trim(),
        polarity: delta.newValue?.trim() || undefined,
        validFromChapter: delta.validFromChapter ?? undefined,
      })
      continue
    }

    if (looksLikeWorldDelta(delta.deltaType, delta.key)) {
      chapterState.world_rules.unshift({
        term: delta.key.trim() || delta.subjectName?.trim() || delta.deltaType.trim(),
        definition: delta.newValue?.trim() || nextDescription,
        firstSeenChapter: delta.validFromChapter ?? undefined,
      })
      continue
    }

    if (looksLikeCharacterStateDelta(delta.deltaType, delta.key) && delta.subjectName?.trim()) {
      chapterState.major_characters.unshift({
        name: delta.subjectName.trim(),
        status: delta.newValue?.trim() || nextDescription,
        lastSeenChapter: delta.validFromChapter ?? undefined,
      })
      continue
    }

    chapterState.open_threads.unshift({
      name: delta.key.trim() || delta.deltaType.trim() || 'speculative_delta',
      description: nextDescription,
    })
  }

  if (authoredContext.latestFutureJumpBridgeSummary) {
    chapterState.open_threads.unshift({
      name: 'future_jump_bridge_summary',
      description: buildCompactExcerpt(authoredContext.latestFutureJumpBridgeSummary, 160),
    })
  }

  if (authoredContext.futureJumpRun) {
    chapterState.open_threads.unshift({
      name: 'future_jump_source_context',
      description: `当前 Future Jump 来源于第 ${authoredContext.futureJumpRun.sourceContext.chapterNo} 章的 ${authoredContext.futureJumpRun.sourceContext.nodeType} 上下文。`,
    })
  }

  if (authoredContext.latestFutureJumpRevisionText) {
    chapterState.recent_events.unshift({
      chapter: authoredContext.futureJumpRun?.targetChapterNo ?? 0,
      name: 'Speculative future jump revision',
      summary: buildCompactExcerpt(authoredContext.latestFutureJumpRevisionText, 160),
    })
  }
}

function loadCharacterProfilesByEntityId(params: {
  novelId: string
  branchId: string
  entityIds: string[]
  chapterNo: number
  db?: KnowledgeExtractionStoryStateDb
}) {
  if (!params.entityIds.length) return new Map<string, CharacterRoleCardProfile>()
  const db = params.db ?? { queryAll }
  const rows = db.queryAll<{ subjectEntityId: string | null; valueJson: string | null; sourceChapter: number }>(
    `
      SELECT subjectEntityId, valueJson, sourceChapter
        FROM KnowledgeFact
        WHERE novelId = ? AND branchId = ? AND factType = 'character_profile'
          AND subjectEntityId IN (${params.entityIds.map(() => '?').join(', ')})
          AND validFromChapter <= ?
          AND validUntilChapter > ?
          AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY validFromChapter ASC, sourceChapter ASC
    `,
    params.novelId,
    params.branchId,
    ...params.entityIds,
    params.chapterNo,
    params.chapterNo,
  )

  const profileByEntityId = new Map<string, CharacterRoleCardProfile>()
  for (const row of rows) {
    const entityId = row.subjectEntityId?.trim()
    if (!entityId || !row.valueJson) continue
    try {
      const parsed = JSON.parse(row.valueJson) as { profile?: unknown }
      const profile = normalizeCharacterRoleCardProfile(parsed.profile)
      if (!hasCharacterRoleCardProfile(profile)) continue
      profileByEntityId.set(entityId, mergeCharacterRoleCardProfiles(profileByEntityId.get(entityId), profile))
    } catch {
    }
  }

  return profileByEntityId
}

function renderChapterStateForPrompt(
  chapterState: ChapterStatePromptData,
  options?: { title?: string }
) {
  const lines: string[] = []

  lines.push('人物状态：')
  lines.push(
    ...(chapterState.major_characters.length
      ? chapterState.major_characters.slice(0, 8).map((character) => {
          const aliasText = character.aliases?.length ? `｜别名：${character.aliases.slice(0, 3).join('、')}` : ''
          const chapterText = typeof character.lastSeenChapter === 'number' ? `｜最近出现：第 ${character.lastSeenChapter} 章` : ''
          const profile = character.profile
          const profileText = profile && hasCharacterRoleCardProfile(profile)
            ? `｜${buildCharacterRoleCardLines(profile, { includeEvidence: false, includeNotes: true }).slice(0, 4).join('｜')}`
            : ''
          return `- ${character.name}｜状态：${character.status?.trim() || '未知'}${aliasText}${chapterText}${profileText}`
        })
      : ['- 暂无人物状态。'])
  )

  lines.push('', '关键关系：')
  lines.push(
    ...(chapterState.active_relationships.length
      ? chapterState.active_relationships.slice(0, 8).map((relation) => {
          const polarity = relation.polarity?.trim() ? `｜${relation.polarity}` : ''
          const chapterText = typeof relation.validFromChapter === 'number' ? `｜起始：第 ${relation.validFromChapter} 章` : ''
          return `- ${relation.source} ↔ ${relation.target}｜${relation.type}${polarity}${chapterText}`
        })
      : ['- 暂无关键关系。'])
  )

  lines.push('', '近期事件：')
  lines.push(
    ...(chapterState.recent_events.length
      ? chapterState.recent_events.slice(0, 6).map((event) => `- 第 ${event.chapter} 章｜${event.name}｜${event.summary}`)
      : ['- 暂无近期事件。'])
  )

  lines.push('', '世界设定：')
  lines.push(
    ...(chapterState.world_rules.length
      ? chapterState.world_rules.slice(0, 8).map((rule) => `- ${rule.term}｜${rule.definition}`)
      : ['- 暂无稳定设定。'])
  )

  lines.push('', '未解线索：')
  lines.push(
    ...(chapterState.open_threads.length
      ? chapterState.open_threads.slice(0, 6).map((thread) => `- ${thread.name}｜${thread.description}`)
      : ['- 暂无线索。'])
  )

  lines.push('', `未来章节限制：${chapterState.forbidden_future_facts}`)

  return renderBlock(options?.title?.trim() || '截至当前章节的知识状态', lines)
}

function buildEnrichedEvidenceQuery(params: {
  userInstruction: string
  selectedText: string
  neighborhoodText: string
  matchedEntities: EntityRow[]
  relatedEvents: Array<{ name: string }>
  relatedWorlds: Array<{ term: string }>
  graphContext: GraphAwareResult
}) {
  const focusTerms = uniqueStrings([
    ...params.matchedEntities.map((entity) => entity.canonicalName),
    ...params.graphContext.seedEntities.map((entity) => entity.label),
    ...params.graphContext.nodes.map((node) => node.label),
    ...params.graphContext.edges.flatMap((edge) => [edge.label ?? null, edge.linkType]),
    ...params.relatedEvents.map((event) => event.name),
    ...params.relatedWorlds.map((world) => world.term),
  ]).slice(0, 18)

  const query = [
    params.userInstruction.trim(),
    params.selectedText.trim(),
    buildNeighborhoodExcerpt(params.neighborhoodText),
    focusTerms.join(' '),
  ].filter(Boolean).join('\n')

  return {
    query,
    queryTerms: focusTerms,
    graphTerms: focusTerms,
  }
}

function formatEvidenceLocation(item: GenerationContextEvidence) {
  if (item.lineStart !== null && item.lineEnd !== null) {
    return `第 ${item.chapterNo} 章 ${item.lineStart}-${item.lineEnd} 行`
  }
  if (item.lineStart !== null) {
    return `第 ${item.chapterNo} 章 第 ${item.lineStart} 行`
  }
  return `第 ${item.chapterNo} 章`
}

function formatEvidenceBlockLine(item: GenerationContextEvidence) {
  const title = item.title?.trim() ? `｜${item.title.trim()}` : ''
  return `- [${item.sourceLabel}] ${formatEvidenceLocation(item)}${title}：${item.text}`
}

function buildFilteredGraphContextText(params: {
  graphContext: GraphAwareResult
  excludedGraphEdgeIds: Set<string>
  latestStateByEntityId: Map<string, EntityStatePreviewRow>
  chapterNo: number
}) {
  const nodesById = new Map(params.graphContext.nodes.map((node) => [node.id, node] as const))
  const stateLines = params.graphContext.seedEntities.flatMap((entity) => {
    const summary = params.latestStateByEntityId.get(entity.id)
    const text = summary ? `${summary.stateValue}｜${summary.description?.trim() || '待从图谱状态补充'}` : ''
    return text ? [`- ${entity.label}：截至第${params.chapterNo}章，${text}`] : []
  })
  const relationLines = params.graphContext.edges
    .filter((edge) => edge.includeInPrompt && !params.excludedGraphEdgeIds.has(edge.id))
    .slice(0, 10)
    .map((edge) => {
      const source = nodesById.get(edge.source)?.label ?? edge.source
      const target = nodesById.get(edge.target)?.label ?? edge.target
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

function createEmptyGraphContext(warnings: string[]): GraphAwareResult {
  return {
    seedEntities: [],
    nodes: [],
    edges: [],
    contextText: '',
    warnings,
    tokenEstimate: 0,
    status: 'ready',
  }
}

function buildChapterGraphEvidenceQuery(params: {
  chapterTitle: string
  chapterSummary: string
  graphContext: GraphAwareResult
}) {
  const queryTerms = uniqueStrings([
    params.chapterTitle,
    ...params.graphContext.seedEntities.map((entity) => entity.label),
    ...params.graphContext.nodes.map((node) => node.label),
    ...params.graphContext.edges.flatMap((edge) => [edge.label ?? null, edge.linkType]),
  ]).slice(0, 18)

  return {
    query: [params.chapterTitle.trim(), params.chapterSummary.trim(), queryTerms.join(' ')].filter(Boolean).join('\n'),
    queryTerms,
    graphTerms: queryTerms,
  }
}

function loadEntitiesWithAliases(
  novelId: string,
  branchId: string,
  chapterNo: number,
  options?: { entityLimit?: number },
  db: KnowledgeExtractionStoryStateDb = { queryAll }
) {
  const entityLimit = Math.max(1, Math.min(options?.entityLimit ?? 24, 64))
  const entities = db.queryAll<{
    id: string
    canonicalName: string
    lastSeenChapter: number | null
  }>(
    `
      SELECT id, canonicalName, lastSeenChapter
      FROM KnowledgeEntity
      WHERE novelId = ? AND branchId = ? AND firstSeenChapter <= ?
      ORDER BY importance DESC, lastSeenChapter DESC, canonicalName ASC
      LIMIT ?
    `,
    novelId,
    branchId,
    chapterNo,
    entityLimit
  )

  if (!entities.length) return [] as EntityRow[]

  const entityIds = entities.map((entity) => entity.id)
  const aliases = db.queryAll<{ entityId: string; alias: string }>(
    `
      SELECT entityId, alias
      FROM EntityAlias
      WHERE entityId IN (${entityIds.map(() => '?').join(', ')})
        AND sourceChapter <= ?
    `,
    ...entityIds,
    chapterNo
  )

  const aliasesByEntityId = new Map<string, Array<{ alias: string }>>()
  for (const alias of aliases) {
    const current = aliasesByEntityId.get(alias.entityId) ?? []
    current.push({ alias: alias.alias })
    aliasesByEntityId.set(alias.entityId, current)
  }
  const profileByEntityId = loadCharacterProfilesByEntityId({
    novelId,
    branchId,
    entityIds,
    chapterNo,
    db,
  })

  return entities.map((entity) => ({
    ...entity,
    aliases: aliasesByEntityId.get(entity.id) ?? [],
    profile: profileByEntityId.get(entity.id),
  }))
}

function loadEntitiesWithAliasesByIds(params: {
  novelId: string
  branchId: string
  chapterNo: number
  entityIds: string[]
  db?: KnowledgeExtractionStoryStateDb
}) {
  const entityIds = Array.from(new Set(params.entityIds.map((entityId) => entityId.trim()).filter(Boolean)))
  if (!entityIds.length) return [] as EntityRow[]

  const db = params.db ?? { queryAll }
  const entities = db.queryAll<{
    id: string
    canonicalName: string
    lastSeenChapter: number | null
  }>(
    `
      SELECT id, canonicalName, lastSeenChapter
      FROM KnowledgeEntity
      WHERE novelId = ? AND branchId = ? AND firstSeenChapter <= ?
        AND id IN (${entityIds.map(() => '?').join(', ')})
      ORDER BY importance DESC, lastSeenChapter DESC, canonicalName ASC
    `,
    params.novelId,
    params.branchId,
    params.chapterNo,
    ...entityIds,
  )

  if (!entities.length) return [] as EntityRow[]

  const resolvedEntityIds = entities.map((entity) => entity.id)
  const aliases = db.queryAll<{ entityId: string; alias: string }>(
    `
      SELECT entityId, alias
      FROM EntityAlias
      WHERE entityId IN (${resolvedEntityIds.map(() => '?').join(', ')})
        AND sourceChapter <= ?
    `,
    ...resolvedEntityIds,
    params.chapterNo,
  )
  const aliasesByEntityId = new Map<string, Array<{ alias: string }>>()
  for (const alias of aliases) {
    const current = aliasesByEntityId.get(alias.entityId) ?? []
    current.push({ alias: alias.alias })
    aliasesByEntityId.set(alias.entityId, current)
  }
  const profileByEntityId = loadCharacterProfilesByEntityId({
    novelId: params.novelId,
    branchId: params.branchId,
    entityIds: resolvedEntityIds,
    chapterNo: params.chapterNo,
    db,
  })

  return entities.map((entity) => ({
    ...entity,
    aliases: aliasesByEntityId.get(entity.id) ?? [],
    profile: profileByEntityId.get(entity.id),
  }))
}

function selectStoryStateEntities(params: {
  entities: EntityRow[]
  currentChapterText: string
  maxCharacters: number
}) {
  const maxCharacters = Math.max(1, params.maxCharacters)
  const normalizedText = params.currentChapterText.trim()
  if (!normalizedText) {
    return params.entities.slice(0, maxCharacters)
  }

  const matched = params.entities.filter((entity) => {
    if (normalizedText.includes(entity.canonicalName)) return true
    return entity.aliases.some((alias) => normalizedText.includes(alias.alias))
  })
  if (matched.length >= maxCharacters) {
    return matched.slice(0, maxCharacters)
  }

  const matchedIds = new Set(matched.map((entity) => entity.id))
  const remaining = params.entities.filter((entity) => !matchedIds.has(entity.id))
  return [...matched, ...remaining].slice(0, maxCharacters)
}

export function buildKnowledgeExtractionStoryState(request: KnowledgeExtractionStoryStateRequest) {
  if (request.asOfChapter <= 0) {
    return renderChapterStateForPrompt({
      major_characters: [],
      active_relationships: [],
      recent_events: [],
      world_rules: [],
      open_threads: [],
      forbidden_future_facts: 'Do not use any facts from future chapters.',
    })
  }

  const maxCharacters = Math.max(4, Math.min(request.maxCharacters ?? 10, 16))
  const recentEventLimit = Math.max(1, Math.min(request.recentEventLimit ?? 6, 12))
  const db = request.db ?? { queryAll }
  const candidateEntities = loadEntitiesWithAliases(
    request.novelId,
    request.branchId,
    request.asOfChapter,
    {
      entityLimit: Math.max(maxCharacters * 2, 24),
    },
    db,
  )
  const selectedEntities = selectStoryStateEntities({
    entities: candidateEntities,
    currentChapterText: request.currentChapterText ?? '',
    maxCharacters,
  })
  const entityIds = selectedEntities.map((entity) => entity.id)
  const latestStateByEntityId = new Map<string, EntityStatePreviewRow>()

  if (entityIds.length) {
    const activeStates = loadEntityStatesByEntityIds({
      novelId: request.novelId,
      branchId: request.branchId,
      chapterNo: request.asOfChapter,
      includeLowConfidence: false,
      entityIds,
      limit: Math.max(entityIds.length * 2, 12),
      db,
    })
    for (const state of activeStates) {
      if (latestStateByEntityId.has(state.entityId)) continue
      latestStateByEntityId.set(state.entityId, state)
    }
  }

  const activeRelationships = entityIds.length
    ? db.queryAll<ChapterStateRelationship>(
        `
          SELECT se.canonicalName AS source,
                 te.canonicalName AS target,
                 kr.relationType AS type,
                 kr.polarity,
                 kr.validFromChapter
          FROM KnowledgeRelation kr
          JOIN KnowledgeEntity se ON se.id = kr.sourceEntityId
          JOIN KnowledgeEntity te ON te.id = kr.targetEntityId
          WHERE kr.novelId = ? AND kr.branchId = ?
            AND kr.validFromChapter <= ?
            AND kr.validUntilChapter > ?
            AND kr.status NOT IN ('rejected', 'outdated', 'potentially_stale')
            AND (kr.sourceEntityId IN (${entityIds.map(() => '?').join(', ')}) OR kr.targetEntityId IN (${entityIds.map(() => '?').join(', ')}))
          ORDER BY kr.strength DESC, kr.sourceChapter DESC
          LIMIT 10
        `,
        request.novelId,
        request.branchId,
        request.asOfChapter,
        request.asOfChapter,
        ...entityIds,
        ...entityIds,
      )
    : []

  const recentEvents = db.queryAll<ChapterStateEvent>(
    `
      SELECT chapterNo AS chapter, name, summary
      FROM KnowledgeEvent
      WHERE novelId = ? AND branchId = ? AND chapterNo <= ?
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY chapterNo DESC, importance DESC
      LIMIT ?
    `,
    request.novelId,
    request.branchId,
    request.asOfChapter,
    recentEventLimit,
  )

  const worldRules = db.queryAll<ChapterStateRule>(
    `
      SELECT term, definition, firstSeenChapter
      FROM KnowledgeWorld
      WHERE novelId = ? AND branchId = ?
        AND validFromChapter <= ?
        AND validUntilChapter > ?
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY firstSeenChapter DESC, term ASC
      LIMIT 8
    `,
    request.novelId,
    request.branchId,
    request.asOfChapter,
    request.asOfChapter,
  )

  const openThreads = db.queryAll<{ name: string; valueJson: string | null }>(
    `
      SELECT predicate AS name, valueJson
      FROM KnowledgeFact
      WHERE novelId = ? AND branchId = ?
        AND factType = 'open_thread'
        AND validFromChapter <= ?
        AND validUntilChapter > ?
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY sourceChapter DESC
      LIMIT 6
    `,
    request.novelId,
    request.branchId,
    request.asOfChapter,
    request.asOfChapter,
  ).map((thread) => {
    const parsed = parseJsonObject<{ description?: unknown }>(thread.valueJson, {})
    return {
      name: thread.name,
      description: typeof parsed.description === 'string' && parsed.description.trim()
        ? parsed.description.trim()
        : thread.name,
    }
  })

  return renderChapterStateForPrompt({
    major_characters: selectedEntities.map((entity) => ({
      name: entity.canonicalName,
      aliases: entity.aliases.map((alias) => alias.alias),
      status: latestStateByEntityId.get(entity.id)?.stateValue ?? '未知',
      lastSeenChapter: entity.lastSeenChapter ?? undefined,
      profile: entity.profile,
    })),
    active_relationships: activeRelationships,
    recent_events: recentEvents,
    world_rules: worldRules,
    open_threads: openThreads,
    forbidden_future_facts: `Do not use any facts from chapters > ${request.asOfChapter}.`,
  }, {
    title: `截至第 ${request.asOfChapter} 章的故事状态`,
  })
}

export async function buildGenerationContext(
  request: GenerationContextRequest,
  options: GenerationContextBuildOptions = {},
): Promise<GenerationContextBuildResult> {
  const effectiveOperationType = resolveGenerationContextOperationType(request.operationType)
  const roleplayContextBlock = effectiveOperationType === 'roleplay'
    ? buildRoleplayContextBlock(request.roleplayMessages)
    : null
  const writingSkillBundle = options.writingSkillBundle !== undefined
    ? options.writingSkillBundle
    : request.writingSkillCardIds?.length
    ? resolveWritingSkillRuntimes({
        cardIds: request.writingSkillCardIds,
        count: request.writingSkillExampleCount,
        seed: typeof request.writingSkillSeed === 'number' && Number.isFinite(request.writingSkillSeed)
          ? Math.floor(request.writingSkillSeed) & 0x7fffffff
          : 1,
      })
    : null
  const excludedGraphEdgeIds = new Set((request.excludedGraphEdgeIds ?? []).map((item) => item.trim()).filter(Boolean))
  const excludedEvidenceIds = new Set((request.excludedEvidenceIds ?? []).map((item) => item.trim()).filter(Boolean))
  const branchId = normalizeBranchId(request.novelId, request.branchId)
  const chapter = queryOne<{ id: string; chapterNo: number; title: string | null; rawText: string | null; summary: string | null }>(
    'SELECT id, chapterNo, title, rawText, summary FROM KnowledgeChapter WHERE id = ? AND novelId = ? AND branchId = ? LIMIT 1',
    request.chapterId,
    request.novelId,
    branchId
  )

  if (!chapter) {
    throw new Error('Chapter not found in knowledge store')
  }

  const authoredContext = (request.whatIfSessionId?.trim() || request.futureJumpRunId?.trim())
    ? loadExplicitAuthoredContext({
        novelId: request.novelId,
        branchId,
        whatIfSessionId: request.whatIfSessionId,
        futureJumpRunId: request.futureJumpRunId,
      })
    : null

  const storedLines = queryAll<{ lineNo: number; text: string }>(
    'SELECT lineNo, text FROM ChapterLine WHERE chapterId = ? ORDER BY lineNo ASC',
    chapter.id
  )
  const recentChapters = queryAll<{ chapterNo: number; title: string | null; rawText: string | null }>(
    `
      SELECT chapterNo, title, rawText
      FROM KnowledgeChapter
      WHERE novelId = ? AND branchId = ? AND chapterNo < ?
      ORDER BY chapterNo DESC
      LIMIT 5
    `,
    request.novelId,
    branchId,
    chapter.chapterNo
  )
  const entities = loadEntitiesWithAliases(request.novelId, branchId, chapter.chapterNo)
  const facts = queryAll<FactRow & { sourceChapter: number }>(
    `
      SELECT f.subjectEntityId, f.objectEntityId, f.predicate, f.valueJson, f.sourceChapter,
             se.canonicalName as subjectCanonicalName,
             oe.canonicalName as objectCanonicalName
       FROM KnowledgeFact f
       LEFT JOIN KnowledgeEntity se ON se.id = f.subjectEntityId
       LEFT JOIN KnowledgeEntity oe ON oe.id = f.objectEntityId
       WHERE f.novelId = ? AND f.branchId = ? AND f.validFromChapter <= ?
        AND f.validUntilChapter > ?
        AND f.status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY f.sourceChapter DESC
      LIMIT 30
    `,
    request.novelId,
    branchId,
    chapter.chapterNo,
    chapter.chapterNo
  )
  const events = queryAll<{ chapterNo: number; name: string; summary: string }>(
    `
      SELECT chapterNo, name, summary
      FROM KnowledgeEvent
      WHERE novelId = ? AND branchId = ? AND chapterNo <= ?
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY importance DESC, chapterNo DESC
      LIMIT 12
    `,
    request.novelId,
    branchId,
    chapter.chapterNo
  )
  const worlds = queryAll<{ term: string; category: string | null; definition: string }>(
    `
       SELECT term, category, definition
       FROM KnowledgeWorld
       WHERE novelId = ? AND branchId = ? AND validFromChapter <= ?
        AND validUntilChapter > ?
        AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
      ORDER BY firstSeenChapter ASC
      LIMIT 12
    `,
    request.novelId,
    branchId,
    chapter.chapterNo,
    chapter.chapterNo
  )

  const storedChapterText = buildFullChapterText(chapter.rawText, storedLines)
  const sourceText = request.sourceText?.trim()
  const fullChapterText = sourceText || storedChapterText
  const lines = sourceText ? splitContextLines(fullChapterText) : storedLines
  const selectionRange = inferSelectionRange(lines, request.selectedText)
  const neighborhoodText = buildNeighborhoodText(lines, selectionRange.lineStart, selectionRange.lineEnd)
  const chapterTextThroughSelection = buildChapterTextThroughSelection(
    fullChapterText,
    request.selectedText,
    selectionRange.lineEnd,
  )
  const branchLineage = buildBranchLineageContextBlock({
    novelId: request.novelId, branchId,
    chapterText: storedChapterText,
    branchContextNodeId: request.branchContextNodeId,
    branchContextInclusion: request.branchContextInclusion,
  })
  const branchLineageContextBlock = branchLineage?.block ?? null
  const isContinuationTask = isContinuationRewriteTask({
    selectedText: request.selectedText,
    hasContinuationSource: Boolean(request.branchContextNodeId),
  })
  const graphCacheKey = hashGenerationContextCacheValue({
    version: 1,
    novelId: request.novelId,
    branchId,
    chapterId: chapter.id,
    chapterNo: chapter.chapterNo,
    strategy: isContinuationTask ? 'chapter-characters' : 'selection-entities',
    operationType: isContinuationTask ? null : effectiveOperationType,
    selectedText: isContinuationTask ? null : request.selectedText,
    neighborhoodText: isContinuationTask ? null : neighborhoodText,
  })
  const graphKnowledgeFingerprint = buildGraphKnowledgeFingerprint({
    novelId: request.novelId,
    branchId,
    chapterId: chapter.id,
    chapterNo: chapter.chapterNo,
  })
  const cachedGraph = options.cachedRagArtifacts?.version === 1
    ? options.cachedRagArtifacts.graph
    : null
  const graphCacheHit = Boolean(
    cachedGraph
    && cachedGraph.cacheKey === graphCacheKey
    && cachedGraph.knowledgeFingerprint === graphKnowledgeFingerprint
  )
  const graphContext = graphCacheHit
    ? cachedGraph!.context
    : isContinuationTask
      ? await buildChapterScopedGraphContext({
          novelId: request.novelId,
          branchId,
          chapterId: chapter.id,
          chapterNo: chapter.chapterNo,
          maxHops: 1,
          includeLowConfidence: false,
        })
      : await buildGraphAwareContext({
          novelId: request.novelId,
          branchId,
          chapterNo: chapter.chapterNo,
          selectedText: request.selectedText,
          nearbyText: neighborhoodText,
          operationType: effectiveOperationType,
          maxHops: 1,
          includeLowConfidence: false,
        })
  const currentSummary = chapter.summary?.trim() || '当前章节尚未生成摘要。'
  const entityContext = `${request.selectedText}\n${neighborhoodText}`
  const matchedEntities = isContinuationTask
    ? loadEntitiesWithAliasesByIds({
        novelId: request.novelId,
        branchId,
        chapterNo: chapter.chapterNo,
        entityIds: graphContext.seedEntities.map((entity) => entity.id),
      })
    : entities.filter((entity) => {
        if (entityContext.includes(entity.canonicalName)) return true
        return entity.aliases.some((alias) => entityContext.includes(alias.alias))
      })
  const relatedEntityIds = new Set(matchedEntities.map((item) => item.id))
  const matchedStates = matchedEntities.length
    ? loadEntityStatesByEntityIds({
        novelId: request.novelId,
        branchId,
        chapterNo: chapter.chapterNo,
        includeLowConfidence: false,
        entityIds: matchedEntities.map((entity) => entity.id),
        limit: Math.max(matchedEntities.length * 4, 24),
      })
    : []
  const latestStateByEntityId = new Map<string, EntityStatePreviewRow>()
  for (const state of matchedStates) {
    if (latestStateByEntityId.has(state.entityId)) continue
    latestStateByEntityId.set(state.entityId, state)
  }

  const relatedFacts = facts.filter((fact) => {
    return Boolean(
      (fact.subjectEntityId && relatedEntityIds.has(fact.subjectEntityId)) ||
      (fact.objectEntityId && relatedEntityIds.has(fact.objectEntityId)) ||
      fact.predicate.includes(request.selectedText.slice(0, 12))
    )
  }).slice(0, 12)

  const relatedEvents = events.filter((event) => {
    return matchedEntities.some((entity) => event.summary.includes(entity.canonicalName) || event.name.includes(entity.canonicalName))
  }).slice(0, 8)

  const relatedWorlds = worlds.filter((world) => {
    return request.selectedText.includes(world.term) || neighborhoodText.includes(world.term)
  }).slice(0, 8)

  const chapterState: ChapterStatePromptData = {
    major_characters: matchedEntities.map((entity) => ({
      name: entity.canonicalName,
      aliases: entity.aliases.map((alias) => alias.alias),
      status: latestStateByEntityId.get(entity.id)?.stateValue ?? '未知',
      lastSeenChapter: chapter.chapterNo,
      profile: entity.profile,
    })),
    active_relationships: graphContext.edges
      .filter((edge) => edge.includeInPrompt && !excludedGraphEdgeIds.has(edge.id))
      .slice(0, 10)
      .map((edge) => ({
        source: graphContext.nodes.find((node) => node.id === edge.source)?.label ?? edge.source,
        target: graphContext.nodes.find((node) => node.id === edge.target)?.label ?? edge.target,
        type: edge.linkType,
        polarity: edge.polarity,
        validFromChapter: edge.validFromChapter,
        evidenceChapter: edge.evidenceLocation?.chapterNo,
      })),
    recent_events: events
      .slice(0, 6)
      .map((event) => ({ chapter: event.chapterNo, name: event.name, summary: event.summary })),
    world_rules: worlds
      .slice(0, 8)
      .map((world) => ({ term: world.term, definition: world.definition })),
    open_threads: facts
      .filter((fact) => fact.predicate.trim())
      .slice(0, 6)
      .map((fact) => {
        const parsed = parseJsonObject<{ description?: unknown }>(fact.valueJson, {})
        return {
          name: fact.predicate,
          description: typeof parsed.description === 'string' ? parsed.description : fact.predicate,
        }
      }),
    forbidden_future_facts: `Do not use any facts from chapters > ${chapter.chapterNo}.`,
  }

  if (authoredContext) {
    mergeExplicitAuthoredContextIntoChapterState(chapterState, authoredContext)
  }

  const graphContextText = buildFilteredGraphContextText({
    graphContext,
    excludedGraphEdgeIds,
    latestStateByEntityId,
    chapterNo: chapter.chapterNo,
  })

  const warnings: string[] = []
  const evidenceQuery = buildEnrichedEvidenceQuery({
    userInstruction: request.userInstruction,
    selectedText: request.selectedText,
    neighborhoodText,
    matchedEntities,
    relatedEvents,
    relatedWorlds,
    graphContext,
  })
  const evidenceCacheKey = hashGenerationContextCacheValue({
    version: 1,
    novelId: request.novelId,
    branchId,
    maxChapterNo: chapter.chapterNo,
    query: evidenceQuery.query,
    queryTerms: evidenceQuery.queryTerms,
    graphTerms: evidenceQuery.graphTerms,
    whatIfSessionId: request.whatIfSessionId?.trim() || null,
    futureJumpRunId: request.futureJumpRunId?.trim() || null,
    limit: 10,
  })
  const retrievalFingerprint = buildRetrievalFingerprint({
    novelId: request.novelId,
    branchId,
    chapterNo: chapter.chapterNo,
    authoredContext,
  })
  const cachedEvidence = options.cachedRagArtifacts?.version === 1
    ? options.cachedRagArtifacts.evidence
    : null
  const evidenceCacheHit = Boolean(
    cachedEvidence
    && cachedEvidence.cacheKey === evidenceCacheKey
    && cachedEvidence.retrievalFingerprint === retrievalFingerprint
  )
  const lanceEvidenceResult = evidenceCacheHit
    ? {
        matches: cachedEvidence!.matches,
        warning: cachedEvidence!.warning,
      }
    : await searchLanceEvidence({
        novelId: request.novelId,
        branchId,
        maxChapterNo: chapter.chapterNo,
        query: evidenceQuery.query,
        queryTerms: evidenceQuery.queryTerms,
        graphTerms: evidenceQuery.graphTerms,
        limit: 10,
        whatIfSessionId: request.whatIfSessionId,
        futureJumpRunId: request.futureJumpRunId,
      })
  const lanceEvidence = lanceEvidenceResult.matches
  if (lanceEvidenceResult.warning) {
    warnings.push(lanceEvidenceResult.warning)
  }
  const promptEvidence = lanceEvidence.filter((item) => !excludedEvidenceIds.has(item.id))

  const ragArtifacts: GenerationContextRagArtifacts = {
    version: 1,
    graph: {
      cacheKey: graphCacheKey,
      knowledgeFingerprint: graphKnowledgeFingerprint,
      context: graphContext,
    },
    evidence: {
      cacheKey: evidenceCacheKey,
      retrievalFingerprint,
      matches: lanceEvidence,
      ...(lanceEvidenceResult.warning ? { warning: lanceEvidenceResult.warning } : {}),
    },
  }
  options.onRagArtifacts?.(ragArtifacts, {
    graph: graphCacheHit ? 'hit' : 'miss',
    evidence: evidenceCacheHit ? 'hit' : 'miss',
  })

  warnings.push(...graphContext.warnings)

  const selectedTextBlock = request.selectedText.trim()
    ? [{
        id: 'selected-text',
        label: '选中文本',
        enabled: true,
        priority: 'highest' as const,
        content: renderBlock('选中文本', [request.selectedText]),
      }]
    : []

  const userInstructionBlock: GenerationContextBlock = {
    id: 'user-instruction',
    label: '任务',
    enabled: true,
    priority: 'highest',
    content: renderBlock('任务', buildRewriteTaskPromptLines({
      operationType: effectiveOperationType,
      userInstruction: request.userInstruction,
      continuation: isContinuationTask,
    })),
  }

  const blocks: GenerationContextBlock[] = [
    ...(roleplayContextBlock ? [roleplayContextBlock] : []),
    ...(!isContinuationTask || !branchLineageContextBlock
      ? [{
          id: 'neighborhood',
          label: '选区附近正文',
          enabled: true,
          priority: 'highest' as const,
          content: renderBlock('选区附近正文', [chapterTextThroughSelection]),
        }]
      : []),
    {
      id: 'current-summary',
      label: '当前章节摘要',
      enabled: true,
      priority: 'high',
      content: renderBlock('当前章节摘要', [currentSummary]),
    },
    {
      id: 'recent-chapters-full-text',
      label: '前情最近 5 章正文',
      enabled: true,
      priority: 'highest',
      content: renderBlock(
        '前情最近 5 章正文',
        recentChapters.length
          ? [
              ...recentChapters
                .slice()
                .sort((a, b) => a.chapterNo - b.chapterNo)
                .flatMap((item, index) => [
                  ...(index > 0 ? [''] : []),
                  `## 第 ${item.chapterNo} 章${item.title?.trim() ? ` ${item.title.trim()}` : ''}`,
                  item.rawText?.trim() || '（本章暂无正文）',
                ]),
            ]
          : ['当前章节之前暂无可用正文。']
      ),
    },
    {
      id: 'chapter-state',
      label: '截至当前章节的知识状态',
      enabled: true,
      priority: 'high',
      content: renderChapterStateForPrompt(chapterState),
    },
    ...(authoredContext?.authoredPromptLines.length
      ? [{
          id: 'authored-branch-context',
          label: '显式作者分支上下文',
          enabled: true,
          priority: 'highest' as const,
          content: renderBlock('显式作者分支上下文', authoredContext.authoredPromptLines),
        }]
      : []),
    {
      id: 'graph-context',
      label: 'GraphRAG 图谱上下文',
      enabled: true,
      priority: 'high',
      content: graphContextText,
    },
    {
      id: 'characters',
      label: '相关人物',
      enabled: true,
      priority: 'high',
      content: renderBlock(
        '相关人物',
        matchedEntities.length
          ? matchedEntities.map((entity) => {
              const state = latestStateByEntityId.get(entity.id)
              const compactDescription = buildCharacterDescriptionDelta(entity.profile ?? {}, state?.description?.trim() || '')
              const profile = entity.profile
              const profileText = profile && hasCharacterRoleCardProfile(profile)
                ? buildCharacterRoleCardLines(profile, { includeEvidence: false, includeNotes: true }).slice(0, 5).join('｜')
                : compactDescription || '待从图谱状态补充'
              return `- ${entity.canonicalName}｜状态：${state?.stateValue ?? '未知'}｜${profileText}`
            })
          : ['- 未命中明确人物。']
      ),
    },
    {
      id: 'facts',
      label: '相关事实',
      enabled: true,
      priority: 'high',
      content: renderBlock(
        '相关事实',
        relatedFacts.length
          ? relatedFacts.map((fact) => {
              const parsed = parseJsonObject(fact.valueJson, {})
              const valueText = typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed)
              return `- ${fact.subjectCanonicalName ?? '（无主语）'} ${fact.predicate} ${fact.objectCanonicalName ?? ''} ${valueText}`.trim()
            })
          : ['- 未命中额外事实。']
      ),
    },
    {
      id: 'events',
      label: '相关事件',
      enabled: true,
      priority: 'medium',
      content: renderBlock(
        '相关事件',
        relatedEvents.length
          ? relatedEvents.map((event) => `- 第 ${event.chapterNo} 章｜${event.name}｜${event.summary}`)
          : ['- 未命中额外事件。']
      ),
    },
    {
      id: 'worldbuilding',
      label: '相关设定',
      enabled: true,
      priority: 'medium',
      content: renderBlock(
        '相关世界设定',
        relatedWorlds.length
          ? relatedWorlds.map((world) => `- ${world.term}｜${world.category ?? 'concept'}｜${world.definition}`)
          : ['- 未命中额外设定。']
      ),
    },
    {
      id: 'evidence',
      label: '原文证据',
      enabled: true,
      priority: 'medium',
      content: renderBlock(
        'Lance 检索证据',
        promptEvidence.length
          ? promptEvidence.map((item) => formatEvidenceBlockLine(item))
          : ['- 没有检索到额外 Lance 证据。']
      ),
    },
    {
      id: 'output-constraints',
      label: '输出要求',
      enabled: true,
      priority: 'high',
      content: renderBlock('输出要求', [formatOutputConstraints(effectiveOperationType)]),
    },
    ...(writingSkillBundle?.blocks ?? []),
    ...(branchLineageContextBlock ? [branchLineageContextBlock] : []),
    ...selectedTextBlock,
    userInstructionBlock,
  ]

  const assembledContext = blocks.filter((block) => block.enabled).map((block) => block.content).join('\n\n')

  return {
    novelId: request.novelId,
    branchId,
    chapterId: request.chapterId,
    chapterNo: chapter.chapterNo,
    selectedLineStart: selectionRange.lineStart,
    selectedLineEnd: selectionRange.lineEnd,
    warnings,
    promptBlocks: blocks,
    assembledContext,
    graphContext,
    lanceEvidence,
    tokenEstimate: estimateTokenCount(assembledContext),
    compression: branchLineage?.compression ?? null,
  }
}

export async function buildChapterGraphContext(request: ChapterGraphContextRequest): Promise<ChapterGraphContextResult> {
  const chapter = queryOne<{ id: string; branchId: string; chapterNo: number; title: string | null; summary: string | null }>(
    `
      SELECT id, branchId, chapterNo, title, summary
      FROM KnowledgeChapter
      WHERE id = ? AND novelId = ?
      LIMIT 1
    `,
    request.chapterId,
    request.novelId
  )

  if (!chapter) {
    throw new Error('Chapter not found in knowledge store')
  }

  const graphContext = await buildChapterScopedGraphContext({
    novelId: request.novelId,
    branchId: chapter.branchId,
    chapterId: chapter.id,
    chapterNo: chapter.chapterNo,
    maxHops: request.maxHops ?? 1,
    includeLowConfidence: request.includeLowConfidence ?? false,
    confirmedOnly: request.confirmedOnly ?? false,
  })

  const chapterTitle = chapter.title?.trim() || `第 ${chapter.chapterNo} 章`
  const chapterSummary = chapter.summary?.trim() || ''
  const warnings = [...graphContext.warnings]
  const evidenceQuery = buildChapterGraphEvidenceQuery({
    chapterTitle,
    chapterSummary,
    graphContext,
  })
  const lanceEvidenceResult = evidenceQuery.queryTerms.length || chapterSummary
      ? await searchLanceEvidence({
          novelId: request.novelId,
          branchId: chapter.branchId,
          maxChapterNo: chapter.chapterNo,
          query: evidenceQuery.query,
          queryTerms: evidenceQuery.queryTerms,
          graphTerms: evidenceQuery.graphTerms,
          limit: 8,
        })
    : { matches: [] }
  const lanceEvidence = lanceEvidenceResult.matches
  if (lanceEvidenceResult.warning) {
    warnings.push(lanceEvidenceResult.warning)
  }

  return {
    novelId: request.novelId,
    branchId: chapter.branchId,
    chapterId: chapter.id,
    chapterNo: chapter.chapterNo,
    chapterTitle,
    warnings,
    graphContext: graphContext.nodes.length || graphContext.edges.length || graphContext.seedEntities.length
      ? graphContext
      : createEmptyGraphContext(warnings),
    lanceEvidence,
    tokenEstimate: estimateTokenCount(
      [graphContext.contextText, ...lanceEvidence.slice(0, 4).map((item) => item.text)].filter(Boolean).join('\n')
    ),
  }
}

export async function buildGenerationContextPreview(request: GenerationContextRequest): Promise<GenerationContextPreview> {
  const result = await buildGenerationContext(request)
  return {
    novelId: result.novelId,
    branchId: result.branchId,
    chapterId: result.chapterId,
    chapterNo: result.chapterNo,
    selectedLineStart: result.selectedLineStart,
    selectedLineEnd: result.selectedLineEnd,
    warnings: result.warnings,
    blocks: result.promptBlocks,
    assembledContext: result.assembledContext,
  }
}

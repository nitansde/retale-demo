import type { Chapter, PersistedNovelState, TimelineEvent } from '@/lib/types'
import { FUTURE_MAP_MISSING_SUMMARY_FALLBACK, type FutureMapResponse, type OutlineNodeChapterRecord, type OutlineNodeRecord } from '@/lib/story-branch-types'
import { normalizeWorkspaceState } from '@/lib/workspace-state'
import { createOutlineNode, createOutlineNodeChapter, listOutlineNodeChapters, listOutlineNodes } from '@/lib/server/outline-node-store'
import { getMainBranchId } from '@/lib/server/knowledge-store'
import { execute, queryAll, queryOne, withTransaction } from '@/lib/server/database-access'
import { loadWorkspacePayloadFromRuntimeOrRecovery } from '@/lib/server/workspace-resilience'

type Db = {
  execute: typeof execute
  queryAll: typeof queryAll
  queryOne: typeof queryOne
  withTransaction: typeof withTransaction
}

type KnowledgeChapterRow = {
  id: string
  chapterNo: number
  title: string | null
  summary: string | null
}

type ChapterAnchorSourceRow = KnowledgeChapterRow & {
  anchorChapterId: string | null
}

type WorkspaceChapterRow = {
  id: string
  chapterNo: number
  title: string | null
}

type KnowledgeEventRow = {
  id: string
  name: string
  summary: string
  consequences: string | null
  chapterNo: number
}

type OpenThreadRow = {
  id: string
  predicate: string
  valueJson: string | null
  sourceChapter: number
  confidence: number
  subjectName: string | null
  objectName: string | null
}

type EventParticipantRow = {
  eventId: string
  canonicalName: string
}

type ChapterAnchor = {
  chapterId: string | null
  chapterNo: number
  chapterTitle: string | null
  isPrimary: boolean
  sortOrder: number
}

type OutlineBootstrapCandidate = {
  id: string
  dedupeKey: string
  chapterNo: number | null
  title: string
  summary: string
  originalOutcome: string | null
  trackKey: string
  phaseLabel: string | null
  sourceType: string
  confidence: number | null
  involvedEntities: string[]
  keyEvents: string[]
  sortOrder: number
  chapterAnchors: ChapterAnchor[]
}

type BootstrapParams = {
  novelId: string
  branchId?: string
  workspaceState?: Partial<PersistedNovelState> | null
  db?: Db
}

type BootstrapResult = {
  createdNodes: number
  createdChapters: number
  outlineNodeCount: number
}

const defaultDb: Db = { execute, queryAll, queryOne, withTransaction }

const DERIVED_EVENT_CONFIDENCE = 0.78
const DERIVED_OPEN_THREAD_CONFIDENCE = 0.66
const DERIVED_SUMMARY_CONFIDENCE = 0.42
const CHAPTER_RANGE_BUCKET_SIZE = 10

function normalizeText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeKeyFragment(value: string | null | undefined) {
  const normalized = normalizeText(value)
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, '-')
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'main'
}

function getSourceTypePrecedence(sourceType: string) {
  switch (sourceType) {
    case 'authored':
      return 0
    case 'derived_event':
      return 1
    case 'derived_open_thread':
      return 2
    case 'derived_summary':
      return 3
    default:
      return 99
  }
}

function buildOutlineDedupeKey(title: string, chapterNo: number | null) {
  return `${chapterNo ?? 'na'}::${normalizeText(title).toLocaleLowerCase('en-US')}`
}

function getChapterRangeMeta(chapterNo: number | null) {
  if (!chapterNo || chapterNo < 1) {
    return {
      trackKey: 'chapter-range-unknown',
      phaseLabel: '章节范围待定',
    }
  }

  const bucket = Math.floor((chapterNo - 1) / CHAPTER_RANGE_BUCKET_SIZE) + 1
  const start = (bucket - 1) * CHAPTER_RANGE_BUCKET_SIZE + 1
  const end = start + CHAPTER_RANGE_BUCKET_SIZE - 1
  return {
    trackKey: `chapter-range-${bucket}`,
    phaseLabel: `第 ${start}-${end} 章`,
  }
}

function buildTrackMeta(timelineEvent: TimelineEvent | null, chapterNo: number | null) {
  const fallback = getChapterRangeMeta(chapterNo)
  if (!timelineEvent) {
    return fallback
  }

  const worldline = normalizeText(timelineEvent.worldline)
  const phase = normalizeText(timelineEvent.phase)
  return {
    trackKey: worldline ? `worldline-${normalizeKeyFragment(worldline)}` : fallback.trackKey,
    phaseLabel: phase || fallback.phaseLabel,
  }
}

function parseOpenThreadDescription(valueJson: string | null, fallback: string) {
  if (!valueJson) return fallback
  try {
    const parsed = JSON.parse(valueJson) as { description?: string }
    return normalizeText(parsed.description) || fallback
  } catch {
    return fallback
  }
}

function sortAndDedupeStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

function createChapterAnchorId(outlineNodeId: string, anchor: ChapterAnchor, hasSinglePrimaryAnchor: boolean) {
  if (anchor.isPrimary && hasSinglePrimaryAnchor && anchor.chapterNo >= 1 && /^outline_event_\d+$/u.test(outlineNodeId)) {
    return `outline_chapter_${anchor.chapterNo}_primary`
  }

  const chapterRef = anchor.chapterId?.trim() || `chapter-${anchor.chapterNo}`
  return `${outlineNodeId}:chapter:${chapterRef}:${anchor.sortOrder}`
}

function getPrimaryAnchor(anchors: ChapterAnchor[]) {
  return anchors.find((anchor) => anchor.isPrimary) ?? anchors[0] ?? null
}

function buildChapterAnchorsFromRows(chapterRows: Array<ChapterAnchorSourceRow | KnowledgeChapterRow>, relatedChapterIds: string[]) {
  const chapterById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]))
  const anchors: ChapterAnchor[] = relatedChapterIds
    .map<ChapterAnchor | null>((chapterId, index) => {
      const chapter = chapterById.get(chapterId)
      if (!chapter) return null
      return {
        chapterId: 'anchorChapterId' in chapter ? chapter.anchorChapterId : chapter.id,
        chapterNo: chapter.chapterNo,
        chapterTitle: chapter.title,
        isPrimary: index === 0,
        sortOrder: index,
      }
    })
    .filter((anchor): anchor is ChapterAnchor => anchor !== null)
    .sort((left, right) => left.chapterNo - right.chapterNo || left.sortOrder - right.sortOrder)

  return anchors.map((anchor, index) => ({
    ...anchor,
    isPrimary: index === 0,
    sortOrder: index,
  }))
}

function buildWorkspaceChapterRows(workspaceState: PersistedNovelState | null, novelId: string) {
  return (workspaceState?.localChapters ?? [])
    .filter((chapter) => chapter.novelId === novelId)
    .map<WorkspaceChapterRow>((chapter) => ({
      id: chapter.id,
      chapterNo: resolveWorkspaceChapterNo(chapter),
      title: normalizeText(chapter.title) || null,
    }))
    .filter((chapter) => chapter.chapterNo >= 1)
}

function resolveWorkspaceChapterNo(chapter: Chapter) {
  return Number.isInteger(chapter.order) && chapter.order > 0 ? chapter.order : 0
}

function mergeChapterRows(chapterRows: KnowledgeChapterRow[], workspaceChapterRows: WorkspaceChapterRow[]) {
  const mergedById = new Map<string, ChapterAnchorSourceRow>()
  for (const chapter of workspaceChapterRows) {
    mergedById.set(chapter.id, {
      id: chapter.id,
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      summary: null,
      anchorChapterId: null,
    })
  }
  for (const chapter of chapterRows) {
    mergedById.set(chapter.id, {
      ...chapter,
      anchorChapterId: chapter.id,
    })
  }
  return Array.from(mergedById.values()).sort((left, right) => left.chapterNo - right.chapterNo || left.id.localeCompare(right.id))
}

function pickTimelineEventForOutline(timelineEvents: TimelineEvent[], outlineChapterIds: string[]) {
  const chapterIdSet = new Set(outlineChapterIds)
  const candidates = timelineEvents
    .map((event) => ({
      event,
      overlapCount: event.chapterIds.filter((chapterId) => chapterIdSet.has(chapterId)).length,
    }))
    .filter((candidate) => candidate.overlapCount > 0)
    .sort((left, right) => left.event.order - right.event.order || right.overlapCount - left.overlapCount || left.event.id.localeCompare(right.event.id))

  return candidates[0]?.event ?? null
}

function choosePreferredNodes(nodes: OutlineNodeRecord[]) {
  const preferredByKey = new Map<string, OutlineNodeRecord>()
  for (const node of nodes) {
    const dedupeKey = buildOutlineDedupeKey(node.title, node.chapterNo)
    const current = preferredByKey.get(dedupeKey)
    if (!current) {
      preferredByKey.set(dedupeKey, node)
      continue
    }

    const precedenceDiff = getSourceTypePrecedence(node.sourceType) - getSourceTypePrecedence(current.sourceType)
    if (precedenceDiff < 0 || (precedenceDiff === 0 && (node.sortOrder < current.sortOrder || (node.sortOrder === current.sortOrder && node.id.localeCompare(current.id) < 0)))) {
      preferredByKey.set(dedupeKey, node)
    }
  }

  return Array.from(preferredByKey.values()).sort((left, right) => left.sortOrder - right.sortOrder || (left.chapterNo ?? Number.MAX_SAFE_INTEGER) - (right.chapterNo ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id))
}

async function loadWorkspaceStatePayload(workspaceState: Partial<PersistedNovelState> | null | undefined, db: Db) {
  if (workspaceState) {
    return normalizeWorkspaceState(workspaceState)
  }

  return loadWorkspacePayloadFromRuntimeOrRecovery('singleton', db)
}

function loadKnowledgeChapters(novelId: string, branchId: string, db: Db) {
  return db.queryAll<KnowledgeChapterRow>(
    `SELECT id, chapterNo, title, summary
     FROM KnowledgeChapter
     WHERE novelId = ? AND branchId = ?
     ORDER BY chapterNo ASC, id ASC`,
    novelId,
    branchId,
  )
}

function loadKnowledgeEvents(novelId: string, branchId: string, db: Db) {
  return db.queryAll<KnowledgeEventRow>(
    `SELECT id, name, summary, consequences, chapterNo
     FROM KnowledgeEvent
     WHERE novelId = ? AND branchId = ?
       AND status NOT IN ('rejected', 'outdated', 'potentially_stale')
     ORDER BY chapterNo ASC, importance DESC, id ASC`,
    novelId,
    branchId,
  )
}

function loadKnowledgeEventParticipants(eventIds: string[], db: Db) {
  if (!eventIds.length) return new Map<string, string[]>()
  const placeholders = eventIds.map(() => '?').join(', ')
  const rows = db.queryAll<EventParticipantRow>(
    `SELECT ep.eventId, ke.canonicalName
     FROM EventParticipant ep
     JOIN KnowledgeEntity ke ON ke.id = ep.entityId
     WHERE ep.eventId IN (${placeholders})
     ORDER BY ep.eventId ASC, ke.canonicalName ASC`,
    ...eventIds,
  )

  const namesByEventId = new Map<string, string[]>()
  for (const row of rows) {
    const current = namesByEventId.get(row.eventId) ?? []
    current.push(row.canonicalName)
    namesByEventId.set(row.eventId, current)
  }
  return namesByEventId
}

function loadOpenThreads(novelId: string, branchId: string, db: Db) {
  return db.queryAll<OpenThreadRow>(
    `SELECT f.id, f.predicate, f.valueJson, f.sourceChapter, f.confidence,
            se.canonicalName as subjectName,
            oe.canonicalName as objectName
     FROM KnowledgeFact f
     LEFT JOIN KnowledgeEntity se ON se.id = f.subjectEntityId
     LEFT JOIN KnowledgeEntity oe ON oe.id = f.objectEntityId
     WHERE f.novelId = ? AND f.branchId = ?
       AND f.factType = 'open_thread'
       AND f.status NOT IN ('rejected', 'outdated', 'potentially_stale')
     ORDER BY f.sourceChapter ASC, f.id ASC`,
    novelId,
    branchId,
  )
}

function buildAuthoredOutlineCandidates(params: {
  novelId: string
  branchId: string
  chapterRows: ChapterAnchorSourceRow[]
  timelineEvents: TimelineEvent[]
  workspaceState: PersistedNovelState | null
}) {
  const outlines = (params.workspaceState?.localOutlines ?? []).filter((outline) => outline.novelId === params.novelId)
  return outlines.map((outline, index) => {
    const chapterAnchors = buildChapterAnchorsFromRows(params.chapterRows, outline.relatedChapterIds)
    const primaryAnchor = getPrimaryAnchor(chapterAnchors)
    const timelineEvent = pickTimelineEventForOutline(params.timelineEvents, outline.relatedChapterIds)
    const trackMeta = buildTrackMeta(timelineEvent, primaryAnchor?.chapterNo ?? null)
    return {
      id: outline.id,
      dedupeKey: buildOutlineDedupeKey(outline.title, primaryAnchor?.chapterNo ?? null),
      chapterNo: primaryAnchor?.chapterNo ?? null,
      title: normalizeText(outline.title) || `大纲节点 ${index + 1}`,
      summary: normalizeText(outline.summary) || normalizeText(outline.title) || `大纲节点 ${index + 1}`,
      originalOutcome: null,
      trackKey: trackMeta.trackKey,
      phaseLabel: trackMeta.phaseLabel,
      sourceType: 'authored',
      confidence: 1,
      involvedEntities: [],
      keyEvents: [normalizeText(outline.title)].filter(Boolean),
      sortOrder: (primaryAnchor?.chapterNo ?? 100000) * 100 + index,
      chapterAnchors,
    } satisfies OutlineBootstrapCandidate
  })
}

function buildAuthoredTimelineCandidates(params: {
  novelId: string
  chapterRows: ChapterAnchorSourceRow[]
  timelineEvents: TimelineEvent[]
}) {
  return params.timelineEvents
    .filter((event) => event.novelId === params.novelId)
    .map((event) => {
      const chapterAnchors = buildChapterAnchorsFromRows(params.chapterRows, event.chapterIds)
      const primaryAnchor = getPrimaryAnchor(chapterAnchors)
      const trackMeta = buildTrackMeta(event, primaryAnchor?.chapterNo ?? null)
      return {
        id: `outline-timeline-${event.id}`,
        dedupeKey: buildOutlineDedupeKey(event.title, primaryAnchor?.chapterNo ?? null),
        chapterNo: primaryAnchor?.chapterNo ?? null,
        title: normalizeText(event.title) || event.id,
        summary: normalizeText(event.summary) || normalizeText(event.title) || event.id,
        originalOutcome: null,
        trackKey: trackMeta.trackKey,
        phaseLabel: trackMeta.phaseLabel,
        sourceType: 'authored',
        confidence: 1,
        involvedEntities: [],
        keyEvents: [normalizeText(event.title)].filter(Boolean),
        sortOrder: (primaryAnchor?.chapterNo ?? Math.max(event.order, 1)) * 100 + 50,
        chapterAnchors,
      } satisfies OutlineBootstrapCandidate
    })
}

function buildDerivedEventCandidates(params: {
  chapterRows: ChapterAnchorSourceRow[]
  knowledgeEvents: KnowledgeEventRow[]
  timelineByChapterNo: Map<number, TimelineEvent>
  eventParticipantsById: Map<string, string[]>
}) {
  const chapterByNo = new Map(params.chapterRows.map((chapter) => [chapter.chapterNo, chapter]))
  return params.knowledgeEvents.map((event, index) => {
    const chapter = chapterByNo.get(event.chapterNo)
    const trackMeta = buildTrackMeta(params.timelineByChapterNo.get(event.chapterNo) ?? null, event.chapterNo)
    return {
      id: `outline-derived-event-${event.id}`,
      dedupeKey: buildOutlineDedupeKey(event.name, event.chapterNo),
      chapterNo: event.chapterNo,
      title: normalizeText(event.name) || `事件 ${event.chapterNo}`,
      summary: normalizeText(event.summary) || normalizeText(event.name) || `事件 ${event.chapterNo}`,
      originalOutcome: normalizeText(event.consequences) || null,
      trackKey: trackMeta.trackKey,
      phaseLabel: trackMeta.phaseLabel,
      sourceType: 'derived_event',
      confidence: DERIVED_EVENT_CONFIDENCE,
      involvedEntities: sortAndDedupeStrings(params.eventParticipantsById.get(event.id) ?? []),
      keyEvents: [normalizeText(event.name)].filter(Boolean),
      sortOrder: event.chapterNo * 100 + index,
      chapterAnchors: chapter
        ? [{ chapterId: chapter.anchorChapterId, chapterNo: chapter.chapterNo, chapterTitle: chapter.title, isPrimary: true, sortOrder: 0 }]
        : [],
    } satisfies OutlineBootstrapCandidate
  })
}

function buildDerivedOpenThreadCandidates(params: {
  chapterRows: ChapterAnchorSourceRow[]
  openThreads: OpenThreadRow[]
  timelineByChapterNo: Map<number, TimelineEvent>
}) {
  const chapterByNo = new Map(params.chapterRows.map((chapter) => [chapter.chapterNo, chapter]))
  return params.openThreads.map((fact, index) => {
    const chapter = chapterByNo.get(fact.sourceChapter)
    const trackMeta = buildTrackMeta(params.timelineByChapterNo.get(fact.sourceChapter) ?? null, fact.sourceChapter)
    return {
      id: `outline-derived-open-thread-${fact.id}`,
      dedupeKey: buildOutlineDedupeKey(fact.predicate, fact.sourceChapter),
      chapterNo: fact.sourceChapter,
      title: normalizeText(fact.predicate) || `伏笔 ${fact.sourceChapter}`,
      summary: parseOpenThreadDescription(fact.valueJson, normalizeText(fact.predicate) || `伏笔 ${fact.sourceChapter}`),
      originalOutcome: null,
      trackKey: trackMeta.trackKey,
      phaseLabel: trackMeta.phaseLabel,
      sourceType: 'derived_open_thread',
      confidence: Math.min(DERIVED_OPEN_THREAD_CONFIDENCE, fact.confidence || DERIVED_OPEN_THREAD_CONFIDENCE),
      involvedEntities: sortAndDedupeStrings([fact.subjectName, fact.objectName]),
      keyEvents: [normalizeText(fact.predicate)].filter(Boolean),
      sortOrder: fact.sourceChapter * 100 + 25 + index,
      chapterAnchors: chapter
        ? [{ chapterId: chapter.anchorChapterId, chapterNo: chapter.chapterNo, chapterTitle: chapter.title, isPrimary: true, sortOrder: 0 }]
        : [],
    } satisfies OutlineBootstrapCandidate
  })
}

function buildDerivedSummaryCandidates(params: {
  chapterRows: KnowledgeChapterRow[]
  timelineByChapterNo: Map<number, TimelineEvent>
}) {
  return params.chapterRows
    .filter((chapter) => normalizeText(chapter.summary))
    .map((chapter, index) => {
      const trackMeta = buildTrackMeta(params.timelineByChapterNo.get(chapter.chapterNo) ?? null, chapter.chapterNo)
      return {
        id: `outline-derived-summary-${chapter.id}`,
        dedupeKey: buildOutlineDedupeKey(chapter.title || `第${chapter.chapterNo}章`, chapter.chapterNo),
        chapterNo: chapter.chapterNo,
        title: normalizeText(chapter.title) || `第 ${chapter.chapterNo} 章`,
        summary: normalizeText(chapter.summary) || normalizeText(chapter.title) || `第 ${chapter.chapterNo} 章`,
        originalOutcome: null,
        trackKey: trackMeta.trackKey,
        phaseLabel: trackMeta.phaseLabel,
        sourceType: 'derived_summary',
        confidence: DERIVED_SUMMARY_CONFIDENCE,
        involvedEntities: [],
        keyEvents: [],
        sortOrder: chapter.chapterNo * 100 + 75 + index,
        chapterAnchors: [{ chapterId: chapter.id, chapterNo: chapter.chapterNo, chapterTitle: chapter.title, isPrimary: true, sortOrder: 0 }],
      } satisfies OutlineBootstrapCandidate
    })
}

async function ensureCandidatePersisted(candidate: OutlineBootstrapCandidate, params: {
  novelId: string
  branchId: string
  existingNodesById: Map<string, OutlineNodeRecord>
  occupiedPrecedenceByDedupeKey: Map<string, number>
  createdCounts: { nodes: number; chapters: number }
  db: Db
}) {
  const candidatePrecedence = getSourceTypePrecedence(candidate.sourceType)
  const existingById = params.existingNodesById.get(candidate.id)
  const occupiedPrecedence = params.occupiedPrecedenceByDedupeKey.get(candidate.dedupeKey)

  if (!existingById && occupiedPrecedence !== undefined && occupiedPrecedence <= candidatePrecedence) {
    return
  }

  const outlineNode = existingById ?? createOutlineNode({
    id: candidate.id,
    novelId: params.novelId,
    branchId: params.branchId,
    chapterNo: candidate.chapterNo,
    title: candidate.title,
    summary: candidate.summary,
    originalOutcome: candidate.originalOutcome,
    trackKey: candidate.trackKey,
    phaseLabel: candidate.phaseLabel,
    sourceType: candidate.sourceType,
    confidence: candidate.confidence,
    involvedEntities: candidate.involvedEntities,
    keyEvents: candidate.keyEvents,
    sortOrder: candidate.sortOrder,
  }, params.db)

  if (!existingById && outlineNode) {
    params.existingNodesById.set(outlineNode.id, outlineNode)
    params.createdCounts.nodes += 1
  }

  params.occupiedPrecedenceByDedupeKey.set(candidate.dedupeKey, Math.min(occupiedPrecedence ?? candidatePrecedence, candidatePrecedence))

  const persistedNodeId = outlineNode?.id ?? candidate.id
  const existingChapters = new Set(listOutlineNodeChapters(persistedNodeId, params.db).map((chapter) => chapter.id))
  const hasSinglePrimaryAnchor = candidate.chapterAnchors.filter((anchor) => anchor.isPrimary).length <= 1 && candidate.chapterAnchors.length === 1
  for (const anchor of candidate.chapterAnchors) {
    const chapterRecordId = createChapterAnchorId(persistedNodeId, anchor, hasSinglePrimaryAnchor)
    if (existingChapters.has(chapterRecordId)) {
      continue
    }

    createOutlineNodeChapter({
      id: chapterRecordId,
      outlineNodeId: persistedNodeId,
      chapterNo: anchor.chapterNo,
      chapterId: anchor.chapterId,
      chapterTitle: anchor.chapterTitle,
      isPrimary: anchor.isPrimary,
      sortOrder: anchor.sortOrder,
    }, params.db)
    params.createdCounts.chapters += 1
    existingChapters.add(chapterRecordId)
  }
}

export async function bootstrapOutlineNodesForFutureMap(params: BootstrapParams): Promise<BootstrapResult> {
  const db = params.db ?? defaultDb
  const branchId = params.branchId ?? getMainBranchId(params.novelId)
  const workspaceState = await loadWorkspaceStatePayload(params.workspaceState, db)
  const chapterRows = loadKnowledgeChapters(params.novelId, branchId, db)
  const workspaceChapterRows = buildWorkspaceChapterRows(workspaceState, params.novelId)
  const chapterAnchorRows = mergeChapterRows(chapterRows, workspaceChapterRows)
  const timelineEvents = (workspaceState?.localTimelineEvents ?? [])
    .filter((event) => event.novelId === params.novelId)
    .slice()
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  const timelineByChapterNo = new Map<number, TimelineEvent>()
  const chapterNoById = new Map(chapterAnchorRows.map((chapter) => [chapter.id, chapter.chapterNo]))

  for (const event of timelineEvents) {
    for (const chapterId of event.chapterIds) {
      const chapterNo = chapterNoById.get(chapterId)
      if (chapterNo && !timelineByChapterNo.has(chapterNo)) {
        timelineByChapterNo.set(chapterNo, event)
      }
    }
  }

  const knowledgeEvents = loadKnowledgeEvents(params.novelId, branchId, db)
  const openThreads = loadOpenThreads(params.novelId, branchId, db)
  const eventParticipantsById = loadKnowledgeEventParticipants(knowledgeEvents.map((event) => event.id), db)
  const candidates = [
    ...buildAuthoredOutlineCandidates({ novelId: params.novelId, branchId, chapterRows: chapterAnchorRows, timelineEvents, workspaceState }),
    ...buildAuthoredTimelineCandidates({ novelId: params.novelId, chapterRows: chapterAnchorRows, timelineEvents }),
    ...buildDerivedEventCandidates({ chapterRows: chapterAnchorRows, knowledgeEvents, timelineByChapterNo, eventParticipantsById }),
    ...buildDerivedOpenThreadCandidates({ chapterRows: chapterAnchorRows, openThreads, timelineByChapterNo }),
    ...buildDerivedSummaryCandidates({ chapterRows, timelineByChapterNo }),
  ]

  const existingNodes = listOutlineNodes(params.novelId, branchId, db)
  const existingNodesById = new Map(existingNodes.map((node) => [node.id, node]))
  const occupiedPrecedenceByDedupeKey = new Map<string, number>()

  for (const node of existingNodes) {
    const dedupeKey = buildOutlineDedupeKey(node.title, node.chapterNo)
    const precedence = getSourceTypePrecedence(node.sourceType)
    const current = occupiedPrecedenceByDedupeKey.get(dedupeKey)
    if (current === undefined || precedence < current) {
      occupiedPrecedenceByDedupeKey.set(dedupeKey, precedence)
    }
  }

  const createdCounts = { nodes: 0, chapters: 0 }
  await db.withTransaction(async () => {
    for (const candidate of candidates) {
      await ensureCandidatePersisted(candidate, {
        novelId: params.novelId,
        branchId,
        existingNodesById,
        occupiedPrecedenceByDedupeKey,
        createdCounts,
        db,
      })
    }
  })

  return {
    createdNodes: createdCounts.nodes,
    createdChapters: createdCounts.chapters,
    outlineNodeCount: listOutlineNodes(params.novelId, branchId, db).length,
  }
}

export async function loadFutureMapSourceData(params: BootstrapParams): Promise<FutureMapResponse> {
  const db = params.db ?? defaultDb
  const branchId = params.branchId ?? getMainBranchId(params.novelId)
  await bootstrapOutlineNodesForFutureMap(params)
  const nodes = listOutlineNodes(params.novelId, branchId, db)

  const preferredNodes = choosePreferredNodes(nodes)
  const chaptersByEvent = Object.fromEntries(
    preferredNodes.map((node) => [node.id, listOutlineNodeChapters(node.id, db)])
  ) as Record<string, OutlineNodeChapterRecord[]>

  const tracks = Array.from(
    preferredNodes.reduce((map, node) => {
      const current = map.get(node.trackKey)
      const sourceTypes = current?.sourceTypes ?? new Set<string>()
      sourceTypes.add(node.sourceType)
      map.set(node.trackKey, {
        trackKey: node.trackKey,
        phaseLabel: current?.phaseLabel ?? node.phaseLabel,
        eventCount: (current?.eventCount ?? 0) + 1,
        sourceTypes,
      })
      return map
    }, new Map<string, { trackKey: string; phaseLabel: string | null; eventCount: number; sourceTypes: Set<string> }>())
      .values()
  )
    .sort((left, right) => left.trackKey.localeCompare(right.trackKey, 'en-US'))
    .map((track) => ({
      trackKey: track.trackKey,
      phaseLabel: track.phaseLabel,
      eventCount: track.eventCount,
      sourceTypes: Array.from(track.sourceTypes).sort((left, right) => left.localeCompare(right, 'en-US')),
    }))

  const events = preferredNodes.map((node) => ({
    id: node.id,
    chapterNo: node.chapterNo,
    title: node.title,
    summary: normalizeText(node.summary) || FUTURE_MAP_MISSING_SUMMARY_FALLBACK,
    originalOutcome: node.originalOutcome,
    trackKey: node.trackKey,
    phaseLabel: node.phaseLabel,
    sourceType: node.sourceType,
    confidence: node.confidence,
    sortOrder: node.sortOrder,
  }))

  const selectedTrackKey = tracks[0]?.trackKey ?? null
  const selectedOutlineNodeId = events.find((event) => event.trackKey === selectedTrackKey)?.id ?? events[0]?.id ?? null

  return {
    novelId: params.novelId,
    branchId,
    tracks,
    events,
    chaptersByEvent,
    defaults: {
      selectedTrackKey,
      selectedOutlineNodeId,
    },
  }
}

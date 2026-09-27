import type { DatabaseAccess } from '@/lib/server/database-access'
import { findFutureJumpRunById } from '@/lib/server/future-jump-store'
import { findWhatIfSessionById } from '@/lib/server/what-if-store'
import type { FutureJumpRunDetail, WhatIfDeltaRecord, WhatIfSessionDetail } from '@/lib/story-branch-types'

type Db = DatabaseAccess

export type AuthoredRetrievalSourceType = 'authored_delta' | 'future_jump_bridge' | 'future_jump_revision'

export type ExplicitAuthoredContextRequest = {
  novelId: string
  branchId: string
  whatIfSessionId?: string
  futureJumpRunId?: string
  db?: Db
}

export type AuthoredRetrievalSeed = {
  id: string
  sourceType: AuthoredRetrievalSourceType
  sourceId: string
  chapterNo: number
  title: string
  sourceLabel: string
  text: string
}

export type ExplicitAuthoredContext = {
  whatIfSession: WhatIfSessionDetail | null
  futureJumpRun: FutureJumpRunDetail | null
  latestFutureJumpRevisionText: string | null
  latestFutureJumpBridgeSummary: string | null
  authoredPromptLines: string[]
  retrievalSeeds: AuthoredRetrievalSeed[]
}

function formatDeltaSummary(delta: WhatIfDeltaRecord) {
  const subject = delta.subjectName?.trim() || '未知主体'
  const target = delta.targetName?.trim() ? ` → ${delta.targetName.trim()}` : ''
  const key = delta.key.trim() || delta.deltaType.trim() || 'delta'
  const valueTransition = [delta.oldValue?.trim(), delta.newValue?.trim()].filter(Boolean).join(' → ')
  const chapterText = typeof delta.validFromChapter === 'number' ? `｜自第 ${delta.validFromChapter} 章起` : ''
  const description = delta.description.trim() || valueTransition || key
  const changeText = valueTransition ? `｜${key}：${valueTransition}` : `｜${key}`
  return `- ${subject}${target}${changeText}${chapterText}｜${description}`
}

function validateWhatIfSession(request: ExplicitAuthoredContextRequest, session: WhatIfSessionDetail | null, requestedId?: string) {
  if (!requestedId) return
  if (!session) {
    throw new Error(`What-if session not found: ${requestedId}`)
  }
  if (session.novelId !== request.novelId || session.baseBranchId !== request.branchId) {
    throw new Error('What-if session does not belong to the requested novel/branch')
  }
}

function validateFutureJumpRun(request: ExplicitAuthoredContextRequest, run: FutureJumpRunDetail | null, requestedId?: string) {
  if (!requestedId) return
  if (!run) {
    throw new Error(`Future jump run not found: ${requestedId}`)
  }
  if (run.baseBranchId !== request.branchId) {
    throw new Error('Future jump run does not belong to the requested branch')
  }
}

function resolveFutureJumpWhatIfSessionId(run: FutureJumpRunDetail | null) {
  return run?.sourceContext.whatIfSessionId?.trim() || undefined
}

function formatFutureJumpSourceContextLine(run: FutureJumpRunDetail) {
  const nodeLabel = run.sourceContext.nodeType === 'continue_block'
    ? 'continue 节点'
    : run.sourceContext.nodeType === 'rewrite'
      ? 'rewrite 节点'
      : run.sourceContext.nodeType === 'what_if'
        ? 'what-if 节点'
        : run.sourceContext.nodeType === 'future_jump'
          ? 'future jump 节点'
          : '章节'
  return `- Future Jump 来源：第 ${run.sourceContext.chapterNo} 章 / ${nodeLabel}`
}

export function hasExplicitAuthoredContextSelection(request: Pick<ExplicitAuthoredContextRequest, 'whatIfSessionId' | 'futureJumpRunId'>) {
  return Boolean(request.whatIfSessionId?.trim() || request.futureJumpRunId?.trim())
}

export function loadExplicitAuthoredContext(request: ExplicitAuthoredContextRequest): ExplicitAuthoredContext {
  const futureJumpRunId = request.futureJumpRunId?.trim() || undefined
  const requestedWhatIfSessionId = request.whatIfSessionId?.trim() || undefined
  const db = request.db

  const futureJumpRun = futureJumpRunId ? findFutureJumpRunById(futureJumpRunId, db) : null
  validateFutureJumpRun(request, futureJumpRun, futureJumpRunId)

  const resolvedWhatIfSessionId = requestedWhatIfSessionId ?? resolveFutureJumpWhatIfSessionId(futureJumpRun)
  const whatIfSession = resolvedWhatIfSessionId ? findWhatIfSessionById(resolvedWhatIfSessionId, db) : null
  validateWhatIfSession(request, whatIfSession, resolvedWhatIfSessionId)

  if (futureJumpRun && whatIfSession && resolveFutureJumpWhatIfSessionId(futureJumpRun) !== whatIfSession.id) {
    throw new Error('Future jump run does not belong to the requested what-if session')
  }

  const latestRevision = futureJumpRun?.revisions[futureJumpRun.revisions.length - 1] ?? null
  const deltaLines = (whatIfSession?.deltas ?? []).map(formatDeltaSummary)
  const authoredPromptLines: string[] = []

  if (whatIfSession) {
    authoredPromptLines.push(`- What-if 会话：${whatIfSession.title}`)
    if (whatIfSession.premise.trim()) {
      authoredPromptLines.push(`- 前提：${whatIfSession.premise.trim()}`)
    }
  }

  authoredPromptLines.push(...deltaLines)

  if (futureJumpRun?.bridgeSummary.trim()) {
    authoredPromptLines.push(formatFutureJumpSourceContextLine(futureJumpRun))
    authoredPromptLines.push(`- Future Jump 桥接摘要：${futureJumpRun.bridgeSummary.trim()}`)
  }

  if (latestRevision?.generatedTargetText.trim()) {
    authoredPromptLines.push(`- Future Jump 最新修订正文：${latestRevision.generatedTargetText.trim()}`)
  }

  const retrievalSeeds: AuthoredRetrievalSeed[] = []

  for (const delta of whatIfSession?.deltas ?? []) {
    retrievalSeeds.push({
      id: `authored-delta:${delta.id}`,
      sourceType: 'authored_delta',
      sourceId: delta.id,
      chapterNo: delta.validFromChapter ?? whatIfSession!.sourceChapterNo,
      title: `${whatIfSession?.title ?? 'What-if'} 变更`,
      sourceLabel: 'What-if 变更',
      text: formatDeltaSummary(delta),
    })
  }

  if (futureJumpRun?.bridgeSummary.trim()) {
    retrievalSeeds.push({
      id: `future-jump-bridge:${futureJumpRun.id}`,
      sourceType: 'future_jump_bridge',
      sourceId: futureJumpRun.id,
      chapterNo: futureJumpRun.targetChapterNo,
      title: `Future Jump ${futureJumpRun.targetChapterNo} 桥接摘要`,
      sourceLabel: 'Future Jump 桥接摘要',
      text: futureJumpRun.bridgeSummary.trim(),
    })
  }

  if (latestRevision?.generatedTargetText.trim()) {
    retrievalSeeds.push({
      id: `future-jump-revision:${latestRevision.id}`,
      sourceType: 'future_jump_revision',
      sourceId: latestRevision.id,
      chapterNo: futureJumpRun?.targetChapterNo ?? latestRevision.revisionNo,
      title: `Future Jump 最新修订（第 ${latestRevision.revisionNo} 版）`,
      sourceLabel: 'Future Jump 最新修订',
      text: latestRevision.generatedTargetText.trim(),
    })
  }

  return {
    whatIfSession,
    futureJumpRun,
    latestFutureJumpRevisionText: latestRevision?.generatedTargetText?.trim() || null,
    latestFutureJumpBridgeSummary: futureJumpRun?.bridgeSummary?.trim() || null,
    authoredPromptLines,
    retrievalSeeds,
  }
}

"use client"

import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { BridgeSummaryPanel } from '@/components/future-jump/BridgeSummaryPanel'
import { FutureJumpControlPanel } from '@/components/future-jump/FutureJumpControlPanel'
import { FutureNodeTextPanel } from '@/components/future-jump/FutureNodeTextPanel'
import { useI18n } from '@/lib/i18n/provider'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import type {
  FutureJumpMutationResponse,
  FutureJumpRunDetail,
  FutureMapEvent,
  FutureMapResponse,
  OutlineNodeChapterRecord,
  WhatIfSessionDetail,
} from '@/lib/story-branch-types'

export type FutureJumpContinueContext = {
  detail: FutureJumpRunDetail
  parentSession: WhatIfSessionDetail | null
  targetEvent: FutureMapEvent | null
  targetChapter: OutlineNodeChapterRecord | null
}

type FutureJumpBundle = {
  detail: FutureJumpRunDetail
  parentSession: WhatIfSessionDetail | null
  targetEvent: FutureMapEvent | null
  targetChapter: OutlineNodeChapterRecord | null
}

function getSuccessfulResult<T>(result: PromiseSettledResult<T>) {
  return result.status === 'fulfilled' ? result.value : null
}

async function loadFutureJumpRunDetail(input: { runId: string; branchId: string }) {
  const params = new URLSearchParams({ branchId: input.branchId })
  const response = await fetch(`/api/future-jump/runs/${input.runId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as FutureJumpRunDetail & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future jump run load failed')
  }
  return data
}

async function loadWhatIfSessionDetail(input: { novelId: string; branchId: string; sessionId: string }) {
  const params = new URLSearchParams({ novelId: input.novelId, branchId: input.branchId })
  const response = await fetch(`/api/what-if/sessions/${input.sessionId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as WhatIfSessionDetail & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'What-if session load failed')
  }
  return data
}

async function loadFutureMap(input: { novelId: string; branchId: string; sessionId: string | null; sourceChapterNo: number }) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
    sourceChapterNo: String(input.sourceChapterNo),
  })
  if (input.sessionId) params.set('parentSessionId', input.sessionId)
  const response = await fetch(`/api/story-future-map?${params.toString()}`, { cache: 'no-store' })
  const data = await response.json() as FutureMapResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future map load failed')
  }
  return data
}

async function reviseFutureJumpRun(input: { runId: string; novelId: string; userFeedback: string }) {
  const response = await fetch(`/api/future-jump/runs/${input.runId}/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId: input.novelId, userFeedback: input.userFeedback }),
  })
  const data = await response.json() as FutureJumpMutationResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future jump revise failed')
  }
  return data
}

async function loadFutureJumpBundle(input: { novelId: string; branchId: string; runId: string }) {
  const detail = await loadFutureJumpRunDetail({ runId: input.runId, branchId: input.branchId })
  const [parentSessionResult, futureMapResult] = await Promise.allSettled([
    detail.sourceContext.whatIfSessionId
      ? loadWhatIfSessionDetail({ novelId: input.novelId, branchId: input.branchId, sessionId: detail.sourceContext.whatIfSessionId })
      : Promise.resolve(null),
    loadFutureMap({
      novelId: input.novelId,
      branchId: input.branchId,
      sessionId: detail.sourceContext.whatIfSessionId,
      sourceChapterNo: detail.sourceChapterNo,
    }),
  ])

  const parentSession = getSuccessfulResult(parentSessionResult)
  const futureMap = getSuccessfulResult(futureMapResult)

  const targetEvent = futureMap?.events.find((event) => event.id === detail.targetOutlineNodeId) ?? null
  const targetChapter = futureMap?.chaptersByEvent[detail.targetOutlineNodeId]?.find((chapter) => chapter.id === detail.targetOutlineChapterId) ?? null

  return { detail, parentSession, targetEvent, targetChapter } satisfies FutureJumpBundle
}

export function FutureJumpView(props: {
  novelId: string
  branchId: string
  runId: string
  sourceChapterNo: number
  targetChapterNo: number
  nodeTitle?: string | null
  readableLineageLabel?: string | null
  nodeSubtitle?: string | null
  onMetricsChange?: (metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => void
  onContinueInFuture: (context: FutureJumpContinueContext) => void
}) {
  const { locale, t } = useI18n()
  const { onMetricsChange } = props
  const [bundle, setBundle] = useState<FutureJumpBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')
      setActionError('')

      try {
        const nextBundle = await loadFutureJumpBundle({
          novelId: props.novelId,
          branchId: props.branchId,
          runId: props.runId,
        })
        if (cancelled) return
        setBundle(nextBundle)
      } catch (loadError) {
        if (cancelled) return
        setBundle(null)
        setError(resolveWorkspaceUserFacingError('future-jump-load', loadError, locale))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [locale, props.branchId, props.novelId, props.runId])

  const revisions = useMemo(
    () => [...(bundle?.detail.revisions ?? [])].sort((left, right) => right.revisionNo - left.revisionNo),
    [bundle?.detail.revisions]
  )

  useEffect(() => {
    if (!bundle) return
    onMetricsChange?.({
      currentText: bundle.detail.generatedTargetText,
      inputTokens: bundle.detail.inputTokens ?? null,
      outputTokens: bundle.detail.outputTokens ?? null,
    })
  }, [bundle, onMetricsChange])

  const targetTitle = bundle?.targetChapter?.chapterTitle?.trim()
    || bundle?.targetEvent?.title?.trim()
    || props.nodeTitle?.trim()
    || t('futureJump.defaultNodeTitle', { count: bundle?.detail.targetChapterNo ?? props.targetChapterNo })
  const readableLabel = props.readableLineageLabel?.trim() || ''
  const instructionPreview = formatStoryBranchInstructionPreview(bundle?.detail.userDirection ?? props.nodeSubtitle)

  const handleRegenerate = async () => {
    if (!bundle || regenerating) return

    setRegenerating(true)
    setActionError('')
    try {
      await reviseFutureJumpRun({
        runId: bundle.detail.id,
        novelId: props.novelId,
        userFeedback: feedback.trim(),
      })
      const nextBundle = await loadFutureJumpBundle({
        novelId: props.novelId,
        branchId: props.branchId,
        runId: bundle.detail.id,
      })
      setBundle(nextBundle)
      setFeedback('')
    } catch (submitError) {
      setActionError(resolveWorkspaceUserFacingError('future-jump-revise', submitError, locale))
    } finally {
      setRegenerating(false)
    }
  }

  const handleContinue = () => {
    if (!bundle || regenerating || !bundle.detail.generatedTargetText.trim()) return
    setActionError('')
    props.onContinueInFuture(bundle)
  }

  return (
    <div className="space-y-4 px-4 py-4 sm:px-7 sm:py-6" data-testid="workspace-future-jump-view">
      <section
        className="overflow-hidden rounded-[28px] border border-sky-400/20 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_42%),var(--surface)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
        data-testid="future-jump-view"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6 sm:py-6">
          <div className="max-w-4xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-sky-200/70">{t('futureJump.eyebrow')}</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{readableLabel || props.nodeTitle?.trim() || t('futureJump.defaultTitle', { source: props.sourceChapterNo, target: props.targetChapterNo })}</h3>
            {instructionPreview ? <p className="mt-2 text-sm text-sky-100">{t('continue.instructionPreview')} · {instructionPreview}</p> : null}
            <p className="mt-3 text-sm leading-7 text-zinc-300">{t('futureJump.description')}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-zinc-300">
            {readableLabel ? <span className="rounded-full border border-sky-300/20 bg-shade/20 px-3 py-1.5">{readableLabel}</span> : null}
            {instructionPreview ? <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5">{t('continue.instructionPreview')} {instructionPreview}</span> : null}
            <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5">{t('futureJump.sourceChapter', { count: props.sourceChapterNo })}</span>
            <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5">{t('futureJump.targetChapter', { count: props.targetChapterNo })}</span>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[24px] border border-line/8 bg-shade/20 p-5 text-sm text-zinc-300">
          <div className="flex items-center gap-2 text-zinc-100">
            <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
            {t('futureJump.loading')}
          </div>
        </section>
      ) : null}

      {!loading && error ? (
        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
          {error}
        </section>
      ) : null}

      {!loading && bundle ? (
        <>
          <BridgeSummaryPanel
            detail={bundle.detail}
            parentSession={bundle.parentSession}
            targetEvent={bundle.targetEvent}
            targetChapter={bundle.targetChapter}
            revisions={revisions}
            readableLineageLabel={readableLabel}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
            <FutureNodeTextPanel
              targetTitle={targetTitle}
              targetChapterLabel={t('continue.chapter', { count: bundle.targetChapter?.chapterNo ?? bundle.detail.targetChapterNo })}
              generatedTargetText={bundle.detail.generatedTargetText}
            />
            <FutureJumpControlPanel
              feedback={feedback}
              onFeedbackChange={setFeedback}
              onRegenerate={handleRegenerate}
              regenerating={regenerating}
              onContinue={handleContinue}
              continueDisabled={regenerating || !bundle.detail.generatedTargetText.trim()}
              latestRevisionNo={bundle.detail.latestRevisionNo}
              actionError={actionError}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

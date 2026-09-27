"use client"

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { normalizeStoryBranchInstructionText } from '@/lib/story-branch-labels'
import type { ContinueBlockDetail, ContinueBlockRecord } from '@/lib/story-branch-types'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import { cn, splitPlainTextParagraphs } from '@/lib/utils'

async function loadContinueBlockDetail(input: {
  novelId: string
  branchId: string
  continueBlockId: string
}) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
  })
  const response = await fetch(`/api/continue-blocks/${input.continueBlockId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as ContinueBlockDetail & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Continue block load failed')
  }
  return data
}

function renderReaderBodyParagraphs(text: string, className?: string, dataTestId?: string) {
  const paragraphs = splitPlainTextParagraphs(text)
  const visibleParagraphs = paragraphs.length ? paragraphs : [text.trim() || '　']

  return (
    <div className={cn('reader-body-prose', className)} data-testid={dataTestId}>
      {visibleParagraphs.map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
      ))}
    </div>
  )
}

export function ContinueBlockDetailView(props: {
  novelId: string
  branchId: string
  continueBlockId: string
  latestRevisionNo?: number | null
  nodeSubtitle?: string | null
  fallbackDetail?: Pick<ContinueBlockRecord, 'latestText' | 'latestRevisionNo' | 'title' | 'subtitle' | 'userInstruction' | 'inputTokens' | 'outputTokens'> | null
  renderActions?: (revisionSelector: ReactNode) => ReactNode
  onMetricsChange?: (metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => void
}) {
  const { locale, t } = useI18n()
  const { onMetricsChange } = props
  const [detail, setDetail] = useState<ContinueBlockDetail | null>(null)
  const [revisionSelection, setRevisionSelection] = useState<{
    detail: ContinueBlockDetail
    revisionNo: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')

      try {
        const nextDetail = await loadContinueBlockDetail({
          novelId: props.novelId,
          branchId: props.branchId,
          continueBlockId: props.continueBlockId,
        })
        if (cancelled) return
        setDetail(nextDetail)
      } catch (loadError) {
        if (cancelled) return
        setDetail(null)
        setError(resolveWorkspaceUserFacingError('continue-block-load', loadError, locale))
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
  }, [locale, props.branchId, props.continueBlockId, props.latestRevisionNo, props.novelId])

  // Ignore stale responses while switching nodes or loading a newly saved revision.
  const currentDetail = detail?.id === props.continueBlockId
    && detail.novelId === props.novelId
    && detail.branchId === props.branchId
    && detail.latestRevisionNo >= (props.latestRevisionNo ?? 1)
    ? detail
    : null
  const effectiveDetail = currentDetail ?? props.fallbackDetail ?? null
  const latestRevisionNo = effectiveDetail?.latestRevisionNo ?? props.latestRevisionNo ?? 1
  const historyEntries = useMemo(
    () => [...(currentDetail?.revisions ?? [])]
      .filter((revision) => revision.revisionNo < latestRevisionNo)
      .sort((left, right) => right.revisionNo - left.revisionNo),
    [currentDetail?.revisions, latestRevisionNo]
  )
  // A refreshed detail defaults to the latest version, without a state-reset effect.
  const selectedRevision = revisionSelection?.detail === currentDetail
    ? historyEntries.find((revision) => revision.revisionNo === revisionSelection.revisionNo)
    : null
  const displayedDetail = selectedRevision ?? effectiveDetail
  const selectedRevisionNo = selectedRevision?.revisionNo ?? latestRevisionNo
  const currentText = selectedRevision?.generatedText ?? effectiveDetail?.latestText
  const inputTokens = displayedDetail?.inputTokens ?? null
  const outputTokens = displayedDetail?.outputTokens ?? null

  useEffect(() => {
    if (currentText == null) return
    onMetricsChange?.({
      currentText,
      inputTokens,
      outputTokens,
    })
  }, [currentText, inputTokens, outputTokens, onMetricsChange])

  const userRequest = normalizeStoryBranchInstructionText(displayedDetail?.userInstruction ?? props.nodeSubtitle)
  const effectiveReaderText = currentText?.trim() || ''
  const revisionSelector = (
    <div className="relative inline-flex shrink-0 items-center">
      <select
        aria-label={t('continue.selectRevision')}
        data-testid="continue-block-revision-select"
        value={selectedRevisionNo}
        disabled={loading || !currentDetail}
        onChange={(event) => {
          if (currentDetail) {
            setRevisionSelection({ detail: currentDetail, revisionNo: Number(event.target.value) })
          }
        }}
        className="min-h-11 cursor-pointer appearance-none rounded-2xl border border-line/10 bg-shade/20 py-2 pl-4 pr-9 text-sm text-zinc-200 transition enabled:hover:bg-overlay/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300/60 disabled:cursor-default"
      >
        <option value={latestRevisionNo} className="bg-surface text-zinc-200">{t('continue.latestRevisionOption', { count: latestRevisionNo })}</option>
        {historyEntries.map((revision) => (
          <option key={revision.id} value={revision.revisionNo} className="bg-surface text-zinc-200">{t('continue.revision', { count: revision.revisionNo })}</option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-zinc-400" />
    </div>
  )

  return (
    <div data-testid="workspace-continue-block-view">
      <div className="border-b border-line/8 px-3 py-3 sm:px-7 sm:py-4">
        {props.renderActions ? props.renderActions(revisionSelector) : revisionSelector}
      </div>
      <div className="space-y-0 sm:space-y-4 sm:px-7 sm:py-6">
        {userRequest ? (
          <div className="border-b border-fuchsia-300/16 bg-shade/20 px-5 py-4 sm:rounded-[20px] sm:border" data-testid="continue-block-user-request">
            <p className="text-[10px] uppercase tracking-[0.16em] text-fuchsia-200/65">{t('continue.userRequest')}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-fuchsia-50">{userRequest}</p>
          </div>
        ) : null}

        {loading ? (
          <section className="rounded-[24px] border border-line/8 bg-shade/20 p-5 text-sm text-zinc-300">
            <div className="flex items-center gap-2 text-zinc-100">
              <LoaderCircle className="h-4 w-4 animate-spin text-fuchsia-300" />
              {t('continue.loading')}
            </div>
          </section>
        ) : null}

        {!loading && error ? (
          <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
            {error}
          </section>
        ) : null}

        {effectiveDetail ? (
          <section className="bg-surface px-5 py-5 sm:rounded-[28px] sm:border sm:border-line/8 sm:p-6 sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="bg-transparent sm:rounded-[24px] sm:border sm:border-line/8 sm:bg-shade/20 sm:p-5">
              {renderReaderBodyParagraphs(effectiveReaderText || t('continue.emptyBody'), 'text-zinc-200', 'workspace-continue-block-reader-body')}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

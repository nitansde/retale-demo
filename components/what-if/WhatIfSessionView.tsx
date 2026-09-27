"use client"

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, GitBranch, LoaderCircle, RefreshCcw, Sparkles } from 'lucide-react'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import { WhatIfDeltaPanel } from '@/components/what-if/WhatIfDeltaPanel'
import { useI18n } from '@/lib/i18n/provider'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import { cn, splitPlainTextParagraphs } from '@/lib/utils'
import type { WhatIfSessionDetail } from '@/lib/story-branch-types'

async function loadWhatIfSessionDetail(input: {
  novelId: string
  branchId: string
  sessionId: string
}) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
  })
  const response = await fetch(`/api/what-if/sessions/${input.sessionId}?${params.toString()}`, {
    cache: 'no-store',
  })
  const data = await response.json() as WhatIfSessionDetail & { ok?: boolean; error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'What-if session load failed')
  }
  return data
}

function excerptText(detail: WhatIfSessionDetail) {
  return detail.selectedText.trim() || detail.originalText.trim() || ''
}

function formatCreatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function renderReaderBodyParagraphs(text: string, className?: string) {
  const paragraphs = splitPlainTextParagraphs(text)
  const visibleParagraphs = paragraphs.length ? paragraphs : [text.trim() || '　']

  return (
    <div className={cn('reader-body-prose mt-3', className)}>
      {visibleParagraphs.map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
      ))}
    </div>
  )
}

export function WhatIfSessionView(props: {
  novelId: string
  branchId: string
  sessionId: string
  anchorChapterNo: number
  nodeTitle?: string | null
  nodeSubtitle?: string | null
  readableLineageLabel?: string | null
  onMetricsChange?: (metrics: { currentText: string; inputTokens: number | null; outputTokens: number | null }) => void
  onJumpToFuture: (detail: WhatIfSessionDetail) => void
  onRegenerateWhatIf: (detail: WhatIfSessionDetail) => void
  onContinueInBranch: (detail: WhatIfSessionDetail) => void
}) {
  const { locale, t } = useI18n()
  const { onMetricsChange } = props
  const [detail, setDetail] = useState<WhatIfSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const readableLabel = props.readableLineageLabel?.trim() || ''

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')

      try {
        const nextDetail = await loadWhatIfSessionDetail({
          novelId: props.novelId,
          branchId: props.branchId,
          sessionId: props.sessionId,
        })
        if (cancelled) return
        setDetail(nextDetail)
      } catch (loadError) {
        if (cancelled) return
        setDetail(null)
        setError(resolveWorkspaceUserFacingError('what-if-session-load', loadError, locale))
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
  }, [locale, props.branchId, props.novelId, props.sessionId])

  useEffect(() => {
    if (!detail) return
    onMetricsChange?.({
      currentText: detail.generatedText,
      inputTokens: detail.inputTokens ?? null,
      outputTokens: detail.outputTokens ?? null,
    })
  }, [detail, onMetricsChange])

  const resolvedTitle = readableLabel || detail?.title || props.nodeTitle || t('whatIf.defaultTitle', { count: props.anchorChapterNo })
  const resolvedSubtitle = props.nodeSubtitle?.trim() || detail?.premise?.trim() || ''
  const instructionPreview = formatStoryBranchInstructionPreview(detail?.premise ?? props.nodeSubtitle)
  const canRunActions = Boolean(detail) && !loading
  const metaPills = useMemo(
    () => [
      readableLabel || null,
        instructionPreview ? `${t('continue.instructionPreview')} ${instructionPreview}` : null,
        t('futureJump.sourceChapter', { count: detail?.sourceChapterNo ?? props.anchorChapterNo }),
        detail ? t('roleplay.createdAt', { value: formatCreatedAt(detail.createdAt) }) : null,
    ].filter(Boolean) as string[],
    [detail, instructionPreview, props.anchorChapterNo, readableLabel, t]
  )
  const revisionEntries = useMemo(
    () => [...(detail?.revisions ?? [])].sort((left, right) => right.revisionNo - left.revisionNo),
    [detail?.revisions]
  )
  const historyEntries = revisionEntries.slice(1)

  return (
    <div className="space-y-4 px-4 py-4 sm:px-7 sm:py-6" data-testid="workspace-what-if-view">
      <section
        className="overflow-hidden rounded-[28px] border border-fuchsia-400/20 bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.14),_transparent_40%),var(--surface)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
        data-testid="what-if-view"
      >
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-fuchsia-200/70">{t('whatIf.eyebrow')}</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">{resolvedTitle}</h3>
            <p className="mt-3 text-sm leading-7 text-zinc-300">
              {resolvedSubtitle || t('whatIf.defaultSubtitle')}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-zinc-300">
              {metaPills.map((pill) => (
                <span key={pill} className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5">{pill}</span>
              ))}
            </div>
          </div>

          <div className="flex w-full max-w-md flex-col gap-2">
            <button
              type="button"
              data-testid="what-if-jump-button"
              onClick={() => detail && props.onJumpToFuture(detail)}
              disabled={!canRunActions}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-fuchsia-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowRight className="h-4 w-4" />
              {t('whatIf.jumpToFuture')}
            </button>
            <button
              type="button"
              onClick={() => detail && props.onRegenerateWhatIf(detail)}
              disabled={!canRunActions}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-fuchsia-300/25 bg-shade/20 px-4 py-3 text-sm text-fuchsia-100 transition hover:bg-overlay/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              {t('whatIf.regenerate')}
            </button>
            <button
              type="button"
              onClick={() => detail && props.onContinueInBranch(detail)}
              disabled={!canRunActions}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 transition hover:bg-overlay/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch className="h-4 w-4" />
              {t('whatIf.continueInBranch')}
            </button>
          </div>
        </div>
      </section>

      {loading ? (
        <section className="rounded-[24px] border border-line/8 bg-shade/20 p-5 text-sm text-zinc-300">
          <div className="flex items-center gap-2 text-zinc-100">
            <LoaderCircle className="h-4 w-4 animate-spin text-fuchsia-300" />
            {t('whatIf.loading')}
          </div>
        </section>
      ) : null}

      {!loading && error ? (
        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">
          {error}
        </section>
      ) : null}

      {!loading && detail ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <section className="rounded-[24px] border border-line/8 bg-shade/20 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl border border-fuchsia-300/18 bg-fuchsia-500/10 p-2 text-fuchsia-100">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('whatIf.originalExcerpt')}</p>
                  {renderReaderBodyParagraphs(excerptText(detail) || t('whatIf.originalExcerptEmpty'), 'text-zinc-200')}
                </div>
              </div>
            </section>

            <section className="rounded-[24px] border border-sky-300/18 bg-sky-500/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.18em] text-sky-100/70">{t('whatIf.generated')}</p>
              {renderReaderBodyParagraphs(detail.generatedText, 'text-sky-50')}
            </section>
          </div>

          <WhatIfDeltaPanel deltas={detail.deltas} />

          {historyEntries.length ? (
            <section className="rounded-[24px] border border-line/8 bg-shade/20 p-5" data-testid="what-if-revision-history">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('whatIf.history')}</p>
                  <p className="mt-1 text-sm text-zinc-300">{t('whatIf.historyDescription')}</p>
                </div>
                <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-300">{t('whatIf.historyCount', { count: historyEntries.length })}</span>
              </div>

              <div className="mt-4 space-y-4">
                {historyEntries.map((revision) => {
                  const revisionPreview = formatStoryBranchInstructionPreview(revision.userInstruction)
                  return (
                    <article key={`${revision.revisionNo}-${revision.createdAt}`} className="rounded-[20px] border border-line/8 bg-overlay/[0.03] p-4" data-testid={`what-if-history-item-${revision.revisionNo}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-zinc-100">{t('whatIf.historyRevision', { count: revision.revisionNo, kind: revision.revisionKind })}</p>
                          {revisionPreview ? <p className="mt-2 text-xs leading-6 text-fuchsia-100">{t('continue.instructionPreview')} · {revisionPreview}</p> : null}
                        </div>
                        <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-400">{formatCreatedAt(revision.createdAt)}</span>
                      </div>
                      <div className="mt-3 rounded-[18px] border border-fuchsia-300/18 bg-fuchsia-500/10 p-4">
                        {renderReaderBodyParagraphs(revision.generatedText, 'text-zinc-100')}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

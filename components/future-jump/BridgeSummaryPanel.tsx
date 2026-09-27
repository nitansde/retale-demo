"use client"

import { ArrowRight, Clock3, GitBranch, Sparkles } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { formatStoryBranchInstructionPreview } from '@/lib/story-branch-labels'
import type { FutureJumpRevisionRecord, FutureJumpRunDetail, FutureMapEvent, OutlineNodeChapterRecord, WhatIfSessionDetail } from '@/lib/story-branch-types'
import { cn } from '@/lib/utils'

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

function buildSourceMetaLabel(sourceType: string | null | undefined) {
  if (!sourceType) return 'unknown'
  if (sourceType === 'authored') return 'authored'
  return sourceType.replaceAll('_', ' ')
}

export function BridgeSummaryPanel(props: {
  detail: FutureJumpRunDetail
  parentSession: WhatIfSessionDetail | null
  targetEvent: FutureMapEvent | null
  targetChapter: OutlineNodeChapterRecord | null
  revisions: FutureJumpRevisionRecord[]
  readableLineageLabel?: string | null
}) {
  const { t } = useI18n()
  const instructionPreview = formatStoryBranchInstructionPreview(props.detail.userDirection)
  const historyEntries = props.revisions
    .sort((left, right) => right.revisionNo - left.revisionNo)

  return (
    <section className="rounded-[24px] border border-sky-400/20 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_42%),var(--surface)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200/70">{t('futureJump.bridgeSummaryEyebrow')}</p>
          <h3 className="mt-2 text-lg font-semibold text-zinc-100">{t('futureJump.bridgeSummaryTitle')}</h3>
          {instructionPreview ? <p className="mt-2 text-sm text-sky-100">{t('workspace.instructionPreview')} · {instructionPreview}</p> : null}
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
            {t('futureJump.bridgeSummaryDescription')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-300">
          {props.readableLineageLabel?.trim() ? <span className="rounded-full border border-sky-300/20 bg-shade/20 px-3 py-1.5">{props.readableLineageLabel.trim()}</span> : null}
          <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5">revision {props.detail.latestRevisionNo}</span>
          <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5">status {props.detail.status}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
        <div className="rounded-[22px] border border-sky-300/18 bg-sky-500/10 p-4" data-testid="future-jump-bridge">
          <div className="flex items-center gap-2 text-sky-100">
            <Sparkles className="h-4 w-4" />
            <p className="text-[11px] uppercase tracking-[0.16em] text-sky-100/75">{t('futureJump.latestMirroredBridge')}</p>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-sky-50">{props.detail.bridgeSummary}</p>
        </div>

        <div className="space-y-4">
          <div className="rounded-[22px] border border-fuchsia-300/18 bg-fuchsia-500/10 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl border border-fuchsia-300/18 bg-shade/20 p-2 text-fuchsia-100">
                <GitBranch className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-fuchsia-200/70">{t('futureJump.parentWhatIfSession')}</p>
                <h4 className="mt-1 text-sm font-medium text-zinc-100">{props.parentSession?.title || t('whatIf.defaultTitle', { count: props.detail.sourceChapterNo })}</h4>
                <p className="mt-2 text-xs leading-6 text-zinc-300">{props.parentSession?.premise?.trim() || t('futureJump.parentWhatIfFallback')}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-300">
                  <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1">{t('futureJump.sourceChapter', { count: props.detail.sourceChapterNo })}</span>
                  {props.parentSession?.premise?.trim() ? <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1">{t('workspace.instructionPreview')} {formatStoryBranchInstructionPreview(props.parentSession.premise)}</span> : null}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-line/8 bg-shade/20 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-2xl border border-sky-300/18 bg-sky-500/10 p-2 text-sky-100">
                <ArrowRight className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('futureJump.targetAnchor')}</p>
                <h4 className="mt-1 text-sm font-medium text-zinc-100">{props.targetEvent?.title || t('futureJump.defaultNodeTitle', { count: props.detail.targetChapterNo })}</h4>
                <p className="mt-2 text-xs leading-6 text-zinc-300">{props.targetEvent?.summary || t('futureJump.targetAnchorFallback')}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-300">
                  <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1">{t('futureJump.targetChapter', { count: props.targetChapter?.chapterNo ?? props.detail.targetChapterNo })}</span>
                  {props.targetChapter?.chapterTitle ? (
                    <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1">{props.targetChapter.chapterTitle}</span>
                  ) : null}
                  {props.targetEvent?.phaseLabel || props.targetEvent?.trackKey ? (
                    <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1">{props.targetEvent?.phaseLabel || props.targetEvent?.trackKey}</span>
                  ) : null}
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-1',
                      props.targetEvent?.sourceType === 'authored'
                        ? 'border-emerald-300/18 bg-emerald-500/10 text-emerald-100'
                        : 'border-amber-300/18 bg-amber-500/10 text-amber-100'
                    )}
                  >
                    {buildSourceMetaLabel(props.targetEvent?.sourceType)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {historyEntries.length ? (
        <div className="mt-4 rounded-[22px] border border-line/8 bg-shade/20 p-4" data-testid="future-jump-revision-history">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('futureJump.revisionHistory')}</p>
              <p className="mt-1 text-sm text-zinc-300">{t('futureJump.revisionHistoryDescription')}</p>
            </div>
            <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-300">{t('futureJump.historyCount', { count: historyEntries.length })}</span>
          </div>

          <ul className="mt-4 space-y-3">
            {historyEntries.map((item) => {
              const isCurrentMirror = item.revisionNo === props.detail.latestRevisionNo
                && item.bridgeSummary.trim() === props.detail.bridgeSummary.trim()
                && item.generatedTargetText.trim() === props.detail.generatedTargetText.trim()
              return (
            <li key={`${item.revisionNo}-${item.createdAt}`} className="rounded-[18px] border border-line/8 bg-overlay/[0.03] p-3" data-testid={`future-jump-history-item-${item.revisionNo}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{t('futureJump.historyRevision', { count: item.revisionNo, kind: item.revisionKind })}</p>
                  <p className="mt-2 text-xs leading-6 text-zinc-300">{item.userFeedback?.trim() || t('futureJump.initialRevisionFeedback')}</p>
                  {isCurrentMirror ? <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-sky-100">{t('futureJump.currentVersionShown')}</p> : null}
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-400">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatCreatedAt(item.createdAt)}
                </div>
              </div>

              {!isCurrentMirror ? <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div className="rounded-[16px] border border-sky-300/18 bg-sky-500/10 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-sky-100/75">{t('futureJump.bridgeLabel')}</p>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-sky-50">{item.bridgeSummary}</p>
                </div>
                <div className="rounded-[16px] border border-line/8 bg-shade/20 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('futureJump.futureTextLabel')}</p>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-zinc-200">{item.generatedTargetText}</p>
                </div>
              </div> : null}
            </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

"use client"

import { useI18n } from '@/lib/i18n/provider'
import type { WhatIfDeltaRecord } from '@/lib/story-branch-types'
import { cn } from '@/lib/utils'

function formatConfidence(confidence: number | null, unlabeled: string) {
  if (confidence === null || Number.isNaN(confidence)) return unlabeled
  return `${Math.round(confidence * 100)}%`
}

function buildDeltaTitle(delta: WhatIfDeltaRecord) {
  const subject = delta.subjectName?.trim() || delta.key
  const target = delta.targetName?.trim()
  return target ? `${subject} → ${target}` : subject
}

export function WhatIfDeltaPanel(props: {
  deltas: WhatIfDeltaRecord[]
}) {
  const { t } = useI18n()
  return (
    <section className="rounded-[24px] border border-fuchsia-400/20 bg-fuchsia-500/10 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-fuchsia-200/70">Speculative deltas</p>
          <h3 className="mt-2 text-lg font-semibold text-zinc-100">{t('whatIf.deltaTitle')}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">{t('whatIf.deltaDescription')}</p>
        </div>
        <span className="rounded-full border border-fuchsia-300/20 bg-shade/20 px-3 py-1 text-[11px] text-fuchsia-100">
          {t('whatIf.deltaCount', { count: props.deltas.length })}
        </span>
      </div>

      <ul className="mt-4 space-y-3" data-testid="what-if-delta-list">
        {props.deltas.map((delta) => (
          <li key={delta.id} className="rounded-[20px] border border-line/8 bg-shade/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{delta.deltaType.replaceAll('_', ' ')}</p>
                <h4 className="mt-1 text-sm font-medium text-zinc-100">{buildDeltaTitle(delta)}</h4>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {delta.validFromChapter !== null ? (
                  <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1 text-zinc-300">{t('whatIf.deltaValidFromChapter', { chapterNo: delta.validFromChapter })}</span>
                ) : null}
                <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1 text-zinc-300">{t('whatIf.deltaConfidence', { value: formatConfidence(delta.confidence, t('whatIf.unlabeled')) })}</span>
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-zinc-300">{delta.description}</p>

            <div className={cn('mt-3 grid gap-3', (delta.oldValue || delta.newValue) ? 'sm:grid-cols-2' : 'sm:grid-cols-1')}>
              {delta.oldValue ? (
                <div className="rounded-[18px] border border-rose-300/15 bg-rose-500/10 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-rose-100/70">Before</p>
                  <p className="mt-2 text-sm leading-6 text-rose-50">{delta.oldValue}</p>
                </div>
              ) : null}
              {delta.newValue ? (
                <div className="rounded-[18px] border border-emerald-300/15 bg-emerald-500/10 p-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-100/70">After</p>
                  <p className="mt-2 text-sm leading-6 text-emerald-50">{delta.newValue}</p>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

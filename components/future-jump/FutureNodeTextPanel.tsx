"use client"

import { FileText } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { splitPlainTextParagraphs } from '@/lib/utils'

export function FutureNodeTextPanel(props: {
  targetTitle: string
  targetChapterLabel: string
  generatedTargetText: string
}) {
  const { t } = useI18n()
  const paragraphs = splitPlainTextParagraphs(props.generatedTargetText)
  const visibleParagraphs = paragraphs.length ? paragraphs : [props.generatedTargetText.trim() || '　']

  return (
    <section className="rounded-[24px] border border-line/8 bg-shade/20 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('futureJump.generatedTargetChapter')}</p>
          <h3 className="mt-2 text-lg font-semibold text-zinc-100">{props.targetTitle}</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{t('futureJump.generatedTargetDescription')}</p>
        </div>
        <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-300">{props.targetChapterLabel}</span>
      </div>

      <div className="mt-4 rounded-[22px] border border-sky-300/18 bg-sky-500/10 p-4" data-testid="future-jump-text">
        <div className="flex items-center gap-2 text-sky-100">
          <FileText className="h-4 w-4" />
          <p className="text-[11px] uppercase tracking-[0.16em] text-sky-100/75">{t('futureJump.latestGeneratedText')}</p>
        </div>
        <div className="reader-body-prose mt-3 text-sky-50">
          {visibleParagraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </div>
      </div>
    </section>
  )
}

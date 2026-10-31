"use client"

import { ArrowRight, LoaderCircle, RefreshCcw } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { CharacterPromptTextarea } from '@/components/workspace/CharacterPromptTextarea'
import type { PromptCharacter } from '@/lib/character-prompt-completion'

export function FutureJumpControlPanel(props: {
  characters?: PromptCharacter[]
  feedback: string
  onFeedbackChange: (value: string) => void
  onRegenerate: () => void
  regenerating: boolean
  onContinue: () => void
  continueDisabled: boolean
  latestRevisionNo: number
  actionError: string
}) {
  const { t } = useI18n()
  return (
    <section className="rounded-[24px] border border-sky-400/20 bg-sky-500/10 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200/70">{t('futureJump.revisionControlsEyebrow')}</p>
          <h3 className="mt-2 text-lg font-semibold text-zinc-100">{t('futureJump.revisionControlsTitle')}</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{t('futureJump.revisionControlsDescription')}</p>
        </div>
        <span className="rounded-full border border-sky-300/20 bg-shade/20 px-3 py-1 text-[11px] text-sky-100">{t('futureJump.latestRevisionBadge', { count: props.latestRevisionNo })}</span>
      </div>

      <div className="mt-4 block">
        <span className="mb-2 block text-sm text-zinc-300">{t('futureJump.revisionFeedback')}</span>
        <CharacterPromptTextarea
          characters={props.characters}
          aria-label={t('futureJump.revisionFeedback')}
          value={props.feedback}
          onValueChange={props.onFeedbackChange}
          className="min-h-[140px] w-full rounded-[22px] border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
          placeholder={t('futureJump.revisionFeedbackPlaceholder')}
          data-testid="future-jump-feedback"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={props.onRegenerate}
          disabled={props.regenerating}
          className="inline-flex items-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="future-jump-regenerate"
        >
          {props.regenerating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          {t('futureJump.regenerate')}
        </button>
        <button
          type="button"
          onClick={props.onContinue}
          disabled={props.continueDisabled}
          className="inline-flex items-center gap-2 rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 transition hover:bg-overlay/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="future-jump-continue"
        >
          <ArrowRight className="h-4 w-4" />
          {t('futureJump.continueThisFuture')}
        </button>
      </div>

      <div className="mt-4 rounded-[18px] border border-amber-300/18 bg-amber-500/10 p-3 text-xs leading-6 text-amber-100">
        {t('futureJump.controlHint')}
      </div>

      {props.actionError ? (
        <div role="alert" data-testid="future-jump-action-error" className="mt-4 whitespace-pre-wrap break-words rounded-[18px] border border-rose-400/20 bg-rose-500/10 p-3 text-sm leading-6 text-rose-100">
          {props.actionError}
        </div>
      ) : null}
    </section>
  )
}

"use client"

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import { buildContextWarnings } from '@/lib/context-warnings'
import type { KnowledgeStatusOverview } from '@/components/workspace/selection-novel-studio-helpers'

export function ContextWarningButton({ warnings, overview }: {
  warnings: string[]
  overview?: KnowledgeStatusOverview | null
}) {
  const { locale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const issues = buildContextWarnings({ warnings, overview }, locale)
  if (!issues.length) return null

  return <>
    <button
      type="button"
      data-testid="workspace-context-warning-toggle"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={t('contextWarning.open', { count: issues.length })}
      onClick={() => setOpen(true)}
      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-amber-300 transition hover:bg-amber-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      {t('contextWarning.badge', { count: issues.length })}
    </button>
    <DialogSurface open={open} onClose={() => setOpen(false)} title={t('contextWarning.title')} description={t('contextWarning.description')} closeLabel={t('common.close')} placement="bottom" className="mx-auto max-w-lg">
      <ul className="divide-y divide-line/10">
        {issues.map((issue) => <li key={issue} className="flex items-start gap-3 py-3 first:pt-0">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
          <p className="text-sm leading-6 text-zinc-300">{issue}</p>
        </li>)}
      </ul>
      <p className="mt-4 border-t border-line/10 pt-4 text-sm leading-6 text-zinc-400">{t('contextWarning.nextStep')}</p>
    </DialogSurface>
  </>
}

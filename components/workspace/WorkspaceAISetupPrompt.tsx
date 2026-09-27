"use client"

import { X } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

export function WorkspaceAISetupPrompt({ onOpenSettings, onClearSelection }: {
  onOpenSettings: () => void
  onClearSelection?: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="flex min-h-12 items-center gap-2" data-testid="workspace-ai-setup-prompt">
      <p className="min-w-0 flex-1 text-sm text-zinc-300" role="status">{t('workspace.aiSetup.title')}</p>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onOpenSettings} className="min-h-11 shrink-0 rounded-xl bg-violet-500 px-4 text-sm font-medium text-white transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70">
        {t('workspace.aiSetup.openSettings')}
      </button>
      {onClearSelection ? <button type="button" aria-label={t('workspace.mobile.clearSelection')} onClick={onClearSelection} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-overlay/5"><X className="h-4 w-4" aria-hidden="true" /></button> : null}
    </div>
  )
}

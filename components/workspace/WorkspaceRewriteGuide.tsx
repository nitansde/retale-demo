"use client"

import { useState } from 'react'
import { Wand2 } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import type { AIProvider } from '@/lib/types'

export function WorkspaceRewriteGuide({ modelConfigured, provider, onOpenSettings }: {
  modelConfigured: boolean
  provider: AIProvider
  onOpenSettings: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs text-violet-200 hover:bg-overlay/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
      >
        <Wand2 className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
        {t('workspace.rewriteGuide.action')}
      </button>
      <DialogSurface
        open={open}
        onClose={() => setOpen(false)}
        title={t(modelConfigured ? 'workspace.rewriteGuide.title' : 'workspace.aiSetup.title')}
        description={t(modelConfigured ? 'workspace.rewriteGuide.description' : provider === 'ollama' ? 'workspace.aiSetup.ollamaDescription' : 'workspace.aiSetup.apiDescription')}
        closeLabel={t('common.close')}
        placement="bottom"
        className="mx-auto max-w-lg"
        footer={<button type="button" onClick={() => { setOpen(false); if (!modelConfigured) onOpenSettings() }} className="min-h-11 w-full rounded-xl bg-violet-500 px-4 text-sm font-medium text-white transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70">{t(modelConfigured ? 'workspace.rewriteGuide.try' : 'workspace.aiSetup.openSettings')}</button>}
      >
        {modelConfigured ? <>
        <figure className="mb-7 select-none border-l-2 border-violet-400/40 pl-4">
          <figcaption className="mb-3 text-xs text-zinc-500">{t('workspace.rewriteGuide.exampleLabel')}</figcaption>
          <p className="text-base leading-8 text-zinc-400">
            {t('workspace.rewriteGuide.exampleBefore')}
            <mark className="relative rounded-sm bg-violet-400/25 py-1 text-violet-100">
              <span aria-hidden="true" className="absolute -left-px top-0 h-full w-0.5 bg-violet-400 before:absolute before:-left-1 before:-top-2 before:h-2.5 before:w-2.5 before:rounded-full before:bg-violet-400" />
              {t('workspace.rewriteGuide.exampleSelection')}
              <span aria-hidden="true" className="absolute -right-px top-0 h-full w-0.5 bg-violet-400 after:absolute after:-bottom-2 after:-right-1 after:h-2.5 after:w-2.5 after:rounded-full after:bg-violet-400" />
            </mark>
            {t('workspace.rewriteGuide.exampleAfter')}
          </p>
        </figure>
        <ol className="space-y-4">
          {(['select', 'adjust', 'rewrite'] as const).map((step, index) => (
            <li key={step} className="flex items-start gap-3 text-sm leading-6 text-zinc-300">
              <span aria-hidden="true" className="w-4 shrink-0 text-violet-300">{index + 1}</span>
              <span>{t(`workspace.rewriteGuide.step.${step}`)}</span>
            </li>
          ))}
        </ol>
        </> : <p className="text-sm leading-6 text-zinc-400">{t('workspace.aiSetup.path')}</p>}
      </DialogSurface>
    </>
  )
}

"use client"

import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useDesktopWorkspaceLayout } from '@/components/workspace/use-desktop-workspace-layout'
import type { WorkspaceKnowledgeStatus } from '@/components/workspace/workspace-knowledge-status'
import { useI18n } from '@/lib/i18n/provider'

export function WorkspaceReferencePanel(props: {
  open: boolean
  drawerOnly?: boolean
  onClose: () => void
  knowledgeOpen: boolean
  onKnowledgeOpen: () => void
  onKnowledgeClose: () => void
  knowledgeStatus: WorkspaceKnowledgeStatus
  contextLabel: string
  selectionActions: ReactNode
  knowledgeControls: ReactNode
  references: ReactNode
}) {
  const { t } = useI18n()
  const desktop = useDesktopWorkspaceLayout()
  const knowledgeIncomplete = props.knowledgeStatus.overall !== 'loading' && props.knowledgeStatus.overall !== 'ready'
  const knowledgeBuilding = props.knowledgeStatus.operation?.status === 'running' || props.knowledgeStatus.operation?.status === 'queued'

  if (desktop && !props.drawerOnly) {
    return (
      <aside className="rounded-[30px] border border-line/10 bg-raised p-4 shadow-[0_28px_90px_rgb(0_0_0/calc(0.35*var(--shadow-strength)))] sm:p-5" data-testid="workspace-reference-panel">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-line/8 bg-shade/20 px-3 py-2">
          <span className="text-xs font-medium text-zinc-300">{t('workspace.context.title')}</span>
          <span className="text-[11px] text-zinc-500" data-testid="workspace-reference-selection-kind">{props.contextLabel}</span>
        </div>
        {props.selectionActions}
        {props.knowledgeControls}
        {props.references}
      </aside>
    )
  }

  return (
    <>
      <DialogSurface
        open={props.open}
        onClose={props.onClose}
        closeLabel={t('workspace.context.close')}
        title={t('workspace.context.title')}
        placement="right"
        mobileFullscreen
      >
        <div className="mb-4">
          <span className="text-xs text-zinc-400" data-testid="workspace-reference-selection-kind">{props.contextLabel}</span>
        </div>
        <div data-testid="workspace-reference-panel">
          {props.selectionActions}
          {knowledgeIncomplete ? (
            <div className="mb-4 border-b border-line/10 pb-4" data-testid="workspace-story-knowledge-guide">
              <p className="text-sm leading-6 text-zinc-400">
                {t(knowledgeBuilding ? 'workspace.context.knowledgeBuilding' : 'workspace.context.knowledgeIncomplete')}
              </p>
              <button
                type="button"
                onClick={props.onKnowledgeOpen}
                className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-500/15 px-3 text-sm font-medium text-violet-200 transition hover:bg-violet-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
              >
                {t(knowledgeBuilding ? 'workspace.context.viewKnowledgeProgress' : 'workspace.context.rebuildKnowledge')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {props.references}
        </div>
      </DialogSurface>
      <DialogSurface
        open={props.knowledgeOpen}
        onClose={props.onKnowledgeClose}
        closeLabel={t('workspace.knowledge.closeSheet')}
        title={t('workspace.knowledge.sheetTitle')}
        description={t('workspace.knowledge.sheetDescription')}
        placement="bottom"
      >
        {props.knowledgeControls}
      </DialogSurface>
    </>
  )
}

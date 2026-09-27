"use client"

import { ChevronDown, Circle, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { TranslationKey } from '@/lib/i18n/messages'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type {
  WorkspaceKnowledgeCoverage,
  WorkspaceKnowledgeStatus as WorkspaceKnowledgeStatusModel,
} from '@/components/workspace/workspace-knowledge-status'

type PrimaryAction = {
  label: TranslationKey
  onClick: () => void
} | null

function StatusIcon({ status, className }: { status: 'not_ready' | 'pending' | 'partial' | 'ready'; className: string }) {
  if (status === 'ready') return <CircleCheck className={className} aria-hidden="true" />
  if (status === 'pending') return <LoaderCircle className={className} aria-hidden="true" />
  if (status === 'partial') return <TriangleAlert className={className} aria-hidden="true" />
  return <Circle className={className} aria-hidden="true" />
}

function getPrimaryAction(
  status: WorkspaceKnowledgeStatusModel,
  onPrepareAnalysis: () => void,
  onPrepareSearch: () => void
): PrimaryAction {
  if (status.overall === 'loading' || status.operation?.status === 'queued' || status.operation?.status === 'running') return null

  if (status.operation?.status === 'paused' || status.operation?.status === 'failed') {
    const isSearch = status.operation.stage === 'search'
    return {
      label: status.operation.status === 'paused'
        ? isSearch ? 'workspace.knowledge.status.action.resumeSearch' : 'workspace.knowledge.status.action.resumeAnalysis'
        : isSearch ? 'workspace.knowledge.status.action.retrySearch' : 'workspace.knowledge.status.action.retryAnalysis',
      onClick: isSearch ? onPrepareSearch : onPrepareAnalysis,
    }
  }

  if (status.overall === 'ready') return null

  if (status.analysis === 'ready') {
    return { label: 'workspace.knowledge.status.action.prepareSearch', onClick: onPrepareSearch }
  }

  return { label: 'workspace.knowledge.status.action.startAnalysis', onClick: onPrepareAnalysis }
}

function coverageText(
  coverage: WorkspaceKnowledgeCoverage,
  fallback: string,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
) {
  if (!coverage) return fallback
  if (coverage.kind === 'all') return t('workspace.knowledge.status.coverage.all', { count: coverage.count })
  if (coverage.kind === 'through') return t('workspace.knowledge.status.coverage.through', { chapter: coverage.chapter })
  if (coverage.kind === 'range') return t('workspace.knowledge.status.coverage.range', { start: coverage.start, end: coverage.end })
  if (coverage.kind === 'count') return t('workspace.knowledge.status.coverage.count', { covered: coverage.covered, total: coverage.total })
  return t('workspace.knowledge.status.coverage.partial')
}

export function WorkspaceKnowledgeStatus({
  status,
  advancedDetailsOpen,
  onAdvancedDetailsChange,
  onPrepareAnalysis,
  onPrepareSearch,
  actionDisabled = false,
}: {
  status: WorkspaceKnowledgeStatusModel
  advancedDetailsOpen: boolean
  onAdvancedDetailsChange: (open: boolean) => void
  onPrepareAnalysis: () => void
  onPrepareSearch: () => void
  actionDisabled?: boolean
}) {
  const { t } = useI18n()
  const primaryAction = getPrimaryAction(status, onPrepareAnalysis, onPrepareSearch)
  const analysisStatus = status.analysis
  const searchStatus = status.search
  const analysisOperation = status.operation?.stage === 'analysis' ? status.operation : null
  const searchOperation = status.operation?.stage === 'search' ? status.operation : null
  const retainedResultsAvailable = status.operation
    && (status.operation.status === 'paused' || status.operation.status === 'failed')
    && (status.analysisResultsUsable || status.searchResultsUsable)

  const renderOperation = (operation: typeof status.operation, phaseProgressLabel: TranslationKey) => {
    if (!operation) return null
    const progress = operation.status === 'running' ? operation.progressPercent : null
    const progressLabel = operation.progressSource === 'phase'
      ? phaseProgressLabel
      : 'workspace.knowledge.status.progress.job'
    return (
      <div className="mt-2 border-t border-line/8 pt-2">
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className={cn(operation.status === 'failed' ? 'text-rose-200' : operation.status === 'paused' ? 'text-amber-200' : 'text-violet-200')}>
            {t(`workspace.knowledge.status.operation.${operation.status}` as TranslationKey)}
          </span>
          {progress !== null ? <span className="text-violet-100">{progress}%</span> : null}
        </div>
        {progress !== null ? (
          <div
            role="progressbar"
            aria-label={t(progressLabel)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-overlay/10"
          >
            <div className="h-full rounded-full bg-violet-300 transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section className="rounded-[24px] border border-violet-400/20 bg-violet-500/10 p-4" data-testid="workspace-knowledge-status">
      <p className="text-[11px] uppercase tracking-[0.22em] text-violet-200/70">{t('workspace.knowledge.status.eyebrow')}</p>
      <h3 className="mt-1 text-sm font-medium leading-6 text-zinc-100">
        {t(`workspace.knowledge.status.overall.${status.overall}`)}
      </h3>

      <div className="mt-3 space-y-2">
        <div className="rounded-2xl border border-line/8 bg-shade/20 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <StatusIcon status={analysisStatus} className={cn('h-4 w-4 shrink-0', status.analysis === 'ready' ? 'text-emerald-300' : status.analysis === 'partial' ? 'text-amber-300' : 'text-zinc-500')} />
              <span className="text-xs text-zinc-200">{t('workspace.knowledge.status.storyAnalysis')}</span>
            </div>
            <span className="text-right text-[11px] text-zinc-400">{coverageText(status.analysisCoverage, t(`workspace.knowledge.status.analysis.${status.analysis}`), t)}</span>
          </div>
          {renderOperation(analysisOperation, 'workspace.knowledge.status.progress.phase.analysis')}
        </div>
        <div className="rounded-2xl border border-line/8 bg-shade/20 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <StatusIcon status={searchStatus} className={cn('h-4 w-4 shrink-0', status.search === 'ready' ? 'text-emerald-300' : status.search === 'partial' ? 'text-amber-300' : status.search === 'pending' ? 'animate-spin text-violet-300' : 'text-zinc-500')} />
              <span className="text-xs text-zinc-200">{t('workspace.knowledge.status.contentSearch')}</span>
            </div>
            <span className="text-right text-[11px] text-zinc-400">{coverageText(status.searchCoverage, t(`workspace.knowledge.status.search.${status.search}`), t)}</span>
          </div>
          {renderOperation(searchOperation, 'workspace.knowledge.status.progress.phase.search')}
        </div>
      </div>

      {retainedResultsAvailable ? (
        <p className="mt-2 text-xs leading-5 text-zinc-400">{t('workspace.knowledge.status.previousResultsAvailable')}</p>
      ) : status.searchMayBeStale ? (
        <p className="mt-2 text-xs leading-5 text-amber-100/80">{t('workspace.knowledge.status.searchMayBeStale')}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {primaryAction ? (
          <button
            type="button"
            onClick={primaryAction.onClick}
            disabled={actionDisabled}
            className="min-h-11 rounded-xl border border-violet-300/30 bg-violet-500/20 px-4 text-xs font-medium text-violet-50 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(primaryAction.label)}
          </button>
        ) : null}
        <button
          type="button"
          aria-expanded={advancedDetailsOpen}
          onClick={() => onAdvancedDetailsChange(!advancedDetailsOpen)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line/10 bg-shade/20 px-4 text-xs text-zinc-300 transition hover:bg-overlay/[0.08]"
        >
          {t(advancedDetailsOpen ? 'workspace.knowledge.status.hideAdvancedDetails' : 'workspace.knowledge.status.advancedDetails')}
          <ChevronDown className={cn('h-4 w-4 transition-transform', advancedDetailsOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

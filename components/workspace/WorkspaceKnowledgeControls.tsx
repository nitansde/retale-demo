"use client"

import { formatProgressMessage } from '@/lib/i18n/progress-message'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { WorkspaceKnowledgeStatus } from '@/components/workspace/WorkspaceKnowledgeStatus'
import { mapWorkspaceKnowledgeStatus } from '@/components/workspace/workspace-knowledge-status'
import {
  formatEmbeddingProviderLabel,
  formatKnowledgeCoverageBadge,
  formatKnowledgeCoverageDetail,
  formatKnowledgeRebuildChapterRangeLabel,
  formatRetrievalIndexBadge,
  KNOWLEDGE_STEP_STATUS_LABELS,
  type KnowledgeActionLoading,
  type KnowledgeChapterCoverageOverview,
  type KnowledgeRebuildRangeMode,
  type KnowledgeRebuildStatus,
  type KnowledgeStatusOverview,
  resolveKnowledgeStepDisplayStatus,
  resolveRetrievalTaskControlsState,
  type RetrievalIndexCoverageOverview,
} from '@/components/workspace/selection-novel-studio-helpers'
import { useI18n } from '@/lib/i18n/provider'
import { redactUserFacingDiagnostic } from '@/lib/workspace-user-facing-errors'
import { cn } from '@/lib/utils'

type DeleteState = {
  disabled: boolean
  helperText: string
}

type WorkspaceKnowledgeControlsProps = {
  advancedDetailsOpen?: boolean
  onAdvancedDetailsChange?: (open: boolean) => void
  knowledgeRebuilding: boolean
  knowledgeRebuildActive: boolean
  knowledgeActionLoading: KnowledgeActionLoading
  knowledgeRebuildPaused: boolean
  knowledgeRebuildFailed: boolean
  knowledgeRebuildRangeMode: KnowledgeRebuildRangeMode
  knowledgeRebuildFirstChapterCount: string
  knowledgeRebuildStartChapter: string
  knowledgeRebuildEndChapter: string
  selectedKnowledgeRebuildChapterRangeLabel: string
  knowledgeStatusOverview: KnowledgeStatusOverview | null
  currentKnowledgeJobBusy: boolean
  knowledgeGraphOverview: KnowledgeChapterCoverageOverview | null
  extractionCacheOverview: KnowledgeChapterCoverageOverview | null
  embeddingCacheOverview: (KnowledgeChapterCoverageOverview & { provider: string | null; model: string | null }) | null
  retrievalIndexOverview: RetrievalIndexCoverageOverview | null
  retrievalIndexStatusLine: string
  retrievalTaskStatus: KnowledgeRebuildStatus | null
  retrievalTaskStatusLabel: string
  retrievalTaskPhaseLabel: string | null
  retrievalControlsState: ReturnType<typeof resolveRetrievalTaskControlsState>
  mainKnowledgeRebuildStatus: KnowledgeRebuildStatus | null
  knowledgeRebuildFailureMessage: string | null
  knowledgeRebuildEtaMinutes: number | null
  hanlpBootstrapStatusLine: string
  hanlpBootstrapCompletedChapterCount: number | null
  hanlpBootstrapTotalChapterCount: number | null
  hanlpCacheStatusLabel: string
  hanlpBootstrapCacheHitRatePercent: number | null
  hanlpBootstrapPhaseLabel: string
  hanlpBootstrapEtaLabel: string
  hanlpBootstrapTimingLabel: string | null
  hanlpSettingsLine: string | null
  rawTextEmbeddingStatusLine: string
  rawTextEmbeddingActive: boolean
  rawTextEmbeddingPhaseBadge: string
  rawTextEmbeddingCacheHitRatePercent: number | null
  rawTextEmbeddingTimingLabel: string | null
  rawTextEmbeddingSettingsLine: string | null
  knowledgeRebuildSteps: KnowledgeRebuildStatus['steps']
  currentKnowledgeRunningStepKey: KnowledgeRebuildStatus['steps'][number]['key'] | null
  confirmDeleteHanlpCache: boolean
  confirmDeleteExtractionCache: boolean
  confirmDeleteEmbeddingCache: boolean
  confirmDeleteKnowledge: boolean
  hanlpCacheDeleteState: DeleteState
  extractionCacheDeleteState: DeleteState
  embeddingCacheDeleteState: DeleteState
  onRebuildKnowledge: () => void
  onPauseKnowledge: () => void
  onAbortKnowledge: () => void
  onRebuildRetrievalIndex: () => void
  onSetKnowledgeRebuildRangeMode: (mode: KnowledgeRebuildRangeMode) => void
  onSetKnowledgeRebuildFirstChapterCount: (value: string) => void
  onSetKnowledgeRebuildStartChapter: (value: string) => void
  onSetKnowledgeRebuildEndChapter: (value: string) => void
  onToggleConfirmDeleteHanlpCache: () => void
  onToggleConfirmDeleteExtractionCache: () => void
  onToggleConfirmDeleteEmbeddingCache: () => void
  onToggleConfirmDeleteKnowledge: () => void
  onCancelDeleteHanlpCache: () => void
  onCancelDeleteExtractionCache: () => void
  onCancelDeleteEmbeddingCache: () => void
  onCancelDeleteKnowledge: () => void
  onDeleteHanlpCache: () => void
  onDeleteExtractionCache: () => void
  onDeleteEmbeddingCache: () => void
  onDeleteKnowledgeGraph: () => void
}

export function WorkspaceKnowledgeControls(props: WorkspaceKnowledgeControlsProps) {
  const { t } = useI18n()
  const [internalAdvancedDetailsOpen, setInternalAdvancedDetailsOpen] = useState(false)
  const advancedDetailsOpen = props.advancedDetailsOpen ?? internalAdvancedDetailsOpen
  const setAdvancedDetailsOpen = props.onAdvancedDetailsChange ?? setInternalAdvancedDetailsOpen
  const mainKnowledgeQueued = props.mainKnowledgeRebuildStatus?.status === 'queued'
  const userStatus = mapWorkspaceKnowledgeStatus({
    overview: props.knowledgeStatusOverview,
    job: props.mainKnowledgeRebuildStatus ?? props.retrievalTaskStatus,
  }, t)

  return (
    <div className="mb-4">
      <WorkspaceKnowledgeStatus
        status={userStatus}
        advancedDetailsOpen={advancedDetailsOpen}
        onAdvancedDetailsChange={setAdvancedDetailsOpen}
        onPrepareAnalysis={props.onRebuildKnowledge}
        onPrepareSearch={props.onRebuildRetrievalIndex}
        actionDisabled={props.knowledgeRebuilding || props.knowledgeRebuildActive ||
          Boolean(props.knowledgeActionLoading)}
      />
      {advancedDetailsOpen ? (
        <div className="mt-3 rounded-[24px] border border-line/10 bg-shade/20 p-4" data-testid="workspace-knowledge-advanced-details">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{t('workspace.knowledge.status.maintenanceEyebrow')}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">{t('workspace.knowledge.status.maintenanceDescription')}</p>
            </div>
            <button type="button" onClick={props.onRebuildKnowledge} disabled={props.knowledgeRebuilding || props.knowledgeRebuildActive || Boolean(props.knowledgeActionLoading)} className="min-h-11 rounded-full border border-line/10 bg-shade/20 px-3 py-1.5 text-[11px] text-zinc-300 transition hover:bg-overlay/[0.08] disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0">
              {props.knowledgeRebuilding
                ? t('workspace.knowledge.processing')
                : props.knowledgeRebuildPaused
                ? t('workspace.knowledge.resumeRebuild')
                : props.knowledgeRebuildFailed
                ? t('workspace.knowledge.retryRebuild')
                : t('workspace.knowledge.startRebuild')}
            </button>
          </div>
          <div className="mt-3 rounded-2xl border border-violet-300/15 bg-shade/20 p-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
              <span className="text-zinc-500">{t('workspace.knowledge.chapterRange')}</span>
              <button
                type="button"
                onClick={() => props.onSetKnowledgeRebuildRangeMode('all')}
                disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding ||
                  Boolean(props.knowledgeActionLoading)}
                className={cn(
                  'min-h-11 rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0',
                  props.knowledgeRebuildRangeMode === 'all'
                    ? 'border-violet-300/40 bg-violet-400/15 text-violet-50'
                    : 'border-line/10 bg-overlay/[0.03] text-zinc-400 hover:bg-overlay/[0.06]',
                )}
              >
                {t('workspace.knowledge.rangeAll')}
              </button>
              <button
                type="button"
                onClick={() => props.onSetKnowledgeRebuildRangeMode('first')}
                disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding ||
                  Boolean(props.knowledgeActionLoading)}
                className={cn(
                  'min-h-11 rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0',
                  props.knowledgeRebuildRangeMode === 'first'
                    ? 'border-violet-300/40 bg-violet-400/15 text-violet-50'
                    : 'border-line/10 bg-overlay/[0.03] text-zinc-400 hover:bg-overlay/[0.06]',
                )}
              >
                {t('workspace.knowledge.rangeFirst')}
              </button>
              <button
                type="button"
                onClick={() => props.onSetKnowledgeRebuildRangeMode('custom')}
                disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding ||
                  Boolean(props.knowledgeActionLoading)}
                className={cn(
                  'min-h-11 rounded-full border px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0',
                  props.knowledgeRebuildRangeMode === 'custom'
                    ? 'border-violet-300/40 bg-violet-400/15 text-violet-50'
                    : 'border-line/10 bg-overlay/[0.03] text-zinc-400 hover:bg-overlay/[0.06]',
                )}
              >
                {t('workspace.knowledge.rangeCustom')}
              </button>
            </div>
            {props.knowledgeRebuildRangeMode === 'first' ? (
              <label className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
                {t('workspace.knowledge.processFirst')}
                <input value={props.knowledgeRebuildFirstChapterCount} onChange={(event) => props.onSetKnowledgeRebuildFirstChapterCount(event.target.value)} disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)} inputMode="numeric" className="min-h-11 w-20 rounded-xl border border-line/10 bg-shade/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0" />
                {t('workspace.knowledge.chapterUnit')}
              </label>
            ) : null}
            {props.knowledgeRebuildRangeMode === 'custom' ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span>{t('workspace.knowledge.fromChapter')}</span>
                <input value={props.knowledgeRebuildStartChapter} onChange={(event) => props.onSetKnowledgeRebuildStartChapter(event.target.value)} disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)} inputMode="numeric" className="min-h-11 w-20 rounded-xl border border-line/10 bg-shade/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0" />
                <span>{t('workspace.knowledge.toChapter')}</span>
                <input value={props.knowledgeRebuildEndChapter} onChange={(event) => props.onSetKnowledgeRebuildEndChapter(event.target.value)} disabled={props.knowledgeRebuildActive || props.knowledgeRebuilding || Boolean(props.knowledgeActionLoading)} inputMode="numeric" className="min-h-11 w-20 rounded-xl border border-line/10 bg-shade/25 px-2 py-1.5 text-zinc-100 outline-none transition focus:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0" />
                <span>{t('workspace.knowledge.chapterUnit')}</span>
              </div>
            ) : null}
            <p className="mt-2 text-[10px] leading-4 text-zinc-500">{t('workspace.knowledge.selectedRangeHint', { range: props.selectedKnowledgeRebuildChapterRangeLabel })}</p>
          </div>
          {props.knowledgeStatusOverview ? (
            <div className="mt-3 rounded-2xl border border-violet-300/15 bg-violet-500/[0.06] px-3 py-3 text-xs text-zinc-300" data-testid="workspace-knowledge-status-overview-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-violet-100/70">{t('workspace.knowledge.overviewEyebrow')}</p>
                  <p className="mt-1 leading-5 text-zinc-300">{t('workspace.knowledge.overviewDescription')}</p>
                </div>
                <span className="rounded-full border border-violet-300/20 bg-shade/20 px-3 py-1.5 text-[11px] text-violet-100/85">
                  {props.currentKnowledgeJobBusy
                    ? t('workspace.knowledge.jobRunning')
                    : t('workspace.knowledge.latestStatus')}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-line/8 bg-overlay/[0.03] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium text-zinc-100">{t('workspace.knowledge.extractionCacheLabel')}</p>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-400">
                        {formatKnowledgeCoverageDetail(
                          t('workspace.knowledge.extractionCacheLabel'),
                          props.extractionCacheOverview,
                        )}
                      </p>
                    </div>
                    <span className="rounded-full border border-violet-300/20 bg-shade/20 px-2.5 py-1 text-[10px] text-violet-100/85">
                      {formatKnowledgeCoverageBadge(props.extractionCacheOverview)}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-line/8 bg-overlay/[0.03] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium text-zinc-100">{t('workspace.knowledge.graphLabel')}</p>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-400">
                        {formatKnowledgeCoverageDetail(
                          t('workspace.knowledge.graphLabel'),
                          props.knowledgeGraphOverview,
                        )}
                      </p>
                    </div>
                    <span className="rounded-full border border-violet-300/20 bg-shade/20 px-2.5 py-1 text-[10px] text-violet-100/85">
                      {formatKnowledgeCoverageBadge(props.knowledgeGraphOverview)}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-line/8 bg-overlay/[0.03] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium text-zinc-100">{t('workspace.knowledge.embeddingCacheLabel')}</p>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-400">
                        {formatKnowledgeCoverageDetail(
                          t('workspace.knowledge.embeddingCacheLabel'),
                          props.embeddingCacheOverview,
                        )}
                      </p>
                    </div>
                    <span className="rounded-full border border-violet-300/20 bg-shade/20 px-2.5 py-1 text-[10px] text-violet-100/85">
                      {formatKnowledgeCoverageBadge(props.embeddingCacheOverview)}
                    </span>
                  </div>
                  {props.embeddingCacheOverview?.provider && props.embeddingCacheOverview.model ? (
                    <p className="mt-1 text-[10px] leading-4 text-zinc-500">
                      {redactUserFacingDiagnostic(
                        `${
                          formatEmbeddingProviderLabel(props.embeddingCacheOverview.provider)
                        } · ${props.embeddingCacheOverview.model}`,
                      )}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-xl border border-line/8 bg-overlay/[0.03] px-3 py-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-100">{t('workspace.knowledge.lancedbIndexLabel')}</p>
                      <p className="mt-1 text-[10px] leading-4 text-zinc-400">{redactUserFacingDiagnostic(props.retrievalIndexStatusLine)}</p>
                      {props.retrievalTaskStatus ? (
                        <>
                          <div className="mt-2 flex items-center gap-2 text-[10px] leading-4 text-zinc-400">
                            <span>
                              {t('workspace.knowledge.taskStatus', {
                                status: redactUserFacingDiagnostic(props.retrievalTaskStatusLabel),
                              })}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-zinc-500">
                            {props.retrievalTaskPhaseLabel ? (
                              <span>
                                {t('workspace.knowledge.phase', {
                                  phase: redactUserFacingDiagnostic(props.retrievalTaskPhaseLabel),
                                })}
                              </span>
                            ) : null}
                            {props.retrievalTaskStatus.chapterRange ? (
                              <span>
                                {t('workspace.knowledge.range', {
                                  range: formatKnowledgeRebuildChapterRangeLabel(
                                    props.retrievalTaskStatus.chapterRange,
                                  ),
                                })}
                              </span>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                      {props.retrievalControlsState.helperText ? (
                        <p className="mt-2 text-[10px] leading-4 text-zinc-500">{props.retrievalControlsState.helperText}</p>
                      ) : null}
                    </div>
                    <span className="rounded-full border border-violet-300/20 bg-shade/20 px-2.5 py-1 text-[10px] text-violet-100/85">
                      {formatRetrievalIndexBadge(props.retrievalIndexOverview)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {props.retrievalControlsState.actions.map((action) => {
                      const isPrimary = action === 'start' || action === 'refresh' || action === 'continue' ||
                        action === 'retry'
                      const isDanger = action === 'abort'
                      const isLoading = props.knowledgeActionLoading === 'rebuild-retrieval-index'
                        ? action === 'start' || action === 'refresh' || action === 'continue' || action === 'retry'
                        : props.knowledgeActionLoading === 'pause'
                        ? action === 'pause'
                        : props.knowledgeActionLoading === 'abort'
                        ? action === 'abort'
                        : false
                      const label = action === 'start'
                        ? t('workspace.knowledge.action.start')
                        : action === 'refresh'
                        ? t('workspace.knowledge.action.refresh')
                        : action === 'pause'
                        ? t('workspace.knowledge.action.pause')
                        : action === 'abort'
                        ? t('workspace.knowledge.action.abort')
                        : action === 'continue'
                        ? t('workspace.knowledge.action.continue')
                        : t('workspace.knowledge.action.retry')
                      const loadingLabel = action === 'pause'
                        ? t('workspace.knowledge.action.pausing')
                        : action === 'abort'
                        ? t('workspace.knowledge.action.aborting')
                        : t('workspace.knowledge.action.starting')
                      return (
                        <button
                          type="button"
                          key={action}
                          onClick={() => {
                            if (action === 'pause') {
                              props.onPauseKnowledge()
                              return
                            }
                            if (action === 'abort') {
                              props.onAbortKnowledge()
                              return
                            }
                            props.onRebuildRetrievalIndex()
                          }}
                          disabled={props.retrievalControlsState.disabled}
                          className={cn(
                            'min-h-11 rounded-xl px-3 py-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0',
                            isDanger
                              ? 'border border-amber-400/20 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20'
                              : isPrimary
                              ? 'border border-violet-400/30 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25'
                              : 'border border-line/10 bg-overlay/[0.04] text-zinc-300 hover:bg-overlay/[0.08]',
                          )}
                        >
                          {isLoading ? loadingLabel : label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {props.mainKnowledgeRebuildStatus ? (
            <div
              className={cn(
                'mt-3 rounded-2xl px-3 py-3 text-xs',
                props.knowledgeRebuildFailed
                  ? 'border border-rose-300/20 bg-rose-500/[0.08] text-rose-50'
                  : 'border border-violet-300/15 bg-shade/20 text-zinc-300',
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span>
                  {props.knowledgeRebuildFailed
                    ? t('workspace.knowledge.main.failed')
                    : props.knowledgeRebuildPaused
                    ? t('workspace.knowledge.main.paused')
                    : mainKnowledgeQueued
                    ? t('workspace.knowledge.main.queued')
                    : t('workspace.knowledge.main.running')}
                </span>
                <span>
                  {props.knowledgeRebuildFailed
                    ? t('workspace.knowledge.failed')
                    : props.knowledgeRebuildPaused
                    ? t('workspace.knowledge.job.paused')
                    : mainKnowledgeQueued
                    ? t('workspace.knowledge.job.queued')
                    : t('workspace.knowledge.job.running')}
                </span>
              </div>
              <p
                className={cn(
                  'mt-2 text-[11px] leading-5',
                  props.knowledgeRebuildFailed ? 'text-rose-100/90' : 'text-zinc-400',
                )}
              >
                {props.knowledgeRebuildFailed
                  ? redactUserFacingDiagnostic(props.knowledgeRebuildFailureMessage)
                  : redactUserFacingDiagnostic(formatProgressMessage(props.mainKnowledgeRebuildStatus.currentStep, t)) ||
                    (props.knowledgeRebuildPaused
                      ? t('workspace.knowledge.waitingContinue')
                      : t('workspace.knowledge.preparing'))}
              </p>
              {mainKnowledgeQueued && props.knowledgeRebuildEtaMinutes === null ? null : (
                <p className={cn('mt-1 text-[11px] leading-5', props.knowledgeRebuildFailed ? 'text-rose-100/70' : 'text-zinc-500')}>
                  {props.knowledgeRebuildFailed
                    ? t('workspace.knowledge.rebuildIncomplete')
                    : t('workspace.knowledge.eta', {
                      value: props.knowledgeRebuildPaused
                        ? t('workspace.knowledge.etaPaused')
                        : props.knowledgeRebuildEtaMinutes !== null
                        ? t('workspace.knowledge.etaMinutes', { count: props.knowledgeRebuildEtaMinutes })
                        : t('workspace.knowledge.calculating'),
                    })}
                </p>
              )}
              {props.mainKnowledgeRebuildStatus.chapterRange ? (
                <p className="mt-1 text-[11px] leading-5 text-violet-100/75">
                  {t('workspace.knowledge.taskRange', {
                    range: formatKnowledgeRebuildChapterRangeLabel(props.mainKnowledgeRebuildStatus.chapterRange),
                  })}
                </p>
              ) : null}
              <div className="mt-3 rounded-xl border border-violet-300/15 bg-violet-500/[0.08] px-3 py-3" data-testid="workspace-hanlp-bootstrap-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium text-violet-100">{t('workspace.knowledge.hanlpBootstrap')}</p>
                    <p className="mt-1 text-[10px] leading-4 text-violet-100/75">{redactUserFacingDiagnostic(props.hanlpBootstrapStatusLine)}</p>
                  </div>
                  <span className="rounded-full border border-violet-300/20 bg-shade/20 px-2.5 py-1 text-[10px] text-violet-100/85">
                    {typeof props.hanlpBootstrapCompletedChapterCount === 'number' &&
                        typeof props.hanlpBootstrapTotalChapterCount === 'number'
                      ? `${props.hanlpBootstrapCompletedChapterCount} / ${props.hanlpBootstrapTotalChapterCount} ${
                        t('workspace.knowledge.chapterUnit')
                      }`
                      : redactUserFacingDiagnostic(props.hanlpCacheStatusLabel)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400 sm:grid-cols-2">
                  <span>
                    {t('workspace.knowledge.completedChapters', {
                      value: typeof props.hanlpBootstrapCompletedChapterCount === 'number' &&
                          typeof props.hanlpBootstrapTotalChapterCount === 'number'
                        ? `${props.hanlpBootstrapCompletedChapterCount} / ${props.hanlpBootstrapTotalChapterCount}`
                        : t('workspace.knowledge.waitingProgress'),
                    })}
                  </span>
                  <span>
                    {t('workspace.knowledge.cacheHitRate', {
                      value: props.hanlpBootstrapCacheHitRatePercent !== null
                        ? `${props.hanlpBootstrapCacheHitRatePercent}%`
                        : t('workspace.knowledge.waitingProgress'),
                    })}
                  </span>
                  <span>
                    {t('workspace.knowledge.currentPhase', {
                      value: redactUserFacingDiagnostic(props.hanlpBootstrapPhaseLabel),
                    })}
                  </span>
                  <span>
                    {t('workspace.knowledge.remaining', {
                      value: redactUserFacingDiagnostic(props.hanlpBootstrapEtaLabel),
                    })}
                  </span>
                  <span>
                    {t('workspace.knowledge.stepDuration', {
                      value: props.hanlpBootstrapTimingLabel
                        ? redactUserFacingDiagnostic(props.hanlpBootstrapTimingLabel)
                        : t('workspace.knowledge.waitingProgress'),
                    })}
                  </span>
                </div>
                {props.hanlpSettingsLine ? (
                  <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{redactUserFacingDiagnostic(props.hanlpSettingsLine)}</p>
                ) : null}
              </div>
              {props.rawTextEmbeddingActive ? (
                <div className="mt-3 rounded-xl border border-violet-300/15 bg-violet-500/[0.08] px-3 py-3" data-testid="workspace-raw-embedding-card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-medium text-violet-100">{t('workspace.knowledge.rawEmbeddingPrecompute')}</p>
                      <p className="mt-1 text-[10px] leading-4 text-violet-100/75">{redactUserFacingDiagnostic(props.rawTextEmbeddingStatusLine)}</p>
                    </div>
                    <span className="rounded-full border border-violet-300/20 bg-shade/20 px-2.5 py-1 text-[10px] text-violet-100/85">
                      {redactUserFacingDiagnostic(props.rawTextEmbeddingPhaseBadge)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
                    <span>
                      {t('workspace.knowledge.cacheHitRate', {
                        value: props.rawTextEmbeddingCacheHitRatePercent !== null
                          ? `${props.rawTextEmbeddingCacheHitRatePercent}%`
                          : t('workspace.knowledge.notReturnedYet'),
                      })}
                    </span>
                    {props.rawTextEmbeddingTimingLabel ? (
                      <span>
                        {t('workspace.knowledge.stepDuration', {
                          value: redactUserFacingDiagnostic(props.rawTextEmbeddingTimingLabel),
                        })}
                      </span>
                    ) : null}
                  </div>
                  {props.rawTextEmbeddingSettingsLine ? (
                    <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{redactUserFacingDiagnostic(props.rawTextEmbeddingSettingsLine)}</p>
                  ) : null}
                </div>
              ) : null}
              {props.knowledgeRebuildSteps.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {props.knowledgeRebuildSteps.map((step) => {
                    const displayStatus = resolveKnowledgeStepDisplayStatus({
                      step,
                      isCurrentRunningStep: props.currentKnowledgeRunningStepKey === step.key,
                    })

                    return (
                      <div key={step.key} className="rounded-xl border border-line/8 bg-overlay/[0.03] px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-zinc-200">{redactUserFacingDiagnostic(formatProgressMessage(step.label, t))}</span>
                          <span className="text-zinc-500">{KNOWLEDGE_STEP_STATUS_LABELS[displayStatus]}</span>
                        </div>
                        {step.detail || (displayStatus === 'running' && step.etaMinutes) ||
                            displayStatus === 'paused'
                          ? (
                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] leading-4 text-zinc-500">
                              <span className="truncate">
                                {step.detail
                                  ? redactUserFacingDiagnostic(formatProgressMessage(step.detail, t))
                                  : KNOWLEDGE_STEP_STATUS_LABELS[displayStatus]}
                              </span>
                              {displayStatus === 'running' && step.etaMinutes
                                ? <span>{t('workspace.knowledge.etaMinutes', { count: step.etaMinutes })}</span>
                                : displayStatus === 'paused'
                                ? <span>{t('workspace.knowledge.etaPaused')}</span>
                                : null}
                            </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : null}
              <div className={cn('mt-3 grid gap-2', props.knowledgeRebuildFailed ? 'grid-cols-1' : 'grid-cols-2')}>
                {props.knowledgeRebuildPaused || props.knowledgeRebuildFailed ? (
                  <button
                    type="button"
                    onClick={props.onRebuildKnowledge}
                    disabled={Boolean(props.knowledgeActionLoading) || props.knowledgeRebuilding}
                    className={cn(
                      'min-h-11 rounded-xl px-3 py-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0',
                      props.knowledgeRebuildFailed
                        ? 'border border-rose-300/30 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25'
                        : 'border border-violet-400/30 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25',
                    )}
                  >
                    {props.knowledgeRebuilding
                      ? (props.knowledgeRebuildFailed
                        ? t('workspace.knowledge.retryStarting')
                        : t('workspace.knowledge.continuing'))
                      : props.knowledgeRebuildFailed
                      ? t('workspace.knowledge.retryRebuild')
                      : t('workspace.knowledge.resumeButton')}
                  </button>
                ) : (
                  <button type="button" onClick={props.onPauseKnowledge} disabled={!props.knowledgeRebuildActive || Boolean(props.knowledgeActionLoading)} className="min-h-11 rounded-xl border border-line/10 bg-overlay/[0.04] px-3 py-2 text-[11px] text-zinc-300 transition hover:bg-overlay/[0.08] disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0">
                    {props.knowledgeActionLoading === 'pause'
                      ? t('workspace.knowledge.action.pausing')
                      : t('workspace.knowledge.pauseButton')}
                  </button>
                )}
                {props.knowledgeRebuildFailed ? null : (
                  <button type="button" onClick={props.onAbortKnowledge} disabled={Boolean(props.knowledgeActionLoading)} className="min-h-11 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0">
                    {props.knowledgeActionLoading === 'abort'
                      ? t('workspace.knowledge.action.aborting')
                      : t('workspace.knowledge.abortCurrent')}
                  </button>
                )}
              </div>
              </div>
            ) : null}
          <div className="mt-3 rounded-2xl border border-sky-400/15 bg-sky-500/[0.06] px-3 py-3 text-xs text-zinc-300" data-testid="workspace-hanlp-cache-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200/70">{t('workspace.knowledge.hanlpCacheEyebrow')}</p>
                <p className="mt-1 leading-5 text-zinc-300">
                  {t('workspace.knowledge.currentStatus', {
                    value: redactUserFacingDiagnostic(props.hanlpCacheStatusLabel),
                  })}
                </p>
                <p className="mt-1 leading-5 text-zinc-400">{props.hanlpCacheDeleteState.helperText}</p>
              </div>
              <button type="button" onClick={props.onToggleConfirmDeleteHanlpCache} disabled={props.hanlpCacheDeleteState.disabled} data-testid="workspace-delete-hanlp-cache" aria-label={t('workspace.knowledge.deleteHanlpCache')} className="min-h-11 rounded-full border border-sky-400/20 bg-shade/20 px-3 py-1.5 text-[11px] text-sky-100 transition hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0">
                {t('workspace.knowledge.deleteHanlpCache')}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
              <span>
                {t('workspace.knowledge.hanlpCacheStatus', {
                  value: redactUserFacingDiagnostic(props.hanlpCacheStatusLabel),
                })}
              </span>
              <span>
                {t('workspace.knowledge.cacheHitRate', {
                  value: props.hanlpBootstrapCacheHitRatePercent !== null
                    ? `${props.hanlpBootstrapCacheHitRatePercent}%`
                    : t('workspace.knowledge.waitingProgress'),
                })}
              </span>
              <span>
                {t('workspace.knowledge.stepDuration', {
                  value: props.hanlpBootstrapTimingLabel
                    ? redactUserFacingDiagnostic(props.hanlpBootstrapTimingLabel)
                    : t('workspace.knowledge.waitingProgress'),
                })}
              </span>
            </div>
            {props.hanlpSettingsLine ? (
              <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{redactUserFacingDiagnostic(props.hanlpSettingsLine)}</p>
            ) : null}
          </div>
          <div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] px-3 py-3 text-xs text-zinc-300" data-testid="workspace-extraction-cache-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">{t('workspace.knowledge.extractionCacheEyebrow')}</p>
                <p className="mt-1 leading-5 text-zinc-300">
                  {formatKnowledgeCoverageDetail(
                    t('workspace.knowledge.extractionCacheLabel'),
                    props.extractionCacheOverview,
                  )}
                </p>
                <p className="mt-1 leading-5 text-zinc-400">{props.extractionCacheDeleteState.helperText}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="rounded-full border border-emerald-300/20 bg-shade/20 px-2.5 py-1 text-[10px] text-emerald-100/85">
                  {formatKnowledgeCoverageBadge(props.extractionCacheOverview)}
                </span>
                <button type="button" onClick={props.onToggleConfirmDeleteExtractionCache} disabled={props.extractionCacheDeleteState.disabled} data-testid="workspace-delete-extraction-cache" aria-label={t('workspace.knowledge.deleteExtractionCache')} className="min-h-11 rounded-full border border-emerald-400/20 bg-shade/20 px-3 py-1.5 text-[11px] text-emerald-100 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0">
                  {t('workspace.knowledge.deleteExtractionCache')}
                </button>
              </div>
            </div>
            <div className="mt-2 text-[10px] leading-4 text-zinc-400">
              {t('workspace.knowledge.extractionCacheAfterDeleteHint')}
            </div>
          </div>
          <div className="mt-3 rounded-2xl border border-amber-400/15 bg-amber-500/[0.06] px-3 py-3 text-xs text-zinc-300" data-testid="workspace-embedding-cache-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">{t('workspace.knowledge.rawEmbeddingCacheEyebrow')}</p>
                <p className="mt-1 leading-5 text-zinc-300">{redactUserFacingDiagnostic(props.rawTextEmbeddingStatusLine)}</p>
                <p className="mt-1 leading-5 text-zinc-400">{props.embeddingCacheDeleteState.helperText}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className="rounded-full border border-amber-300/20 bg-shade/20 px-2.5 py-1 text-[10px] text-amber-100/85">
                  {redactUserFacingDiagnostic(props.rawTextEmbeddingPhaseBadge)}
                </span>
                <button type="button" onClick={props.onToggleConfirmDeleteEmbeddingCache} disabled={props.embeddingCacheDeleteState.disabled} data-testid="workspace-delete-embedding-cache" aria-label={t('workspace.knowledge.deleteEmbeddingCache')} className="min-h-11 rounded-full border border-amber-400/20 bg-shade/20 px-3 py-1.5 text-[11px] text-amber-100 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0">
                  {t('workspace.knowledge.deleteEmbeddingCache')}
                </button>
              </div>
            </div>
            {props.rawTextEmbeddingActive ? (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] leading-4 text-zinc-400">
                {props.rawTextEmbeddingCacheHitRatePercent !== null ? (
                  <span>
                    {t('workspace.knowledge.cacheHitRate', {
                      value: `${props.rawTextEmbeddingCacheHitRatePercent}%`,
                    })}
                  </span>
                ) : null}
                {props.rawTextEmbeddingTimingLabel ? (
                  <span>
                    {t('workspace.knowledge.stepDuration', {
                      value: redactUserFacingDiagnostic(props.rawTextEmbeddingTimingLabel),
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {props.rawTextEmbeddingSettingsLine ? (
              <p className="mt-1 truncate text-[10px] leading-4 text-zinc-500">{redactUserFacingDiagnostic(props.rawTextEmbeddingSettingsLine)}</p>
            ) : null}
          </div>
          <div className="mt-3 rounded-2xl border border-rose-400/15 bg-rose-500/[0.06] px-3 py-3 text-xs text-zinc-300">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-rose-200/70">{t('workspace.knowledge.dangerZone')}</p>
                <p className="mt-1 leading-5 text-zinc-400">{t('workspace.knowledge.dangerZoneDescription')}</p>
              </div>
              <button type="button" onClick={props.onToggleConfirmDeleteKnowledge} disabled={props.knowledgeActionLoading === 'delete'} className="min-h-11 rounded-full border border-rose-400/20 bg-shade/20 px-3 py-1.5 text-[11px] text-rose-100 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0">
                {t('workspace.knowledge.deleteKnowledgeGraph')}
              </button>
            </div>
          </div>
          <p className="mt-3 rounded-2xl border border-line/8 bg-shade/20 px-3 py-2 text-xs leading-5 text-zinc-400">{t('workspace.knowledge.readonlyNotice')}</p>
        </div>
      ) : null}
      <ConfirmDialog open={props.confirmDeleteHanlpCache} onClose={props.onCancelDeleteHanlpCache} onConfirm={props.onDeleteHanlpCache} title={t('workspace.knowledge.confirmDeleteHanlpCache')} description={t('workspace.knowledge.confirmDeleteHanlpCacheDescription')} confirmLabel={props.knowledgeActionLoading === 'delete-hanlp-cache' ? t('workspace.knowledge.processing') : t('workspace.knowledge.confirmDeleteHanlpCache')} cancelLabel={t('workspace.knowledge.cancel')} busy={props.knowledgeActionLoading === 'delete-hanlp-cache'} />
      <ConfirmDialog open={props.confirmDeleteExtractionCache} onClose={props.onCancelDeleteExtractionCache} onConfirm={props.onDeleteExtractionCache} title={t('workspace.knowledge.confirmDeleteExtractionCache')} description={t('workspace.knowledge.confirmDeleteExtractionCacheDescription')} confirmLabel={props.knowledgeActionLoading === 'delete-extraction-cache' ? t('workspace.knowledge.processing') : t('workspace.knowledge.confirmDeleteExtractionCache')} cancelLabel={t('workspace.knowledge.cancel')} busy={props.knowledgeActionLoading === 'delete-extraction-cache'} />
      <ConfirmDialog open={props.confirmDeleteEmbeddingCache} onClose={props.onCancelDeleteEmbeddingCache} onConfirm={props.onDeleteEmbeddingCache} title={t('workspace.knowledge.confirmDeleteEmbeddingCache')} description={t('workspace.knowledge.confirmDeleteEmbeddingCacheDescription')} confirmLabel={props.knowledgeActionLoading === 'delete-embedding-cache' ? t('workspace.knowledge.processing') : t('workspace.knowledge.confirmDeleteEmbeddingCache')} cancelLabel={t('workspace.knowledge.cancel')} busy={props.knowledgeActionLoading === 'delete-embedding-cache'} />
      <ConfirmDialog open={props.confirmDeleteKnowledge} onClose={props.onCancelDeleteKnowledge} onConfirm={props.onDeleteKnowledgeGraph} title={t('workspace.knowledge.confirmDeleteKnowledgeGraph')} description={t('workspace.knowledge.confirmDeleteKnowledgeDescription')} confirmLabel={props.knowledgeActionLoading === 'delete' ? t('workspace.knowledge.processing') : t('workspace.knowledge.confirmDeleteKnowledgeGraph')} cancelLabel={t('workspace.knowledge.cancel')} busy={props.knowledgeActionLoading === 'delete'} />
    </div>
  )
}

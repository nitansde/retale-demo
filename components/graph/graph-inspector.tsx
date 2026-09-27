"use client"

import { useState, type ReactNode } from 'react'
import { Ban, Check, Pencil, Save, X } from 'lucide-react'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { GraphEdgeEditDraft, GraphNodeGenerationState, GraphSelection } from '@/components/graph/types'
import { graphEdgeLabel, graphStatusLabel } from '@/components/graph/graph-presentation'
import { useI18n } from '@/lib/i18n/provider'
import { INF_CHAPTER } from '@/lib/server/chapter-interval'

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-line/8 bg-shade/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{props.label}</p>
      <p className="mt-1 break-words text-sm text-zinc-200">{props.value}</p>
    </div>
  )
}

function buildEdgeEditDraft(edge: GraphEdge): GraphEdgeEditDraft {
  return {
    linkType: edge.linkType,
    label: edge.label ?? '',
    description: edge.description ?? '',
    polarity: edge.polarity ?? '',
    strength: edge.strength,
    validFromChapter: edge.validFromChapter,
    validUntilChapter: edge.validUntilChapter >= INF_CHAPTER ? '' : String(edge.validUntilChapter),
    includeByDefault: edge.includeInPrompt,
  }
}

const NODE_GENERATION_LABEL_KEYS = {
  included: 'graph.nodeGeneration.included',
  partial: 'graph.nodeGeneration.partial',
  excluded: 'graph.nodeGeneration.excluded',
  unavailable: 'graph.nodeGeneration.unavailable',
} as const

function NodeInspector(props: {
  node: GraphNode
  mode: 'selection' | 'browse-only'
  generationState?: GraphNodeGenerationState
  onToggleNodeExcluded?: (node: GraphNode, excluded: boolean) => void
}) {
  const { node } = props
  const { t } = useI18n()

  return (
    <>
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('graph.selectedNode')}</p>
      <h4 className="mt-2 text-lg font-semibold text-zinc-100">{node.label}</h4>
      <p className="mt-1 text-sm text-zinc-400">{node.description?.trim() || t('graph.nodeNoDescription')} </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label={t('graph.metric.type')} value={t(`graph.entity.${node.entityType}`)} />
        <Metric label={t('graph.metric.status')} value={graphStatusLabel(node.status?.trim() || 'active', t)} />
        <Metric label={t('graph.metric.confidence')} value={`${Math.round(node.confidence * 100)}%`} />
        <Metric label={t('graph.metric.importance')} value={String(node.importance)} />
        <Metric label={t('graph.metric.score')} value={node.score.toFixed(1)} />
        <Metric label={t('graph.metric.firstSeen')} value={node.firstSeenChapter ? t('graph.chapterOnly', { chapterNo: node.firstSeenChapter }) : t('graph.unknown')} />
        {props.generationState ? <Metric label={t('graph.metric.generation')} value={t(NODE_GENERATION_LABEL_KEYS[props.generationState.inclusionState])} /> : null}
        {props.generationState ? <Metric label={t('graph.metric.mappedEdges')} value={String(props.generationState.connectedEdgeIds.length)} /> : null}
      </div>

      {props.mode === 'selection' && props.generationState ? (
        <div className="mt-4 rounded-[20px] border border-amber-300/15 bg-amber-500/10 p-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={props.generationState.inclusionState === 'included' || props.generationState.inclusionState === 'unavailable'}
              onClick={() => props.onToggleNodeExcluded?.(node, false)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 transition hover:bg-emerald-500/16 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
               {t('graph.nodeReincludeEdges')}
            </button>
            <button
              type="button"
              disabled={props.generationState.inclusionState === 'excluded' || props.generationState.inclusionState === 'unavailable'}
              onClick={() => props.onToggleNodeExcluded?.(node, true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-overlay/[0.06] disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
               {t('graph.nodeExcludeEdges')}
            </button>
          </div>
          <p className="mt-3 text-xs leading-6 text-zinc-400">
            {t('graph.nodeSelectionHint', { label: node.label })}
          </p>
        </div>
      ) : null}
    </>
  )
}

function EdgeInspector(props: {
  edge: GraphEdge
  source?: GraphNode
  target?: GraphNode
  mode: 'selection' | 'browse-only'
  excluded: boolean
  mutationPending: boolean
  mutationError: string
  onConfirmEdge?: (edge: GraphEdge) => void
  onRejectEdge?: (edge: GraphEdge) => void
  onSaveEdgeEdit?: (edge: GraphEdge, draft: GraphEdgeEditDraft) => void
  onToggleEdgeExcluded?: (edge: GraphEdge, excluded: boolean) => void
}) {
  const { edge, source, target } = props
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<GraphEdgeEditDraft>(() => buildEdgeEditDraft(edge))

  return (
    <>
      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('graph.selectedEdge')}</p>
      <h4 className="mt-2 text-lg font-semibold text-zinc-100">{graphEdgeLabel(edge, t)}</h4>
      <p className="mt-1 text-sm text-zinc-400">
        {source?.label ?? edge.source} → {target?.label ?? edge.target}
      </p>
      <p className="mt-3 text-sm leading-6 text-zinc-300">{edge.description?.trim() || t('graph.edgeNoDescription')}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric label={t('graph.metric.status')} value={graphStatusLabel(edge.status, t)} />
        <Metric label={t('graph.metric.hop')} value={t('graph.hopCount', { count: edge.hop })} />
        <Metric label={t('graph.metric.confidence')} value={`${Math.round(edge.confidence * 100)}%`} />
        <Metric label={t('graph.metric.strength')} value={edge.strength.toFixed(1)} />
        <Metric label={t('graph.metric.validFrom')} value={t('graph.chapterOnly', { chapterNo: edge.validFromChapter })} />
        <Metric
          label={t('graph.metric.validUntil')}
          value={edge.validUntilChapter >= INF_CHAPTER ? t('graph.stillValid') : t('graph.validUntilChapter', { chapterNo: edge.validUntilChapter })}
        />
        <Metric label={t('graph.metric.prompt')} value={edge.includeInPrompt ? t('graph.promptIncluded') : t('graph.promptExcluded')} />
        {props.mode === 'selection' ? <Metric label={t('graph.metric.generation')} value={props.excluded ? t('graph.generationExcluded') : t('graph.generationIncluded')} /> : null}
      </div>

      {props.mode === 'selection' ? (
        <div className="mt-4 rounded-[20px] border border-amber-300/15 bg-amber-500/10 p-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={props.mutationPending}
              onClick={() => props.onConfirmEdge?.(edge)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 transition hover:bg-emerald-500/16 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
               {t('graph.confirmEdge')}
            </button>
            <button
              type="button"
              disabled={props.mutationPending}
              onClick={() => props.onRejectEdge?.(edge)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 transition hover:bg-rose-500/16 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
               {t('graph.rejectEdge')}
            </button>
            <button
              type="button"
              disabled={props.mutationPending}
              onClick={() => props.onToggleEdgeExcluded?.(edge, !props.excluded)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-overlay/[0.06] disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
               {props.excluded ? t('graph.includeThisRun') : t('graph.excludeThisRun')}
            </button>
            <button
              type="button"
              disabled={props.mutationPending}
              onClick={() => setEditing((current) => !current)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-overlay/[0.06] disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
               {editing ? t('graph.collapseEdgeEdit') : t('graph.expandEdgeEdit')}
            </button>
          </div>

          {props.mutationError ? <p className="mt-3 text-xs leading-6 text-rose-200">{props.mutationError}</p> : null}

          {editing ? (
            <div className="mt-3 grid gap-3 rounded-[18px] border border-line/8 bg-shade/20 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">{t('graph.edgeEdit.linkType')}</span>
                  <input
                    value={draft.linkType}
                    onChange={(event) => setDraft((current) => ({ ...current, linkType: event.target.value }))}
                    className="w-full rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">{t('graph.edgeEdit.label')}</span>
                  <input
                    value={draft.label}
                    onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                    className="w-full rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none"
                    placeholder={t('graph.edgeEdit.labelPlaceholder')}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">{t('graph.edgeEdit.description')}</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-[84px] w-full rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none"
                  placeholder={t('graph.edgeEdit.descriptionPlaceholder')}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                    <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">{t('graph.edgeEdit.polarity')}</span>
                  <select
                    value={draft.polarity}
                    onChange={(event) => setDraft((current) => ({ ...current, polarity: event.target.value as GraphEdgeEditDraft['polarity'] }))}
                    className="w-full rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none"
                  >
                      <option value="">{t('graph.edgeEdit.unset')}</option>
                    <option value="positive">{t('graph.polarity.positive')}</option>
                    <option value="negative">{t('graph.polarity.negative')}</option>
                    <option value="neutral">{t('graph.polarity.neutral')}</option>
                    <option value="mixed">{t('graph.polarity.mixed')}</option>
                  </select>
                </label>
                <label className="block">
                    <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">{t('graph.edgeEdit.strength')}</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={draft.strength}
                    onChange={(event) => setDraft((current) => ({ ...current, strength: Number(event.target.value || 1) }))}
                    className="w-full rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </label>
                <label className="block">
                    <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">{t('graph.edgeEdit.validFrom')}</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.validFromChapter}
                    onChange={(event) => setDraft((current) => ({ ...current, validFromChapter: Number(event.target.value || 1) }))}
                    className="w-full rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none"
                  />
                </label>
                <label className="block">
                    <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">{t('graph.edgeEdit.validUntil')}</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.validUntilChapter}
                    onChange={(event) => setDraft((current) => ({ ...current, validUntilChapter: event.target.value }))}
                    className="w-full rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100 outline-none"
                    placeholder={t('graph.edgeEdit.validUntilPlaceholder')}
                  />
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={draft.includeByDefault}
                  onChange={(event) => setDraft((current) => ({ ...current, includeByDefault: event.target.checked }))}
                  className="h-4 w-4 rounded border-line/20 bg-surface"
                />
                {t('graph.edgeEdit.includeByDefault')}
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={props.mutationPending || !draft.linkType.trim()}
                  onClick={() => props.onSaveEdgeEdit?.(edge, draft)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-300/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-100 transition hover:bg-sky-500/16 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                   {t('graph.edgeEdit.save')}
                </button>
                <button
                  type="button"
                  disabled={props.mutationPending}
                  onClick={() => {
                    setDraft(buildEdgeEditDraft(edge))
                    setEditing(false)
                  }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-overlay/[0.06] disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                   {t('graph.edgeEdit.cancel')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export function GraphInspector(props: {
  children?: ReactNode
  selection: GraphSelection
  nodeById: Map<string, GraphNode>
  nodeCount: number
  edgeCount: number
  warningCount: number
  graphEdges?: GraphEdge[]
  mode?: 'selection' | 'browse-only'
  modeLabel?: string
  excludedEdgeIds?: string[]
  edgeMutationPending?: boolean
  edgeMutationError?: string
  onConfirmEdge?: (edge: GraphEdge) => void
  onRejectEdge?: (edge: GraphEdge) => void
  onSaveEdgeEdit?: (edge: GraphEdge, draft: GraphEdgeEditDraft) => void
  onToggleEdgeExcluded?: (edge: GraphEdge, excluded: boolean) => void
  onToggleNodeExcluded?: (node: GraphNode, excluded: boolean) => void
  emptyStateCopy?: {
    eyebrow: string
    title: string
    description: string
  }
}) {
  const { t } = useI18n()
  const edge = props.selection?.type === 'edge' ? props.selection.edge : null
  const node = props.selection?.type === 'node' ? props.selection.node : null
  const mode = props.mode ?? 'browse-only'
  const nodeGenerationState = node && mode === 'selection'
    ? (() => {
        const connectedEdgeIds = (props.graphEdges ?? [])
          .filter((graphEdge) => graphEdge.source === node.id || graphEdge.target === node.id)
          .map((graphEdge) => graphEdge.id)

        if (!connectedEdgeIds.length) {
          return {
            connectedEdgeIds,
            inclusionState: 'unavailable',
          } satisfies GraphNodeGenerationState
        }

        const excludedCount = connectedEdgeIds.filter((edgeId) => props.excludedEdgeIds?.includes(edgeId)).length
        return {
          connectedEdgeIds,
          inclusionState:
            excludedCount === 0
              ? 'included'
              : excludedCount === connectedEdgeIds.length
                ? 'excluded'
                : 'partial',
        } satisfies GraphNodeGenerationState
      })()
    : undefined
  const emptyStateCopy = props.emptyStateCopy ?? {
    eyebrow: t('graph.inspector'),
    title: t('graph.inspectorOverviewTitle'),
    description: t('graph.inspectorOverviewDescription'),
  }

  return (
    <aside className="min-w-0 break-words rounded-[24px] border border-line/8 bg-shade/20 p-4">
      {node ? <NodeInspector node={node} mode={mode} generationState={nodeGenerationState} onToggleNodeExcluded={props.onToggleNodeExcluded} /> : null}
      {edge ? (
        <EdgeInspector
          key={edge.id}
          edge={edge}
          source={props.nodeById.get(edge.source)}
          target={props.nodeById.get(edge.target)}
          mode={mode}
          excluded={Boolean(props.excludedEdgeIds?.includes(edge.id))}
          mutationPending={Boolean(props.edgeMutationPending)}
          mutationError={props.edgeMutationError ?? ''}
          onConfirmEdge={props.onConfirmEdge}
          onRejectEdge={props.onRejectEdge}
          onSaveEdgeEdit={props.onSaveEdgeEdit}
          onToggleEdgeExcluded={props.onToggleEdgeExcluded}
        />
      ) : null}
      {!props.selection ? (
        <>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{emptyStateCopy.eyebrow}</p>
          <h4 className="mt-2 text-lg font-semibold text-zinc-100">{emptyStateCopy.title}</h4>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{emptyStateCopy.description}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label={t('graph.metric.nodes')} value={String(props.nodeCount)} />
            <Metric label={t('graph.metric.edges')} value={String(props.edgeCount)} />
            <Metric label={t('graph.metric.warnings')} value={String(props.warningCount)} />
            <Metric label={t('graph.metric.mode')} value={props.modeLabel ?? t('graph.readOnlyMode')} />
          </div>
        </>
      ) : null}
      {props.selection ? props.children : null}
    </aside>
  )
}

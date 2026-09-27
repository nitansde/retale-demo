import type { GraphEdgeEditDraft, GenerationContextBuildData, GenerationContextEvidence, GraphReviewControls, GraphSelection } from '@/components/graph/types'
import { RefreshCcw } from 'lucide-react'
import { AdvancedContextPromptPanel } from '@/components/graph/advanced-context-prompt-panel'
import { GraphSelectionEvidence } from '@/components/graph/graph-selection-evidence'
import { GraphExplorer } from '@/components/graph/graph-explorer'
import { GraphInspector } from '@/components/graph/graph-inspector'
import { useI18n } from '@/lib/i18n/provider'
import { formatContextWarning, isUserFacingContextWarning } from '@/lib/context-warnings'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'

export function GraphReviewPanel(props: {
  context: GenerationContextBuildData
  showSelectedLines?: boolean
  graphNodes: GraphNode[]
  graphEdges: GraphEdge[]
  controls: GraphReviewControls
  loading: boolean
  error: string
  selection: GraphSelection
  disabledBlockIds: string[]
  excludedEdgeIds: string[]
  excludedEvidenceIds: string[]
  edgeMutationPending: boolean
  edgeMutationError: string
  onTogglePromptBlock: (blockId: string, enabled: boolean) => void
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  onClearSelection: () => void
  onConfirmEdge: (edge: GraphEdge) => void
  onRejectEdge: (edge: GraphEdge) => void
  onSaveEdgeEdit: (edge: GraphEdge, draft: GraphEdgeEditDraft) => void
  onToggleEdgeExcluded: (edge: GraphEdge, excluded: boolean) => void
  onToggleNodeExcluded: (node: GraphNode, excluded: boolean) => void
  onToggleEvidenceExcluded: (itemId: string, excluded: boolean) => void
  onChangeControls: (controls: GraphReviewControls) => void
  onJumpToEdgeSource: (edge: GraphEdge) => void
  canJumpToEdgeSource: (edge: GraphEdge) => boolean
  onJumpToEvidenceSource: (item: GenerationContextEvidence) => void
  canJumpToEvidenceSource: (item: GenerationContextEvidence) => boolean
  onRefresh: () => void
}) {
  const { locale, t } = useI18n()
  const nodeById = new Map(props.graphNodes.map((node) => [node.id, node] as const))
  const visiblePromptBlocks = props.context.promptBlocks
  const visibleWarnings = props.context.warnings.filter(isUserFacingContextWarning)

  return (
    <section className="mb-4 min-w-0 rounded-2xl border border-line/10 bg-surface p-3 sm:rounded-3xl sm:p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">{t('graph.reviewEyebrow')}</p>
          <p className="mt-1 text-sm text-zinc-300">{t('graph.reviewDescription')}</p>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loading}
          className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300 transition hover:bg-overlay/[0.06]"
        >
          <RefreshCcw className="h-4 w-4" />
          {t('graph.refreshContext')}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-zinc-400">
        <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1">{t('graph.chapterOnly', { chapterNo: props.context.chapterNo })}</span>
        {props.context.sourceMeta?.mode === 'inherited-parent' ? (
          <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-3 py-1 text-fuchsia-100">
            {t('graph.inheritedFromMainline', { chapterNo: props.context.sourceMeta.chapterNo })}
          </span>
        ) : null}
        {props.showSelectedLines !== false && props.context.selectedLineStart != null && props.context.selectedLineEnd != null ? (
          <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1">{t('graph.selectedLines', { start: props.context.selectedLineStart, end: props.context.selectedLineEnd })}</span>
        ) : null}
        <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1">{t('graph.promptApproxTokens', { count: props.context.tokenEstimate })}</span>
      </div>

      {visibleWarnings.length ? (
        <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {visibleWarnings.map((warning) => (
            <p key={warning}>{formatContextWarning(warning, locale)}</p>
          ))}
        </div>
      ) : null}

      {props.error ? <p className="mb-4 text-sm text-rose-300">{props.error}</p> : null}

      <GraphExplorer
          nodes={props.graphNodes}
          edges={props.graphEdges}
          seedNodeIds={props.context.graphContext.seedEntities.map((node) => node.id)}
          controls={props.controls}
          loading={props.loading}
          onSelectNode={props.onSelectNode}
          onSelectEdge={props.onSelectEdge}
          onClearSelection={props.onClearSelection}
          onChangeControls={props.onChangeControls}
          selection={props.selection}
        >
        <GraphInspector
          selection={props.selection}
          nodeById={nodeById}
          nodeCount={props.graphNodes.length}
          edgeCount={props.graphEdges.length}
          warningCount={visibleWarnings.length}
          graphEdges={props.graphEdges}
          mode="selection"
          modeLabel={t('graph.selectionReviewMode')}
          excludedEdgeIds={props.excludedEdgeIds}
          edgeMutationPending={props.edgeMutationPending}
          edgeMutationError={props.edgeMutationError}
          onConfirmEdge={props.onConfirmEdge}
          onRejectEdge={props.onRejectEdge}
          onSaveEdgeEdit={props.onSaveEdgeEdit}
          onToggleEdgeExcluded={props.onToggleEdgeExcluded}
          onToggleNodeExcluded={props.onToggleNodeExcluded}
        >
          <GraphSelectionEvidence selection={props.selection} edges={props.graphEdges} nodeById={nodeById} evidence={props.context.lanceEvidence}
            excludedEvidenceIds={props.excludedEvidenceIds} onToggleEvidenceExcluded={(item, excluded) => props.onToggleEvidenceExcluded(item.id, excluded)}
            canJumpToEdgeSource={props.canJumpToEdgeSource} onJumpToEdgeSource={props.onJumpToEdgeSource}
            canJumpToEvidenceSource={props.canJumpToEvidenceSource} onJumpToEvidenceSource={props.onJumpToEvidenceSource} />
        </GraphInspector>
      </GraphExplorer>

      <div className="mt-4 space-y-4">
        <AdvancedContextPromptPanel
          blocks={visiblePromptBlocks}
          requestMessages={props.context.requestMessages}
          loading={props.loading}
          disabledBlockIds={props.disabledBlockIds}
          onToggle={props.onTogglePromptBlock}
        />
      </div>
    </section>
  )
}

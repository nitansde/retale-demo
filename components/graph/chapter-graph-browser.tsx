"use client"

import { useMemo } from 'react'
import { AlertTriangle, GitBranch, Network, RefreshCcw } from 'lucide-react'
import { GraphSelectionEvidence } from '@/components/graph/graph-selection-evidence'
import { GraphExplorer } from '@/components/graph/graph-explorer'
import { GraphInspector } from '@/components/graph/graph-inspector'
import type { ChapterGraphContextData, GraphContextSourceMeta, GraphReviewControls, GraphSelection } from '@/components/graph/types'
import { useI18n } from '@/lib/i18n/provider'
import { formatContextWarning } from '@/lib/context-warnings'
import { cn } from '@/lib/utils'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { Chapter } from '@/lib/types'

export function ChapterGraphBrowser(props: {
  chapter: Chapter
  parentChapter: Chapter | null
  data: ChapterGraphContextData | null
  sourceMeta?: GraphContextSourceMeta
  controls: GraphReviewControls
  selection: GraphSelection
  loading: boolean
  error: string
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  onClearSelection: () => void
  onChangeControls: (controls: GraphReviewControls) => void
  onRefresh: () => void
  onJumpToParent?: () => void
  onJumpToEdgeSource?: (edge: GraphEdge) => void
  canJumpToEdgeSource?: (edge: GraphEdge) => boolean
  onJumpToEvidenceSource?: (item: ChapterGraphContextData['lanceEvidence'][number]) => void
  canJumpToEvidenceSource?: (item: ChapterGraphContextData['lanceEvidence'][number]) => boolean
}) {
  const { locale, t } = useI18n()
  const graph = props.data?.graphContext ?? null
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.id, node] as const)), [graph?.nodes])
  const sourceMeta = props.data?.sourceMeta ?? props.sourceMeta
  const inherited = sourceMeta?.mode === 'inherited-parent'
  const warnings = (props.data?.warnings ?? graph?.warnings ?? []).map((warning) => formatContextWarning(warning, locale))

  return (
    <div className="min-w-0 space-y-4 px-3 py-4 sm:px-6 sm:py-5" data-testid="chapter-graph-browser">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sky-200"><Network className="h-4 w-4" /><p className="text-sm font-medium">{t('graph.chapterBrowserEyebrow')}</p></div>
          <h3 className="mt-2 break-words text-lg font-semibold text-zinc-100">{t('graph.chapterTitle', { chapterNo: props.chapter.order, title: props.chapter.title })}</h3>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{t('graph.chapterBrowserDescription')}</p>
        </div>
        <button type="button" onClick={props.onRefresh} disabled={props.loading} aria-label={t('graph.refresh')} title={t('graph.refresh')} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line/10 bg-overlay/[0.03] text-zinc-300 transition hover:bg-overlay/[0.08] disabled:opacity-50">
          <RefreshCcw className={cn('h-4 w-4', props.loading && 'animate-spin')} />
        </button>
      </header>

      {inherited ? <section className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/8 p-3">
        <p className="flex min-w-0 items-start gap-2 text-sm leading-6 text-zinc-300"><GitBranch className="mt-1 h-4 w-4 shrink-0 text-fuchsia-200" />{t('graph.branchInheritsParentDescription', { chapterNo: sourceMeta.chapterNo, chapterTitle: sourceMeta.chapterTitle })}</p>
        {props.parentChapter ? <button type="button" onClick={props.onJumpToParent} className="min-h-11 rounded-xl px-3 text-sm text-fuchsia-100 hover:bg-overlay/[0.05]">{t('graph.jumpToParent')}</button> : null}
      </section> : null}
      {warnings.length ? <details className="rounded-2xl border border-amber-400/20 bg-amber-500/8 p-3">
        <summary className="min-h-8 cursor-pointer text-sm text-amber-100"><AlertTriangle className="mr-2 inline h-4 w-4" />{t('graph.warnings')} · {warnings.length}</summary>
        <div className="mt-2 space-y-2">{warnings.map((warning) => <p key={warning} className="break-words text-sm leading-6 text-amber-100/90">{warning}</p>)}</div>
      </details> : null}
      {props.error && !props.loading ? <p role="alert" className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm leading-6 text-rose-100">{props.error}</p> : null}
      {props.loading && !props.data ? <p role="status" className="rounded-2xl border border-line/10 p-6 text-sm text-zinc-400">{t('graph.loading')}</p> : null}
      {!props.loading && graph && !graph.nodes.length ? <div className="rounded-3xl border border-dashed border-line/10 bg-surface px-5 py-10 text-center">
        <Network className="mx-auto h-8 w-8 text-sky-300" />
        <h3 className="mt-4 text-lg font-medium text-zinc-100">{t('graph.emptyTitle')}</h3>
        <p className="mt-3 text-sm leading-7 text-zinc-400">{t('graph.emptyDescription', { chapterLabel: t('graph.chapterOnly', { chapterNo: props.chapter.order }) })}</p>
      </div> : null}
      {graph?.nodes.length ? <GraphExplorer
        nodes={graph.nodes} edges={graph.edges} seedNodeIds={graph.seedEntities.map((node) => node.id)}
        selection={props.selection} controls={props.controls} loading={props.loading}
        onSelectNode={props.onSelectNode} onSelectEdge={props.onSelectEdge} onClearSelection={props.onClearSelection} onChangeControls={props.onChangeControls}
      >
        <GraphInspector selection={props.selection} nodeById={nodeById} nodeCount={graph.nodes.length} edgeCount={graph.edges.length} warningCount={warnings.length} modeLabel={t('graph.browseOnly')} emptyStateCopy={{ eyebrow: t('graph.browserInspectorEyebrow'), title: t('graph.browserInspectorTitle'), description: t('graph.browserInspectorDescription') }}>
          <GraphSelectionEvidence selection={props.selection} edges={graph.edges} nodeById={nodeById} evidence={props.data?.lanceEvidence ?? []}
            canJumpToEdgeSource={props.canJumpToEdgeSource} onJumpToEdgeSource={props.onJumpToEdgeSource}
            canJumpToEvidenceSource={props.canJumpToEvidenceSource} onJumpToEvidenceSource={props.onJumpToEvidenceSource} />
        </GraphInspector>
      </GraphExplorer> : null}

    </div>
  )
}

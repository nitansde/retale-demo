"use client"

import { useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowRight, ChevronRight, List, Network, Search, SlidersHorizontal } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { GraphFlowCanvas } from '@/components/graph/graph-flow-canvas'
import { filterGraph, graphEdgeLabel, graphStatusLabel } from '@/components/graph/graph-presentation'
import type { GraphReviewControls, GraphSelection } from '@/components/graph/types'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

const desktopQuery = '(min-width: 1024px)'
function subscribeLayout(callback: () => void) {
  const query = window.matchMedia(desktopQuery)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}
const desktopSnapshot = () => window.matchMedia(desktopQuery).matches
const serverSnapshot = () => false

export function GraphExplorer(props: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  seedNodeIds: string[]
  controls: GraphReviewControls
  selection: GraphSelection
  loading: boolean
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  onClearSelection: () => void
  onChangeControls: (controls: GraphReviewControls) => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const desktop = useSyncExternalStore(subscribeLayout, desktopSnapshot, serverSnapshot)
  const [chosenView, setChosenView] = useState<'list' | 'map' | null>(null)
  const view = chosenView ?? (desktop ? 'map' : 'list')
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  // Inspecting an edge should not change the entity whose relationships are listed.
  const [listNodeId, setListNodeId] = useState<string | null>(() => props.selection?.type === 'node'
    ? props.selection.node.id
    : props.seedNodeIds[0] ?? props.nodes[0]?.id ?? null)
  const detailsRef = useRef<HTMLDivElement>(null)
  const filtersId = useId()
  const graph = useMemo(() => filterGraph(props.nodes, props.edges, props.seedNodeIds, props.controls, query, t), [props.nodes, props.edges, props.seedNodeIds, props.controls, query, t])
  const nodeById = useMemo(() => new Map(props.nodes.map((node) => [node.id, node])), [props.nodes])
  const seedIds = useMemo(() => new Set(props.seedNodeIds), [props.seedNodeIds])
  const listNode = listNodeId === null ? null : nodeById.get(listNodeId) ?? graph.nodes[0] ?? null
  const listEdges = listNode ? graph.edges.filter((edge) => edge.source === listNode.id || edge.target === listNode.id) : graph.edges
  const activeFilters = Number(props.controls.hideLowConfidence) + Number(props.controls.confirmedOnly) + Number(!props.controls.showPotentiallyStale)

  function showDetails() {
    if (!desktop) setDetailsOpen(true)
    else requestAnimationFrame(() => {
      const details = detailsRef.current
      if (details && details.getBoundingClientRect().top > window.innerHeight * 0.8) details.scrollIntoView({ block: 'nearest' })
    })
  }

  const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm transition focus-visible:outline-2 focus-visible:outline-sky-400'
  return (
    <div data-testid="graph-explorer" className="grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.85fr)]">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-line/10 bg-surface sm:rounded-3xl" aria-label={t('graph.chapterBrowserEyebrow')}>
        <div className="space-y-3 border-b border-line/8 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <div role="group" aria-label={t('graph.view.label')} className="inline-flex rounded-2xl bg-shade/25 p-1">
              {(['list', 'map'] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={view === mode} onClick={() => { setChosenView(mode); if (!desktop) setFiltersOpen(false) }} className={cn(buttonClass, view === mode ? 'bg-overlay/10 text-zinc-100 shadow-sm' : 'text-zinc-400 hover:text-zinc-200')}>
                  {mode === 'list' ? <List className="h-4 w-4" /> : <Network className="h-4 w-4" />}
                  {t(`graph.view.${mode}`)}
                </button>
              ))}
            </div>
            <button type="button" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(!filtersOpen)} className={cn(buttonClass, 'border border-line/10', activeFilters ? 'text-sky-200' : 'text-zinc-400')}>
              <SlidersHorizontal className="h-4 w-4" />{t('graph.filters')}
              {activeFilters > 0 ? <span className="rounded-full bg-sky-500/15 px-1.5 text-xs">{activeFilters}</span> : null}
            </button>
          </div>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zinc-500" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('graph.search')} placeholder={t('graph.search')} className="h-11 w-full min-w-0 rounded-xl border border-line/10 bg-shade/15 pl-9 pr-3 text-base text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-sky-400/50 sm:text-sm" />
          </div>
          {filtersOpen ? (
            <div id={filtersId} className="space-y-2 rounded-2xl border border-line/8 bg-shade/15 p-3">
              <div className="grid grid-cols-2 gap-2">
                {([1, 2] as const).map((hops) => <button key={hops} type="button" aria-pressed={props.controls.maxHops === hops} onClick={() => props.onChangeControls({ ...props.controls, maxHops: hops })} className={cn(buttonClass, 'border', props.controls.maxHops === hops ? 'border-sky-300/25 bg-sky-500/10 text-sky-100' : 'border-line/10 text-zinc-400')}>{t(hops === 1 ? 'graph.direct' : 'graph.extended')}</button>)}
              </div>
              {(['hideLowConfidence', 'confirmedOnly', 'showPotentiallyStale'] as const).map((key) => (
                <label key={key} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-zinc-300">
                  {t(`graph.controls.${key}`)}
                  <input type="checkbox" checked={props.controls[key]} onChange={(event) => props.onChangeControls({ ...props.controls, [key]: event.target.checked })} className="h-5 w-5 shrink-0 accent-sky-500" />
                </label>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500" aria-live="polite" role="status">
            <span>{props.loading ? t('graph.refreshing') : t('graph.statusCounts', { nodes: graph.nodes.length, edges: view === 'list' ? listEdges.length : graph.edges.length })}</span>
            <span>{t(props.controls.maxHops === 1 ? 'graph.direct' : 'graph.extended')}</span>
          </div>
        </div>
        {!graph.nodes.length ? (
          <div className="px-5 py-12 text-center">
            <Search className="mx-auto h-6 w-6 text-zinc-500" />
            <h4 className="mt-3 text-sm font-medium text-zinc-200">{t('graph.noMatches')}</h4>
            <p className="mt-2 text-sm text-zinc-400">{t('graph.noMatchesHint')}</p>
            <button type="button" onClick={() => { setQuery(''); props.onChangeControls({ maxHops: 2, hideLowConfidence: false, confirmedOnly: false, showPotentiallyStale: true }) }} className={cn(buttonClass, 'mt-3 text-sky-200')}>{t('graph.resetFilters')}</button>
          </div>
        ) : view === 'map' ? (
          <GraphFlowCanvas nodes={graph.nodes} edges={graph.edges} seedNodeIds={props.seedNodeIds} selection={props.selection} onSelectNode={(node) => { setListNodeId(node.id); props.onSelectNode(node); showDetails() }} onSelectEdge={(edge) => { props.onSelectEdge(edge); showDetails() }} onClearSelection={() => { setListNodeId(null); props.onClearSelection() }} />
        ) : (
          <div data-testid="graph-list" className="max-h-[62svh] space-y-5 overflow-y-auto p-3 sm:p-4 lg:max-h-[540px]">
            <div>
              <h4 className="mb-2 text-xs font-medium text-zinc-400">{t('graph.entities')}</h4>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={!listNode} onClick={() => { setListNodeId(null); props.onClearSelection() }} className={cn(buttonClass, 'border border-line/10 text-zinc-300', !listNode && 'bg-sky-500/10 ring-1 ring-sky-400/60')}>
                  {t('graph.allRelationships')}
                </button>
                {graph.nodes.map((node) => (
                  <button key={node.id} type="button" onClick={() => { setListNodeId(node.id); props.onSelectNode(node) }} aria-pressed={listNode?.id === node.id} className={cn('flex min-h-11 max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-sky-400', seedIds.has(node.id) ? 'border-amber-300/20 bg-amber-500/8' : 'border-line/10 bg-overlay/[0.02]', listNode?.id === node.id && 'ring-1 ring-sky-400/60')}>
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', seedIds.has(node.id) ? 'bg-amber-300' : 'bg-sky-300')} />
                    <span className="min-w-0 break-words text-sm text-zinc-100">{node.label}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{t(`graph.entity.${node.entityType}`)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="min-w-0 break-words text-xs font-medium leading-5 text-zinc-400" aria-live="polite">{listNode ? t('graph.entityRelationships', { name: listNode.label, count: listEdges.length }) : t('graph.relationships')}</h4>
                {listNode ? <button type="button" onClick={() => { props.onSelectNode(listNode); showDetails() }} className={cn(buttonClass, 'shrink-0 px-2 text-xs text-sky-200')}>{t('graph.viewEntityDetails')}</button> : null}
              </div>
              <div className="space-y-2">
                {listEdges.map((edge) => (
                  <button key={edge.id} type="button" data-testid="graph-relation-card" onClick={() => { props.onSelectEdge(edge); showDetails() }} aria-pressed={props.selection?.type === 'edge' && props.selection.edge.id === edge.id} className={cn('group w-full rounded-2xl border bg-overlay/[0.02] p-3 text-left transition hover:bg-overlay/[0.05] focus-visible:outline-2 focus-visible:outline-sky-400', props.selection?.type === 'edge' && props.selection.edge.id === edge.id ? 'border-sky-300/40' : 'border-line/10')}>
                    <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                      <span className="min-w-0 flex-1 break-words">{nodeById.get(edge.source)?.label ?? edge.source}</span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
                      <span className="min-w-0 flex-1 break-words">{nodeById.get(edge.target)?.label ?? edge.target}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="rounded-md bg-sky-500/10 px-2 py-1 text-sky-200">{graphEdgeLabel(edge, t)}</span>
                      <span className="text-zinc-400">{graphStatusLabel(edge.status, t)}</span>
                      <span className="text-zinc-500">{t('graph.confidence', { value: Math.round(edge.confidence * 100) })}</span>
                    </span>
                    {edge.description ? <span className="mt-2 line-clamp-2 block break-words text-sm leading-6 text-zinc-400">{edge.description}</span> : null}
                  </button>
                ))}
                {!listEdges.length ? <p className="rounded-2xl border border-dashed border-line/10 p-4 text-sm leading-6 text-zinc-400">{listNode ? t('graph.noEntityRelationships', { name: listNode.label }) : t('graph.noRelationships')}</p> : null}
              </div>
            </div>
          </div>
        )}
        <p className="border-t border-line/8 px-4 py-3 text-xs leading-5 text-zinc-500">{t(view === 'list' ? 'graph.listHint' : 'graph.mapHint')}</p>
      </section>
      {desktop ? <div ref={detailsRef} className="min-w-0 space-y-3">{props.children}</div> : null}
      <DialogSurface open={detailsOpen && !desktop && Boolean(props.selection)} onClose={() => setDetailsOpen(false)} title={t('graph.details')} closeLabel={t('graph.closeDetails')} placement="bottom" className="max-h-[88dvh] px-3 pt-3" contentClassName="mt-3 space-y-3">
        {props.children}
      </DialogSurface>
    </div>
  )
}

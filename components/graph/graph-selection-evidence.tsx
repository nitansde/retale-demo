import { ArrowUpRight, Ban, Quote } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { GenerationContextEvidence, GraphSelection } from '@/components/graph/types'

// Use source identities, not shared chapter numbers or name matches, to associate evidence.
export function getSelectionEvidence(selection: GraphSelection, edges: GraphEdge[], evidence: GenerationContextEvidence[]) {
  if (!selection) return []
  const relatedEdges = selection.type === 'edge'
    ? [selection.edge]
    : edges.filter((edge) => edge.source === selection.node.id || edge.target === selection.node.id)
  const edgeById = new Map(relatedEdges.map((edge) => [edge.id, edge]))
  const relatedItems = evidence.filter((item) =>
    (item.sourceType === 'relationship' && edgeById.has(item.sourceId))
    || (selection.type === 'node' && item.sourceType === 'entity_profile'
      && (item.sourceId === selection.node.id || item.id.startsWith(`entity-profile:${selection.node.id}:`))))
  const quotedEdges = relatedEdges.filter((edge) => edge.evidenceQuote?.trim() || edge.evidenceLocation)
  const quotedIds = new Set(quotedEdges.map((edge) => edge.id))
  return [
    ...quotedEdges.map((edge) => {
      const item = relatedItems.find((item) => item.sourceType === 'relationship' && item.sourceId === edge.id)
      return {
        id: `edge:${edge.id}`, edge, item,
        text: edge.evidenceQuote?.trim() || item?.text || '',
        location: edge.evidenceLocation,
        quote: Boolean(edge.evidenceQuote?.trim()),
      }
    }),
    ...relatedItems.filter((item) => item.sourceType !== 'relationship' || !quotedIds.has(item.sourceId)).map((item) => ({
      id: item.id,
      edge: item.sourceType === 'relationship' ? edgeById.get(item.sourceId) : undefined,
      item, text: item.text,
      location: { chapterNo: item.chapterNo, lineStart: item.lineStart ?? undefined, lineEnd: item.lineEnd ?? undefined },
      quote: false,
    })),
  ]
}

export function GraphSelectionEvidence(props: {
  selection: GraphSelection
  edges: GraphEdge[]
  nodeById: Map<string, GraphNode>
  evidence: GenerationContextEvidence[]
  excludedEvidenceIds?: string[]
  onToggleEvidenceExcluded?: (item: GenerationContextEvidence, excluded: boolean) => void
  canJumpToEdgeSource?: (edge: GraphEdge) => boolean
  onJumpToEdgeSource?: (edge: GraphEdge) => void
  canJumpToEvidenceSource?: (item: GenerationContextEvidence) => boolean
  onJumpToEvidenceSource?: (item: GenerationContextEvidence) => void
}) {
  const { t } = useI18n()
  if (!props.selection) return null
  const entries = getSelectionEvidence(props.selection, props.edges, props.evidence)

  function formatLocation(location: typeof entries[number]['location']) {
    if (!location || location.chapterNo < 1) return null
    if (location.lineStart && location.lineStart > 0 && location.lineEnd && location.lineEnd > 0) return t('graph.chapterLineRange', { chapterNo: location.chapterNo, start: location.lineStart, end: location.lineEnd })
    if (location.lineStart && location.lineStart > 0) return t('graph.chapterLineSingle', { chapterNo: location.chapterNo, line: location.lineStart })
    return t('graph.chapterOnly', { chapterNo: location.chapterNo })
  }

  return (
    <section data-testid="graph-selection-evidence" className="mt-5 border-t border-line/10 pt-4">
      <h5 className="flex items-center gap-2 text-sm font-medium text-zinc-200"><Quote className="h-4 w-4 text-sky-300" />{t('graph.supportingEvidence')}</h5>
      {entries.length ? <div className="mt-3 space-y-4">
        {entries.map(({ id, edge, item, text, location, quote }) => {
          const excluded = Boolean(item && props.excludedEvidenceIds?.includes(item.id))
          const jump = edge && (quote || !item) && props.canJumpToEdgeSource?.(edge)
            ? () => props.onJumpToEdgeSource?.(edge)
            : item && props.canJumpToEvidenceSource?.(item)
              ? () => props.onJumpToEvidenceSource?.(item)
              : undefined
          const locationLabel = formatLocation(location)
          return <article key={id} className="min-w-0 break-words">
            {props.selection?.type === 'node' && edge ? <p className="mb-2 text-xs text-zinc-400">{props.nodeById.get(edge.source)?.label ?? edge.source} → {props.nodeById.get(edge.target)?.label ?? edge.target}</p> : null}
            {item && !quote ? <p className="mb-2 text-xs text-zinc-500">{t(`graph.source.${item.sourceType}`)}{item.title ? ` · ${item.title}` : ''}</p> : null}
            <div className={cn('border-l-2 pl-3 text-sm leading-6', excluded ? 'border-amber-300/40 text-zinc-500' : 'border-sky-300/40 text-zinc-300')}>
              {quote && text ? <blockquote className="whitespace-pre-wrap">{text}</blockquote> : <p className="whitespace-pre-wrap">{text || t('graph.edgeNoQuote')}</p>}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {locationLabel ? <p className="text-xs text-zinc-500">{locationLabel}</p> : null}
              <div className="flex flex-wrap gap-2">
                {jump ? <button type="button" onClick={jump} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-sky-200 hover:bg-sky-500/10"><ArrowUpRight className="h-3.5 w-3.5" />{t('graph.jumpToSource')}</button> : null}
                {item && props.onToggleEvidenceExcluded ? <button type="button" onClick={() => props.onToggleEvidenceExcluded?.(item, !excluded)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-zinc-400 hover:bg-overlay/[0.05]"><Ban className="h-3.5 w-3.5" />{excluded ? t('graph.includeThisRun') : t('graph.excludeThisRun')}</button> : null}
              </div>
            </div>
          </article>
        })}
      </div> : <p className="mt-3 text-sm leading-6 text-zinc-500">{t('graph.selectionEvidenceEmpty')}</p>}
    </section>
  )
}

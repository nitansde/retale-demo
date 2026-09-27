import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { GraphReviewControls } from '@/components/graph/types'
import type { TranslationKey, TranslationValues } from '@/lib/i18n/messages'

type Translate = (key: TranslationKey, values?: TranslationValues) => string

const statusKeys: Record<string, TranslationKey> = {
  active: 'graph.status.active', inactive: 'graph.status.inactive', alive: 'graph.status.alive', dead: 'graph.status.dead', unknown: 'graph.status.unknown',
  ai_generated: 'graph.status.aiGenerated', user_confirmed: 'graph.status.userConfirmed', rejected: 'graph.status.rejected',
  outdated: 'graph.status.outdated', conflicted: 'graph.status.conflicted', potentially_stale: 'graph.status.potentiallyStale',
}
const linkKeys: Record<string, TranslationKey> = {
  relation: 'graph.link.relationship', relationship: 'graph.link.relationship', related: 'graph.link.relationship',
  friend: 'graph.link.friend', ally: 'graph.link.ally', enemy: 'graph.link.enemy',
  member_of: 'graph.link.member_of', located_in: 'graph.link.located_in', owns: 'graph.link.owns',
}
export function graphStatusLabel(status: string, t: Translate) {
  return Object.hasOwn(statusKeys, status) ? t(statusKeys[status]) : status
}
export function graphEdgeLabel(edge: GraphEdge, t: Translate) {
  const label = edge.label?.trim() || edge.linkType
  return Object.hasOwn(linkKeys, label) ? t(linkKeys[label]) : label
}

export function filterGraph(nodes: GraphNode[], edges: GraphEdge[], seedNodeIds: string[], controls: GraphReviewControls, query: string, t: Translate) {
  const seedIds = new Set(seedNodeIds)
  const eligibleNodes = nodes.filter((node) => !controls.confirmedOnly || node.userConfirmed || seedIds.has(node.id))
  const eligibleIds = new Set(eligibleNodes.map((node) => node.id))
  const eligibleEdges = edges.filter((edge) => eligibleIds.has(edge.source) && eligibleIds.has(edge.target)
    && edge.hop <= controls.maxHops
    && (!controls.hideLowConfidence || edge.confidence >= 0.5)
    && (!controls.confirmedOnly || edge.status === 'user_confirmed')
    && (controls.showPotentiallyStale || edge.status !== 'potentially_stale'))
  // Keep truly isolated entities browsable, without bringing back endpoints hidden by filters.
  const connectedIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
  const visibleIds = new Set([...seedIds, ...eligibleNodes.filter((node) => !connectedIds.has(node.id)).map((node) => node.id), ...eligibleEdges.flatMap((edge) => [edge.source, edge.target])])
  const availableNodes = eligibleNodes.filter((node) => visibleIds.has(node.id))
  const search = query.trim().toLocaleLowerCase()
  if (!search) return { nodes: availableNodes, edges: eligibleEdges }
  const matchingIds = new Set(availableNodes.filter((node) => [node.label, node.description, ...(node.aliases ?? []), t(`graph.entity.${node.entityType}`)].join(' ').toLocaleLowerCase().includes(search)).map((node) => node.id))
  const matchingEdges = eligibleEdges.filter((edge) => matchingIds.has(edge.source) || matchingIds.has(edge.target)
    || `${graphEdgeLabel(edge, t)} ${edge.description ?? ''}`.toLocaleLowerCase().includes(search))
  const resultIds = new Set([...matchingIds, ...matchingEdges.flatMap((edge) => [edge.source, edge.target])])
  return { nodes: availableNodes.filter((node) => resultIds.has(node.id)), edges: matchingEdges }
}

"use client"

import '@xyflow/react/dist/style.css'
import { useEffect, useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { useI18n } from '@/lib/i18n/provider'
import { useThemePreferences } from '@/components/ThemePreferencesProvider'
import { graphEdgeLabel } from '@/components/graph/graph-presentation'
import type { GraphEdge, GraphNode } from '@/lib/server/graph-types'
import type { GraphSelection } from '@/components/graph/types'

const LOW_CONFIDENCE_THRESHOLD = 0.5
const NODE_WIDTH = 252
const NODE_MIN_HEIGHT = 96
const COLUMN_X = [40, 356, 672]
const ROW_Y_START = 52
const ROW_GAP = 152

function getNodeHop(nodeId: string, seedIds: Set<string>, edges: GraphEdge[]) {
  if (seedIds.has(nodeId)) return 0
  const related = edges.filter((edge) => edge.source === nodeId || edge.target === nodeId)
  if (!related.length) return 1
  return Math.min(...related.map((edge) => edge.hop))
}

function getNodeTone(node: GraphNode, seedIds: Set<string>) {
  if (seedIds.has(node.id)) {
    return {
      background: 'color-mix(in srgb, var(--color-amber-500) 18%, var(--surface))',
      borderColor: 'color-mix(in srgb, var(--color-amber-300) 44%, transparent)',
      textColor: 'var(--color-amber-100)',
    }
  }

  if (node.userConfirmed) {
    return {
      background: 'color-mix(in srgb, var(--color-sky-400) 12%, var(--surface))',
      borderColor: 'color-mix(in srgb, var(--color-sky-300) 30%, transparent)',
      textColor: 'var(--color-sky-100)',
    }
  }

  return {
    background: 'var(--raised)',
    borderColor: 'color-mix(in srgb, var(--line) 12%, transparent)',
    textColor: 'var(--foreground)',
  }
}

function buildFlowNodes(nodes: GraphNode[], edges: GraphEdge[], seedIds: Set<string>, t: ReturnType<typeof useI18n>['t']): Node[] {
  const buckets = new Map<number, GraphNode[]>()

  for (const node of nodes) {
    const hop = getNodeHop(node.id, seedIds, edges)
    const current = buckets.get(hop) ?? []
    current.push(node)
    buckets.set(hop, current)
  }

  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => right.score - left.score || right.importance - left.importance)
  }

  return nodes.map((node) => {
    const hop = getNodeHop(node.id, seedIds, edges)
    const bucket = buckets.get(hop) ?? [node]
    const index = Math.max(bucket.findIndex((item) => item.id === node.id), 0)
    const y = ROW_Y_START + index * ROW_GAP
    const tone = getNodeTone(node, seedIds)

    return {
      id: node.id,
      ariaLabel: `${node.label} · ${t(`graph.entity.${node.entityType}`)}`,
      position: {
        x: COLUMN_X[Math.min(hop, COLUMN_X.length - 1)] ?? COLUMN_X[COLUMN_X.length - 1],
        y,
      },
      draggable: true,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: (
          <div className="w-full rounded-[inherit] px-4 py-3.5">
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="line-clamp-3 break-words text-[15px] font-medium leading-5 text-pretty">{node.label}</p>
                <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                  <span>{t(`graph.entity.${node.entityType}`)}</span>
                  <span>·</span>
                  <span>{Math.round(node.confidence * 100)}%</span>
                  <span>·</span>
                  <span>{t('graph.score', { score: node.score.toFixed(1) })}</span>
                </div>
              </div>
              {seedIds.has(node.id) ? (
                <span className="shrink-0 rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-100">
                  {t('graph.seed')}
                </span>
              ) : null}
            </div>
          </div>
        ),
      },
      style: {
        width: NODE_WIDTH,
        minHeight: NODE_MIN_HEIGHT,
        borderRadius: 24,
        border: `1px solid ${tone.borderColor}`,
        background: tone.background,
        color: tone.textColor,
        boxShadow: '0 16px 40px rgb(0 0 0 / calc(0.28 * var(--shadow-strength)))',
        padding: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
      },
    }
  })
}

function buildFlowEdges(edges: GraphEdge[], t: ReturnType<typeof useI18n>['t']): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: graphEdgeLabel(edge, t),
    ariaLabel: graphEdgeLabel(edge, t),
    interactionWidth: 28,
    type: 'smoothstep',
    animated: edge.status === 'potentially_stale',
    style: {
      stroke: edge.status === 'potentially_stale' ? 'var(--color-amber-500)' : edge.confidence < LOW_CONFIDENCE_THRESHOLD ? 'var(--color-zinc-500)' : 'var(--color-sky-400)',
      strokeOpacity: edge.confidence < LOW_CONFIDENCE_THRESHOLD ? 0.55 : 0.88,
      strokeWidth: edge.hop === 1 ? 1.9 : 1.4,
    },
    labelStyle: {
      fill: 'var(--color-zinc-200)',
      fontSize: 11,
      fontWeight: 500,
    },
    labelBgStyle: {
      fill: 'var(--panel)',
      fillOpacity: 1,
    },
  }))
}

type GraphFlowProps = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  seedNodeIds: string[]
  selection: GraphSelection
  onSelectNode: (node: GraphNode) => void
  onSelectEdge: (edge: GraphEdge) => void
  onClearSelection: () => void
}

function GraphFlowInner(props: GraphFlowProps) {
  const { t } = useI18n()
  const { theme } = useThemePreferences()
  const { fitView } = useReactFlow()
  const seedIds = useMemo(() => new Set(props.seedNodeIds), [props.seedNodeIds])
  const flowNodes = useMemo(() => buildFlowNodes(props.nodes, props.edges, seedIds, t), [props.nodes, props.edges, seedIds, t])
  const flowEdges = useMemo(() => buildFlowEdges(props.edges, t), [props.edges, t])
  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges)

  useEffect(() => { setNodes(flowNodes) }, [flowNodes, setNodes])
  useEffect(() => { setEdges(flowEdges) }, [flowEdges, setEdges])
  useEffect(() => {
    const frame = requestAnimationFrame(() => { void fitView({ padding: 0.2, duration: 0 }) })
    return () => cancelAnimationFrame(frame)
  }, [flowNodes, fitView])

  return (
    <div data-testid="graph-map" className="h-[52svh] min-h-[320px] overflow-hidden bg-canvas lg:h-[540px]">
      <ReactFlow
        nodes={nodes.map((node) => ({ ...node, selected: props.selection?.type === 'node' && props.selection.node.id === node.id }))}
        edges={edges.map((edge) => ({ ...edge, selected: props.selection?.type === 'edge' && props.selection.edge.id === edge.id }))}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          const match = props.nodes.find((item) => item.id === node.id)
          if (match) props.onSelectNode(match)
        }}
        onEdgeClick={(_, edge) => {
          const match = props.edges.find((item) => item.id === edge.id)
          if (match) props.onSelectEdge(match)
        }}
        onPaneClick={props.onClearSelection}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.15}
        maxZoom={1.6}
        nodesConnectable={false}
        deleteKeyCode={null}
        zoomOnScroll={false}
        defaultEdgeOptions={{ zIndex: 1 }}
        proOptions={{ hideAttribution: true }}
        colorMode={theme === 'dark' ? 'dark' : 'light'}
        style={{ background: 'transparent' }}
        ariaLabelConfig={{
          'node.a11yDescription.default': t('graph.nodeA11y'),
          'node.a11yDescription.keyboardDisabled': t('graph.nodeA11y'),
          'node.a11yDescription.ariaLiveMessage': ({ x, y }) => t('graph.nodeMoved', { x, y }),
          'edge.a11yDescription.default': t('graph.edgeA11y'),
          'controls.zoomIn.ariaLabel': t('graph.zoomIn'),
          'controls.zoomOut.ariaLabel': t('graph.zoomOut'),
          'controls.fitView.ariaLabel': t('graph.fitView'),
          'minimap.ariaLabel': t('graph.minimap'),
          'handle.ariaLabel': t('graph.handle'),
          'controls.ariaLabel': t('graph.view.map'),
        }}
      >
        <Background color="color-mix(in srgb, var(--line) 8%, transparent)" gap={20} size={1} />
        <MiniMap
          className="max-lg:hidden!"
          pannable zoomable
          nodeColor={(node) => (seedIds.has(node.id) ? 'var(--color-amber-400)' : 'var(--color-zinc-400)')}
          maskColor="var(--graph-mask)"
          style={{ backgroundColor: 'var(--background)', border: '1px solid color-mix(in srgb, var(--line) 8%, transparent)' }}
        />
        <Controls className="[&>button]:h-11! [&>button]:w-11!" showInteractive={false} style={{ background: 'var(--background)', border: '1px solid color-mix(in srgb, var(--line) 8%, transparent)' }} />
      </ReactFlow>
    </div>
  )
}

export function GraphFlowCanvas(props: GraphFlowProps) {
  return <ReactFlowProvider><GraphFlowInner {...props} /></ReactFlowProvider>
}

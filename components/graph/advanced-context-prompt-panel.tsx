"use client"

import { ContextPromptBlocks, type DisplayContextPromptBlock } from '@/components/graph/context-prompt-blocks'
import type { GenerationContextPromptBlock } from '@/components/graph/types'
import type { RequestPromptMessage } from '@/lib/generation-prompt-preview'
import { useI18n } from '@/lib/i18n/provider'

export function AdvancedContextPromptPanel(props: {
  blocks: GenerationContextPromptBlock[]
  requestMessages?: RequestPromptMessage[]
  disabledBlockIds: string[]
  onToggle: (id: string, enabled: boolean) => void
  loading?: boolean
}) {
  const { t } = useI18n()
  const sentContext = new Map<string, string[]>()
  const extraBlocks: DisplayContextPromptBlock[] = []
  const presetParts: string[] = []
  const requestOrder = new Map<string, number>()

  // Keep source controls in place while a new preview is fetched. Never mix
  // previous-request instructions with the current selection during refresh.
  for (const message of props.loading ? [] : props.requestMessages ?? []) {
    for (const block of message.blocks) {
      if (!block.content.trim()) continue
      if (block.kind === 'preset') {
        presetParts.push(block.content.trim())
        continue
      }
      const source = props.blocks.find((candidate) => candidate.id === block.contextBlockId)
        ?? (block.contextBlockId ? undefined : props.blocks.find((candidate) =>
          candidate.enabled && !candidate.trimmed && !props.disabledBlockIds.includes(candidate.id)
          && (candidate.content.trim() === block.content.trim() || candidate.label === block.label)))
      if (source) {
        if (!requestOrder.has(source.id)) requestOrder.set(source.id, requestOrder.size)
        sentContext.set(source.id, [...(sentContext.get(source.id) ?? []), block.content.trim()])
      } else {
        requestOrder.set(block.id, requestOrder.size)
        extraBlocks.push({ ...block, enabled: true, priority: 'highest', readOnly: true,
          label: block.label === 'System' ? t('graph.systemMessage') : block.label === 'User' ? t('graph.userMessage') : block.label,
        })
      }
    }
  }
  // Keep the combined list in request order too. Disabled/trimmed sources remain
  // available at the end, while the preset stays grouped in its single foldout.
  const contextBlocks: DisplayContextPromptBlock[] = [
    ...props.blocks.map((block) => ({ ...block, content: sentContext.get(block.id)?.join('\n\n') ?? block.content })),
    ...extraBlocks,
  ].sort((left, right) => (requestOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (requestOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  const blocks: DisplayContextPromptBlock[] = [
    ...(presetParts.length ? [{
      id: 'request-preset', label: t('graph.presetPrompt'), content: presetParts.join('\n\n'),
      enabled: true, priority: 'highest' as const, readOnly: true, collapseContent: true,
    }] : []),
    ...contextBlocks,
  ]

  return <div className="space-y-3" data-testid="advanced-context-prompt-panel" aria-busy={props.loading || undefined}>
    {props.loading ? <p role="status" className="text-sm text-zinc-400">{t('workspace.shell.loadingContextEvidence')}</p> : null}
    <ContextPromptBlocks
      blocks={blocks} disabledBlockIds={props.disabledBlockIds} onToggle={props.onToggle}
      description={t('graph.combinedPromptDescription')}
    />
  </div>
}

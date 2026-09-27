"use client"

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import type { GenerationContextPromptBlock } from '@/components/graph/types'
import { cn } from '@/lib/utils'

const LONG_PROMPT_BLOCK_CHARACTER_THRESHOLD = 600
const LONG_PROMPT_BLOCK_LINE_THRESHOLD = 12
const COLLAPSED_PROMPT_BLOCK_CHARACTER_LIMIT = 360
const COLLAPSED_PROMPT_BLOCK_LINE_LIMIT = 8

export type DisplayContextPromptBlock = GenerationContextPromptBlock & {
  readOnly?: boolean
  collapseContent?: boolean
}

export function isLongPromptBlockContent(content: string) {
  return content.length > LONG_PROMPT_BLOCK_CHARACTER_THRESHOLD
    || content.split('\n').length > LONG_PROMPT_BLOCK_LINE_THRESHOLD
}

export function buildCollapsedPromptBlockPreview(content: string) {
  const previewLines: string[] = []
  let remainingCharacters = COLLAPSED_PROMPT_BLOCK_CHARACTER_LIMIT

  for (const line of content.split('\n').slice(0, COLLAPSED_PROMPT_BLOCK_LINE_LIMIT)) {
    if (remainingCharacters <= 0) break

    if (line.length > remainingCharacters) {
      previewLines.push(line.slice(0, remainingCharacters).trimEnd())
      remainingCharacters = 0
      break
    }

    previewLines.push(line)
    remainingCharacters -= line.length + 1
  }

  const preview = previewLines.join('\n').trimEnd()
  return preview === content.trimEnd() ? content : `${preview}\n…`
}

export function ContextPromptBlocks(props: {
  blocks: DisplayContextPromptBlock[]
  disabledBlockIds: string[]
  onToggle?: (blockId: string, enabled: boolean) => void
  readOnly?: boolean
  title?: string
  description?: string
}) {
  const { t } = useI18n()
  const [expandedBlockContent, setExpandedBlockContent] = useState<Record<string, string>>({})
  const priorityLabels: Record<GenerationContextPromptBlock['priority'], string> = {
    highest: t('graph.priority.highest'),
    high: t('graph.priority.high'),
    medium: t('graph.priority.medium'),
  }

  return (
    <section className="rounded-[24px] border border-line/8 bg-shade/20 p-4" data-testid="context-prompt-blocks">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{props.title ?? t('graph.promptBlocksEyebrow')}</p>
          <p className="mt-1 text-sm text-zinc-300">{props.description ?? t('graph.promptBlocksDescription')}</p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-400">
          {t('graph.blocksCount', { count: props.blocks.length })}
        </span>
      </div>

      <div className="space-y-3">
        {props.blocks.map((block, index) => {
          const readOnly = props.readOnly || block.readOnly
          const enabled = block.required || !props.disabledBlockIds.includes(block.id)
          const isLong = isLongPromptBlockContent(block.content)
          const collapsible = isLong || block.collapseContent
          const isExpanded = collapsible && expandedBlockContent[block.id] === block.content
          const visibleContent = isLong && !isExpanded
            ? buildCollapsedPromptBlockPreview(block.content)
            : block.content
          const contentId = `prompt-block-content-${index}-${block.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
          const toggleExpanded = () => {
            setExpandedBlockContent((current) => {
              if (current[block.id] === block.content) {
                const next = { ...current }
                delete next[block.id]
                return next
              }
              return { ...current, [block.id]: block.content }
            })
          }
          return (
            <article
              key={block.id}
              className={cn(
                'block rounded-[22px] border px-4 py-3 transition',
                enabled ? 'border-amber-300/20 bg-amber-500/10' : 'border-line/8 bg-shade/30 opacity-65'
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="break-words text-sm font-medium text-zinc-100">{block.label}</p>
                    {!readOnly ? <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                      {priorityLabels[block.priority]}
                    </span> : null}
                    {block.required ? <span className="text-[11px] text-zinc-400">{t('graph.contextRequired')}</span> : null}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {collapsible ? (
                    <button
                      type="button"
                      aria-controls={contentId}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? t('graph.collapseLongText') : t('graph.expandLongText')}：${block.label}`}
                      onClick={toggleExpanded}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line/10 bg-shade/20 px-2.5 py-1 text-[11px] text-zinc-300 transition hover:bg-overlay/[0.06]"
                    >
                      {isExpanded ? t('graph.collapseLongText') : t('graph.expandLongText')}
                      <ChevronDown className={cn('h-3.5 w-3.5 transition', isExpanded && 'rotate-180')} />
                    </button>
                  ) : null}
                  {!readOnly ? <input
                    type="checkbox"
                    aria-label={block.label}
                    checked={enabled}
                    disabled={block.required}
                    onChange={(event) => props.onToggle?.(block.id, event.target.checked)}
                    className="h-4 w-4 rounded border-line/20 bg-shade/20 text-amber-400"
                  /> : null}
                </div>
              </div>
              {block.trimmed ? <p className="mt-2 text-xs text-amber-300">{t('graph.contextTrimmed')}</p> : null}
              <div className="mt-3" hidden={block.collapseContent && !isExpanded}>
                <p
                  id={contentId}
                  data-testid={`prompt-block-content-${block.id}`}
                  className="whitespace-pre-wrap break-words text-xs leading-6 text-zinc-400 [overflow-wrap:anywhere]"
                >
                  {visibleContent}
                </p>
                {isLong && !isExpanded ? (
                  <p className="mt-2 text-[11px] text-zinc-500">{t('graph.longTextCollapsed')}</p>
                ) : null}
              </div>
              {isLong && isExpanded ? (
                <div className="mt-3 flex justify-end border-t border-line/8 pt-3">
                  <button
                    type="button"
                    aria-controls={contentId}
                    aria-expanded="true"
                    onClick={toggleExpanded}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line/10 bg-shade/20 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-overlay/[0.06]"
                  >
                    <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                    {t('graph.collapseLongText')}
                  </button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}

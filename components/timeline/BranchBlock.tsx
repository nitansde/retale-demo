"use client"

import { forwardRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { SwipeDeleteRow } from '@/components/timeline/SwipeDeleteRow'
import { useI18n } from '@/lib/i18n/provider'
import { normalizeStoryBranchInstructionText, resolveStoryBranchDisplayLabel } from '@/lib/story-branch-labels'
import type { StoryTimelineBranchNode } from '@/lib/story-branch-types'
import { cn } from '@/lib/utils'

const INDENT_CLASSES = ['', 'lg:ml-2', 'lg:ml-4', 'lg:ml-6'] as const

function resolveIndentClass(laneIndex: number) {
  return INDENT_CLASSES[Math.min(Math.max(laneIndex, 0), INDENT_CLASSES.length - 1)]
}

export const BranchBlock = forwardRef<HTMLButtonElement, {
  node: StoryTimelineBranchNode
  sourceLabel?: string
  compactSourceLabel?: string
  selected: boolean
  highlighted: boolean
  disabled?: boolean
  deleting?: boolean
  onSelect: () => void
  onDelete?: () => void
  onHoverChange: (hovered: boolean) => void
  onFocusChange: (focused: boolean) => void
}>((props, ref) => {
  const { t } = useI18n()
  const isWhatIfLike = props.node.nodeType === 'rewrite' || props.node.nodeType === 'what_if' || props.node.nodeType === 'continue_block'
  const isRoleplay = props.node.nodeType === 'roleplay_session'
  const branchKindLabel = props.node.nodeType === 'rewrite'
    ? t('workspace.timeline.branchKind.rewrite')
    : props.node.nodeType === 'continue_block'
      ? t('workspace.timeline.branchKind.continueBlock')
      : props.node.nodeType === 'what_if'
        ? t('workspace.timeline.branchKind.whatIf')
        : props.node.nodeType === 'roleplay_session'
          ? t('workspace.timeline.branchKind.roleplaySession')
          : t('workspace.timeline.branchKind.futureJump')
  const displayLabel = resolveStoryBranchDisplayLabel(props.node)
  const instructionText = normalizeStoryBranchInstructionText(props.node.userInstruction ?? props.node.subtitle)

  return (
    <SwipeDeleteRow
      data-visible-depth={props.node.laneIndex}
      data-testid={`timeline-node-row-${props.node.id}`}
      className={resolveIndentClass(props.node.laneIndex)}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') props.onHoverChange(true)
      }}
      onPointerLeave={() => props.onHoverChange(false)}
      onDelete={props.onDelete}
      deleting={props.deleting}
      deleteLabel={t('workspace.timeline.deleteNodeAria', { kind: branchKindLabel, title: displayLabel })}
    >
      <button
        ref={ref}
        type="button"
        disabled={props.disabled || props.deleting}
        data-testid={`timeline-node-${props.node.id}`}
        data-navigation-target={props.selected ? 'true' : undefined}
        data-visible-depth={props.node.laneIndex}
        data-active={props.selected ? 'true' : 'false'}
        data-highlighted={props.highlighted ? 'true' : 'false'}
        data-node-type={props.node.nodeType}
        onClick={props.onSelect}
        onFocus={() => props.onFocusChange(true)}
        onBlur={() => props.onFocusChange(false)}
          className={cn(
            'min-w-0 flex-1 rounded-[22px] border px-3 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] transition disabled:cursor-not-allowed disabled:opacity-60',
            isWhatIfLike
              ? 'border-violet-300/20 bg-[linear-gradient(135deg,rgba(109,40,217,0.22),rgb(var(--raised-rgb)/0.94))] text-zinc-100 hover:border-violet-300/30 hover:bg-[linear-gradient(135deg,rgba(124,58,237,0.28),rgb(var(--raised-rgb)/0.98))]'
              : isRoleplay
                ? 'border-emerald-300/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.22),rgb(var(--raised-rgb)/0.94))] text-zinc-100 hover:border-emerald-300/30 hover:bg-[linear-gradient(135deg,rgba(52,211,153,0.28),rgb(var(--raised-rgb)/0.98))]'
            : 'border-sky-300/20 bg-[linear-gradient(135deg,rgba(59,130,246,0.20),rgb(var(--branch-rgb)/0.90))] text-zinc-100 hover:border-sky-300/32 hover:bg-[linear-gradient(135deg,rgba(96,165,250,0.28),rgb(var(--branch-hover-rgb)/0.96))]',
          props.highlighted && !props.selected && 'border-line/30',
          props.selected && (isWhatIfLike ? 'border-fuchsia-300/36 bg-fuchsia-500/16 text-fuchsia-50' : isRoleplay ? 'border-emerald-300/40 bg-emerald-500/16 text-emerald-50' : 'border-sky-300/40 bg-sky-500/16 text-sky-50')
        )}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={cn('text-[11px] uppercase tracking-[0.16em]', isWhatIfLike ? 'text-fuchsia-100/70' : isRoleplay ? 'text-emerald-100/75' : 'text-sky-100/75')}>
              {branchKindLabel}
            </p>
            <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
              <p className={cn('text-sm font-medium text-zinc-50', props.node.readableLabel ? 'shrink-0 whitespace-nowrap' : 'min-w-0 break-words [overflow-wrap:anywhere]')}>{displayLabel}</p>
              {props.sourceLabel ? (
                <span
                  data-testid={`timeline-source-${props.node.id}`}
                  title={t('workspace.timeline.source', { label: props.sourceLabel })}
                  aria-label={t('workspace.timeline.source', { label: props.sourceLabel })}
                  className="flex min-w-0 max-w-[50%] items-center gap-1 text-[10px] font-normal text-zinc-500"
                >
                  <ArrowLeft aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{props.compactSourceLabel ?? props.sourceLabel}</span>
                </span>
              ) : null}
            </div>
            {instructionText ? (
              <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-zinc-300">
                <span className="text-zinc-500">{t('workspace.userRequest')} · </span>
                {instructionText}
              </p>
            ) : null}
          </div>
        </div>
      </button>
    </SwipeDeleteRow>
  )
})

BranchBlock.displayName = 'BranchBlock'

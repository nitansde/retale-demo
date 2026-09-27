"use client"

import type { ReactNode } from 'react'
import { BookOpen, GitBranch, Globe } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type { TimelineSelection } from '@/lib/story-branch-types'

export function WorkspaceCenterPane(props: {
  selection: TimelineSelection
  chapterTitle: string
  centerPaneView: 'body' | 'graph'
  onCenterPaneViewChange: (view: 'body' | 'graph') => void
  chapterSelectionSummary: string
  chapterGraphSummary: string
  chapterBodyView: ReactNode
  chapterGraphView: ReactNode
  continueBlockView: ReactNode
  whatIfView: ReactNode
  futureJumpView: ReactNode
  roleplayView: ReactNode
  selectionActions?: ReactNode
  branchReadableLabel?: string | null
  branchInstructionText?: string | null
}) {
  const { t } = useI18n()
  const isChapter = props.selection.kind === 'chapter'
  const isRoleplay = props.selection.kind === 'roleplay_session'
  let eyebrow = props.centerPaneView === 'body' ? t('workspace.centerPane.chapterBodyEyebrow') : t('workspace.centerPane.chapterGraphEyebrow')
  let title = props.chapterTitle
  let description = props.centerPaneView === 'body'
    ? t('workspace.centerPane.chapterBodyDescription')
    : t('workspace.centerPane.chapterGraphDescription')
  let statusSummary = props.centerPaneView === 'body' ? props.chapterSelectionSummary : props.chapterGraphSummary
  const branchReadableLabel = props.branchReadableLabel?.trim() || ''

  if (props.selection.kind === 'what_if') {
    eyebrow = t('workspace.centerPane.whatIfEyebrow')
    title = branchReadableLabel || t('whatIf.defaultTitle', { count: props.selection.anchorChapterNo })
    description = t('workspace.centerPane.whatIfDescription')
    statusSummary = t('workspace.centerPane.anchorChapter', { chapterNo: props.selection.anchorChapterNo })
  } else if (props.selection.kind === 'rewrite') {
    eyebrow = t('workspace.centerPane.rewriteEyebrow')
    title = branchReadableLabel || t('workspace.centerPane.rewriteTitle', { chapterNo: props.selection.anchorChapterNo })
    description = t('workspace.centerPane.rewriteDescription')
    statusSummary = t('workspace.centerPane.anchorChapter', { chapterNo: props.selection.anchorChapterNo })
  } else if (props.selection.kind === 'continue_block') {
    eyebrow = t('workspace.centerPane.continueEyebrow')
    title = branchReadableLabel || t('workspace.centerPane.continueTitle', { chapterNo: props.selection.anchorChapterNo })
    description = t('workspace.centerPane.continueDescription')
    statusSummary = t('workspace.centerPane.anchorChapter', { chapterNo: props.selection.anchorChapterNo })
  } else if (props.selection.kind === 'future_jump') {
    eyebrow = t('workspace.centerPane.futureJumpEyebrow')
    title = branchReadableLabel || t('futureJump.defaultTitle', { source: props.selection.sourceChapterNo, target: props.selection.targetChapterNo })
    description = t('workspace.centerPane.futureJumpDescription')
    statusSummary = t('workspace.centerPane.futureJumpStatus', { source: props.selection.sourceChapterNo, target: props.selection.targetChapterNo })
  } else if (props.selection.kind === 'roleplay_session') {
    eyebrow = t('workspace.centerPane.roleplayEyebrow')
    title = branchReadableLabel || t('roleplay.defaultTitle', { count: props.selection.anchorChapterNo })
    description = t('workspace.centerPane.roleplayDescription')
    statusSummary = t('workspace.centerPane.anchorChapter', { chapterNo: props.selection.anchorChapterNo })
  }

  return (
    <section className={cn('min-w-0 overflow-hidden bg-transparent shadow-none sm:rounded-[30px] sm:border sm:border-line/10 sm:bg-raised sm:shadow-[0_28px_90px_rgb(0_0_0/calc(0.35*var(--shadow-strength)))]', isRoleplay && 'flex h-full min-h-0 flex-col')} data-testid="workspace-center-pane">
      <div className={cn(
        'border-y border-line/8 bg-panel/88 px-4 py-3 backdrop-blur-xl sm:border-x-0 sm:border-t-0 sm:bg-transparent sm:px-7 sm:py-4 sm:backdrop-blur-none',
        isRoleplay ? 'hidden' : 'hidden lg:block',
      )}>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:items-start">
          <div className={cn('min-w-0', isChapter && 'hidden sm:block')}>
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500" data-testid="workspace-center-pane-kind">{eyebrow}</p>
            <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-zinc-100 sm:text-2xl">{title}</h2>
            <p className="mt-2 hidden max-w-2xl text-sm leading-6 text-zinc-400 sm:block">{description}</p>
          </div>
          <div className={cn('flex items-center gap-2 sm:flex-wrap sm:justify-end sm:gap-3', isChapter && 'w-full sm:w-auto')}>
            {isChapter ? (
              <div className="inline-flex shrink-0 rounded-[18px] border border-line/10 bg-shade/25 p-1 text-sm text-zinc-400 sm:rounded-[22px]" data-testid="workspace-chapter-view-toggle">
                {(['body', 'graph'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => props.onCenterPaneViewChange(view)}
                    className={cn(
                      'min-h-9 rounded-[14px] px-4 py-2 transition sm:rounded-[18px]',
                      props.centerPaneView === view ? 'bg-overlay/10 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                    )}
                  >
                    {view === 'body' ? t('workspace.centerPane.bodyTab') : t('workspace.centerPane.graphTab')}
                  </button>
                ))}
              </div>
            ) : (
              <div className="hidden items-center gap-2 rounded-[22px] border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3 text-xs text-fuchsia-100 sm:inline-flex">
                <GitBranch className="h-4 w-4" />
                <span className="font-medium">{branchReadableLabel || t('workspace.centerPane.branchView')}</span>
              </div>
            )}
            <div className="min-w-0 flex-1 rounded-[18px] border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-400 sm:flex-none sm:rounded-[22px] sm:px-4 sm:py-3 sm:leading-6">
              <div className="flex min-w-0 items-center gap-2">
                {isChapter ? (
                  props.centerPaneView === 'body' ? <BookOpen className="h-4 w-4 text-violet-300" /> : <Globe className="h-4 w-4 text-sky-300" />
                ) : (
                  <GitBranch className="h-4 w-4 text-fuchsia-300" />
                )}
                <span className="truncate">{statusSummary}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!isChapter && !isRoleplay && props.selectionActions ? (
        <div className="border-b border-line/8 px-3 py-3 sm:px-7 sm:py-4">
          {props.selectionActions}
        </div>
      ) : null}

      {isChapter
        ? (props.centerPaneView === 'body' ? props.chapterBodyView : props.chapterGraphView)
        : props.selection.kind === 'what_if'
          ? props.whatIfView
          : props.selection.kind === 'rewrite' || props.selection.kind === 'continue_block'
            ? props.continueBlockView
          : props.selection.kind === 'future_jump'
            ? props.futureJumpView
            : props.selection.kind === 'roleplay_session'
              ? props.roleplayView
             : props.chapterBodyView}
    </section>
  )
}

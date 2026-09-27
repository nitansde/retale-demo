"use client"

import { forwardRef, type ReactNode } from 'react'
import { SwipeDeleteRow } from '@/components/timeline/SwipeDeleteRow'
import { useI18n } from '@/lib/i18n/provider'
import type { ChapterTimelineItem } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'
import { cn } from '@/lib/utils'

export const ChapterTimelineCard = forwardRef<HTMLButtonElement, {
  chapter: ChapterTimelineItem
  highlighted?: boolean
  activeChapterId: string
  navigationTargetChapterId: string | null
  branchChapters: Chapter[]
  onSelectChapter: () => void
  onDeleteChapter: () => void
  onSelectBranchChapter: (chapter: Chapter) => void
  onDeleteBranchChapter: (chapter: Chapter) => void
  branchArtifacts?: ReactNode
}>((props, ref) => {
  const { t } = useI18n()
  const chapterSelected = props.activeChapterId === props.chapter.chapterId
  const branchChapterSelected = props.branchChapters.some((chapter) => chapter.id === props.activeChapterId)

  return (
    <article
      data-testid={`timeline-chapter-${props.chapter.chapterNo}`}
      data-navigation-current={chapterSelected || branchChapterSelected ? 'true' : undefined}
      data-source-highlighted={props.highlighted ? 'true' : 'false'}
      className="relative z-10 space-y-2 border-b border-line/8 pb-1 lg:space-y-3 lg:border-0 lg:pb-0"
    >
      <div className="space-y-2">
        <SwipeDeleteRow
          data-testid={`timeline-chapter-row-${props.chapter.chapterId}`}
          onDelete={props.onDeleteChapter}
          deleteLabel={t('workspace.timeline.deleteChapterAria', { title: props.chapter.title })}
        >
          <button
            ref={ref}
            type="button"
            data-navigation-target={props.navigationTargetChapterId === props.chapter.chapterId ? 'true' : undefined}
            aria-current={chapterSelected ? "page" : undefined}
            onClick={props.onSelectChapter}
            className={cn(
              'min-h-16 min-w-0 flex-1 border-l-2 px-3 py-2.5 text-left transition lg:rounded-[22px] lg:border lg:py-3',
              chapterSelected ? 'border-violet-400 bg-violet-500/10 lg:border-violet-400/30' : 'border-transparent hover:bg-overlay/[0.04] lg:border-line/8 lg:bg-shade/20',
              props.highlighted && !chapterSelected && 'border-line/30 lg:border-line/30'
            )}
          >
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
              <span>{t('workspace.timeline.chapterLabel', { count: props.chapter.chapterNo })}</span>
              <span className="lg:hidden">{t('workspace.wordCount', { count: props.chapter.wordCount })}</span>
            </div>
            <p className="mt-1 break-words text-sm font-medium text-zinc-100">{props.chapter.title}</p>
            {props.chapter.summary ? (
              <p className="mt-2 break-words text-xs leading-5 text-zinc-400">{props.chapter.summary}</p>
            ) : null}
            <p className="mt-2 hidden text-xs text-zinc-500 lg:block">{t('workspace.wordCount', { count: props.chapter.wordCount })}</p>
          </button>
        </SwipeDeleteRow>

        {props.branchChapters.length ? (
          <div className="ml-3 border-l border-line/10 pl-3">
            {props.branchChapters.map((branch) => {
              const branchSelected = props.activeChapterId === branch.id
              return (
                <SwipeDeleteRow
                  key={branch.id}
                  className="mt-2"
                  data-testid={`timeline-chapter-row-${branch.id}`}
                  onDelete={() => props.onDeleteBranchChapter(branch)}
                  deleteLabel={t('workspace.timeline.deleteChapterAria', { title: branch.title })}
                >
                  <button
                    type="button"
                    data-navigation-target={props.navigationTargetChapterId === branch.id ? 'true' : undefined}
                    onClick={() => props.onSelectBranchChapter(branch)}
                    className={cn(
                      'min-w-0 flex-1 rounded-2xl border px-3 py-3 text-left transition',
                      branchSelected ? 'border-fuchsia-400/30 bg-fuchsia-500/12' : 'border-line/8 bg-shade/20 hover:bg-overlay/[0.06]'
                    )}
                  >
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('workspace.timeline.branchLabel', { label: branch.branchLabel ?? 'B' })}</p>
                    <p className="mt-1 break-words text-sm font-medium text-zinc-100">{branch.title}</p>
                  </button>
                </SwipeDeleteRow>
              )
            })}
          </div>
        ) : null}
      </div>

      {props.branchArtifacts ? (
        <div className="ml-2">
          <div className="space-y-2">{props.branchArtifacts}</div>
        </div>
      ) : null}

    </article>
  )
})

ChapterTimelineCard.displayName = 'ChapterTimelineCard'

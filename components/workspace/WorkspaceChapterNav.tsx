"use client"

import Link from 'next/link'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, House, LocateFixed, Search, X } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { StoryTimeline } from '@/components/timeline/StoryTimeline'
import { useDesktopWorkspaceLayout } from '@/components/workspace/use-desktop-workspace-layout'
import {
  CHAPTER_NAVIGATION_WINDOW_SIZE,
  filterChapterNavigationItems,
  resolveCenteredChapterWindowStart,
} from '@/lib/chapter-navigation'
import { useI18n } from '@/lib/i18n/provider'
import type { ChapterTimelineItem, StoryTimelineBranchNode, StoryTimelineEdge, TimelineSelection } from '@/lib/story-branch-types'
import type { Chapter } from '@/lib/types'

type WorkspaceChapterNavProps = {
  leftPanelOpen: boolean
  onClose: () => void
  onCreateChapter: () => void
  sortedChapters: Chapter[]
  currentNovelId: string
  storyTimelineError: string
  branchNodes: StoryTimelineBranchNode[]
  edges: StoryTimelineEdge[]
  timelineChapterById: Map<string, ChapterTimelineItem>
  currentChapterId: string
  activeSelection: TimelineSelection | null
  branchChaptersByParentId: Map<string, Chapter[]>
  onSelectionChange: (selection: TimelineSelection) => void
  onDeleteChapter: (chapterId: string) => void
  deletingBranchNodeId: string | null
  onDeleteBranchNode: (node: StoryTimelineBranchNode) => void
}

export function WorkspaceChapterNav(props: WorkspaceChapterNavProps) {
  const { t } = useI18n()
  const desktop = useDesktopWorkspaceLayout()
  const timelineScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollRequestRef = useRef<{ key: string; completed: boolean } | null>(null)
  const mainlineChapters = useMemo(
    () => props.sortedChapters.filter((chapter) => !chapter.parentChapterId),
    [props.sortedChapters],
  )
  const navigationChapters = useMemo(
    () => mainlineChapters.map<ChapterTimelineItem>((chapter) => props.timelineChapterById.get(chapter.id) ?? {
      type: 'chapter',
      chapterNo: chapter.order,
      chapterId: chapter.id,
      title: chapter.title,
      wordCount: chapter.wordCount,
      summary: null,
    }),
    [mainlineChapters, props.timelineChapterById],
  )
  const currentChapter = props.sortedChapters.find((chapter) => chapter.id === props.currentChapterId) ?? null
  const currentMainlineChapterId = currentChapter?.parentChapterId ?? currentChapter?.id ?? props.currentChapterId
  const centeredWindowStart = useMemo(
    () => resolveCenteredChapterWindowStart(navigationChapters, currentMainlineChapterId),
    [currentMainlineChapterId, navigationChapters],
  )
  const navigationScopeKey = `${props.currentNovelId}\u0000${currentMainlineChapterId}\u0000${props.leftPanelOpen ? 'open' : 'closed'}`
  const [navigationState, setNavigationState] = useState(() => ({
    scopeKey: navigationScopeKey,
    searchQuery: '',
    windowStart: centeredWindowStart,
  }))
  const activeNavigationState = navigationState.scopeKey === navigationScopeKey
    ? navigationState
    : { scopeKey: navigationScopeKey, searchQuery: '', windowStart: centeredWindowStart }
  const searchQuery = activeNavigationState.searchQuery
  const windowStart = activeNavigationState.windowStart
  const updateNavigationState = (updates: Partial<Pick<typeof navigationState, 'searchQuery' | 'windowStart'>>) => {
    setNavigationState((current) => ({
      ...(current.scopeKey === navigationScopeKey
        ? current
        : { scopeKey: navigationScopeKey, searchQuery: '', windowStart: centeredWindowStart }),
      ...updates,
    }))
  }

  const normalizedWindowStart = Math.min(
    Math.max(0, navigationChapters.length - CHAPTER_NAVIGATION_WINDOW_SIZE),
    Math.max(0, windowStart),
  )
  const searchMatches = useMemo(
    () => filterChapterNavigationItems(navigationChapters, searchQuery),
    [navigationChapters, searchQuery],
  )
  const searching = Boolean(searchQuery.trim())
  const visibleChapters = searching
    ? searchMatches.slice(0, CHAPTER_NAVIGATION_WINDOW_SIZE)
    : navigationChapters.slice(normalizedWindowStart, normalizedWindowStart + CHAPTER_NAVIGATION_WINDOW_SIZE)
  const visibleAnchorChapterNos = new Set(visibleChapters.map((chapter) => chapter.chapterNo))
  const visibleBranchNodes = props.branchNodes.filter((node) => visibleAnchorChapterNos.has(node.anchorChapterNo))
  const visibleStartChapterNo = visibleChapters[0]?.chapterNo ?? null
  const visibleEndChapterNo = visibleChapters.at(-1)?.chapterNo ?? null
  const canShowPrevious = !searching && normalizedWindowStart > 0
  const canShowNext = !searching
    && normalizedWindowStart + CHAPTER_NAVIGATION_WINDOW_SIZE < navigationChapters.length
  const alreadyCentered = !searching && normalizedWindowStart === centeredWindowStart
  const activeNavigationKey = props.activeSelection?.kind === 'chapter'
    ? `chapter:${props.activeSelection.chapterId}`
    : props.activeSelection
      ? `${props.activeSelection.kind}:${props.activeSelection.nodeId}`
      : `chapter:${props.currentChapterId}`
  const scrollRequestKey = JSON.stringify([
    navigationScopeKey,
    activeNavigationKey,
    desktop,
    normalizedWindowStart,
    searchQuery,
  ])

  useLayoutEffect(() => {
    if (!desktop && !props.leftPanelOpen) {
      scrollRequestRef.current = null
      return
    }
    const container = timelineScrollRef.current
    if (!container) return
    // Data refreshes may recreate the maps/arrays below without a navigation
    // request. Keep the user's position once that request has been handled.
    const request = scrollRequestRef.current?.key === scrollRequestKey
      ? scrollRequestRef.current
      : { key: scrollRequestKey, completed: false }
    scrollRequestRef.current = request
    if (request.completed) return

    const centerActiveItem = () => {
      const activeItem = container.querySelector<HTMLElement>('[data-navigation-target="true"]')
      if (!activeItem) {
        if (searchQuery.trim()) {
          container.scrollTop = 0
          request.completed = true
        }
        return
      }

      const containerBounds = container.getBoundingClientRect()
      const itemBounds = activeItem.getBoundingClientRect()
      const centeredOffset = itemBounds.top - containerBounds.top - (container.clientHeight - itemBounds.height) / 2
      container.scrollTop = Math.max(0, container.scrollTop + centeredOffset)
      request.completed = true
    }

    centerActiveItem()
    let expectedScrollTop = container.scrollTop
    const frameId = window.requestAnimationFrame(() => {
      if (container.scrollTop !== expectedScrollTop) {
        request.completed = true
        return
      }
      centerActiveItem()
      expectedScrollTop = container.scrollTop
    })
    const stopCentering = () => {
      // Also abandon pending positioning when the selected item loads later.
      request.completed = true
      window.cancelAnimationFrame(frameId)
    }
    const onScroll = () => {
      if (container.scrollTop !== expectedScrollTop) stopCentering()
    }
    const interactionEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    interactionEvents.forEach((event) => container.addEventListener(event, stopCentering, { passive: true }))
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.cancelAnimationFrame(frameId)
      interactionEvents.forEach((event) => container.removeEventListener(event, stopCentering))
      container.removeEventListener('scroll', onScroll)
    }
  }, [
    desktop,
    props.branchChaptersByParentId,
    props.branchNodes,
    props.leftPanelOpen,
    props.timelineChapterById,
    scrollRequestKey,
    searchQuery,
  ])

  const selectChapter = (chapter: ChapterTimelineItem) => {
    props.onSelectionChange({ kind: 'chapter', chapterId: chapter.chapterId, chapterNo: chapter.chapterNo })
    props.onClose()
  }

  const content = (
    <>
      <Link
        href="/library"
        aria-label={t('workspace.header.backToLibrary')}
        className="mb-3 flex min-h-11 items-center gap-2 rounded-2xl border border-line/10 bg-overlay/[0.04] px-3 text-sm text-zinc-200 transition hover:bg-overlay/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
        data-testid="workspace-chapter-nav-home"
      >
        <House className="h-4 w-4 text-violet-200" aria-hidden="true" />
        {t('workspace.header.home')}
      </Link>
      <section className="space-y-3 lg:rounded-[24px] lg:border lg:border-line/8 lg:bg-overlay/[0.03] lg:p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-1 lg:grid-cols-[minmax(0,1fr)_auto]">
          <p className="text-xs text-zinc-500">{t('chapterNav.chapterCount', { count: mainlineChapters.length })}</p>
          <button
            type="button"
            onClick={() => {
              props.onCreateChapter()
              props.onClose()
            }}
            className="min-h-11 rounded-xl px-2 text-sm font-medium text-violet-300 transition hover:bg-overlay/5 lg:order-first lg:col-span-2 lg:bg-violet-500 lg:text-white"
          >
            {t('chapterNav.newChapter')}
          </button>
          <button
            type="button"
            disabled={alreadyCentered}
            onClick={() => {
              updateNavigationState({ searchQuery: '', windowStart: centeredWindowStart })
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line/8 bg-shade/20 px-2.5 text-[11px] text-zinc-300 transition hover:bg-overlay/[0.06] disabled:cursor-default disabled:opacity-45"
          >
            <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
            {t('chapterNav.currentChapter')}
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => updateNavigationState({ searchQuery: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && visibleChapters[0]) selectChapter(visibleChapters[0])
            }}
            aria-label={t('chapterNav.searchLabel')}
            placeholder={t('chapterNav.searchPlaceholder')}
            className="min-h-11 w-full rounded-xl border border-line/8 bg-shade/25 py-2 pl-10 pr-10 text-base lg:text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-violet-400/35 focus:bg-shade/35"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => updateNavigationState({ searchQuery: '' })}
              aria-label={t('chapterNav.clearSearch')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-zinc-500 transition hover:bg-overlay/[0.06] hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <p className="px-1 text-[11px] leading-5 text-zinc-500">
          {searching
            ? searchMatches.length > CHAPTER_NAVIGATION_WINDOW_SIZE
              ? t('chapterNav.searchResultsLimited', { visible: CHAPTER_NAVIGATION_WINDOW_SIZE, count: searchMatches.length })
              : t('chapterNav.searchResults', { count: searchMatches.length })
            : visibleStartChapterNo !== null && visibleEndChapterNo !== null
              ? t('chapterNav.visibleRange', { start: visibleStartChapterNo, end: visibleEndChapterNo })
              : t('chapterNav.noChapters')}
        </p>

        {!searching && navigationChapters.length > CHAPTER_NAVIGATION_WINDOW_SIZE ? (
          <div className="grid grid-cols-2 gap-2" data-testid="chapter-navigation-range-controls">
            <button
              type="button"
              disabled={!canShowPrevious}
              onClick={() => updateNavigationState({ windowStart: Math.max(0, normalizedWindowStart - CHAPTER_NAVIGATION_WINDOW_SIZE) })}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-2xl border border-line/8 bg-shade/20 px-3 text-xs text-zinc-300 transition hover:bg-overlay/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              {t('chapterNav.previousRange')}
            </button>
            <button
              type="button"
              disabled={!canShowNext}
              onClick={() => updateNavigationState({
                windowStart: Math.min(
                  Math.max(0, navigationChapters.length - CHAPTER_NAVIGATION_WINDOW_SIZE),
                  normalizedWindowStart + CHAPTER_NAVIGATION_WINDOW_SIZE,
                ),
              })}
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-2xl border border-line/8 bg-shade/20 px-3 text-xs text-zinc-300 transition hover:bg-overlay/[0.06] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {t('chapterNav.nextRange')}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {props.storyTimelineError ? (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">{props.storyTimelineError}</div>
        ) : null}

        {!desktop && visibleChapters.length ? <p className="px-1 text-[11px] leading-5 text-zinc-500">{t('workspace.timeline.swipeHint')}</p> : null}

        <div
          ref={timelineScrollRef}
          className="max-h-[calc(100dvh-17rem)] min-h-48 lg:-mx-3 lg:max-h-[calc(100vh-21rem)] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]"
          data-testid="chapter-navigation-scroll"
        >
          {visibleChapters.length ? (
            <StoryTimeline
              chapters={visibleChapters}
              branchNodes={visibleBranchNodes}
              allBranchNodes={props.branchNodes}
              edges={props.edges}
              activeChapterId={props.currentChapterId}
              activeSelection={props.activeSelection}
              branchChaptersByParentId={props.branchChaptersByParentId}
              onSelectionChange={(selection) => {
                props.onSelectionChange(selection)
                props.onClose()
              }}
              onDeleteChapter={props.onDeleteChapter}
              onDeleteBranchChapter={props.onDeleteChapter}
              deletingBranchNodeId={props.deletingBranchNodeId}
              onDeleteBranchNode={props.onDeleteBranchNode}
            />
          ) : (
            <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-line/8 bg-shade/15 px-4 text-center text-sm leading-6 text-zinc-500">
              {searching ? t('chapterNav.noSearchResults') : t('chapterNav.noChapters')}
            </div>
          )}
        </div>
      </section>
    </>
  )

  if (desktop) {
    return (
      <aside className="sticky top-3 self-start rounded-[30px] border border-line/10 bg-raised p-4 shadow-[0_24px_70px_rgb(0_0_0/calc(0.3*var(--shadow-strength)))]" data-testid="workspace-chapter-nav">
        <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{t('chapterNav.novel')}</p>
        <h2 className="mb-4 mt-1 text-lg font-semibold text-zinc-100">{t('chapterNav.title')}</h2>
        {content}
      </aside>
    )
  }

  return (
    <DialogSurface
      open={props.leftPanelOpen}
      onClose={props.onClose}
      closeLabel={t('chapterNav.close')}
      title={t('chapterNav.title')}
      placement="left"
      className="w-[94vw] max-w-md rounded-r-2xl"
    >
      <div data-testid="workspace-chapter-nav">{content}</div>
    </DialogSurface>
  )
}

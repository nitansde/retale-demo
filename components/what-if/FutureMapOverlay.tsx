"use client"

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronDown, GitBranch, LoaderCircle, Sparkles, X } from 'lucide-react'
import { ContextCompressionControl, ContextCompressionWarning } from '@/components/workspace/ContextCompressionControl'
import type { ContextCompressionPreview } from '@/lib/context-compression'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import { resolveWorkspaceUserFacingError } from '@/lib/workspace-user-facing-errors'
import {
  FUTURE_MAP_MISSING_SUMMARY_FALLBACK,
  type FutureJumpMutationResponse,
  type FutureJumpSourceContext,
  type FutureMapEvent,
  type FutureMapResponse,
  type OutlineNodeChapterRecord,
} from '@/lib/story-branch-types'

type FutureMapOverlayProps = {
  novelId: string
  branchId: string
  sourceContext: FutureJumpSourceContext
  title: string
  parentTimelineNodeId: string | null
  onClose: () => void
  onCreated: (
    result: FutureJumpMutationResponse,
    context: { sourceChapterNo: number; targetChapterNo: number }
  ) => Promise<void> | void
}

type FutureMapMode = 'history_node' | 'direct_chapter'

type DirectChapterOption = {
  event: FutureMapEvent
  chapter: OutlineNodeChapterRecord
}

function formatConfidence(confidence: number | null, unlabeled: string) {
  if (confidence === null || Number.isNaN(confidence)) return unlabeled
  return `${Math.round(confidence * 100)}%`
}

function buildSourceMeta(sourceType: string, t: ReturnType<typeof useI18n>['t']) {
  if (sourceType === 'authored') {
    return {
      label: 'Authored',
      tone: 'border-emerald-300/20 bg-emerald-500/12 text-emerald-100',
      description: t('futureMap.authoredDescription'),
    }
  }

  return {
    label: sourceType.replaceAll('_', ' '),
    tone: 'border-amber-300/20 bg-amber-500/12 text-amber-100',
    description: t('futureMap.derivedDescription'),
  }
}

function resolveEventSummary(summary: string | null | undefined) {
  const normalized = summary?.trim()
  return normalized || FUTURE_MAP_MISSING_SUMMARY_FALLBACK
}

async function loadFutureMap(input: Pick<FutureMapOverlayProps, 'novelId' | 'branchId' | 'sourceContext'>) {
  const params = new URLSearchParams({
    novelId: input.novelId,
    branchId: input.branchId,
    sourceChapterNo: String(input.sourceContext.chapterNo),
  })
  if (input.sourceContext.chapterId) {
    params.set('sourceChapterId', input.sourceContext.chapterId)
  }
  if (input.sourceContext.nodeId) {
    params.set('sourceNodeId', input.sourceContext.nodeId)
  }
  params.set('sourceNodeType', input.sourceContext.nodeType)
  if (input.sourceContext.whatIfSessionId) {
    params.set('parentSessionId', input.sourceContext.whatIfSessionId)
  }
  const response = await fetch(`/api/story-future-map?${params.toString()}`, { cache: 'no-store' })
  const data = await response.json() as FutureMapResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future map load failed')
  }
  return data
}

async function createFutureJump(input: {
  novelId: string
  sourceContext: FutureJumpSourceContext
  targetOutlineNodeId: string
  targetOutlineChapterId: string
  parentTimelineNodeId: string | null
  userDirection?: string | null
}) {
  const response = await fetch('/api/future-jump/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await response.json() as FutureJumpMutationResponse & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || 'Future jump create failed')
  }
  return data
}

function EventCard(props: {
  event: FutureMapEvent
  selected: boolean
  dimmed: boolean
  onClick: () => void
}) {
  const { t } = useI18n()
  const sourceMeta = buildSourceMeta(props.event.sourceType, t)

  return (
    <button
      type="button"
      data-testid={`future-map-event-${props.event.id}`}
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={cn(
        'w-full rounded-[24px] border p-4 text-left transition',
        props.selected
          ? 'border-sky-300/35 bg-sky-500/12 shadow-[0_18px_60px_rgba(14,165,233,0.12)]'
          : 'border-line/8 bg-shade/20 hover:border-line/15 hover:bg-overlay/[0.05]',
        props.dimmed && !props.selected && 'opacity-60'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {props.event.phaseLabel || props.event.trackKey}
          </p>
          <h4 className="mt-1 text-sm font-medium text-zinc-100">{props.event.title}</h4>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className={cn('rounded-full border px-2.5 py-1', sourceMeta.tone)}>{sourceMeta.label}</span>
          <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1 text-zinc-300">
            {t('whatIf.deltaConfidence', { value: formatConfidence(props.event.confidence, t('whatIf.unlabeled')) })}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-zinc-300">{resolveEventSummary(props.event.summary)}</p>

      {props.event.originalOutcome ? (
        <div className="mt-3 rounded-[18px] border border-line/8 bg-overlay/[0.03] p-3 text-xs leading-6 text-zinc-400">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Original outcome</p>
          <p className="mt-1">{props.event.originalOutcome}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-300">
        <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1">track {props.event.trackKey}</span>
        {props.event.chapterNo !== null ? (
          <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1">{t('futureMap.chapterNode', { chapterNo: props.event.chapterNo })}</span>
        ) : null}
      </div>
    </button>
  )
}

export function FutureMapOverlay(props: FutureMapOverlayProps) {
  const { locale, t } = useI18n()
  const { branchId, novelId, onClose, onCreated, parentTimelineNodeId, sourceContext } = props
  const [data, setData] = useState<FutureMapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<FutureMapMode>('history_node')
  const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [userDirection, setUserDirection] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [contextRevision, setContextRevision] = useState(0)
  const [contextPreview, setContextPreview] = useState<{ key: string; compression: ContextCompressionPreview | null; tokenEstimate: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError('')
      setCreateError('')
      setMode('history_node')
      setSelectedEventId(null)
      setSelectedChapterId(null)

      try {
        const nextData = await loadFutureMap({ novelId, branchId, sourceContext })
        if (cancelled) return
        setData(nextData)
        setSelectedTrackKey(nextData.defaults.selectedTrackKey ?? nextData.tracks[0]?.trackKey ?? null)
      } catch (loadError) {
        if (cancelled) return
        setData(null)
        setError(resolveWorkspaceUserFacingError('future-map-load', loadError, locale))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [branchId, locale, novelId, sourceContext])

  const eventsById = useMemo(() => new Map((data?.events ?? []).map((event) => [event.id, event] as const)), [data?.events])
  const visibleEvents = useMemo(() => {
    if (!data) return []
    if (!selectedTrackKey) return data.events
    return data.events.filter((event) => event.trackKey === selectedTrackKey)
  }, [data, selectedTrackKey])
  const selectedEvent = selectedEventId ? eventsById.get(selectedEventId) ?? null : null
  const resolveHistoryNodeChapterId = (event: FutureMapEvent) => {
    const chapters = data?.chaptersByEvent[event.id] ?? []
    if (!chapters.length) return null
    return chapters.find((chapter) => chapter.chapterNo === event.chapterNo)?.id
      ?? chapters.find((chapter) => chapter.isPrimary)?.id
      ?? chapters[0]?.id
      ?? null
  }
  const chapterOptions = useMemo<OutlineNodeChapterRecord[]>(() => {
    if (!selectedEvent || !data) return []
    return data.chaptersByEvent[selectedEvent.id] ?? []
  }, [data, selectedEvent])
  const directChapterOptions = useMemo<DirectChapterOption[]>(() => {
    if (!data) return []
    return data.events.flatMap((event) =>
      (data.chaptersByEvent[event.id] ?? []).map((chapter) => ({ event, chapter }))
    )
  }, [data])
  const visibleDirectChapterOptions = useMemo(() => {
    if (!selectedTrackKey) return directChapterOptions
    return directChapterOptions.filter((option) => option.event.trackKey === selectedTrackKey)
  }, [directChapterOptions, selectedTrackKey])
  const selectedChapter = chapterOptions.find((chapter) => chapter.id === selectedChapterId) ?? null
  const canConfirm = Boolean(selectedEvent && selectedChapter) && !creating && !compressing
  const contextRequest = JSON.stringify({ novelId, branchId, sourceContext, targetOutlineNodeId: selectedEventId, targetOutlineChapterId: selectedChapterId, userDirection })
  const contextKey = `${contextRevision}:${contextRequest}`
  useEffect(() => {
    if (!selectedEventId || !selectedChapterId) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/future-jump/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: contextRequest, signal: controller.signal })
        const preview = await response.json()
        if (response.ok && preview.ok && !controller.signal.aborted) setContextPreview({ ...preview, key: contextKey })
      } catch { /* Generation still reports actionable source/model errors. */ }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [contextRequest, contextKey, selectedEventId, selectedChapterId])

  const handleTrackSelect = (trackKey: string) => {
    setSelectedTrackKey(trackKey)
    const currentEvent = selectedEventId ? eventsById.get(selectedEventId) ?? null : null
    if (!currentEvent || currentEvent.trackKey !== trackKey) {
      setSelectedEventId(null)
      setSelectedChapterId(null)
    }
  }

  const handleEventSelect = (event: FutureMapEvent) => {
    setSelectedTrackKey(event.trackKey)
    setSelectedEventId(event.id)
    setSelectedChapterId(mode === 'history_node' ? resolveHistoryNodeChapterId(event) : null)
    setCreateError('')
  }

  const handleDirectChapterSelect = (option: DirectChapterOption) => {
    setSelectedTrackKey(option.event.trackKey)
    setSelectedEventId(option.event.id)
    setSelectedChapterId(option.chapter.id)
    setCreateError('')
  }

  const handleConfirm = async () => {
    if (!selectedEvent || !selectedChapter || creating) return

    setCreating(true)
    setCreateError('')

    try {
        const result = await createFutureJump({
          novelId,
          sourceContext,
          targetOutlineNodeId: selectedEvent.id,
          targetOutlineChapterId: selectedChapter.id,
          parentTimelineNodeId,
          userDirection: userDirection.trim() || undefined,
        })
        await onCreated(result, {
          sourceChapterNo: sourceContext.chapterNo,
          targetChapterNo: selectedChapter.chapterNo,
        })
    } catch (submitError) {
      setCreateError(resolveWorkspaceUserFacingError('future-jump-create', submitError, locale))
    } finally {
      setCreating(false)
    }
  }

  return (
    <DialogSurface
      open
      onClose={onClose}
      title={t('futureMap.title')}
      busy={creating}
      closeDisabled={creating}
      backdropClassName="bg-shade/72"
      titleClassName="sr-only"
      contentClassName="mt-0 flex min-h-[calc(100vh-2rem)] flex-col sm:min-h-[calc(100vh-3rem)]"
      className="my-4 min-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[1680px] rounded-[34px] border-sky-300/20 p-0 shadow-[0_30px_120px_rgb(0_0_0/calc(0.55*var(--shadow-strength)))] sm:my-6 sm:min-h-[calc(100vh-3rem)] sm:w-[calc(100%-3rem)]"
    >
      <div className="flex flex-1 flex-col" data-testid="future-map-overlay">
            <div className="border-b border-line/8 px-5 py-5 sm:px-7 sm:py-6">
              <div className="flex items-start justify-between gap-4">
                <h3 className="self-center text-xl font-semibold text-zinc-100">{t('futureMap.title')}</h3>
                <button
                  type="button"
                  data-testid="future-map-close"
                  aria-label={t('futureMap.close')}
                  disabled={creating}
                  onClick={onClose}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line/10 text-zinc-300 transition hover:bg-overlay/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">{t('futureMap.description')}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="future-map-mode-history-node"
                  aria-pressed={mode === 'history_node'}
                  onClick={() => {
                    setMode('history_node')
                    setSelectedEventId(null)
                    setSelectedChapterId(null)
                    setCreateError('')
                  }}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm transition',
                    mode === 'history_node'
                      ? 'border-sky-300/35 bg-sky-500/12 text-sky-50'
                      : 'border-line/10 bg-shade/20 text-zinc-300 hover:bg-overlay/[0.05]'
                  )}
                >
                  {t('futureMap.historyNodeMode')}
                </button>
                <button
                  type="button"
                  data-testid="future-map-mode-direct-chapter"
                  aria-pressed={mode === 'direct_chapter'}
                  onClick={() => {
                    setMode('direct_chapter')
                    setSelectedEventId(null)
                    setSelectedChapterId(null)
                    setCreateError('')
                  }}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm transition',
                    mode === 'direct_chapter'
                      ? 'border-sky-300/35 bg-sky-500/12 text-sky-50'
                      : 'border-line/10 bg-shade/20 text-zinc-300 hover:bg-overlay/[0.05]'
                  )}
                >
                  {t('futureMap.directChapterMode')}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex flex-1 items-center justify-center px-6 py-12 text-sm text-zinc-200">
                <div className="flex items-center gap-2 rounded-[24px] border border-line/8 bg-shade/20 px-5 py-4">
                  <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
                  {t('futureMap.loading')}
                </div>
              </div>
            ) : error ? (
              <div className="px-6 py-8 sm:px-7">
                <div role="alert" className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-5 text-sm leading-6 text-rose-100">{error}</div>
              </div>
            ) : data ? (
              <div data-testid="future-map-layout" className="grid min-w-0 flex-1 gap-4 p-4 sm:p-5 lg:grid-cols-[248px_minmax(0,1.3fr)_360px] lg:p-6">
                <aside data-testid="future-map-tracks" className="min-w-0 rounded-[28px] border border-line/8 bg-shade/20 p-4">
                  <div className="flex items-center gap-2 text-zinc-200">
                    <GitBranch className="h-4 w-4 text-sky-300" />
                    <h4 className="text-sm font-medium">Tracks</h4>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-zinc-400">{t('futureMap.trackHint', { mode: mode === 'history_node' ? t('futureMap.historyNodeMode') : t('futureMap.directChapterMode') })}</p>
                  <div className="mt-4 space-y-2">
                    {data.tracks.map((track) => {
                      const selected = selectedTrackKey === track.trackKey
                      return (
                        <button
                          key={track.trackKey}
                          type="button"
                          data-testid={`future-map-track-${track.trackKey}`}
                          aria-pressed={selected}
                          onClick={() => handleTrackSelect(track.trackKey)}
                          className={cn(
                            'w-full rounded-[22px] border px-3 py-3 text-left transition',
                            selected ? 'border-sky-300/35 bg-sky-500/12 text-sky-50' : 'border-line/8 bg-overlay/[0.03] text-zinc-200 hover:bg-overlay/[0.06]'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{track.phaseLabel || track.trackKey}</p>
                              <p className="mt-1 text-xs text-zinc-400">{track.trackKey}</p>
                            </div>
                            <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1 text-[11px] text-zinc-300">{track.eventCount}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </aside>

                <section data-testid="future-map-candidates" className="min-w-0 rounded-[28px] border border-line/8 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.08),_transparent_40%),var(--surface)] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{mode === 'history_node' ? 'History nodes' : 'Direct chapter anchors'}</p>
                      <h4 className="mt-1 text-lg font-semibold text-zinc-100">
                        {selectedTrackKey
                          ? t('futureMap.candidateCount', { count: mode === 'history_node' ? visibleEvents.length : visibleDirectChapterOptions.length, kind: mode === 'history_node' ? t('futureMap.nodeKind') : t('futureMap.chapterKind') })
                          : t('futureMap.selectTrack')}
                      </h4>
                    </div>
                    <div className="rounded-full border border-line/10 bg-shade/20 px-3 py-1.5 text-[11px] text-zinc-300">
                      authored vs derived provenance visible
                    </div>
                  </div>

                  {(mode === 'history_node' ? visibleEvents.length : visibleDirectChapterOptions.length) ? (
                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                      {mode === 'history_node'
                        ? visibleEvents.map((event) => (
                            <EventCard
                              key={event.id}
                              event={event}
                              selected={selectedEventId === event.id}
                              dimmed={Boolean(selectedTrackKey) && event.trackKey !== selectedTrackKey}
                              onClick={() => handleEventSelect(event)}
                            />
                          ))
                        : visibleDirectChapterOptions.map((option) => {
                            const selected = selectedChapterId === option.chapter.id
                            const sourceMeta = buildSourceMeta(option.event.sourceType, t)
                            return (
                              <button
                                key={option.chapter.id}
                                type="button"
                                data-testid={`future-map-direct-chapter-${option.chapter.chapterNo}`}
                                aria-pressed={selected}
                                onClick={() => handleDirectChapterSelect(option)}
                                className={cn(
                                  'w-full rounded-[24px] border p-4 text-left transition',
                                  selected
                                    ? 'border-sky-300/35 bg-sky-500/12 shadow-[0_18px_60px_rgba(14,165,233,0.12)]'
                                    : 'border-line/8 bg-shade/20 hover:border-line/15 hover:bg-overlay/[0.05]'
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{option.event.phaseLabel || option.event.trackKey}</p>
                                    <h4 className="mt-1 text-sm font-medium text-zinc-100">{t('graph.chapterTitle', { chapterNo: option.chapter.chapterNo, title: option.chapter.chapterTitle || option.event.title })}</h4>
                                  </div>
                                  <div className="flex flex-wrap gap-2 text-[11px]">
                                    <span className={cn('rounded-full border px-2.5 py-1', sourceMeta.tone)}>{sourceMeta.label}</span>
                                    <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1 text-zinc-300">
                                      {t('whatIf.deltaConfidence', { value: formatConfidence(option.event.confidence, t('whatIf.unlabeled')) })}
                                    </span>
                                    {option.chapter.isPrimary ? (
                                      <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1 text-[11px] text-zinc-300">primary</span>
                                    ) : null}
                                  </div>
                                </div>
                                 <p className="mt-3 text-sm leading-6 text-zinc-300">{resolveEventSummary(option.event.summary)}</p>
                                {option.event.originalOutcome ? (
                                  <p className="mt-3 text-xs leading-6 text-zinc-500">{t('futureMap.originalOutcome', { value: option.event.originalOutcome })}</p>
                                ) : null}
                              </button>
                            )
                          })}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[24px] border border-dashed border-line/10 bg-shade/20 p-5 text-sm leading-6 text-zinc-400">
                      {t('futureMap.noCandidates', { kind: mode === 'history_node' ? t('futureMap.nodeKind') : t('futureMap.chapterKind') })}
                    </div>
                  )}
                </section>

                <aside data-testid="future-map-confirmation" className="min-w-0 rounded-[28px] border border-line/8 bg-shade/20 p-4 sm:p-5">
                  <div className="flex items-center gap-2 text-zinc-200">
                    <Sparkles className="h-4 w-4 text-sky-300" />
                    <h4 className="text-sm font-medium">Confirm target</h4>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-zinc-400">
                    {mode === 'history_node'
                      ? t('futureMap.historyNodeModeHint')
                      : t('futureMap.directChapterModeHint')}
                  </p>

                  <div className="mt-4 rounded-[22px] border border-line/8 bg-overlay/[0.03] p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{mode === 'history_node' ? 'Step 1 · History node' : 'Step 1 · Direct chapter'}</p>
                    {selectedEvent ? (
                      <div className="mt-2 space-y-2">
                        <p className="text-sm font-medium text-zinc-100">{mode === 'history_node' ? selectedEvent.title : t('graph.chapterTitle', { chapterNo: selectedChapter?.chapterNo ?? '—', title: selectedChapter?.chapterTitle || selectedEvent.title })}</p>
                         <p className="text-sm leading-6 text-zinc-300">{resolveEventSummary(selectedEvent.summary)}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-zinc-400">{t('futureMap.selectTargetHint', { kind: mode === 'history_node' ? t('futureMap.historyNodeMode') : t('futureMap.targetChapterKind') })}</p>
                    )}
                  </div>

                  <div className="mt-4 rounded-[22px] border border-line/8 bg-overlay/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Step 2 · Resolved chapter</p>
                      <span className="text-[11px] text-zinc-500">{mode === 'history_node' ? 'auto-bound' : chapterOptions.length ? 'selected' : 'pending'}</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {selectedChapter ? (
                        <div
                          data-testid="future-map-resolved-chapter"
                          className="rounded-[18px] border border-sky-300/20 bg-sky-500/10 px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-sky-50">{t('graph.chapterOnly', { chapterNo: selectedChapter.chapterNo })}</p>
                              <p className="mt-1 text-xs text-sky-100/75">{selectedChapter.chapterTitle || selectedChapter.chapterId || t('futureMap.unnamedChapterAnchor')}</p>
                            </div>
                            {selectedChapter.isPrimary ? <span className="rounded-full border border-line/10 bg-shade/20 px-2.5 py-1 text-[11px] text-zinc-300">primary</span> : null}
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-[18px] border border-dashed border-line/10 bg-shade/20 px-3 py-3 text-sm leading-6 text-zinc-400">
                          {selectedEvent ? t('futureMap.noResolvedChapterForSelection') : t('futureMap.noResolvedChapterYet')}
                        </div>
                      )}
                    </div>
                  </div>

                  <ContextCompressionWarning preview={contextPreview?.key === contextKey ? contextPreview.compression : null} tokenEstimate={contextPreview?.key === contextKey ? contextPreview.tokenEstimate : null} />
                  {contextPreview?.key === contextKey && contextPreview.compression?.totalChapters ? <details className="group mt-4 border-b border-line/10 pb-3">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-zinc-300 outline-none focus-visible:ring-2 focus-visible:ring-violet-400 [&::-webkit-details-marker]:hidden">
                      {t('workspace.shell.advancedContext')}<ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <ContextCompressionControl preview={contextPreview.compression} disabled={creating} onBusyChange={setCompressing} onContextChanged={() => setContextRevision((value) => value + 1)} />
                  </details> : null}
                  <label className="mt-4 block">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Optional direction</span>
                    <textarea
                      value={userDirection}
                      onChange={(event) => setUserDirection(event.target.value)}
                      rows={4}
                      placeholder={t('futureMap.optionalDirectionPlaceholder')}
                      className="mt-2 w-full rounded-[20px] border border-line/10 bg-surface px-3 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                    />
                  </label>

                  {createError ? (
                    <div role="alert" data-testid="future-map-create-error" className="mt-4 whitespace-pre-wrap break-words rounded-[20px] border border-rose-400/20 bg-rose-500/10 p-3 text-sm leading-6 text-rose-100">{createError}</div>
                  ) : null}

                  <button
                    type="button"
                    data-testid="future-map-confirm"
                    disabled={!canConfirm}
                    onClick={() => {
                      void handleConfirm()
                    }}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[22px] bg-sky-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : canConfirm ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                    {t('futureMap.confirmAndGenerate')}
                  </button>
                </aside>
              </div>
            ) : null}
      </div>
    </DialogSurface>
  )
}

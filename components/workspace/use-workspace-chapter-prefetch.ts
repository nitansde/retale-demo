"use client"

import { useEffect } from 'react'
import { useNovelStore } from '@/store/novel-store'

const IDLE_DELAY_MS = 2_000

export function useWorkspaceChapterPrefetch() {
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let idleCallback: number | undefined
    let controller: AbortController | null = null
    let failures = 0

    const cancel = () => {
      clearTimeout(timer)
      if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback)
      idleCallback = undefined
      controller?.abort()
      controller = null
    }

    const schedule = (delay = IDLE_DELAY_MS) => {
      if (stopped || document.hidden || !navigator.onLine || failures >= 3) return
      timer = setTimeout(() => {
        if (window.requestIdleCallback) {
          idleCallback = window.requestIdleCallback(() => {
            idleCallback = undefined
            void download()
          })
        } else {
          void download()
        }
      }, delay)
    }

    const download = async () => {
      if (stopped || document.hidden || !navigator.onLine || controller) return
      const request = new AbortController()
      controller = request
      let more = false
      try {
        more = await useNovelStore.getState().prefetchChapterContent(request.signal)
        if (!request.signal.aborted) failures = 0
      } catch {
        if (!request.signal.aborted) {
          failures += 1
          more = true
        }
      } finally {
        if (controller === request) {
          controller = null
          // Yield between small batches, and back off on failures without changing the UI.
          if (more) schedule(failures ? failures * 10_000 : 100)
        }
      }
    }

    const activity = () => {
      cancel()
      schedule()
    }
    const online = () => {
      failures = 0
      activity()
    }
    const context = (state: ReturnType<typeof useNovelStore.getState>) => [
      state.currentNovelId, state.currentChapterId, state.revisionNovelId, state.workspaceRevision,
      state.backendLoaded, state.backendLoadError, state.isSaving, state.isNovelDeletionPending,
      state.persistRevision, state.workspaceSaveConflict, state.chapterLoadError,
      state.localChapters.find((chapter) => chapter.id === state.currentChapterId)?.contentLoaded,
    ]
    const unsubscribe = useNovelStore.subscribe((state, previous) => {
      const before = context(previous)
      if (context(state).every((value, index) => value === before[index])) return
      if (state.currentNovelId !== previous.currentNovelId || state.workspaceRevision !== previous.workspaceRevision
        || state.backendLoaded !== previous.backendLoaded) failures = 0
      activity()
    })
    const events = ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'] as const
    for (const event of events) window.addEventListener(event, activity, { passive: true })
    document.addEventListener('visibilitychange', activity)
    window.addEventListener('offline', activity)
    window.addEventListener('online', online)
    schedule()
    return () => {
      stopped = true
      cancel()
      unsubscribe()
      for (const event of events) window.removeEventListener(event, activity)
      document.removeEventListener('visibilitychange', activity)
      window.removeEventListener('offline', activity)
      window.removeEventListener('online', online)
    }
  }, [])
}

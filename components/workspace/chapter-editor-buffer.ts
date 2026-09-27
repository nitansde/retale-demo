export type ChapterEditorBufferCommit = {
  chapterId: string
  html: string
  plainText: string
}

type ChapterEditorBufferOptions = {
  delayMs: number
  commit: (payload: ChapterEditorBufferCommit) => void
  setTimer?: typeof globalThis.setTimeout
  clearTimer?: typeof globalThis.clearTimeout
}

type BufferedChapterEditor = {
  chapterId: string
  read: () => Omit<ChapterEditorBufferCommit, 'chapterId'>
}

export function createChapterEditorBuffer(options: ChapterEditorBufferOptions) {
  const setTimer = options.setTimer ?? globalThis.setTimeout
  const clearTimer = options.clearTimer ?? globalThis.clearTimeout
  let commit = options.commit
  let timer: ReturnType<typeof setTimeout> | null = null
  let buffered: BufferedChapterEditor | null = null
  let generation = 0

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  const flush = () => {
    cancelTimer()
    const pending = buffered
    buffered = null
    if (!pending) return null
    const payload = { chapterId: pending.chapterId, ...pending.read() }
    commit(payload)
    return payload
  }

  const schedule = () => {
    cancelTimer()
    const scheduledGeneration = generation
    timer = setTimer(() => {
      timer = null
      if (scheduledGeneration !== generation) return
      flush()
    }, options.delayMs)
  }

  return {
    setCommit(nextCommit: ChapterEditorBufferOptions['commit']) {
      commit = nextCommit
    },
    update(chapterId: string, read: BufferedChapterEditor['read']) {
      buffered = { chapterId, read }
      generation += 1
      schedule()
    },
    flush,
    discard() {
      generation += 1
      buffered = null
      cancelTimer()
    },
    hasDirtyChapter(chapterId?: string) {
      return Boolean(buffered && (!chapterId || buffered.chapterId === chapterId))
    },
    getBuffered() {
      return buffered
    },
  }
}

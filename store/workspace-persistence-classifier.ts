import type { Chapter, PersistedNovelState } from '@/lib/types'

export type WorkspacePersistenceClassification =
  | { kind: 'none' }
  | { kind: 'patch'; chapter: Chapter }
  | { kind: 'post' }

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function withoutSeparatelyPersistedSettings(state: PersistedNovelState) {
  const {
    aiSettings: _aiSettings,
    currentNovelId: _currentNovelId,
    currentChapterId: _currentChapterId,
    currentTab: _currentTab,
    helperTab: _helperTab,
    focusMode: _focusMode,
    selectionText: _selectionText,
    selectedParagraphIndex: _selectedParagraphIndex,
    presetCompatSessionState: _presetCompatSessionState,
    ...workspace
  } = state
  return workspace
}

function chapterWithoutPatchFields(chapter: Chapter) {
  const {
    content: _content,
    wordCount: _wordCount,
    updatedAt: _updatedAt,
    ...identityAndStructure
  } = chapter
  return identityAndStructure
}

export function classifyWorkspacePersistence(
  baseline: PersistedNovelState,
  current: PersistedNovelState,
): WorkspacePersistenceClassification {
  const baselineWorkspace = withoutSeparatelyPersistedSettings(baseline)
  const currentWorkspace = withoutSeparatelyPersistedSettings(current)
  const { localChapters: baselineChapters, ...baselineWithoutChapters } = baselineWorkspace
  const { localChapters: currentChapters, ...currentWithoutChapters } = currentWorkspace

  if (!valuesEqual(baselineWithoutChapters, currentWithoutChapters)) return { kind: 'post' }
  if (baselineChapters.length !== currentChapters.length) return { kind: 'post' }

  let changedChapter: Chapter | null = null
  for (let index = 0; index < baselineChapters.length; index += 1) {
    const baselineChapter = baselineChapters[index]
    const currentChapter = currentChapters[index]
    if (!baselineChapter || !currentChapter || baselineChapter.id !== currentChapter.id) return { kind: 'post' }
    if (valuesEqual(baselineChapter, currentChapter)) continue
    if (changedChapter || !valuesEqual(
      chapterWithoutPatchFields(baselineChapter),
      chapterWithoutPatchFields(currentChapter),
    )) return { kind: 'post' }
    changedChapter = currentChapter
  }

  return changedChapter ? { kind: 'patch', chapter: changedChapter } : { kind: 'none' }
}

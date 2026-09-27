import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'
import { createDefaultAISettings, normalizeAISettings } from '@/lib/ai-settings'
import { normalizeCharacterRoleCardProfile } from '@/lib/story-knowledge'
import type {
  Chapter,
  PersistedNovelState,
  PresetCompatSessionEntry,
  PresetCompatSessionPhase,
  PresetCompatSessionState,
  PresetCompatSessionWorkspaceSelection,
  RewriteConstraint,
  RewritePreset,
} from '@/lib/types'
import { normalizeLegacySingleParagraphHtml } from '@/lib/utils'

const defaultPresets: RewritePreset[] = [
  {
    id: 'preset-1',
    name: '冷感压迫',
    mode: 'heavy',
    tone: 'colder',
    prompt: '压低情绪外露，提高压迫感与空间细节，避免解释性台词。',
  },
  {
    id: 'preset-2',
    name: '电影镜头',
    mode: 'perspective',
    tone: 'cinematic',
    prompt: '以镜头推进为优先，增强动作和环境切换，减少抽象比喻。',
  },
  {
    id: 'preset-3',
    name: '对话拉扯',
    mode: 'dialogue',
    tone: 'romantic',
    prompt: '强化角色之间的张力与潜台词，不要破坏既有设定。',
  },
]

const defaultConstraints: RewriteConstraint[] = [
  { id: 'cons-1', label: '不改世界观规则', enabled: true, strength: 'strict' },
  { id: 'cons-2', label: '保留关键伏笔词', enabled: true, strength: 'soft' },
  { id: 'cons-3', label: '避免现代口语跳戏', enabled: false, strength: 'soft' },
  { id: 'cons-4', label: '控制单段长度', enabled: true, strength: 'soft' },
]

const PRESET_COMPAT_SESSION_PHASE_SET = new Set<PresetCompatSessionPhase>([
  'new_chat',
  'new_group_chat',
  'new_example_chat',
  'continue',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createEmptyPresetCompatSessionState(): PresetCompatSessionState {
  return {}
}

function normalizePresetCompatSessionEntry(
  entryKey: string,
  input: unknown
): PresetCompatSessionEntry | null {
  if (!isRecord(input)) return null

  const phase = input.phase
  const surfaceId = input.surfaceId
  const resetPending = input.resetPending

  if (
    typeof surfaceId !== 'string'
    || typeof phase !== 'string'
    || !PRESET_COMPAT_SESSION_PHASE_SET.has(phase as PresetCompatSessionPhase)
    || typeof resetPending !== 'boolean'
  ) {
    return null
  }

  return {
    surfaceId: surfaceId as PresetCompatSurfaceId,
    phase: phase as PresetCompatSessionPhase,
    resetPending,
  }
}

export function normalizePresetCompatSessionState(input: unknown): PresetCompatSessionState {
  if (!isRecord(input)) return createEmptyPresetCompatSessionState()

  const normalizedEntries = Object.entries(input)
    .map(([entryKey, value]) => {
      const normalizedValue = normalizePresetCompatSessionEntry(entryKey, value)
      return normalizedValue ? [entryKey, normalizedValue] as const : null
    })
    .filter((entry): entry is readonly [string, PresetCompatSessionEntry] => entry !== null)

  return Object.fromEntries(normalizedEntries)
}

function encodePresetCompatSessionKeyPart(value: string | number) {
  return encodeURIComponent(String(value))
}

export function createPresetCompatSessionSelectionKey(selection: PresetCompatSessionWorkspaceSelection) {
  if (selection.kind === 'chapter') {
    return `chapter:${encodePresetCompatSessionKeyPart(selection.chapterId)}`
  }

  if (selection.kind === 'what_if') {
    return [
      'what_if',
      encodePresetCompatSessionKeyPart(selection.nodeId),
      encodePresetCompatSessionKeyPart(selection.sessionId),
      selection.anchorChapterNo,
    ].join(':')
  }

  if (selection.kind === 'rewrite') {
    return [
      'rewrite',
      encodePresetCompatSessionKeyPart(selection.nodeId),
      encodePresetCompatSessionKeyPart(selection.continueBlockId),
      selection.anchorChapterNo,
    ].join(':')
  }

  if (selection.kind === 'continue_block') {
    return [
      'continue_block',
      encodePresetCompatSessionKeyPart(selection.nodeId),
      encodePresetCompatSessionKeyPart(selection.continueBlockId),
      selection.anchorChapterNo,
    ].join(':')
  }

  if (selection.kind === 'roleplay_session') {
    return [
      'roleplay_session',
      encodePresetCompatSessionKeyPart(selection.nodeId),
      encodePresetCompatSessionKeyPart(selection.roleplaySessionId),
      selection.anchorChapterNo,
    ].join(':')
  }

  return [
    'future_jump',
    encodePresetCompatSessionKeyPart(selection.nodeId),
    encodePresetCompatSessionKeyPart(selection.runId),
    selection.sourceChapterNo,
    selection.targetChapterNo,
  ].join(':')
}

export function createPresetCompatSessionStateKey(
  selection: PresetCompatSessionWorkspaceSelection,
  surfaceId: PresetCompatSurfaceId
) {
  return `${createPresetCompatSessionSelectionKey(selection)}::${surfaceId}`
}

export function setPresetCompatSessionEntry(
  state: PresetCompatSessionState,
  selection: PresetCompatSessionWorkspaceSelection,
  surfaceId: PresetCompatSurfaceId,
  phase: PresetCompatSessionPhase,
  resetPending = false
): PresetCompatSessionState {
  const entryKey = createPresetCompatSessionStateKey(selection, surfaceId)
  const currentEntry = state[entryKey]
  if (
    currentEntry?.surfaceId === surfaceId
    && currentEntry.phase === phase
    && currentEntry.resetPending === resetPending
  ) {
    return state
  }

  return {
    ...state,
    [entryKey]: {
      surfaceId,
      phase,
      resetPending,
    },
  }
}

export function clearPresetCompatSessionStateForSelection(
  state: PresetCompatSessionState,
  selection: PresetCompatSessionWorkspaceSelection
): PresetCompatSessionState {
  const selectionPrefix = `${createPresetCompatSessionSelectionKey(selection)}::`
  const matchingKeys = Object.keys(state).filter((entryKey) => entryKey.startsWith(selectionPrefix))
  if (matchingKeys.length === 0) return state

  const nextState = { ...state }
  matchingKeys.forEach((entryKey) => delete nextState[entryKey])
  return nextState
}

export function resetPresetCompatSessionStateForSelection(
  state: PresetCompatSessionState,
  selection: PresetCompatSessionWorkspaceSelection,
  surfaceIds: PresetCompatSurfaceId[],
  phase: PresetCompatSessionPhase = 'new_chat'
): PresetCompatSessionState {
  return surfaceIds.reduce(
    (nextState, surfaceId) => setPresetCompatSessionEntry(nextState, selection, surfaceId, phase, true),
    state
  )
}

function pickDeterministicChapter(
  chapters: PersistedNovelState['localChapters'],
  preferredNovelId?: string
) {
  const sorted = chapters.slice().sort((left, right) => {
    const preferredDiff = Number(right.novelId === preferredNovelId) - Number(left.novelId === preferredNovelId)
    if (preferredDiff !== 0) return preferredDiff

    const mainDiff = Number(Boolean(left.parentChapterId)) - Number(Boolean(right.parentChapterId))
    if (mainDiff !== 0) return mainDiff

    if (left.novelId !== right.novelId) return left.novelId.localeCompare(right.novelId)
    if (left.order !== right.order) return left.order - right.order
    return left.id.localeCompare(right.id)
  })

  return sorted[0] ?? null
}

function repairCurrentWorkspaceSelection(state: PersistedNovelState) {
  if (!state.localChapters.length) {
    return {
      currentNovelId: '',
      currentChapterId: '',
    }
  }

  const selectedChapter = state.localChapters.find((chapter) => chapter.id === state.currentChapterId)
  if (selectedChapter) {
    return {
      currentNovelId: selectedChapter.novelId,
      currentChapterId: selectedChapter.id,
    }
  }

  const fallbackChapter = pickDeterministicChapter(state.localChapters, state.currentNovelId)

  return {
    currentNovelId: fallbackChapter?.novelId ?? '',
    currentChapterId: fallbackChapter?.id ?? '',
  }
}

function cloneDefaultPresets() {
  return defaultPresets.map((preset) => ({ ...preset }))
}

function cloneDefaultConstraints() {
  return defaultConstraints.map((constraint) => ({ ...constraint }))
}

function normalizeChapters(input: Chapter[]) {
  return input.map((chapter) => ({
    ...chapter,
    content: normalizeLegacySingleParagraphHtml(chapter.content),
    originalContent: chapter.originalContent
      ? normalizeLegacySingleParagraphHtml(chapter.originalContent)
      : chapter.originalContent,
  }))
}

export function createEmptyWorkspaceState(): PersistedNovelState {
  return {
    currentNovelId: '',
    currentChapterId: '',
    currentTab: 'editor',
    helperTab: 'ai',
    localNovels: [],
    localChapters: [],
    localOutlines: [],
    localCharacters: [],
    localCharacterRelations: [],
    localWorldEntries: [],
    localTimelineEvents: [],
    rewriteCandidates: [],
    rewriteHistory: [],
    trajectories: [],
    rewriteMode: 'medium',
    rewriteTone: 'keep',
    rewriteOutput: 'candidate',
    rewriteScope: 'paragraph',
    selectionText: '',
    selectedParagraphIndex: 0,
    thinkingLevel: 'medium',
    autoContinue: true,
    keepCanon: true,
    promptText: '保留世界观与人物关系，仅强化氛围、节奏与张力。',
    selectedPresetId: defaultPresets[0]?.id ?? '',
    presets: cloneDefaultPresets(),
    constraints: cloneDefaultConstraints(),
    focusMode: false,
    presetCompatSessionState: createEmptyPresetCompatSessionState(),
    aiSettings: createDefaultAISettings(),
  }
}

export function normalizeWorkspaceState(input?: Partial<PersistedNovelState> | null): PersistedNovelState {
  const base = createEmptyWorkspaceState()
  if (!input) return base
  const source = input

  const normalizedState = {
    ...base,
    ...source,
    selectedParagraphIndex: typeof source.selectedParagraphIndex === 'number' ? source.selectedParagraphIndex : base.selectedParagraphIndex,
    localNovels: source.localNovels ?? base.localNovels,
    localChapters: normalizeChapters(source.localChapters ?? base.localChapters),
    localOutlines: source.localOutlines ?? base.localOutlines,
    localCharacters: (source.localCharacters ?? base.localCharacters).map((character) => ({
      ...character,
      profile: character.profile ? normalizeCharacterRoleCardProfile(character.profile) : undefined,
    })),
    localCharacterRelations: source.localCharacterRelations ?? base.localCharacterRelations,
    localWorldEntries: source.localWorldEntries ?? base.localWorldEntries,
    localTimelineEvents: source.localTimelineEvents ?? base.localTimelineEvents,
    rewriteCandidates: source.rewriteCandidates ?? base.rewriteCandidates,
    rewriteHistory: source.rewriteHistory ?? base.rewriteHistory,
    trajectories: source.trajectories ?? base.trajectories,
    presets: source.presets ?? base.presets,
    constraints: source.constraints ?? base.constraints,
    presetCompatSessionState: normalizePresetCompatSessionState(source.presetCompatSessionState),
    aiSettings: normalizeAISettings(source.aiSettings ?? source),
  }

  return {
    ...normalizedState,
    ...repairCurrentWorkspaceSelection(normalizedState),
  }
}

export function serializeNovelResourceState(input: PersistedNovelState) {
  const state = normalizeWorkspaceState(input)
  return {
    localNovels: state.localNovels,
    localChapters: state.localChapters,
    localOutlines: state.localOutlines,
    localCharacters: state.localCharacters,
    localCharacterRelations: state.localCharacterRelations,
    localWorldEntries: state.localWorldEntries,
    localTimelineEvents: state.localTimelineEvents,
    rewriteCandidates: state.rewriteCandidates,
    rewriteHistory: state.rewriteHistory,
    trajectories: state.trajectories,
    rewriteMode: state.rewriteMode,
    rewriteTone: state.rewriteTone,
    rewriteOutput: state.rewriteOutput,
    rewriteScope: state.rewriteScope,
    thinkingLevel: state.thinkingLevel,
    autoContinue: state.autoContinue,
    keepCanon: state.keepCanon,
    promptText: state.promptText,
    selectedPresetId: state.selectedPresetId,
    presets: state.presets,
    constraints: state.constraints,
  }
}

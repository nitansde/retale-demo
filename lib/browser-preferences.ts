import type { HelperTab, PresetCompatSessionState, WorkspaceTab } from '@/lib/types'
import { normalizePresetCompatSessionState } from '@/lib/workspace-state'

export const WORKSPACE_PREFERENCES_STORAGE_KEY = 'retale.workspace-preferences.v1'
export const WORKSPACE_SESSION_STORAGE_KEY = 'retale.workspace-session.v1'

export type BrowserWorkspaceCenterPaneView = 'body' | 'graph'
export type BrowserWorkspaceRefTab = 'characters' | 'organizations' | 'locations' | 'worldbuilding' | 'outline' | 'timeline'

export type BrowserWorkspacePreferences = {
  version: 1
  centerPaneView: BrowserWorkspaceCenterPaneView
  refTab: BrowserWorkspaceRefTab
}

export type BrowserWorkspaceSession = {
  version: 1
  currentNovelId: string
  currentChapterIds: Record<string, string>
  currentTab: WorkspaceTab
  helperTab: HelperTab
  focusMode: boolean
  presetCompatSessionStates: Record<string, PresetCompatSessionState>
}

export const DEFAULT_BROWSER_WORKSPACE_PREFERENCES: BrowserWorkspacePreferences = {
  version: 1,
  centerPaneView: 'body',
  refTab: 'characters',
}

export const DEFAULT_BROWSER_WORKSPACE_SESSION: BrowserWorkspaceSession = {
  version: 1,
  currentNovelId: '',
  currentChapterIds: {},
  currentTab: 'editor',
  helperTab: 'ai',
  focusMode: false,
  presetCompatSessionStates: {},
}

const VALID_CENTER_PANE_VIEWS = new Set<BrowserWorkspaceCenterPaneView>(['body', 'graph'])
const VALID_REF_TABS = new Set<BrowserWorkspaceRefTab>([
  'characters',
  'organizations',
  'locations',
  'worldbuilding',
  'outline',
  'timeline',
])
const VALID_WORKSPACE_TABS = new Set<WorkspaceTab>(['editor', 'rewrite', 'outline', 'characters', 'world'])
const VALID_HELPER_TABS = new Set<HelperTab>(['ai', 'references', 'trajectory', 'stats'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseBrowserWorkspacePreferences(value: unknown): BrowserWorkspacePreferences | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (typeof value.centerPaneView !== 'string' || !VALID_CENTER_PANE_VIEWS.has(value.centerPaneView as BrowserWorkspaceCenterPaneView)) return null
  if (typeof value.refTab !== 'string' || !VALID_REF_TABS.has(value.refTab as BrowserWorkspaceRefTab)) return null

  return {
    version: 1,
    centerPaneView: value.centerPaneView as BrowserWorkspaceCenterPaneView,
    refTab: value.refTab as BrowserWorkspaceRefTab,
  }
}

export function parseBrowserWorkspaceSession(value: unknown): BrowserWorkspaceSession | null {
  if (!isRecord(value) || value.version !== 1) return null
  if (typeof value.currentNovelId !== 'string') return null
  if (!isRecord(value.currentChapterIds)) return null
  if (typeof value.currentTab !== 'string' || !VALID_WORKSPACE_TABS.has(value.currentTab as WorkspaceTab)) return null
  if (typeof value.helperTab !== 'string' || !VALID_HELPER_TABS.has(value.helperTab as HelperTab)) return null
  if (typeof value.focusMode !== 'boolean') return null

  const currentChapterIds: Record<string, string> = {}
  for (const [novelId, chapterId] of Object.entries(value.currentChapterIds)) {
    if (novelId && typeof chapterId === 'string' && chapterId) currentChapterIds[novelId] = chapterId
  }
  const presetCompatSessionStates: Record<string, PresetCompatSessionState> = {}
  if (isRecord(value.presetCompatSessionStates)) {
    for (const [novelId, sessionState] of Object.entries(value.presetCompatSessionStates)) {
      if (novelId && isRecord(sessionState)) {
        presetCompatSessionStates[novelId] = normalizePresetCompatSessionState(sessionState)
      }
    }
  }

  return {
    version: 1,
    currentNovelId: value.currentNovelId,
    currentChapterIds,
    currentTab: value.currentTab as WorkspaceTab,
    helperTab: value.helperTab as HelperTab,
    focusMode: value.focusMode,
    presetCompatSessionStates,
  }
}

export function readBrowserWorkspacePreferences(): BrowserWorkspacePreferences {
  if (typeof window === 'undefined') return DEFAULT_BROWSER_WORKSPACE_PREFERENCES

  try {
    const raw = window.localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY)
    if (!raw) return DEFAULT_BROWSER_WORKSPACE_PREFERENCES
    return parseBrowserWorkspacePreferences(JSON.parse(raw)) ?? DEFAULT_BROWSER_WORKSPACE_PREFERENCES
  } catch {
    return DEFAULT_BROWSER_WORKSPACE_PREFERENCES
  }
}

export function readBrowserWorkspaceSession(): BrowserWorkspaceSession {
  if (typeof window === 'undefined') return DEFAULT_BROWSER_WORKSPACE_SESSION

  try {
    const raw = window.localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY)
    if (!raw) return DEFAULT_BROWSER_WORKSPACE_SESSION
    return parseBrowserWorkspaceSession(JSON.parse(raw)) ?? DEFAULT_BROWSER_WORKSPACE_SESSION
  } catch {
    return DEFAULT_BROWSER_WORKSPACE_SESSION
  }
}

export function removeBrowserWorkspaceNovelSession(novelId: string) {
  const session = readBrowserWorkspaceSession()
  const currentChapterIds = { ...session.currentChapterIds }
  const presetCompatSessionStates = { ...session.presetCompatSessionStates }
  delete currentChapterIds[novelId]
  delete presetCompatSessionStates[novelId]
  return writeBrowserWorkspaceSession({
    ...session,
    currentNovelId: session.currentNovelId === novelId ? '' : session.currentNovelId,
    currentChapterIds,
    presetCompatSessionStates,
  })
}

export function writeBrowserWorkspacePreferences(preferences: Omit<BrowserWorkspacePreferences, 'version'>) {
  if (typeof window === 'undefined') return false

  try {
    window.localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 1,
      centerPaneView: preferences.centerPaneView,
      refTab: preferences.refTab,
    } satisfies BrowserWorkspacePreferences))
    return true
  } catch {
    return false
  }
}

export function writeBrowserWorkspaceSession(session: Omit<BrowserWorkspaceSession, 'version'>) {
  if (typeof window === 'undefined') return false

  try {
    window.localStorage.setItem(WORKSPACE_SESSION_STORAGE_KEY, JSON.stringify({
      version: 1,
      currentNovelId: session.currentNovelId,
      currentChapterIds: session.currentChapterIds,
      currentTab: session.currentTab,
      helperTab: session.helperTab,
      focusMode: session.focusMode,
      presetCompatSessionStates: session.presetCompatSessionStates,
    } satisfies BrowserWorkspaceSession))
    return true
  } catch {
    return false
  }
}

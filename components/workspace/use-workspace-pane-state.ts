"use client"

import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_BROWSER_WORKSPACE_PREFERENCES,
  readBrowserWorkspacePreferences,
  WORKSPACE_PREFERENCES_STORAGE_KEY,
  writeBrowserWorkspacePreferences,
  type BrowserWorkspaceCenterPaneView,
  type BrowserWorkspaceRefTab,
} from '@/lib/browser-preferences'

export type WorkspaceCenterPaneView = BrowserWorkspaceCenterPaneView
export type WorkspaceRefTab = BrowserWorkspaceRefTab

const VALID_WORKSPACE_REF_TABS: WorkspaceRefTab[] = [
  'characters',
  'organizations',
  'locations',
  'worldbuilding',
  'outline',
  'timeline',
]

export function resolveWorkspaceRefTab(value: string | null | undefined): WorkspaceRefTab {
  return VALID_WORKSPACE_REF_TABS.includes(value as WorkspaceRefTab) ? value as WorkspaceRefTab : 'characters'
}

export function useWorkspacePaneState() {
  const [leftPanelOpen, setLeftPanelOpen] = useState(false)
  const [referencePanelOpen, setReferencePanelOpen] = useState(false)
  const [knowledgePanelOpen, setKnowledgePanelOpen] = useState(false)
  const [chapterListState, setChapterListState] = useState<Record<string, number>>({})
  const [centerPaneView, setCenterPaneView] = useState<WorkspaceCenterPaneView>('body')
  const [rawRefTab, setRawRefTab] = useState<string>('characters')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmDeleteKnowledge, setConfirmDeleteKnowledge] = useState(false)
  const [browserPreferencesReady, setBrowserPreferencesReady] = useState(false)

  const refTab = useMemo(() => resolveWorkspaceRefTab(rawRefTab), [rawRefTab])

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const preferences = readBrowserWorkspacePreferences()
      setCenterPaneView(preferences.centerPaneView)
      setRawRefTab(preferences.refTab)
      setBrowserPreferencesReady(true)
    }, 0)

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_PREFERENCES_STORAGE_KEY) return
      const next = event.newValue
        ? readBrowserWorkspacePreferences()
        : DEFAULT_BROWSER_WORKSPACE_PREFERENCES
      setCenterPaneView(next.centerPaneView)
      setRawRefTab(next.refTab)
    }

    window.addEventListener('storage', handleStorage)
    return () => {
      window.clearTimeout(restoreTimer)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => {
    if (!browserPreferencesReady) return
    writeBrowserWorkspacePreferences({ centerPaneView, refTab })
  }, [browserPreferencesReady, centerPaneView, refTab])

  return {
    leftPanelOpen,
    setLeftPanelOpen,
    referencePanelOpen,
    setReferencePanelOpen,
    knowledgePanelOpen,
    setKnowledgePanelOpen,
    chapterListState,
    setChapterListState,
    centerPaneView,
    setCenterPaneView,
    refTab,
    setRefTab: (tab: WorkspaceRefTab | string) => setRawRefTab(resolveWorkspaceRefTab(tab)),
    settingsOpen,
    setSettingsOpen,
    confirmDeleteKnowledge,
    setConfirmDeleteKnowledge,
  }
}

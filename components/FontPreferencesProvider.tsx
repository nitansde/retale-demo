'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_FONT_PREFERENCES,
  FONT_PREFERENCES_COOKIE,
  getFontPreferenceStyles,
  type FontPreferences,
} from '@/lib/font-preferences'

type FontPreferencesContextValue = {
  preferences: FontPreferences
  setPreferences: (preferences: FontPreferences) => void
  persistenceError: boolean
}

const FontPreferencesContext = createContext<FontPreferencesContextValue>({
  preferences: DEFAULT_FONT_PREFERENCES,
  setPreferences: () => undefined,
  persistenceError: false,
})

export function FontPreferencesProvider({
  children,
  initialPreferences,
}: {
  children: ReactNode
  initialPreferences: FontPreferences
}) {
  const [preferences, setPreferencesState] = useState(initialPreferences)
  const [persistenceError, setPersistenceError] = useState(false)

  useEffect(() => {
    for (const [property, value] of Object.entries(getFontPreferenceStyles(preferences))) {
      document.documentElement.style.setProperty(property, value)
    }
  }, [preferences])

  const setPreferences = useCallback((next: FontPreferences) => {
    setPreferencesState(next)
    const encoded = encodeURIComponent(JSON.stringify(next))
    try {
      document.cookie = `${FONT_PREFERENCES_COOKIE}=${encoded}; Path=/; Max-Age=31536000; SameSite=Lax`
      setPersistenceError(!document.cookie.split('; ').includes(`${FONT_PREFERENCES_COOKIE}=${encoded}`))
    } catch {
      setPersistenceError(true)
    }
  }, [])

  const value = useMemo(() => ({ preferences, setPreferences, persistenceError }), [preferences, setPreferences, persistenceError])

  return <FontPreferencesContext.Provider value={value}>{children}</FontPreferencesContext.Provider>
}

export function useFontPreferences() {
  return useContext(FontPreferencesContext)
}

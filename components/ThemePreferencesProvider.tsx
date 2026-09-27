'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_THEME, THEME_PREFERENCE_COOKIE, type ThemeId } from '@/lib/theme-preferences'

const ThemePreferencesContext = createContext<{
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
  persistenceError: boolean
}>({
  theme: DEFAULT_THEME,
  setTheme: () => undefined,
  persistenceError: false,
})

export function ThemePreferencesProvider({ children, initialTheme }: { children: ReactNode; initialTheme: ThemeId }) {
  const [theme, setThemeState] = useState(initialTheme)
  const [persistenceError, setPersistenceError] = useState(false)

  const setTheme = useCallback((next: ThemeId) => {
    document.documentElement.dataset.theme = next
    setThemeState(next)
    try {
      document.cookie = `${THEME_PREFERENCE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`
      setPersistenceError(!document.cookie.split('; ').includes(`${THEME_PREFERENCE_COOKIE}=${next}`))
    } catch {
      setPersistenceError(true)
    }
  }, [])

  const value = useMemo(() => ({ theme, setTheme, persistenceError }), [theme, setTheme, persistenceError])
  return <ThemePreferencesContext.Provider value={value}>{children}</ThemePreferencesContext.Provider>
}

export function useThemePreferences() {
  return useContext(ThemePreferencesContext)
}

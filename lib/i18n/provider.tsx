"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getMessage,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
  type TranslationKey,
  type TranslationValues,
} from '@/lib/i18n/messages'

const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

const defaultContextValue: I18nContextValue = {
  locale: 'zh',
  setLocale: () => undefined,
  t: (key, values) => getMessage('zh', key, values),
}

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey, values?: TranslationValues) => string
}

const I18nContext = createContext<I18nContextValue>(defaultContextValue)

export function I18nProvider({
  children,
  initialLocale = 'zh',
  localeCookiePresent = false,
}: {
  children: ReactNode
  initialLocale?: Locale
  localeCookiePresent?: boolean
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [browserStorageReady, setBrowserStorageReady] = useState(localeCookiePresent)

  useEffect(() => {
    if (localeCookiePresent) return
    const restoreTimer = window.setTimeout(() => {
      let nextLocale = initialLocale
      try {
        const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
        if (stored && isLocale(stored)) nextLocale = stored
      } catch {
        // Ignore storage access failures in restricted or test environments.
      }

      setLocaleState(nextLocale)
      setBrowserStorageReady(true)
    }, 0)
    return () => window.clearTimeout(restoreTimer)
  }, [initialLocale, localeCookiePresent])

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    document.documentElement.dataset.locale = locale
    if (!browserStorageReady) return

    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
    } catch {
      // Ignore storage access failures in restricted or test environments.
    }
    document.cookie = `${LOCALE_STORAGE_KEY}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
  }, [browserStorageReady, locale])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY || !event.newValue || !isLocale(event.newValue)) return
      setLocaleState(event.newValue)
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
  }, [])

  const t = useCallback((key: TranslationKey, values?: TranslationValues) => getMessage(locale, key, values), [locale])

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}

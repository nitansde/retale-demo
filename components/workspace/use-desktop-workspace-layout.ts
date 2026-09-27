"use client"

import { useEffect, useState } from 'react'

const DESKTOP_QUERY = '(min-width: 1024px)'

export function useDesktopWorkspaceLayout() {
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia(DESKTOP_QUERY)
    const update = () => setDesktop(mediaQuery.matches)
    update()
    mediaQuery.addEventListener('change', update)
    return () => mediaQuery.removeEventListener('change', update)
  }, [])

  return desktop
}

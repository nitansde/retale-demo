"use client"

import type { ReactNode } from 'react'
import { LanguageSwitcher } from '@/components/i18n/language-switcher'
import { useI18n } from '@/lib/i18n/provider'

export const LIBRARY_ACTION_ROW_CLASS_NAME = 'grid grid-cols-2 gap-2 sm:flex sm:justify-end'
export const LIBRARY_PRIMARY_ACTION_CLASS_NAME = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-indigo-400/20 bg-indigo-500/90 px-4 text-sm font-medium text-white shadow-[0_12px_30px_var(--primary-shadow)] transition hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300/70 disabled:cursor-not-allowed disabled:opacity-60'
export const LIBRARY_SECONDARY_ACTION_CLASS_NAME = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-violet-300/20 bg-violet-500/12 px-4 text-sm font-medium text-violet-100 transition hover:bg-violet-500/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70'

export function LibraryPageShell({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}) {
  const { t } = useI18n()

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <p className="whitespace-nowrap text-sm uppercase tracking-[0.12em] text-zinc-500 sm:tracking-[0.28em]">{t('library.eyebrow')}</p>
            <LanguageSwitcher />
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">{description}</p>
        </header>
        {children}
      </div>
    </main>
  )
}

"use client"

import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'

export function LoadingScreen({ children }: { children?: ReactNode }) {
  const { t } = useI18n()

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-center" data-testid="app-loading-screen">
      <div className="-translate-y-6">
        <p lang="zh" className="text-lg font-normal tracking-[0.12em] text-zinc-300 sm:text-xl">戏说不是胡说</p>
        <div role="status" className="mt-5 flex items-center justify-center gap-2.5 text-xs text-zinc-500">
          <LoaderCircle className="h-4 w-4 text-violet-300/70 motion-safe:animate-spin" aria-hidden="true" />
          <span>{t('common.loading')}</span>
        </div>
        {children ? <div className="mt-6 text-sm text-zinc-400">{children}</div> : null}
      </div>
    </main>
  )
}

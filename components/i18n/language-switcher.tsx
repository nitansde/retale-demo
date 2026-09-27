"use client"

import { Languages } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import type { Locale } from '@/lib/i18n/messages'
import { cn } from '@/lib/utils'

const LOCALES: Locale[] = ['zh', 'en']

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line/10 bg-panel p-1 text-[11px] text-zinc-200" data-testid="app-language-switcher">
      <span className="inline-flex items-center gap-1.5 px-1.5 text-zinc-400">
        <Languages className="h-3.5 w-3.5" />
        {t('language.label')}
      </span>
      <div className="flex rounded-lg border border-line/10 bg-shade/20 p-0.5">
        {LOCALES.map((item) => {
          const active = locale === item
          const label = t(`language.${item}`)
          return (
            <button
              key={item}
              type="button"
              data-testid={`app-language-option-${item}`}
              onClick={() => setLocale(item)}
              className={cn(
                'rounded-md px-2 py-1 transition',
                active ? 'bg-violet-500 text-white' : 'text-zinc-300 hover:bg-overlay/[0.08]'
              )}
              aria-pressed={active}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

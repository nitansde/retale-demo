"use client"

import { AudioLines } from 'lucide-react'
import { useI18n } from '@/lib/i18n/provider'
import type { PublicVoiceSettings } from '@/lib/voice-chat'
import { cn } from '@/lib/utils'

export function RoleplayVoiceSelect({ settings, onChange, disabled, trigger }: {
  settings: PublicVoiceSettings
  onChange: (id: string) => void
  disabled?: boolean
  /** A quiet button that hides the current voice; the transparent native picker sits on top of it. */
  trigger?: 'text' | 'icon'
}) {
  const { t } = useI18n()
  return <label title={trigger ? t('voice.select') : undefined} className={cn('items-center text-xs text-zinc-400', trigger ? 'relative inline-flex has-[:disabled]:opacity-40 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-violet-400' : 'flex min-w-0 gap-2', trigger === 'text' && 'min-h-9 gap-2 rounded-lg px-2', trigger === 'icon' && 'h-11 w-11 justify-center rounded-xl hover:bg-overlay/5 hover:text-zinc-100')}>
    {trigger ? <AudioLines className="h-4 w-4" /> : null}
    {trigger !== 'icon' ? <span className="shrink-0">{t('voice.select')}</span> : null}
    <select aria-label={t('voice.select')} value={settings.voiceId} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={trigger ? 'absolute inset-0 text-base opacity-0' : 'min-h-9 min-w-0 max-w-52 rounded-lg border border-line/10 bg-inset px-2 text-xs text-zinc-300 disabled:opacity-40'}>
      {!settings.voices.some((voice) => voice.id === settings.voiceId) ? <option value={settings.voiceId}>{settings.voiceId || t('voice.choose')}</option> : null}
      {(['female', 'male'] as const).map((gender) => <optgroup key={gender} label={t(`voice.${gender}`)}>
        {settings.voices.filter((voice) => voice.gender === gender).map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {t(`voice.${voice.language}`)}</option>)}
      </optgroup>)}
    </select>
  </label>
}

"use client"

import { useState } from 'react'
import { useI18n } from '@/lib/i18n/provider'
import { parseRoleplayCast, type RoleplayCast, type RoleplayCharacterOption } from '@/lib/roleplay-script'
import { cn } from '@/lib/utils'

export function RoleplayCastPicker({ options, initial, onStart, hideHeading = false }: {
  options: RoleplayCharacterOption[]
  initial: RoleplayCast | null
  onStart: (cast: RoleplayCast) => void
  hideHeading?: boolean
}) {
  const { t } = useI18n()
  const [playerName, setPlayerName] = useState(initial?.playerName ?? options.find((option) => option.protagonist)?.name ?? '')
  const [counterpartName, setCounterpartName] = useState(initial?.counterpartName ?? '')
  const cast = parseRoleplayCast({ playerName, counterpartName })
  return <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-8 sm:py-10" data-testid="roleplay-cast-picker">
    {!hideHeading ? <div><h3 className="text-lg font-medium text-zinc-100">{t('roleplay.chooseCast')}</h3><p className="mt-2 text-sm leading-6 text-zinc-400">{t('roleplay.chooseCastHint')}</p></div> : null}
    {!options.length ? <p className="rounded-xl bg-overlay/5 p-3 text-sm text-zinc-400">{t('roleplay.noCharacters')}</p> : null}
    {(['player', 'counterpart'] as const).map((side) => {
      const value = side === 'player' ? playerName : counterpartName
      const setValue = side === 'player' ? setPlayerName : setCounterpartName
      const other = side === 'player' ? counterpartName : playerName
      const label = t(side === 'player' ? 'roleplay.playerRole' : 'roleplay.counterpartRole')
      return <fieldset key={side} className="space-y-3">
        <legend className="mb-3 text-sm font-medium text-zinc-200">{label}</legend>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => <button key={option.name} type="button" disabled={option.name === other} aria-pressed={value === option.name} onClick={() => setValue(option.name)} className={cn('min-h-11 rounded-xl border px-3 text-sm disabled:opacity-30', value === option.name ? 'border-violet-400/50 bg-violet-500/15 text-violet-200' : 'border-line/10 text-zinc-300 hover:bg-overlay/5')}>
            {option.name}{option.protagonist ? ` · ${t('roleplay.protagonist')}` : ''}
          </button>)}
        </div>
        <input aria-label={label} value={value} onChange={(event) => setValue(event.target.value)} maxLength={80} placeholder={t('roleplay.customName')} className="min-h-11 w-full rounded-xl border border-line/10 bg-inset px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/50" />
      </fieldset>
    })}
    {playerName.trim() && playerName.trim() === counterpartName.trim() ? <p role="alert" className="text-sm text-rose-300">{t('roleplay.differentCharacters')}</p> : null}
    <button type="button" disabled={!cast} onClick={() => { if (cast) onStart(cast) }} className="min-h-11 w-full rounded-xl bg-violet-500 px-4 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40">{t('roleplay.enterScene')}</button>
  </div>
}

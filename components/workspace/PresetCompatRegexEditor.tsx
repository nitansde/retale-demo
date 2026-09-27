"use client"

import type { ChangeEvent } from 'react'
import type { PresetCompatRegexRecord } from '@/lib/preset-compat/types'
import { cn } from '@/lib/utils'

type PresetCompatRegexEditorProps = {
  title?: string
  regexRecord: PresetCompatRegexRecord
  onUpdate: (updates: Partial<PresetCompatRegexRecord>) => void
  attachment?: {
    attached: boolean
    onToggle: () => void
    testId: string
  }
}

const SUPPORTED_RUNTIME_REGEX_PLACEMENTS = new Set(['user_input', 'assistant_output'])

function buildRegexWarnings(regexRecord: PresetCompatRegexRecord) {
  const warnings: string[] = []
  const unsupportedPlacements = regexRecord.placements.filter((placement) => !SUPPORTED_RUNTIME_REGEX_PLACEMENTS.has(placement))
  const substituteRegexValue = typeof regexRecord.substituteRegex === 'string'
    ? Number(regexRecord.substituteRegex)
    : regexRecord.substituteRegex

  if (unsupportedPlacements.length) warnings.push(`Preserved-only placements: ${unsupportedPlacements.join(', ')}`)
  if (typeof substituteRegexValue === 'number' && Number.isFinite(substituteRegexValue) && substituteRegexValue !== 0) {
    warnings.push(`substituteRegex=${substituteRegexValue} is outside the MVP runtime subset.`)
  }

  return warnings
}

function updateTextField(
  event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  onUpdate: (updates: Partial<PresetCompatRegexRecord>) => void,
  field: keyof Pick<PresetCompatRegexRecord, 'name' | 'pattern' | 'replacement' | 'flags'>
) {
  onUpdate({ [field]: event.target.value })
}

export function PresetCompatRegexEditor({ title, regexRecord, onUpdate, attachment }: PresetCompatRegexEditorProps) {
  const warnings = buildRegexWarnings(regexRecord)
  const runtimePlacements = regexRecord.placements.filter((placement) => SUPPORTED_RUNTIME_REGEX_PLACEMENTS.has(placement))

  return (
    <div className="rounded-[24px] border border-line/8 bg-shade/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{title ?? 'Regex rule'}</p>
          <p className="mt-2 text-sm font-medium text-zinc-100">{regexRecord.name || 'Unnamed regex rule'}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {runtimePlacements.length ? runtimePlacements.map((placement) => (
              <span key={placement} className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-100">
                runtime: {placement}
              </span>
            )) : (
              <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100">
                no active runtime placement
              </span>
            )}
            <span className={cn(
              'rounded-full border px-2.5 py-1 text-[11px]',
              regexRecord.disabled
                ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                : 'border-sky-400/20 bg-sky-500/10 text-sky-100'
            )}>
              {regexRecord.disabled ? 'disabled' : 'enabled'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {attachment ? (
            <button
              type="button"
              data-testid={attachment.testId}
              onClick={attachment.onToggle}
              className={cn(
                'rounded-2xl border px-3 py-2 text-xs transition',
                attachment.attached
                  ? 'border-violet-400/30 bg-violet-500/12 text-violet-100 hover:bg-violet-500/20'
                  : 'border-line/10 bg-shade/20 text-zinc-300 hover:bg-overlay/[0.06]'
              )}
            >
              {attachment.attached ? 'Detach from preset' : 'Attach to preset'}
            </button>
          ) : null}

          <label className="inline-flex items-center gap-2 rounded-2xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              data-testid={`preset-compat-${attachment ? 'standalone' : 'embedded'}-regex-toggle-${regexRecord.id}`}
              checked={!regexRecord.disabled}
              onChange={(event) => onUpdate({ disabled: !event.target.checked })}
              className="h-3.5 w-3.5 rounded border-line/20 bg-transparent"
            />
            Runtime enabled
          </label>
        </div>
      </div>

      {warnings.length ? (
        <div className="mt-4 rounded-[20px] border border-amber-300/18 bg-amber-500/10 p-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-amber-100/80">Preserved-only behavior</p>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Name</span>
          <input
            value={regexRecord.name}
            onChange={(event) => updateTextField(event, onUpdate, 'name')}
            className="w-full rounded-2xl border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Flags</span>
          <input
            value={regexRecord.flags}
            onChange={(event) => updateTextField(event, onUpdate, 'flags')}
            className="w-full rounded-2xl border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none"
            placeholder="gim"
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3">
        <label className="block">
          <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Pattern</span>
          <textarea
            value={regexRecord.pattern}
            onChange={(event) => updateTextField(event, onUpdate, 'pattern')}
            className="h-24 w-full rounded-[20px] border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Replacement</span>
          <textarea
            value={regexRecord.replacement}
            onChange={(event) => updateTextField(event, onUpdate, 'replacement')}
            className="h-24 w-full rounded-[20px] border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none"
          />
        </label>
      </div>
    </div>
  )
}

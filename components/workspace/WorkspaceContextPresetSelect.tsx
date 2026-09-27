"use client"

import { useEffect, useId } from 'react'
import { useI18n } from '@/lib/i18n/provider'
import { withNovelRewritePreset } from '@/lib/preset-compat/novel-preset'
import { toUserFacingPresetCompatError } from '@/lib/workspace-user-facing-errors'
import { useNovelStore } from '@/store/novel-store'

export function WorkspaceContextPresetSelect({ novelId, disabled, onOpenLibrary }: {
  novelId: string
  disabled: boolean
  onOpenLibrary: () => void
}) {
  const { locale, t } = useI18n()
  const id = useId()
  const library = useNovelStore((state) => state.presetCompatLibrary)
  const loading = useNovelStore((state) => state.presetCompatLibraryLoading)
  const error = useNovelStore((state) => state.presetCompatLibraryError)
  const dirty = useNovelStore((state) => state.presetCompatLibraryDirty)
  const loadLibrary = useNovelStore((state) => state.loadPresetCompatLibrary)
  const saveLibrary = useNovelStore((state) => state.savePresetCompatLibrary)
  const bindPreset = useNovelStore((state) => state.bindPresetCompatPresetToNovel)

  useEffect(() => {
    const state = useNovelStore.getState()
    // Keep any unsaved changes from the preset editor when reopening this panel.
    if (!state.presetCompatLibraryDirty && !state.presetCompatLibraryLoading) {
      void loadLibrary().catch(() => undefined)
    }
  }, [loadLibrary])

  const binding = withNovelRewritePreset(library, novelId).surfaceBindings.rewrite
  const selectedId = binding.enabled && binding.presetId && library.presets[binding.presetId]
    ? binding.presetId : ''
  const presets = Object.values(library.presets).sort((a, b) => a.name.localeCompare(b.name, locale))

  return <div className="mb-5 border-b border-line/10 pb-5">
    <div className="mb-2 flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-zinc-300">{t('workspace.contextPreset.label')}</label>
      <button type="button" onClick={onOpenLibrary} disabled={disabled || loading} className="min-h-11 shrink-0 px-1 text-xs text-violet-300 transition hover:text-violet-200 disabled:opacity-40">{t('workspace.contextPreset.manage')}</button>
    </div>
    <select
      id={id}
      data-testid="workspace-context-preset-select"
      aria-describedby={`${id}-description`}
      value={selectedId}
      disabled={disabled || loading || Boolean(error && !dirty)}
      onChange={(event) => {
        bindPreset(novelId, event.target.value || null)
        void saveLibrary().catch(() => undefined)
      }}
      className="min-h-11 w-full min-w-0 rounded-xl border border-line/10 bg-surface px-3 py-2.5 text-sm text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 disabled:opacity-50"
    >
      <option value="">{loading && !selectedId ? t('common.loading') : t('preset.noPreset')}</option>
      {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select>
    <p id={`${id}-description`} className="mt-2 text-xs leading-5 text-zinc-500">{t('workspace.contextPreset.description')}</p>
    {error ? <div role="alert" className="mt-2 text-sm text-rose-300">
      <p>{toUserFacingPresetCompatError(dirty ? 'save' : 'load', error, locale)}</p>
      <button type="button" disabled={disabled || loading} onClick={() => { void (dirty ? saveLibrary() : loadLibrary()).catch(() => undefined) }} className="min-h-11 text-violet-300 disabled:opacity-40">{t('workspace.contextPreset.retry')}</button>
    </div> : null}
  </div>
}

import type { PresetCompatLibrary } from '@/lib/preset-compat/types'

// A missing entry inherits the existing default; null explicitly opts this book out.
export function withNovelRewritePreset(library: PresetCompatLibrary, novelId?: string | null): PresetCompatLibrary {
  const overrides = library.novelRewritePresetIds
  if (!novelId || !overrides || !Object.hasOwn(overrides, novelId)) return library
  const presetId = overrides[novelId]
  const availableId = presetId && library.presets[presetId] ? presetId : null
  return {
    ...library,
    surfaceBindings: {
      ...library.surfaceBindings,
      rewrite: { ...library.surfaceBindings.rewrite, presetId: availableId, enabled: Boolean(availableId) },
    },
  }
}

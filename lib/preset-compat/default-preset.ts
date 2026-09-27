import chineseDefaultPreset from '@/config/presets/retale-default-zh-CN.json'
import { normalizePresetCompatPresetImport } from '@/lib/preset-compat/normalize'

export const RETALE_DEFAULT_PRESET_ID = 'retale-default-zh-CN'
export const PRESET_COMPAT_BUNDLED_DEFAULTS_VERSION = 1

export function createChineseDefaultPreset() {
  return normalizePresetCompatPresetImport(chineseDefaultPreset, {
    idFactory: () => RETALE_DEFAULT_PRESET_ID,
    // Bundled content has no import time; keep it behind the user's recent imports.
    now: '1970-01-01T00:00:00.000Z',
  }).preset
}

export const THEME_PREFERENCE_COOKIE = 'retale.theme.v1'
export const THEME_OPTIONS = ['dark', 'light', 'green'] as const
export type ThemeId = (typeof THEME_OPTIONS)[number]
export const DEFAULT_THEME: ThemeId = 'dark'

export function parseThemePreference(value: string | undefined): ThemeId {
  return THEME_OPTIONS.find((theme) => theme === value) ?? DEFAULT_THEME
}

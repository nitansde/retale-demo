import type { CSSProperties } from 'react'

export const FONT_PREFERENCES_COOKIE = 'retale.font-preferences.v1'

const SANS_FALLBACK = 'var(--font-noto-sans-sc), var(--font-geist-sans), sans-serif'
const SERIF_FALLBACK = 'var(--font-noto-serif-sc), serif'

export const FONT_OPTIONS = [
  { id: 'noto-sans-sc', label: '思源黑体 · Noto Sans SC', group: 'chinese', family: SANS_FALLBACK },
  { id: 'noto-serif-sc', label: '思源宋体 · Noto Serif SC', group: 'chinese', family: SERIF_FALLBACK },
  { id: 'pingfang', label: '苹方 · PingFang', group: 'chinese', family: `"PingFang SC", "PingFang TC", ${SANS_FALLBACK}` },
  { id: 'microsoft-yahei', label: '微软雅黑 · Microsoft YaHei', group: 'chinese', family: `"Microsoft YaHei", ${SANS_FALLBACK}` },
  { id: 'simsun', label: '宋体 · SimSun', group: 'chinese', family: `SimSun, "Songti SC", ${SERIF_FALLBACK}` },
  { id: 'kaiti', label: '楷体 · KaiTi', group: 'chinese', family: `KaiTi, "Kaiti SC", STKaiti, ${SERIF_FALLBACK}` },
  { id: 'geist', label: 'Geist', group: 'english', family: `var(--font-geist-sans), ${SANS_FALLBACK}` },
  { id: 'arial', label: 'Arial', group: 'english', family: `Arial, Helvetica, ${SANS_FALLBACK}` },
  { id: 'verdana', label: 'Verdana', group: 'english', family: `Verdana, ${SANS_FALLBACK}` },
  { id: 'georgia', label: 'Georgia', group: 'english', family: `Georgia, ${SERIF_FALLBACK}` },
  { id: 'times-new-roman', label: 'Times New Roman', group: 'english', family: `"Times New Roman", Times, ${SERIF_FALLBACK}` },
] as const

export type FontId = (typeof FONT_OPTIONS)[number]['id']
export type FontPreferences = { interfaceFont: FontId; readingFont: FontId }

export const DEFAULT_FONT_PREFERENCES: FontPreferences = {
  interfaceFont: 'noto-sans-sc',
  readingFont: 'noto-serif-sc',
}

export function isFontId(value: unknown): value is FontId {
  return FONT_OPTIONS.some((font) => font.id === value)
}

export function parseFontPreferences(raw: string | undefined): FontPreferences {
  try {
    const value: unknown = JSON.parse(decodeURIComponent(raw ?? ''))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_FONT_PREFERENCES
    const preferences = value as Record<string, unknown>
    return {
      interfaceFont: isFontId(preferences.interfaceFont) ? preferences.interfaceFont : DEFAULT_FONT_PREFERENCES.interfaceFont,
      readingFont: isFontId(preferences.readingFont) ? preferences.readingFont : DEFAULT_FONT_PREFERENCES.readingFont,
    }
  } catch {
    return DEFAULT_FONT_PREFERENCES
  }
}

export function getFontFamily(id: FontId): string {
  return FONT_OPTIONS.find((font) => font.id === id)?.family ?? SANS_FALLBACK
}

export function getFontPreferenceStyles(preferences: FontPreferences) {
  return {
    '--font-app-ui': getFontFamily(preferences.interfaceFont),
    '--font-app-reading': getFontFamily(preferences.readingFont),
  } as CSSProperties & Record<'--font-app-ui' | '--font-app-reading', string>
}

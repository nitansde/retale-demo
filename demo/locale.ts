import type { Locale } from '@/lib/i18n/messages';
let activeLocale: Locale = 'zh';
export const getDemoLocale = () => activeLocale;
export function setDemoLocale(locale: Locale) { activeLocale = locale; }

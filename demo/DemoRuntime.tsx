"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { FontPreferencesProvider } from "@/components/FontPreferencesProvider";
import { ThemePreferencesProvider } from "@/components/ThemePreferencesProvider";
import {
  FONT_PREFERENCES_COOKIE,
  parseFontPreferences,
} from "@/lib/font-preferences";
import {
  THEME_PREFERENCE_COOKIE,
  parseThemePreference,
} from "@/lib/theme-preferences";

import { useI18n } from '@/lib/i18n/provider';
import { usePathname } from 'next/navigation';
import { useNovelStore } from '@/store/novel-store';
import { setDemoLocale } from './locale';

let ready: Promise<unknown> | undefined;

export function DemoRuntime({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const pathname = usePathname();
  // Set the adapter before child effects request data for the new UI language.
  useLayoutEffect(() => { setDemoLocale(locale); }, [locale]);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    ready ??= import("./browser").then(({ startDemo }) => startDemo());
    let active = true;
    ready
      .then(() => {
        if (active) setStarted(true);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!started) return;
    // The upstream library loader also selects a book. Never run it over an open workspace.
    if (pathname === '/' || pathname.replace(/\/$/, '').endsWith('/library')) {
      void useNovelStore.getState().loadLibrarySummaries({ fresh: true }).catch(() => {});
    }
  }, [started, locale, pathname]);
  if (error)
    return (
      <main className="p-8 text-zinc-200">
        {locale === 'en' ? 'Demo data could not load. Allow Service Workers for this site, then refresh.' : '演示数据加载失败。请允许此站点使用 Service Worker 后刷新。'}
        <pre className="mt-4 whitespace-pre-wrap text-xs">{error}</pre>
      </main>
    );
  if (!started) return <LoadingScreen />;
  return <ReadyApp>{children}</ReadyApp>;
}

function ReadyApp({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const [preferences] = useState(() => {
    const cookies = Object.fromEntries(
      document.cookie.split("; ").map((item) => {
        const index = item.indexOf("=");
        return [item.slice(0, index), item.slice(index + 1)];
      }),
    );
    return {
      theme: parseThemePreference(cookies[THEME_PREFERENCE_COOKIE]),
      fonts: parseFontPreferences(cookies[FONT_PREFERENCES_COOKIE]),
    };
  });
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
  return (
    <ThemePreferencesProvider initialTheme={preferences.theme}>
      <FontPreferencesProvider initialPreferences={preferences.fonts}>
        {children}
        <div
          className="fixed bottom-0 left-0 z-[90] flex items-center gap-3 rounded-tr-lg border border-line/10 bg-panel/95 px-2 py-1 text-[10px] text-zinc-400"
          role="note"
        >
          <span>{locale === 'en' ? 'Demo · Originals & classics · Simulated AI' : 'Demo · 原创 / 公版选篇 · 模拟 AI'}</span>
          <button
            className="text-violet-200 hover:underline"
            onClick={async () => {
              const { resetDemo } = await import("./browser");
              await resetDemo();
              // A document reload also clears the upstream Zustand store and API caches.
              window.history.replaceState(
                null,
                "",
                `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`,
              );
              window.location.reload();
            }}
          >
            {locale === 'en' ? 'Reset demo' : '重置演示'}
          </button>
        </div>
      </FontPreferencesProvider>
    </ThemePreferencesProvider>
  );
}

import type { Metadata } from "next";
import { Geist, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import { DemoRuntime } from "@/demo/DemoRuntime";
import {
  getFontPreferenceStyles,
  parseFontPreferences,
} from "@/lib/font-preferences";
import { parseThemePreference } from "@/lib/theme-preferences";
import { I18nProvider } from "@/lib/i18n/provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
  weight: "variable",
});

const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  subsets: ["latin"],
  weight: "variable",
});

export const metadata: Metadata = {
  title: {
    default: "ReTale · 戏说",
    template: "%s · ReTale · 戏说",
  },
  description: "ReTale 互动演示。原版界面，内置虚构小说与模拟 AI 结果。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const fontPreferences = parseFontPreferences(undefined);
  const initialTheme = parseThemePreference(undefined);
  const localeCookiePresent = false;
  const initialLocale = "zh";

  return (
    <html
      lang={initialLocale === "zh" ? "zh-CN" : "en"}
      data-locale={initialLocale}
      data-theme={initialTheme}
      style={getFontPreferenceStyles(fontPreferences)}
      className={`${geistSans.variable} ${notoSansSC.variable} ${notoSerifSC.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-zinc-100">
        <I18nProvider
          initialLocale={initialLocale}
          localeCookiePresent={localeCookiePresent}
        >
          <DemoRuntime>{children}</DemoRuntime>
        </I18nProvider>
      </body>
    </html>
  );
}

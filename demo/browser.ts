import { http, passthrough } from "msw";
import { setupWorker } from "msw/browser";
import { createDemoApi } from "./api";
import { getDemoLocale } from "./locale";
import { removeBrowserWorkspaceNovelSession } from "@/lib/browser-preferences";
import { CHAPTER_DRAFT_CACHE_STORAGE_KEY } from "@/lib/chapter-draft-cache";

const storageKey = "retale.demo.database.v1";
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
let fetchPatched = false;
export async function startDemo() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {
    /* Restricted storage uses memory. */
  }
  const api = createDemoApi(saved, (value) => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      /* In-memory demo remains usable. */
    }
  }, getDemoLocale);
  if (!fetchPatched && basePath) {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const source = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const url = new URL(source, window.location.href);
      if (url.pathname.startsWith("/api/")) {
        url.pathname = `${basePath}${url.pathname}`;
        if (input instanceof Request) return nativeFetch(new Request(url, input), init);
        return nativeFetch(url, init);
      }
      return nativeFetch(input, init);
    };
    fetchPatched = true;
  }
  const worker = setupWorker(
    http.all("*", async ({ request }) => {
      const url = new URL(request.url);
      const apiPath = basePath && url.pathname.startsWith(`${basePath}/`)
        ? url.pathname.slice(basePath.length)
        : url.pathname;
      if (apiPath.startsWith("/api/")) {
        if (apiPath !== url.pathname) {
          url.pathname = apiPath;
          return api.handle(new Request(url, request));
        }
        return api.handle(request);
      }
      return passthrough();
    }),
  );
  await worker.start({
    quiet: true,
    onUnhandledRequest: "bypass",
    serviceWorker: {
      url: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/mockServiceWorker.js`,
    },
  });
}

export async function resetDemo() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const novelIds = new Set([
    "demo-mist",
    "demo-star",
    ...Object.keys(saved.novels || {}),
  ]);
  localStorage.removeItem(storageKey);
  for (const novelId of novelIds) removeBrowserWorkspaceNovelSession(novelId);
  const rawDrafts = localStorage.getItem(CHAPTER_DRAFT_CACHE_STORAGE_KEY);
  if (rawDrafts) {
    const drafts = JSON.parse(rawDrafts);
    if (Array.isArray(drafts.entries)) {
      drafts.entries = drafts.entries.filter(
        (entry: { novelId: string }) => !novelIds.has(entry.novelId),
      );
      localStorage.setItem(
        CHAPTER_DRAFT_CACHE_STORAGE_KEY,
        JSON.stringify(drafts),
      );
    }
  }
}

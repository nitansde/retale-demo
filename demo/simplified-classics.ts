import { Converter } from 'opencc-js/t2cn';
import { createChapterContentFingerprint } from '@/lib/chapter-draft-cache';
import { countChineseFriendlyWords, htmlToPlainText } from '@/lib/utils';

export const simplifiedClassicIds = new Set(['demo-redcliff', 'demo-monkey']);
export const simplifyChinese = Converter({ from: 't', to: 'cn' });

// Convert prose while leaving identifiers, links and persistence keys intact.
export function simplifyClassicValue<T>(value: T, field = ''): T {
  if (/(?:Id|Ids|Fingerprint)$/.test(field) || field === 'id' || field === 'url') return value;
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value)) return value;
    return simplifyChinese(value).replaceAll('完整繁体原文', '完整简体原文') as T;
  }
  if (Array.isArray(value)) return value.map(item => simplifyClassicValue(item, field)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, simplifyClassicValue(item, key)])) as T;
  }
  return value;
}

export function simplifyClassicDrafts(saved: string | null, rawDrafts: string | null): string | null {
  if (!saved || !rawDrafts) return rawDrafts;
  const previous = JSON.parse(saved);
  if (previous.version !== 1 || (previous.catalogVersion || 1) >= 5) return rawDrafts;
  const drafts = JSON.parse(rawDrafts);
  if (!Array.isArray(drafts.entries)) return rawDrafts;
  for (const draft of drafts.entries) {
    if (!simplifiedClassicIds.has(draft.novelId) || typeof draft.content !== 'string') continue;
    const chapter = previous.novels?.[draft.novelId]?.localChapters?.find((c: { id: string }) => c.id === draft.chapterId);
    // Only rebase drafts that matched the old text; preserve genuine conflicts for the upstream recovery UI.
    if (chapter && draft.baseContentFingerprint === createChapterContentFingerprint(chapter.content)) {
      draft.baseContentFingerprint = createChapterContentFingerprint(simplifyChinese(chapter.content));
    }
    draft.content = simplifyChinese(draft.content);
    draft.wordCount = countChineseFriendlyWords(htmlToPlainText(draft.content));
  }
  return JSON.stringify(drafts);
}

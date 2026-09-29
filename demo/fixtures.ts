import { demoBookById, chineseBooks } from './catalog';
import { makeCatalogNovel, makeCatalogGraph } from './catalog/runtime';
import type { DemoScenario } from './catalog/types';
import { createDefaultAISettings } from '@/lib/ai-settings';
import { createDefaultPresetCompatLibrary } from '@/lib/preset-compat/surface-contract';
import type { WritingSkillCardDetail } from '@/lib/writing-skill-types';

export const seedDate = '2026-09-27T08:00:00.000Z';

export function makeNovel(id: string) {
  const book = demoBookById[id];
  if (!book) throw new Error(`Unknown demo book: ${id}`);
  return makeCatalogNovel(book);
}

export function makeSettings() {
  const settings = createDefaultAISettings();
  for (const scenario of Object.values(settings)) {
    scenario.provider = 'openai-compatible';
    Object.assign(scenario.openAICompatible, {
      baseUrl: 'https://demo.invalid/v1', model: 'ReTale Dummy Model', apiKey: '',
      apiKeyConfigured: true, apiKeyMasked: 'demo', configured: true,
    });
  }
  return settings;
}

export const makeGraph = makeCatalogGraph;

export function makeSkill(id: string, title: string, novelId: string): WritingSkillCardDetail {
  const book = demoBookById[novelId] || chineseBooks[0];
  const chapter = book.scenario.chapter;
  const sourceChapter = book.chapters[chapter - 1];
  return {
    id, libraryId: book.id, libraryVersion: '1', libraryName: book.title,
    title: demoBookById[novelId] ? book.skill.title : title,
    userInstruction: book.skill.rule, summary: book.skill.rule,
    applicationScope: book.tags.join(book.locale === 'en' ? ', ' : '、'),
    rules: [{ text: book.skill.rule, evidenceRefs: [sourceChapter.title] }],
    avoid: [book.skill.avoid], defaultExampleCount: 1, modelConfigId: 'demo',
    status: 'ACTIVE', sourceJobId: null, createdAt: seedDate, updatedAt: seedDate, exampleCount: 1,
    sources: [{ sourceType: 'LIBRARY', sourceId: book.id, sourceName: book.title, sourceVersion: '1', sourceOrder: 0 }],
    examples: [{
      id: `${id}-ex`, skillCardId: id,
      rangeRef: { libraryId: book.id, libraryVersion: '1', workId: book.id,
        chapterId: `${book.id}-ch-${chapter}`, startParagraphId: 'p1', endParagraphId: 'p3' },
      displayRef: `${sourceChapter.title} / ${book.locale === 'en' ? 'paragraphs 1–3' : '1–3 段'}`,
      score: 0.96, enabled: true, createdAt: seedDate,
      anonymizedText: sourceChapter.text.split('\n\n').slice(0, 3).join('\n\n'),
    }],
  };
}

export { createDefaultPresetCompatLibrary };

export function scenarioFor(novelId: string): DemoScenario {
  return (demoBookById[novelId] || chineseBooks[0]).scenario;
}

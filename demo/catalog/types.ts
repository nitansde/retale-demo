import type { OutlineType, WorldEntryType, CharacterRelation } from '@/lib/types';

export type DemoScenario = {
  chapter: number;
  sourceText: string;
  instruction: string;
  rewriteText: string;
  continueText: string;
  whatIfText: string;
  futureText: string;
  bridge: string;
  titles: Record<string, string>;
  delta: { before: string; after: string; description: string };
  roleplay: { opening: string; reply: string; narration: string; responses: string[] };
  alternative?: { title: string; instruction: string; text: string };
};
export type DemoBook = {
  id: string;
  title: string;
  author: string;
  tags: string[];
  summary: string;
  chapters: { title: string; text: string; summary: string }[];
  characters: { name: string; role: string; goal: string; trait: string; note: string; voice: string; aliases?: string[] }[];
  relations: { from: number; to: number; label: string; status: CharacterRelation['status']; note: string; chapter: number }[];
  world: { title: string; type: WorldEntryType; content: string }[];
  outlines: { title: string; type: OutlineType; summary: string; chapters: number[] }[];
  scenario: DemoScenario;
  skill: { title: string; rule: string; avoid: string };
  source?: { url: string; note: string };
};

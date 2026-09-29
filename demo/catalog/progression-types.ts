import type { CharacterRelation } from '@/lib/types';

// Each entry is a complete replacement of the previous state, revealed at the END
// of an excerpt chapter. Cues must occur literally in that chapter's source text.
export type CharacterStage = [chapter: number, role: string, note: string, cue: string, name?: string];
export type RelationStage = [chapter: number, label: string, note: string, cue: string, status?: CharacterRelation['status']];
export type WorldStage = [chapter: number, content: string, cue: string, title?: string];
export type BookProgression = {
  characters: Record<number, CharacterStage[]>;
  relations: Record<number, RelationStage[]>;
  world: Record<number, WorldStage[]>;
};

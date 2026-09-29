import { demoBookById, bookLocale } from './catalog';
import { chineseProgression } from './catalog/progression-zh';
import { englishProgression } from './catalog/progression-en';
import { classicProgression } from './catalog/progression-classics';
import { makeCatalogNovel } from './catalog/runtime';
import { htmlToPlainText } from '@/lib/utils';
import type { Character, PersistedNovelState } from '@/lib/types';
import type { GraphAwareResult, GraphEdge } from '@/lib/server/graph-types';

export const progressions = { ...chineseProgression, ...englishProgression, ...classicProgression };
export const knowledgeKeys = ['localCharacters', 'localCharacterRelations', 'localWorldEntries', 'localOutlines', 'localTimelineEvents'] as const;
type Collection = typeof knowledgeKeys[number];
export type KnowledgeProjection = Pick<PersistedNovelState, Collection>;
type KnowledgeRow = KnowledgeProjection[Collection][number];
export type KnowledgeEdit = { chapter: number; collection: Collection; id: string; patch: Record<string, unknown> | null };
export type GraphEdits = Record<string, Partial<GraphEdge>>;
export const emptyProjection = (): KnowledgeProjection => ({localCharacters:[],localCharacterRelations:[],localWorldEntries:[],localOutlines:[],localTimelineEvents:[]});
const seeds = new Map<string, PersistedNovelState>();

export function chapterCutoff(novel: PersistedNovelState | undefined, value?: unknown, chapterId?: unknown) {
  const chapters = novel?.localChapters || [];
  const max = Math.max(1, ...chapters.map(c => c.order));
  const explicit = Number(value);
  const selected = chapters.find(c => c.id === chapterId)?.order;
  const remembered = chapters.find(c => c.id === novel?.currentChapterId)?.order;
  return Math.max(1, Math.min(max, Math.floor(selected ?? (Number.isFinite(explicit) && explicit > 0 ? explicit : remembered || 1))));
}

// Use actual saved prose. If a visitor removes the supporting passage, the
// corresponding authored fact is no longer asserted by the simulated extractor.
export function findEvidence(novel: PersistedNovelState, chapter: number, cue: string) {
  const source = novel.localChapters.find(c => c.order === chapter);
  if (!source) return null;
  const lines = htmlToPlainText(source.content).split('\n');
  const index = lines.findIndex(line => line.includes(cue));
  if (index < 0) return null;
  return { quote:lines[index].trim(), location:{chapterNo:chapter,lineStart:index+1,lineEnd:index+1}, title:source.title };
}

function latest<T extends [number, ...unknown[]]>(stages: T[], cutoff: number, novel: PersistedNovelState, cueIndex: number) {
  return stages.filter(s => s[0] <= cutoff && findEvidence(novel,s[0],String(s[cueIndex]))).at(-1);
}

function applyPatch(projection: KnowledgeProjection, edit: KnowledgeEdit) {
  const rows = projection[edit.collection] as KnowledgeRow[];
  const index = rows.findIndex(row => row.id === edit.id);
  if (!edit.patch) {
    if (index >= 0) rows.splice(index,1);
  } else if (index >= 0) {
    rows[index] = {...rows[index],...edit.patch} as KnowledgeRow;
    if (edit.collection === 'localCharacters' && !edit.patch.profile) {
      const character = rows[index] as Character;
      character.profile = {...character.profile};
      // A visitor correction must be visible in the profile too, and must not
      // retain an authored citation as if it proved the visitor's new wording.
      if (typeof edit.patch.role === 'string') character.profile.identity = {content:edit.patch.role};
      if (typeof edit.patch.note === 'string') character.profile.capability = {content:edit.patch.note};
      if (typeof edit.patch.trait === 'string') character.profile.personality = {content:edit.patch.trait};
    }
  } else if (edit.patch.novelId) {
    rows.push(edit.patch as KnowledgeRow);
  }
}

export function projectKnowledge(novel: PersistedNovelState | undefined, cutoff: number, edits: KnowledgeEdit[] = []): KnowledgeProjection {
  if (!novel) return emptyProjection();
  const book = demoBookById[novel.currentNovelId];
  const arc = progressions[novel.currentNovelId];
  const projection = emptyProjection();
  const chapterIds = new Set(novel.localChapters.filter(c => c.order <= cutoff).map(c => c.id));
  if (!book || !arc) {
    // Imports have no authored story model. Only explicit chapter-linked knowledge
    // is projected; never borrow the fallback demo's plot or character cards.
    projection.localCharacters = structuredClone(novel.localCharacters);
    projection.localWorldEntries = structuredClone(novel.localWorldEntries);
    projection.localCharacterRelations = novel.localCharacterRelations.filter(r => r.chapterIds.some(id => chapterIds.has(id)));
    projection.localOutlines = novel.localOutlines.filter(o => o.relatedChapterIds.every(id => chapterIds.has(id)));
    projection.localTimelineEvents = novel.localTimelineEvents.filter(e => e.chapterIds.every(id => chapterIds.has(id)));
  } else {
    const key = novel.currentNovelId;
    for (const [index,stages] of Object.entries(arc.characters)) {
      const stage = latest(stages,cutoff,novel,3);
      const base = novel.localCharacters.find(c => c.id === `${key}-person-${index}`);
      if (!stage || !base) continue;
      const [chapter,role,note,cue,renamed] = stage;
      const evidence = findEvidence(novel,chapter,cue)!;
      const name = renamed || book.characters[Number(index)].name;
      const revealedText = novel.localChapters.filter(c => c.order <= cutoff).map(c => htmlToPlainText(c.content)).join('\n');
      const aliases = (base.aliases || []).filter(alias => revealedText.includes(alias));
      const citation = `${evidence.title} · ${evidence.location.lineStart}: ${evidence.quote}`;
      projection.localCharacters.push({
        id:base.id, novelId:key, name, aliases, role, note, goal:'', trait:'',
        importanceTier:base.importanceTier, classificationKey:base.classificationKey,
        profile:{identity:{content:role,evidence:citation},capability:{content:note,evidence:citation}},
      });
    }
    const visible = new Set(projection.localCharacters.map(c => c.id));
    for (const [index,stages] of Object.entries(arc.relations)) {
      const stage = latest(stages,cutoff,novel,3);
      const base = novel.localCharacterRelations.find(r => r.id === `${key}-relation-${index}`);
      if (!stage || !base || !visible.has(base.fromCharacterId) || !visible.has(base.toCharacterId)) continue;
      const [chapter,label,note,,status = 'active'] = stage;
      projection.localCharacterRelations.push({...base,label,note,status,chapterIds:[novel.localChapters.find(c => c.order===chapter)!.id]});
    }
    for (const [index,stages] of Object.entries(arc.world)) {
      const stage = latest(stages,cutoff,novel,2);
      const base = novel.localWorldEntries.find(w => w.id === `${key}-world-${index}`);
      if (!stage || !base) continue;
      projection.localWorldEntries.push({...base,title:stage[3] || book.world[Number(index)].title,content:stage[1]});
    }
    projection.localTimelineEvents = novel.localTimelineEvents.filter(e => e.chapterIds.every(id => chapterIds.has(id))).map(event => {
      const chapter = novel.localChapters.find(c => event.chapterIds.includes(c.id));
      return chapter && chapter.content !== chapter.originalContent ? {...event,summary:htmlToPlainText(chapter.content).slice(0,240)} : {...event};
    });
    // A thread crossing the cutoff gets only the events already revealed. The
    // canonical outline's final title and synopsis can contain the solution.
    projection.localOutlines = novel.localOutlines.flatMap(outline => {
      const seen = outline.relatedChapterIds.filter(id => chapterIds.has(id));
      if (!seen.length) return [];
      const events = projection.localTimelineEvents.filter(e => e.chapterIds.some(id => seen.includes(id)));
      const complete = seen.length === outline.relatedChapterIds.length && novel.localChapters.filter(c => seen.includes(c.id)).every(c => c.content === c.originalContent);
      return [{...outline,relatedChapterIds:seen,title:complete?outline.title:events[0]?.title || (book.locale==='en'?'Story so far':'已知进展'),summary:events.map(e => e.summary).join('\n')}];
    });
    // Keep pre-existing visitor edits without making old full-book seed notes a
    // source of early spoilers. New edits are saved separately below.
    let seed = seeds.get(key);
    if (!seed) { seed = makeCatalogNovel(book); seeds.set(key,seed); }
    const legacyFrom = chapterCutoff(novel);
    if (cutoff >= legacyFrom) for (const collection of knowledgeKeys) {
      for (const row of novel[collection]) {
        const original = seed[collection].find(r => r.id === row.id);
        if (!original) { applyPatch(projection,{chapter:legacyFrom,collection,id:row.id,patch:{...row}}); continue; }
        const patch = changedFields(original,row);
        if (Object.keys(patch).length) applyPatch(projection,{chapter:legacyFrom,collection,id:row.id,patch});
      }
    }
  }
  for (const edit of [...edits].sort((a,b) => a.chapter-b.chapter)) if (edit.chapter <= cutoff) applyPatch(projection,edit);
  const visible = new Set(projection.localCharacters.map(c => c.id));
  projection.localCharacterRelations = projection.localCharacterRelations.filter(r => visible.has(r.fromCharacterId) && visible.has(r.toCharacterId));
  return projection;
}

function changedFields(before: object, after: object) {
  const old = before as Record<string,unknown>;
  return Object.fromEntries(Object.entries(after).filter(([key,value]) => JSON.stringify(old[key]) !== JSON.stringify(value)));
}

// A workspace save contains only the currently projected cards. Store differences
// from the served projection, never replace the canonical full-book collections.
export function recordKnowledgeEdits(before: KnowledgeProjection, incoming: Partial<KnowledgeProjection>, cutoff: number): KnowledgeEdit[] {
  const changes: KnowledgeEdit[] = [];
  for (const collection of knowledgeKeys) {
    if (!Array.isArray(incoming[collection])) continue;
    const rows = incoming[collection]!;
    for (const previous of before[collection]) {
      const next = rows.find(row => row.id === previous.id);
      if (!next) changes.push({chapter:cutoff,collection,id:previous.id,patch:null});
      else {
        const patch = changedFields(previous,next);
        if (Object.keys(patch).length) changes.push({chapter:cutoff,collection,id:next.id,patch});
      }
    }
    for (const row of rows) if (!before[collection].some(old => old.id === row.id)) changes.push({chapter:cutoff,collection,id:row.id,patch:{...row}});
  }
  return changes;
}

export function projectGraph(novel: PersistedNovelState | undefined, cutoff: number, projection: KnowledgeProjection, graphEdits: GraphEdits = {}): GraphAwareResult {
  const key = novel?.currentNovelId || '';
  const arc = progressions[key];
  const nodes: GraphAwareResult['nodes'] = [
    ...projection.localCharacters.map((c,i) => ({id:c.id,label:c.name,entityType:'character' as const,description:c.note,aliases:c.aliases,
      importance:Math.max(0.5,1-i*0.06),confidence:0.98,userConfirmed:true,firstSeenChapter:arc?.characters[Number(c.id.split('-person-')[1])]?.[0]?.[0] || 1,lastSeenChapter:cutoff,score:1})),
    ...projection.localWorldEntries.map(w => ({id:w.id,label:w.title,entityType:(w.type==='location'?'location':w.type==='organization'?'faction':w.type==='item'?'item':'concept') as GraphAwareResult['nodes'][number]['entityType'],description:w.content,importance:0.6,confidence:0.95,userConfirmed:true,firstSeenChapter:arc?.world[Number(w.id.split('-world-')[1])]?.[0]?.[0] || 1,lastSeenChapter:cutoff,score:0.9})),
  ];
  let edges: GraphEdge[] = [];
  if (novel && arc) {
    for (const relation of projection.localCharacterRelations) {
      const stages = arc.relations[Number(relation.id.split('-relation-')[1])];
      const stage = stages && latest(stages,cutoff,novel,3);
      if (!stage) continue;
      const evidence = findEvidence(novel,stage[0],stage[3])!;
      const next = stages.find(s => s[0] > stage[0] && findEvidence(novel,s[0],s[3]));
      edges.push({id:`${relation.id}-at-${stage[0]}`,source:relation.fromCharacterId,target:relation.toCharacterId,linkType:'related',label:relation.label,description:relation.note,
        strength:0.85,confidence:0.95,validFromChapter:stage[0],validUntilChapter:next?next[0]-1:2147483647,status:'user_confirmed',hop:1,score:0.9,includeInPrompt:true,evidenceQuote:evidence.quote,evidenceLocation:evidence.location});
    }
    for (const world of projection.localWorldEntries) {
      const stages = arc.world[Number(world.id.split('-world-')[1])];
      const stage = stages && latest(stages,cutoff,novel,2);
      if (!stage) continue;
      const evidence = findEvidence(novel,stage[0],stage[2])!;
      // Attach a clue to a character actually present in its supporting passage.
      const character = projection.localCharacters.find(c => [c.name,...c.aliases || []].some(name => evidence.quote.includes(name)));
      if (!character) continue;
      const next = stages.find(s => s[0] > stage[0] && findEvidence(novel,s[0],s[2]));
      edges.push({id:`${world.id}-at-${stage[0]}`,source:character.id,target:world.id,linkType:'related',label:bookLocale(key)==='en'?'Established clue':'已知线索',description:world.content,
        strength:0.65,confidence:0.9,validFromChapter:stage[0],validUntilChapter:next?next[0]-1:2147483647,status:'user_confirmed',hop:1,score:0.8,includeInPrompt:true,evidenceQuote:evidence.quote,evidenceLocation:evidence.location});
    }
  }
  edges = edges.map(edge => ({...edge,...graphEdits[edge.id]})).filter(edge => edge.status !== 'rejected' && edge.validFromChapter <= cutoff && edge.validUntilChapter >= cutoff);
  const contextText = [
    ...nodes.map(n => `${n.label}: ${n.description || ''}`),
    ...edges.filter(e => e.includeInPrompt).map(e => `${e.label}: ${e.description}`),
  ].join('\n');
  return {status:'ready',nodes,edges,seedEntities:nodes.filter(n => n.entityType==='character').slice(0,2),contextText,warnings:[],tokenEstimate:Math.ceil(contextText.length/3)};
}

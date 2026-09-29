import { normalizeWorkspaceState } from '@/lib/workspace-state';
import { plainTextToHtml, countChineseFriendlyWords, htmlToPlainText } from '@/lib/utils';
import type { GraphAwareResult } from '@/lib/server/graph-types';
import type { DemoBook } from './types';

export function makeCatalogNovel(book: DemoBook) {
  const novelId = book.id;
  const chapters = book.chapters.map((chapter, i) => ({
    id: `${novelId}-ch-${i + 1}`, novelId,
    title: book.source ? chapter.title : `第 ${i + 1} 章 ${chapter.title}`,
    order: i + 1, content: plainTextToHtml(chapter.text), originalContent: plainTextToHtml(chapter.text),
    wordCount: countChineseFriendlyWords(chapter.text), status: 'done' as const, updatedAt: '2026-09-29T08:00:00.000Z',
  }));
  return normalizeWorkspaceState({
    currentNovelId: novelId, currentChapterId: chapters[0].id,
    localNovels: [{ id: novelId, title: book.title, summary: book.summary, tags: book.tags }],
    localChapters: chapters,
    localCharacters: book.characters.map((character, i) => ({
      ...character, id: `${novelId}-person-${i}`, novelId,
      aliases: character.aliases || [],
      importanceTier: i === 0 ? 'protagonist' : 'important', classificationKey: i === 0 ? 'tier0' : 'tier1',
      profile: { identity: { content: character.role }, personality: { content: character.trait },
        speakingStyle: { content: character.voice }, capability: { content: character.note } },
    })),
    localCharacterRelations: book.relations.map((r,i) => ({
      id: `${novelId}-relation-${i}`, novelId, fromCharacterId: `${novelId}-person-${r.from}`,
      toCharacterId: `${novelId}-person-${r.to}`, label:r.label, strength:'strong', status:r.status,
      note:r.note, chapterIds:[`${novelId}-ch-${r.chapter}`],
    })),
    localWorldEntries: book.world.map((entry,i) => ({...entry, id:`${novelId}-world-${i}`,novelId})),
    localOutlines: book.outlines.map((outline,i) => ({
      id:`${novelId}-outline-${i}`,novelId,title:outline.title,type:outline.type,summary:outline.summary,
      relatedChapterIds:outline.chapters.map(n=>`${novelId}-ch-${n}`),
    })),
    localTimelineEvents: book.chapters.map((chapter,i) => ({
      id:`${novelId}-event-${i}`,novelId,title:chapter.title,summary:chapter.summary,
      order:i+1,phase:i===0?'开局':i===book.chapters.length-1?'收束':'推进',worldline:'主线',chapterIds:[chapters[i].id],
    })),
  });
}

export function makeCatalogGraph(novel: ReturnType<typeof normalizeWorkspaceState>): GraphAwareResult {
  const total = novel.localChapters.length;
  const nodes: GraphAwareResult['nodes'] = [
    ...novel.localCharacters.map((c,i)=>({id:c.id,label:c.name,entityType:'character' as const,description:c.note,
      importance:Math.max(0.5,1-i*0.06),confidence:0.98,userConfirmed:true,firstSeenChapter:1,lastSeenChapter:total,score:1})),
    ...novel.localWorldEntries.map(w=>({id:w.id,label:w.title,
      entityType:(w.type==='location'?'location':w.type==='organization'?'faction':w.type==='item'?'item':'concept') as GraphAwareResult['nodes'][number]['entityType'],
      description:w.content,importance:0.6,confidence:0.95,userConfirmed:true,score:0.9})),
  ];
  const edges: GraphAwareResult['edges'] = novel.localCharacterRelations.map((r,i)=>{
    const c=novel.localChapters.find(c=>r.chapterIds.includes(c.id)) || novel.localChapters[0];
    const from=novel.localCharacters.find(c=>c.id===r.fromCharacterId)!;
    const to=novel.localCharacters.find(c=>c.id===r.toCharacterId)!;
    const names=[from.name,...(from.aliases||[]),to.name,...(to.aliases||[])];
    const paragraphs=htmlToPlainText(c.content).split('\n\n');
    const index=Math.max(0,paragraphs.findIndex(p=>names.some(name=>p.includes(name))));
    return {id:`${novel.currentNovelId}-edge-${i}`,source:r.fromCharacterId,target:r.toCharacterId,
      linkType:'related',label:r.label,description:r.note,strength:0.85,confidence:0.95,
      validFromChapter:c.order,validUntilChapter:2147483647,status:'user_confirmed',hop:1,score:0.9,includeInPrompt:true,
      evidenceQuote:paragraphs[index],evidenceLocation:{chapterNo:c.order,lineStart:index+1,lineEnd:index+1}};
  });
  // Connect world entities only when a literal mention supplies an actual source passage.
  for (const entry of novel.localWorldEntries) {
    for (const chapter of novel.localChapters) {
      const paragraphs=htmlToPlainText(chapter.content).split('\n\n');
      const index=paragraphs.findIndex(p=>p.includes(entry.title));
      if(index<0) continue;
      edges.push({id:`${novel.currentNovelId}-world-edge-${edges.length}`,source:novel.localCharacters[0].id,target:entry.id,
        linkType:'related',label:'故事线索',description:entry.content,strength:0.65,confidence:0.8,
        validFromChapter:chapter.order,validUntilChapter:2147483647,status:'user_confirmed',hop:1,score:0.8,includeInPrompt:true,
        evidenceQuote:paragraphs[index],evidenceLocation:{chapterNo:chapter.order,lineStart:index+1,lineEnd:index+1}});
      break;
    }
  }
  return {status:'ready',nodes,edges,seedEntities:nodes.slice(0,2),contextText:novel.localNovels[0].summary,warnings:[],tokenEstimate:1200};
}

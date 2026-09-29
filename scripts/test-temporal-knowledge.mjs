import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'

await mkdir('test-results',{recursive:true})
const outfile=resolve('test-results/temporal-api.cjs')
await build({stdin:{contents:'export {createDemoApi} from "./demo/api"; export {demoBooks} from "./demo/catalog"; export {progressions, knowledgeKeys} from "./demo/temporal-knowledge"; export {htmlToPlainText} from "./lib/utils";',resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'})
const {createDemoApi,demoBooks,progressions,knowledgeKeys,htmlToPlainText}=createRequire(import.meta.url)(outfile)
const api=createDemoApi()
const initial=JSON.parse(api.snapshot())
const requestFor=instance=>async(path,body,method=body?'POST':'GET')=>{
  const response=await instance.handle(new Request(`http://demo.test/api/${path}`,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}))
  assert.equal(response.status,200,path)
  return response.json()
}
const request=requestFor(api)
const cards=value=>Object.fromEntries(knowledgeKeys.map(key=>[key,value[key]]))
const knowledge=(id,ch)=>request(`knowledge-view?novelId=${id}&asOfChapter=${ch}`)
const graph=(id,ch,query='')=>request(`graph/subgraph?novelId=${id}&chapterNo=${ch}${query}`)
let stages=0
for(const book of demoBooks){
  const arc=progressions[book.id]
  assert.ok(arc)
  for(const [kind,entries]of Object.entries(arc)){
    assert.equal(Object.keys(entries).length,book[kind==='world'?'world':kind].length,`${book.id}: all ${kind} covered`)
    for(const [index,sequence]of Object.entries(entries)){
      assert.deepEqual(sequence.map(s=>s[0]),[...new Set(sequence.map(s=>s[0]))].sort((a,b)=>a-b))
      for(const stage of sequence){
        stages++
        const cue=stage[kind==='world'?2:3]
        assert.ok(book.chapters[stage[0]-1].text.includes(cue),`${book.id} ${kind}[${index}] chapter ${stage[0]} cue: ${cue}`)
      }
    }
  }
  const first=await knowledge(book.id,1)
  const last=await knowledge(book.id,book.chapters.length)
  assert.notDeepEqual(cards(first),cards(last),`${book.id}: progression`)
  const protagonist=`${book.id}-person-0`
  assert.notEqual(first.localCharacters.find(c=>c.id===protagonist)?.note,last.localCharacters.find(c=>c.id===protagonist)?.note,`${book.id}: replaces protagonist state`)
  for(let chapter=1;chapter<=book.chapters.length;chapter++){
    const projection=await knowledge(book.id,chapter)
    const g=await graph(book.id,chapter)
    const workspace=await request(`novels/${book.id}?view=workspace&chapterId=${book.id}-ch-${chapter}`)
    const context=(await request(`context-preview?novelId=${book.id}&chapterId=${book.id}-ch-${chapter}`)).preview
    assert.equal(context.chapterNo,chapter)
    assert.equal(workspace.currentChapterId,`${book.id}-ch-${chapter}`)
    assert.deepEqual(cards(workspace),cards(projection),`${book.id}: initial workspace uses same projection`)
    assert.deepEqual(context.graphContext.nodes,g.nodes,`${book.id}: prompt and graph agree`)
    assert.equal(context.promptBlocks.find(b=>b.id==='history').content,'','mainline never receives arbitrary branch history')
    assert.deepEqual(projection.localTimelineEvents.map(e=>e.order),Array.from({length:chapter},(_,i)=>i+1))
    for(const c of projection.localCharacters){
      const sequence=arc.characters[Number(c.id.split('-person-')[1])]
      const stage=sequence.filter(s=>s[0]<=chapter).at(-1)
      assert.ok(stage,`${book.id}: hidden future character`)
      assert.equal(c.note,stage[2])
      assert.equal(c.role,stage[1])
      assert.equal(c.name,stage[4]||book.characters[Number(c.id.split('-person-')[1])].name)
    }
    for(const n of g.nodes)assert.ok(n.firstSeenChapter<=chapter && n.lastSeenChapter<=chapter)
    for(const e of g.edges){
      assert.ok(g.nodes.some(n=>n.id===e.source)&&g.nodes.some(n=>n.id===e.target),'no dangling edge')
      assert.ok(e.validFromChapter<=chapter && e.validUntilChapter>=chapter)
      assert.ok(e.evidenceLocation.chapterNo<=chapter,'no future evidence')
      const source=initial.novels[book.id].localChapters[e.evidenceLocation.chapterNo-1]
      assert.equal(htmlToPlainText(source.content).split('\n').slice(e.evidenceLocation.lineStart-1,e.evidenceLocation.lineEnd).join('\n').trim(),e.evidenceQuote,'exact evidence and line numbers')
    }
    for(const outline of projection.localOutlines)assert.ok(outline.relatedChapterIds.every(id=>Number(id.split('-ch-')[1])<=chapter))
  }
  assert.deepEqual(cards(await knowledge(book.id,1)),cards(first),`${book.id}: backward navigation restores early state`)
  // Saving a partial projection must not delete future seed rows or freeze early states.
  const early=await request(`novels/${book.id}?view=workspace&chapterId=${book.id}-ch-1`)
  await request(`novels/${book.id}`,early)
  const saved=JSON.parse(api.snapshot())
  for(const key of knowledgeKeys)assert.deepEqual(saved.novels[book.id][key],initial.novels[book.id][key],`${book.id}: canonical ${key} survives partial save`)
  assert.deepEqual(cards(await knowledge(book.id,book.chapters.length)),cards(last))
  console.log(`PASS ${book.id}: ${book.chapters.length} chapter states, source evidence, prompts, backward navigation and partial save`)
}
assert.ok(!JSON.stringify(cards(await knowledge('demo-sect',1))).includes('天命司'))
assert.ok(!JSON.stringify(cards(await knowledge('demo-monkey',1))).includes('五行山'))
assert.ok(!JSON.stringify(cards(await knowledge('demo-redcliff',1))).includes('华容'))
assert.ok(!JSON.stringify(cards(await knowledge('demo-bellwether',2))).includes('Ada Voss'))
assert.ok(JSON.stringify(cards(await knowledge('demo-bellwether',3))).includes('Ada Voss'))
assert.equal((await knowledge('demo-familiar',2)).localCharacters.find(c=>c.id==='demo-familiar-person-5').role,'Village physician')
assert.equal((await knowledge('demo-familiar',5)).localCharacters.find(c=>c.id==='demo-familiar-person-5').role,'Physician responsible for the poisoning')
for(const [n,role]of [[1,'有名无职的齐天大圣'],[2,'反天归山的齐天大圣'],[3,'被擒的齐天大圣'],[4,'五行山下的孙悟空']])assert.equal((await knowledge('demo-monkey',n)).localCharacters[0].role,role)
// Query and body cutoffs work across each generation-context entry point.
for(const endpoint of ['rag','roleplay/preview','future-jump/preview']){
  const result=await request(`${endpoint}?novelId=demo-monkey&chapterNo=1`)
  assert.equal(result.chapterNo,1)
  assert.ok(!JSON.stringify(result).includes('五行山'))
}
// A branch inherits its anchor, and only its own ancestry goes into history.
const branch=await request('rag?novelId=demo-sect&chapterNo=6&branchContextNodeId=demo-sect-whatif-node')
const anchor=initial.nodes.find(n=>n.id==='demo-sect-whatif-node').anchorChapterNo
assert.equal(branch.chapterNo,anchor)
assert.deepEqual(branch.graphContext.nodes,(await graph('demo-sect',anchor)).nodes)
assert.ok(branch.promptBlocks.find(b=>b.id==='history').content.includes(initial.details['demo-sect-whatif'].latestText))
assert.ok(!branch.promptBlocks.find(b=>b.id==='history').content.includes(initial.details['demo-sect-alternative'].latestText))
assert.equal((await request('rag?novelId=demo-sect&chapterNo=1')).promptBlocks.find(b=>b.id==='history').content,'')
const legacyGraph=structuredClone(initial)
legacyGraph.graphs['demo-monkey'].edges[0].label='A visitor’s saved graph label'
const legacyRequest=requestFor(createDemoApi(JSON.stringify(legacyGraph)))
assert.ok((await legacyRequest('graph/subgraph?novelId=demo-monkey&chapterNo=1')).edges.some(e=>e.label==='A visitor’s saved graph label'))
// Reviews are stable for one relation stage and do not overwrite later states.
const monkeyEdge=(await graph('demo-monkey',1)).edges.find(e=>e.id==='demo-monkey-relation-1-at-1')
await request(`graph/edge/${monkeyEdge.id}/reject`,{novelId:'demo-monkey'})
assert.ok(!(await graph('demo-monkey',1)).edges.some(e=>e.id===monkeyEdge.id))
assert.ok((await graph('demo-monkey',2)).edges.some(e=>e.id==='demo-monkey-relation-1-at-2'))
await request(`graph/edge/${monkeyEdge.id}/confirm`,{novelId:'demo-monkey'})
assert.ok((await graph('demo-monkey',1)).edges.some(e=>e.id===monkeyEdge.id))
const filtered=await graph('demo-monkey',1,'&entityId=demo-monkey-person-1&hops=1&confirmedOnly=true')
assert.deepEqual(filtered.seedEntities.map(n=>n.id),['demo-monkey-person-1'])
assert.ok(!filtered.nodes.some(n=>n.id==='demo-monkey-person-5'))
// Manual knowledge edits survive reload and stay out of earlier chapters.
const at3=await request('novels/demo-monkey?chapterId=demo-monkey-ch-3')
at3.localCharacters[0].note='Visitor annotation about the capture.'
at3.localWorldEntries=at3.localWorldEntries.filter(w=>w.id!=='demo-monkey-world-3')
await request('novels/demo-monkey',at3)
assert.notEqual((await knowledge('demo-monkey',1)).localCharacters[0].note,at3.localCharacters[0].note)
const reload=requestFor(createDemoApi(api.snapshot()))
const edited=await reload('knowledge-view?novelId=demo-monkey&asOfChapter=3')
assert.equal(edited.localCharacters[0].note,at3.localCharacters[0].note)
assert.equal(edited.localCharacters[0].profile.capability.content,at3.localCharacters[0].note)
assert.ok(!edited.localWorldEntries.some(w=>w.id==='demo-monkey-world-3'))
assert.ok((await reload('knowledge-view?novelId=demo-monkey&asOfChapter=4')).localWorldEntries.some(w=>w.id==='demo-monkey-world-5'),'unrelated later fact remains')
// A changed source cannot leave an unsupported extracted claim with a bogus quote.
const changedApi=createDemoApi()
const changed=requestFor(changedApi)
await changed('chapters/demo-familiar-ch-5',{content:'<p>The investigation remains unresolved.</p>',wordCount:5},'PATCH')
assert.notEqual((await changed('knowledge-view?novelId=demo-familiar&asOfChapter=5')).localCharacters.find(c=>c.id==='demo-familiar-person-5').role,'Physician responsible for the poisoning')
const editedGraph=await changed('graph/subgraph?novelId=demo-familiar&chapterNo=5')
assert.ok(editedGraph.edges.every(e=>e.validFromChapter<=5&&e.validUntilChapter>=5))
// Delete/rebuild respects the active cutoff and keeps all response surfaces aligned.
await knowledge('demo-landlord',2)
const deleted=await request('knowledge-view',{novelId:'demo-landlord',action:'delete-knowledge'})
assert.deepEqual(cards(deleted),Object.fromEntries(knowledgeKeys.map(k=>[k,[]])))
assert.equal((await graph('demo-landlord',2)).nodes.length,0)
const rebuilt=await request('knowledge-view',{novelId:'demo-landlord',action:'rebuild'})
assert.equal(rebuilt.asOfChapter,2)
assert.ok(!rebuilt.localWorldEntries.some(w=>w.id==='demo-landlord-world-4'))
// Real browser snapshot from before this fix requires no data reset.
if(process.env.DEMO_SAVED_DB_PATH){
  const raw=await readFile(process.env.DEMO_SAVED_DB_PATH,'utf8')
  const old=JSON.parse(raw)
  const migrated=createDemoApi(raw)
  assert.deepEqual(JSON.parse(migrated.snapshot()).novels,old.novels)
  const read=requestFor(migrated)
  assert.ok(!JSON.stringify(cards(await read('knowledge-view?novelId=demo-monkey&asOfChapter=1'))).includes('五行山'))
  assert.ok(JSON.stringify(cards(await read('knowledge-view?novelId=demo-monkey&asOfChapter=4'))).includes('五行山'))
}
console.log(`PASS ${stages} authored stages, reveal boundaries, branch isolation, review persistence, edits, extraction invalidation, deletion/rebuild and old browser snapshot`)

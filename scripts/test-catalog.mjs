import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'

await mkdir('test-results', { recursive: true })
const outfile = resolve('test-results/catalog-api.cjs')
await build({ stdin: { contents: 'export {createDemoApi} from "./demo/api"; export {simplifyChinese, simplifyClassicValue, simplifyClassicDrafts} from "./demo/simplified-classics"; export {createChapterContentFingerprint} from "./lib/chapter-draft-cache"; export {demoBooks, englishBooks, chineseBooks} from "./demo/catalog";', resolveDir: process.cwd() },
  outfile, bundle:true, platform:'node', format:'cjs', packages:'external', logLevel:'silent' })
const { createDemoApi, demoBooks, englishBooks, chineseBooks, simplifyChinese, simplifyClassicValue, simplifyClassicDrafts, createChapterContentFingerprint } = createRequire(import.meta.url)(outfile)
const api = createDemoApi()
const snapshot = JSON.parse(api.snapshot())
const call = async (path, body) => {
  const response = await api.handle(new Request(`http://demo.test/api/${path}`, body ? {
    method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  } : {}))
  assert.equal(response.status,200,`${path} returns success`)
  return response.json()
}
assert.equal(Object.keys(snapshot.novels).length,12)
for (const book of demoBooks) {
  const novel = snapshot.novels[book.id]
  assert.ok(book.chapters[book.scenario.chapter-1].text.includes(book.scenario.sourceText), `${book.title}: source quote exists`)
  assert.ok(novel.localCharacters.length >= 5)
  assert.ok(novel.localCharacterRelations.length >= 6)
  assert.equal(novel.localTimelineEvents.length,book.chapters.length)
  assert.ok(book.chapters.every(c=>c.text.length>=300), `${book.title}: substantive chapters`)
  assert.ok(snapshot.details[`${book.id}-rewrite`].sourceTextSnapshot.includes(book.scenario.sourceText),`${book.title}: branch preserves selected passage`)
  assert.equal(snapshot.nodes.filter(n=>n.novelId===book.id).length,6)
  const graph = snapshot.graphs[book.id]
  for (const edge of graph.edges) {
    assert.ok(graph.nodes.some(n=>n.id===edge.source) && graph.nodes.some(n=>n.id===edge.target))
    assert.ok(book.chapters[edge.evidenceLocation.chapterNo-1].text.includes(edge.evidenceQuote.trim()), `${book.title}: actual graph evidence`)
  }
  const rewritten = await call('rewrite', {novelId:book.id})
  assert.match(rewritten.result.content, new RegExp(book.scenario.rewriteText.slice(0,8).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
  assert.ok(!rewritten.result.content.includes('林舟'))
  const roleplay = await call('rewrite',{novelId:book.id,roleplayTurn:{playerName:book.characters[0].name,counterpartName:book.characters[1].name,dialogue:book.scenario.roleplay.opening},roleplayMessages:[]})
  const script = JSON.parse(roleplay.result.content)
  assert.equal(script.blocks.at(-1).text,book.scenario.roleplay.responses[0])
  const future = await call('future-jump/runs',{novelId:book.id,targetOutlineChapterId:`${book.id}-link-${book.chapters.length}`,sourceChapterNo:book.scenario.chapter})
  assert.equal(future.targetChapterNo,book.chapters.length)
  assert.equal(future.generatedTargetText,book.scenario.futureText)
  assert.equal(future.bridgeSummary,book.scenario.bridge)
  const skill = await call('writing-skills', {sourceRefs:[{sourceType:'LIBRARY',sourceId:book.id}],instruction:'提炼这本书的叙事方式'})
  assert.equal(skill.job.libraryId,book.id)
  assert.equal(skill.job.card.sources[0].sourceId,book.id)
  assert.ok(book.chapters[book.scenario.chapter-1].text.includes(skill.job.card.examples[0].anonymizedText))
  const alternative = snapshot.details[`${book.id}-alternative`]
  assert.notEqual(alternative.deltas[0].newValue,snapshot.details[`${book.id}-whatif`].deltas[0].newValue)
  if (book.source) {
    assert.ok(book.scenario.rewriteText.includes(book.locale === 'en' ? 'Demo branch — not the original text.' : '非原著'))
    const source = JSON.parse(await readFile(`demo/catalog/${book.locale === 'en' ? 'english-' : ''}public-domain.json`,'utf8'))[book.id]
    const originals = book.locale === 'en' ? source.chapters : source
    assert.deepEqual(book.chapters.map(c=>c.text),originals.map(c=>c.text))
    if (book.locale === 'en') assert.match(source.downloadSha256,/^[a-f0-9]{64}$/)
    else assert.ok(originals.every(c=>c.revision && c.url.startsWith('https://zh.wikisource.org/')))
  }
  console.log(`PASS ${book.title}: ${book.chapters.length} chapters, ${graph.nodes.length} graph nodes, ${graph.edges.length} edges`)
}
// Each old catalog version retires the prototypes and all related records without resetting other work.
const retiredIds = ['demo-mist', 'demo-star'];
function addRetiredRows(db) {
  for (const key of retiredIds) {
    db.novels[key] = {...structuredClone(snapshot.novels['demo-sect']),currentNovelId:key};
    db.metadata[key] = {author:'Prototype'}; db.revisions[key] = 7;
    db.graphs[key] = {nodes:[],edges:[]}; db.knowledge[key] = {job:{novelId:key}};
    db.nodes.push({id:`${key}-node`,novelId:key}); db.details[`${key}-detail`] = {novelId:key};
    db.skills[`${key}-skill`] = {libraryId:key}; db.jobs[`${key}-job`] = {libraryId:key};
    db.compressions[JSON.stringify({novelId:key,branchId:`${key}-main`})] = 1;
    db.presets.novelRewritePresetIds ??= {};
    db.presets.novelRewritePresetIds[key] = 'retale-default-zh-CN';
  }
}
for (const edition of [1,2,3]) {
  const old = structuredClone(snapshot)
  old.catalogVersion = edition
  const pending = demoBooks.filter(b=>(b.locale==='en'?3:2)>edition)
  for (const book of pending) {
    delete old.novels[book.id]; delete old.graphs[book.id]; delete old.revisions[book.id]
    delete old.skills[`${book.id}-skill`]
  }
  old.nodes=old.nodes.filter(n=>!pending.some(b=>b.id===n.novelId))
  old.details=Object.fromEntries(Object.entries(old.details).filter(([,d])=>!pending.some(b=>b.id===d.novelId)))
  const keptNodes = old.nodes.length
  // Same title as a retired demo, but a visitor import has a distinct ID and must survive.
  old.novels['my-import'] = {...structuredClone(snapshot.novels['demo-sect']),currentNovelId:'my-import'}
  old.novels['my-import'].localNovels[0].title='雾城来信'
  old.novels['my-import'].localChapters[0].content='<p>访客自己的编辑，不能覆盖。</p>'
  old.metadata['my-import']={author:'访客'}
  addRetiredRows(old)
  let persisted
  const upgraded = createDemoApi(JSON.stringify(old),value=>{persisted=value})
  const after = JSON.parse(upgraded.snapshot())
  assert.deepEqual(after.novels['my-import'],old.novels['my-import'])
  assert.equal(after.metadata['my-import'].author,'访客')
  assert.ok(retiredIds.every(id=>!upgraded.snapshot().includes(id)))
  assert.equal(Object.keys(after.novels).length,13)
  assert.equal(after.nodes.length,keptNodes+pending.length*6)
  assert.ok(persisted)
  const rerun = JSON.parse(createDemoApi(upgraded.snapshot()).snapshot())
  assert.deepEqual(rerun,after)
  delete rerun.novels['demo-sect']
  assert.equal(JSON.parse(createDemoApi(JSON.stringify(rerun)).snapshot()).novels['demo-sect'],undefined)
}
// Upgrade an edited v2 collection, including intentional deletions, to bilingual v3.
const v2 = structuredClone(snapshot)
v2.catalogVersion = 2
for (const book of englishBooks) {
  delete v2.novels[book.id]; delete v2.graphs[book.id]; delete v2.skills[`${book.id}-skill`]
}
v2.nodes = v2.nodes.filter(n => !englishBooks.some(b=>b.id===n.novelId))
v2.details = Object.fromEntries(Object.entries(v2.details).filter(([,d])=>!englishBooks.some(b=>b.id===d.novelId)))
delete v2.novels['demo-sect']; delete v2.skills['demo-sect-skill']
v2.novels['demo-loop'].localChapters[0].content = '<p>Keep my revised ending.</p>'
v2.novels['my-import'] = {...structuredClone(v2.novels['demo-loop']),currentNovelId:'my-import'}
let locale = 'en'
const bilingual = createDemoApi(JSON.stringify(v2),()=>{},()=>locale)
const v3 = JSON.parse(bilingual.snapshot())
assert.equal(v3.novels['demo-sect'],undefined)
assert.equal(v3.skills['demo-sect-skill'],undefined)
assert.deepEqual(v3.novels['demo-loop'],v2.novels['demo-loop'])
assert.deepEqual(v3.novels['my-import'],v2.novels['my-import'])
const request = async path => {
  const response = await bilingual.handle(new Request(`http://demo.test/api/${path}`))
  assert.equal(response.status,200,path)
  return response.json()
}
assert.equal((await request('novels')).novels.length,7) // Six English books + visitor import.
assert.equal((await request('writing-skills')).cards.length,6)
assert.equal((await request('writing-skill-sources')).librarySources.length,7)
assert.ok(!/\p{Script=Han}/u.test(JSON.stringify(await request('settings/preset-compat'))))
for (const book of englishBooks) {
  assert.ok(!/\p{Script=Han}/u.test(JSON.stringify(v3.novels[book.id])),`${book.title}: English workspace defaults`)
  const preview = await request(`context-preview?novelId=${book.id}`)
  assert.ok(!/\p{Script=Han}/u.test(JSON.stringify(preview)),`${book.title}: English mock context`)
  assert.equal(v3.novels[book.id].localChapters[0].wordCount,book.chapters[0].text.trim().split(/\s+/).length)
}
const edited = await bilingual.handle(new Request('http://demo.test/api/chapters/demo-safe-room-ch-1',{
  method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'<p>Keep this revised ending.</p>',wordCount:999})
}))
assert.equal(edited.status,200)
assert.equal((await request('novels/demo-safe-room')).localChapters[0].wordCount,4)
locale = 'zh'
assert.equal((await request('novels')).novels.length,chineseBooks.length) // One deleted, one imported.
assert.ok((await request('novels')).novels.every(n=>!englishBooks.some(b=>b.id===n.id)))
locale = 'en'
assert.equal((await request('novels')).novels.length,7)
assert.equal(JSON.parse(createDemoApi(bilingual.snapshot()).snapshot()).nodes.length,v3.nodes.length)
// Edition 4 snapshots convert only the two classics, including custom edits and branch history.
const traditional = structuredClone(snapshot)
traditional.catalogVersion = 4
const classicId = 'demo-redcliff'
const chapter = traditional.novels[classicId].localChapters[0]
chapter.content = '<p>諸葛亮說：「這是訪客新增的話，關於孫權與劉備。」</p>'
chapter.originalContent = '<p>原文：孔明與魯肅。</p>'
chapter.title = '第四十三回 舌戰群儒'
traditional.details['demo-redcliff-rewrite'].sourceTextSnapshot = '孔明曰：「只消三日，便可拜納十萬枝箭。」'
traditional.graphs[classicId].edges[0].evidenceQuote = '孔明與魯肅。'
traditional.skills['demo-redcliff-skill'].examples[0].anonymizedText = '孔明與魯肅。'
traditional.metadata[classicId] = {title:'三國演義',coverImage:'https://example.test/三國.png'}
traditional.novels['my-import'] = {...structuredClone(traditional.novels[classicId]),currentNovelId:'my-import'}
delete traditional.novels['demo-monkey']
const raw = JSON.stringify(traditional)
const convertedApi = createDemoApi(raw)
const converted = JSON.parse(convertedApi.snapshot())
assert.equal(converted.novels[classicId].localChapters[0].content,'<p>诸葛亮说：「这是访客新增的话，关于孙权与刘备。」</p>')
assert.equal(converted.novels[classicId].localChapters[0].originalContent,'<p>原文：孔明与鲁肃。</p>')
assert.equal(converted.novels[classicId].localChapters[0].title,'第四十三回 舌战群儒')
assert.equal(converted.revisions[classicId],traditional.revisions[classicId]+1)
assert.equal(converted.novels['demo-monkey'],undefined)
assert.equal(converted.details['demo-redcliff-rewrite'].sourceTextSnapshot,'孔明曰：「只消三日，便可拜纳十万枝箭。」')
assert.equal(converted.graphs[classicId].edges[0].evidenceQuote,'孔明与鲁肃。')
assert.equal(converted.skills['demo-redcliff-skill'].examples[0].anonymizedText,'孔明与鲁肃。')
assert.equal(converted.metadata[classicId].coverImage,traditional.metadata[classicId].coverImage)
assert.deepEqual(converted.novels['my-import'],traditional.novels['my-import'])
assert.deepEqual(converted.novels['demo-safe-room'],traditional.novels['demo-safe-room'])
assert.equal(createDemoApi(convertedApi.snapshot()).snapshot(),convertedApi.snapshot())
const pendingDrafts = {version:1,entries:[
  {novelId:classicId,chapterId:chapter.id,content:'<p>未儲存的草稿，請保留我的修改。</p>',baseContentFingerprint:createChapterContentFingerprint(chapter.content)},
  {novelId:classicId,chapterId:'unknown-chapter',content:'保留衝突',baseContentFingerprint:'real-conflict'},
  {novelId:'my-import',chapterId:'imported',content:'不轉換我匯入的文字',baseContentFingerprint:'unchanged'},
]}
const drafts = JSON.parse(simplifyClassicDrafts(raw,JSON.stringify(pendingDrafts)))
assert.equal(drafts.entries[0].content,'<p>未储存的草稿，请保留我的修改。</p>')
assert.equal(drafts.entries[0].baseContentFingerprint,createChapterContentFingerprint(converted.novels[classicId].localChapters[0].content))
assert.equal(drafts.entries[1].baseContentFingerprint,'real-conflict')
assert.deepEqual(drafts.entries[2],pendingDrafts.entries[2])
for (const id of ['demo-redcliff','demo-monkey']) {
  const book = demoBooks.find(b=>b.id===id)
  assert.deepEqual(book.chapters,book.chapters.map(c=>({...c,title:simplifyChinese(c.title),text:simplifyChinese(c.text)})))
  assert.deepEqual(snapshot.graphs[id],simplifyClassicValue(snapshot.graphs[id]))
}
console.log('PASS simplified classics, edited text, citations, draft recovery, deletion and unrelated-book preservation')
assert.ok(Buffer.byteLength(api.snapshot(),'utf16le') < 4*1024*1024,'seed fits typical localStorage quota with headroom')
console.log('PASS migration keeps edits, metadata and deletions; idempotent refresh; storage budget')
console.log('Content stats:',JSON.stringify(demoBooks.map(b=>({title:b.title,characters:b.chapters.reduce((n,c)=>n+c.text.replace(/\s/g,'').length,0)}))))

import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'

await mkdir('test-results', { recursive: true })
const outfile = resolve('test-results/catalog-api.cjs')
await build({ stdin: { contents: 'export {createDemoApi} from "./demo/api"; export {demoBooks, englishBooks, chineseBooks} from "./demo/catalog";', resolveDir: process.cwd() },
  outfile, bundle:true, platform:'node', format:'cjs', packages:'external', logLevel:'silent' })
const { createDemoApi, demoBooks, englishBooks, chineseBooks } = createRequire(import.meta.url)(outfile)
const api = createDemoApi()
const snapshot = JSON.parse(api.snapshot())
const call = async (path, body) => {
  const response = await api.handle(new Request(`http://demo.test/api/${path}`, body ? {
    method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  } : {}))
  assert.equal(response.status,200,`${path} returns success`)
  return response.json()
}
assert.equal(Object.keys(snapshot.novels).length,14)
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
// A visitor with edited v1 data should receive only new content, never a reset.
const old = structuredClone(snapshot)
delete old.catalogVersion
for (const book of demoBooks) {
  delete old.novels[book.id]; delete old.graphs[book.id]; delete old.revisions[book.id]
  delete old.skills[`${book.id}-skill`]
}
old.nodes=old.nodes.filter(n=>!demoBooks.some(b=>b.id===n.novelId))
old.details=Object.fromEntries(Object.entries(old.details).filter(([,d])=>!demoBooks.some(b=>b.id===d.novelId)))
delete old.novels['demo-star'] // Existing deliberate deletion is preserved.
old.novels['demo-mist'].localChapters[0].content='<p>访客自己的编辑，不能覆盖。</p>'
old.metadata['demo-mist']={author:'访客'}
const before = structuredClone(old.novels['demo-mist'])
let persisted
const upgraded = createDemoApi(JSON.stringify(old), value=>{persisted=value})
const after = JSON.parse(upgraded.snapshot())
assert.deepEqual(after.novels['demo-mist'],before)
assert.equal(after.metadata['demo-mist'].author,'访客')
assert.equal(after.novels['demo-star'],undefined)
assert.equal(Object.keys(after.novels).length,13)
assert.equal(after.nodes.length,old.nodes.length+72)
assert.ok(persisted)
const rerun = JSON.parse(createDemoApi(upgraded.snapshot()).snapshot())
assert.equal(rerun.nodes.length,after.nodes.length)
delete rerun.novels['demo-sect']
assert.equal(JSON.parse(createDemoApi(JSON.stringify(rerun)).snapshot()).novels['demo-sect'],undefined)
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
assert.equal((await request('novels')).novels.length,chineseBooks.length+2) // One deleted, one imported.
assert.ok((await request('novels')).novels.every(n=>!englishBooks.some(b=>b.id===n.id)))
locale = 'en'
assert.equal((await request('novels')).novels.length,7)
assert.equal(JSON.parse(createDemoApi(bilingual.snapshot()).snapshot()).nodes.length,v3.nodes.length)
assert.ok(Buffer.byteLength(api.snapshot(),'utf16le') < 4*1024*1024,'seed fits typical localStorage quota with headroom')
console.log('PASS migration keeps edits, metadata and deletions; idempotent refresh; storage budget')
console.log('Content stats:',JSON.stringify(demoBooks.map(b=>({title:b.title,characters:b.chapters.reduce((n,c)=>n+c.text.replace(/\s/g,'').length,0)}))))

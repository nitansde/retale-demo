import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build } from 'esbuild'

await mkdir('test-results', { recursive: true })
const outfile = resolve('test-results/catalog-api.cjs')
await build({ stdin: { contents: 'export {createDemoApi} from "./demo/api"; export {demoBooks} from "./demo/catalog";', resolveDir: process.cwd() },
  outfile, bundle:true, platform:'node', format:'cjs', packages:'external', logLevel:'silent' })
const { createDemoApi, demoBooks } = createRequire(import.meta.url)(outfile)
const api = createDemoApi()
const snapshot = JSON.parse(api.snapshot())
const call = async (path, body) => {
  const response = await api.handle(new Request(`http://demo.test/api/${path}`, body ? {
    method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  } : {}))
  assert.equal(response.status,200,`${path} returns success`)
  return response.json()
}
assert.equal(Object.keys(snapshot.novels).length,8)
for (const book of demoBooks) {
  const novel = snapshot.novels[book.id]
  assert.ok(book.chapters[book.scenario.chapter-1].text.includes(book.scenario.sourceText), `${book.title}: source quote exists`)
  assert.ok(novel.localCharacters.length >= 5)
  assert.ok(novel.localCharacterRelations.length >= 6)
  assert.equal(novel.localTimelineEvents.length,book.chapters.length)
  assert.ok(book.chapters.every(c=>c.text.length>=300), `${book.title}: substantive chapters`)
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
    assert.ok(book.scenario.rewriteText.includes('非原著'))
    const originals = JSON.parse(await readFile('demo/catalog/public-domain.json','utf8'))[book.id]
    assert.deepEqual(book.chapters.map(c=>c.text),originals.map(c=>c.text))
    assert.ok(originals.every(c=>c.revision && c.url.startsWith('https://zh.wikisource.org/')))
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
assert.equal(Object.keys(after.novels).length,7)
assert.equal(after.nodes.length,old.nodes.length+36)
assert.ok(persisted)
const rerun = JSON.parse(createDemoApi(upgraded.snapshot()).snapshot())
assert.equal(rerun.nodes.length,after.nodes.length)
delete rerun.novels['demo-sect']
assert.equal(JSON.parse(createDemoApi(JSON.stringify(rerun)).snapshot()).novels['demo-sect'],undefined)
assert.ok(Buffer.byteLength(api.snapshot(),'utf16le') < 4*1024*1024,'seed fits typical localStorage quota with headroom')
console.log('PASS migration keeps edits, metadata and deletions; idempotent refresh; storage budget')
console.log('Content stats:',JSON.stringify(demoBooks.map(b=>({title:b.title,characters:b.chapters.reduce((n,c)=>n+c.text.replace(/\s/g,'').length,0)}))))

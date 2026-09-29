import { chromium, expect } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const url=(process.env.DEMO_TEST_URL || 'http://localhost:3000/retale-demo').replace(/\/$/,'')
await mkdir('test-results',{recursive:true})
const outfile=resolve('test-results/catalog-ui.cjs')
await build({stdin:{contents:'export {chineseBooks as demoBooks, catalogVersion} from "./demo/catalog"; export {createChapterContentFingerprint} from "./lib/chapter-draft-cache";',resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'})
const {demoBooks,catalogVersion,createChapterContentFingerprint}=createRequire(import.meta.url)(outfile)
const browser=await chromium.launch()
const page=await browser.newPage({viewport:{width:1440,height:1050}})
if (process.env.DEMO_SAVED_DB_PATH) {
  const saved = await readFile(process.env.DEMO_SAVED_DB_PATH,'utf8')
  const chapter = JSON.parse(saved).novels['demo-monkey'].localChapters.at(-1)
  const draft = {version:1,novelId:'demo-monkey',chapterId:chapter.id,content:'<p>大聖歸來，我的草稿仍在。</p>',wordCount:12,savedAt:Date.now(),baseContentFingerprint:createChapterContentFingerprint(chapter.content)}
  await page.addInitScript(({saved,draft})=>{
    if(sessionStorage.getItem('simplified-fixture-loaded')) return
    sessionStorage.setItem('simplified-fixture-loaded','1')
    localStorage.setItem('retale.demo.database.v1',saved)
    localStorage.setItem('retale.chapter-drafts.v1',JSON.stringify({version:1,entries:[draft]}))
  },{saved,draft})
}
page.setDefaultTimeout(20000)
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)})
try {
  await page.goto(`${url}/`)
  await expect(page.getByRole('heading',{name:demoBooks[0].title,exact:true})).toBeVisible()
  await expect(page.locator('article')).toHaveCount(6)
  await expect(page.locator('article img')).toHaveCount(6)
  await expect.poll(()=>page.locator('article img').evaluateAll(imgs=>imgs.every(img=>img.complete&&img.naturalWidth>0))).toBe(true)
  await page.screenshot({path:'test-results/collection-library.png',fullPage:true})
  for(const book of demoBooks) {
    await page.goto(`${url}/library/`)
    await page.getByRole('button').filter({has:page.getByRole('heading',{name:book.title,exact:true})}).click()
    await page.getByTestId('workspace-chapter-view-toggle').getByRole('button',{name:'正文',exact:true}).click()
    await expect(page.getByTestId('workspace-chapter-reader')).toContainText(book.chapters[0].text.split('\n\n')[0].slice(0,30))
    await page.getByTestId(`timeline-chapter-row-${book.id}-ch-${book.scenario.chapter}`).getByRole('button').first().click()
    await expect(page.getByTestId('workspace-chapter-reader')).toContainText(book.scenario.sourceText)
    await page.getByTestId('workspace-chapter-view-toggle').getByRole('button',{name:'图谱',exact:true}).click()
    await expect(page.getByTestId('chapter-graph-browser')).toContainText(book.characters[0].name)
    await expect(page.getByTestId('chapter-graph-browser')).toContainText(book.characters[1].name)
    if(book.id==='demo-sect') await page.screenshot({path:'test-results/collection-graph.png',fullPage:true})
    await page.getByTestId(`timeline-node-${book.id}-whatif-node`).click()
    await expect(page.getByTestId('workspace-what-if-view')).toContainText(book.scenario.delta.after)
    await page.getByTestId('what-if-jump-button').click()
    await page.getByTestId(`future-map-event-${book.id}-future-${book.chapters.length}`).click()
    await page.getByTestId('future-map-confirm').click()
    await expect(page.getByTestId('workspace-future-jump-view')).toContainText(book.scenario.futureText.split('\n\n').at(-1))
    await page.getByTestId(`timeline-node-${book.id}-roleplay-node`).click()
    await expect(page.getByTestId('roleplay-message-list')).toContainText(book.scenario.roleplay.reply)
    await page.getByRole('textbox',{name:'我的台词',exact:true}).fill(book.scenario.roleplay.opening)
    await page.getByTestId('roleplay-composer-send').click()
    await expect(page.getByTestId('roleplay-message-list')).toContainText(book.scenario.roleplay.responses[1])
    await page.reload()
    await expect(page.getByTestId('roleplay-message-list')).toContainText(book.scenario.roleplay.responses[1])
    if(book.id==='demo-landlord')await page.screenshot({path:'test-results/collection-roleplay.png',fullPage:true})
    console.log(`PASS online UI: ${book.title} — original prose, graph, What-if, Future Jump, saved roleplay`)
  }
  if (process.env.DEMO_SAVED_DB_PATH) {
    const migrated = await page.evaluate(()=>JSON.parse(localStorage.getItem('retale.demo.database.v1')))
    expect(migrated.catalogVersion).toBe(catalogVersion)
    await page.getByTestId('timeline-chapter-row-demo-monkey-ch-4').getByRole('button').first().click()
    await page.getByTestId('workspace-chapter-view-toggle').getByRole('button',{name:'正文',exact:true}).click()
    await expect(page.getByTestId('workspace-chapter-reader')).toContainText('大圣归来，我的草稿仍在。')
    console.log('PASS existing-browser simplification, matching citations and automatic draft recovery')
  }
  await page.setViewportSize({width:390,height:844})
  await page.goto(`${url}/library/`)
  await expect(page.getByRole('heading',{name:demoBooks[3].title,exact:true})).toBeVisible()
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/collection-mobile.png',fullPage:true})
  await page.getByRole('button').filter({has:page.getByRole('heading',{name:demoBooks[3].title,exact:true})}).click()
  await expect(page.getByTestId('workspace-mobile-toolbar')).toBeVisible()
  if(errors.length)throw Error(errors.join('\n'))
  console.log('PASS six covers, six books, long-title mobile layout, no failed HTTP requests or JS errors')
} catch(error) {
  await page.screenshot({path:'test-results/collection-failure.png',fullPage:true})
  console.error(errors)
  throw error
} finally {await browser.close()}

import { chromium, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'

const url=(process.env.DEMO_TEST_URL || 'http://localhost:3000/retale-demo').replace(/\/$/,'')
await mkdir('test-results',{recursive:true})
const browser=await chromium.launch()
const page=await browser.newPage({viewport:{width:1600,height:1100}})
page.setDefaultTimeout(20000)
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)})
if(process.env.DEMO_SAVED_DB_PATH){
  const saved=await readFile(process.env.DEMO_SAVED_DB_PATH,'utf8')
  await page.addInitScript(saved=>{
    if(sessionStorage.getItem('temporal-fixture'))return
    sessionStorage.setItem('temporal-fixture','1')
    localStorage.setItem('retale.demo.database.v1',saved)
  },saved)
}
async function openBook(title,language){
  await page.goto(`${url}/library/`)
  await page.getByTestId(`app-language-option-${language}`).click()
  await page.getByRole('button').filter({has:page.getByRole('heading',{name:title,exact:true})}).click()
  await expect(page.getByTestId('workspace-chapter-nav')).toBeVisible()
  const panel=page.getByTestId('workspace-reference-panel')
  if(!await panel.isVisible())await page.getByRole('button',{name:language==='zh'?'打开故事上下文':'Open story context',exact:true}).click()
  await expect(panel).toBeVisible()
  return panel
}
async function selectChapter(id,n){
  await page.getByTestId(`timeline-chapter-row-${id}-ch-${n}`).getByRole('button').first().click()
}
try{
  const panel=await openBook('西游记·大闹天宫','zh')
  await panel.getByRole('button',{name:/^人物/}).click()
  for(const [chapter,role]of [[1,'有名无职的齐天大圣'],[2,'反天归山的齐天大圣'],[3,'被擒的齐天大圣'],[4,'五行山下的孙悟空'],[1,'有名无职的齐天大圣']]){
    await selectChapter('demo-monkey',chapter)
    await expect(panel.locator('#workspace-character-profile-demo-monkey-person-0')).toContainText(role)
    if(chapter<4)await expect(panel).not.toContainText('五行山')
    if(chapter===1)await expect(panel).not.toContainText('如来')
    await page.screenshot({path:`test-results/temporal-monkey-${chapter}.png`,fullPage:false})
  }
  // The separate chapter graph must follow exactly the same cutoff.
  await page.getByTestId('workspace-chapter-view-toggle').getByRole('button',{name:'图谱',exact:true}).click()
  const graph=page.getByTestId('chapter-graph-browser')
  await expect(graph).toContainText('孙悟空')
  await expect(graph).not.toContainText('五行山')
  await selectChapter('demo-monkey',4)
  await expect(graph).toContainText('五行山')
  await selectChapter('demo-monkey',1)
  await expect(graph).not.toContainText('五行山')
  await expect(panel).toContainText('有名无职的齐天大圣')
  await page.reload()
  await expect(page.getByTestId('workspace-reference-panel')).toContainText('有名无职的齐天大圣')
  await expect(page.getByTestId('chapter-graph-browser')).not.toContainText('五行山')
  console.log('PASS original Chinese UI: four changing character states, future entities hidden, backward navigation and reload')

  const english=await openBook('The Saint of Bellwether Hall','en')
  await english.getByRole('button',{name:/^Characters/}).click()
  await selectChapter('demo-bellwether',1)
  await expect(english).toContainText('The girl in the case')
  await expect(english).not.toContainText('Ada Voss')
  await selectChapter('demo-bellwether',3)
  await expect(english).toContainText('Ada Voss')
  await expect(english).toContainText('captive donor')
  await selectChapter('demo-bellwether',5)
  await expect(english).toContainText('Awakened former captive')
  await selectChapter('demo-bellwether',2)
  await expect(english).not.toContainText('Ada Voss')
  await expect(english).toContainText('The girl in the case')
  await page.screenshot({path:'test-results/temporal-bellwether-before-reveal.png',fullPage:false})

  const mystery=await openBook('A Familiar Kind of Murder','en')
  await mystery.getByRole('button',{name:/^Characters/}).click()
  await selectChapter('demo-familiar',2)
  await expect(mystery).toContainText('Village physician')
  await expect(mystery).not.toContainText('Physician responsible for the poisoning')
  await selectChapter('demo-familiar',5)
  await expect(mystery).toContainText('Physician responsible for the poisoning')
  await selectChapter('demo-familiar',2)
  await expect(mystery).toContainText('Village physician')
  console.log('PASS original English UI: hidden identity, discovered identity, release; suspicion becomes proof and reverses on earlier chapters')
  expect(errors).toEqual([])
} catch(error){
  await page.screenshot({path:'test-results/temporal-ui-failure.png',fullPage:false})
  console.error(errors)
  throw error
} finally{await browser.close()}

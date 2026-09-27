import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const url = process.env.DEMO_TEST_URL || 'http://localhost:3000'
const browser = await chromium.launch()
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(20000)
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
})
const chapter = async number => {
  await page.getByTestId(`timeline-chapter-row-demo-mist-ch-${number}`).getByRole('button').first().click()
  await expect(page.getByTestId('workspace-chapter-reader')).toBeVisible()
}
const branch = async (name, view) => {
  await page.getByTestId(`timeline-node-demo-mist-${name}-node`).click()
  await expect(page.getByTestId(view)).toBeVisible()
}
await mkdir('test-results', { recursive: true })
try {
  await page.goto(`${url}/`)
  await expect(page.getByRole('heading', { name: '雾城来信' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '星海回声' })).toBeVisible()
  await page.screenshot({ path: 'test-results/library.png', fullPage: true })
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: '雾城来信' }) }).click()
  await chapter(3)
  await expect(page.getByTestId('workspace-chapter-reader')).toContainText('你还是来了')
  await page.screenshot({ path: 'test-results/workspace.png', fullPage: true })

  await page.getByTestId('workspace-reader-edit-toggle').click()
  const editor = page.locator('.tiptap[contenteditable=true]')
  await editor.fill('编辑保存测试：雨停之前，他们选择一起赴约。')
  await page.getByTestId('workspace-reader-edit-toggle').click()
  await page.reload()
  await expect(page.getByTestId('workspace-chapter-reader')).toContainText('编辑保存测试')
  console.log('PASS chapter edit, save and reload')

  await chapter(1)
  await page.getByTestId('workspace-chapter-reader').evaluate(element => {
    const text = element.querySelector('p')?.firstChild
    if (!text) throw new Error('Missing reader paragraph')
    const range = document.createRange(); range.selectNodeContents(text)
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.getByTestId('workspace-chapter-rewrite-entry').click()
  await page.getByRole('button', { name: '生成版本', exact: true }).click()
  await expect(page.getByTestId('rewrite-actions').getByRole('button', { name: /保存/ })).toBeEnabled()
  await page.screenshot({ path: 'test-results/rewrite.png', fullPage: true })
  await page.getByTestId('rewrite-actions').getByRole('button', { name: /保存/ }).click()
  await expect(page.getByTestId('workspace-center-pane')).toContainText('带路')
  await page.reload()
  await expect(page.getByTestId('workspace-center-pane')).toContainText('带路')
  console.log('PASS select original prose, generate rewrite, save branch and reload')

  await branch('whatif', 'workspace-what-if-view')
  await expect(page.getByTestId('workspace-what-if-view')).toContainText('分支变化')
  await page.getByTestId('what-if-jump-button').click()
  await expect(page.getByTestId('future-map-overlay')).toBeVisible()
  await page.getByTestId('future-map-event-demo-mist-future-8').click()
  await page.getByTestId('future-map-confirm').click()
  await expect(page.getByTestId('workspace-future-jump-view')).toContainText('这次一起走')
  console.log('PASS What-if and create future jump')

  await branch('roleplay', 'workspace-roleplay-session-view')
  await page.getByRole('textbox', { name: '我的台词', exact: true }).fill('那我们一起进去吧。')
  await page.getByTestId('roleplay-composer-send').click()
  await expect(page.getByTestId('roleplay-message-list')).toContainText('这一次，我会把知道的都告诉你')
  await page.getByTestId('roleplay-regenerate-last').click()
  await expect(page.getByTestId('roleplay-message-list')).toContainText('这一次，我会把知道的都告诉你')
  await page.screenshot({ path: 'test-results/roleplay.png', fullPage: true })
  await page.reload()
  await expect(page.getByTestId('roleplay-message-list')).toContainText('那我们一起进去吧')
  console.log('PASS roleplay, regeneration, conversation persistence')

  await chapter(1)
  await page.getByTestId('workspace-book-search-open-desktop').click()
  await page.getByRole('searchbox', { name: '搜索内容' }).fill('钥匙')
  await page.getByRole('dialog').getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('铜钥匙')
  await page.getByRole('dialog').getByRole('button', { name: /关闭/ }).click()
  await page.getByTestId('workspace-chapter-view-toggle').getByRole('button', { name: '图谱', exact: true }).click()
  await expect(page.getByTestId('chapter-graph-browser')).toContainText('林舟')
  await page.screenshot({ path: 'test-results/graph.png', fullPage: true })
  console.log('PASS search and original interactive graph')

  await page.getByRole('button', { name: '设置', exact: true }).evaluate((element) => element.click())
  await page.getByLabel('浅色', { exact: true }).evaluate((element) => element.click())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByTestId('preset-compat-library-open').click()
  await expect(page.getByRole('dialog')).toContainText('预设')
  await page.getByRole('dialog').getByRole('button', { name: /关闭/ }).first().click()
  console.log('PASS settings, theme persistence, original preset library')

  await page.goto(`${url}/writing-skills/`)
  await expect(page.getByRole('button', { name: /有潜台词的对话/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/writing-skills.png', fullPage: true })
  console.log('PASS writing skill studio')
  await page.getByRole('button', { name: '重置演示', exact: true }).click()
  await expect(page.getByRole('heading', { name: '雾城来信' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: '星海回声' }) }).click()
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await expect(page.getByTestId('workspace-chapter-reader')).toContainText('许澄')
  await expect(page.getByTestId('workspace-mobile-toolbar')).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  console.log('PASS second novel, reset, mobile viewport')
  expect(errors).toEqual([])
} catch (error) {
  console.error(await page.locator('body').innerText())
  await page.screenshot({ path: 'test-results/failure.png', fullPage: true })
  throw error
} finally {
  await browser.close()
}

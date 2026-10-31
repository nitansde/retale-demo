// Every book must offer a sample voice and a simulated call. Audio is checked at the
// Web Audio boundary, so a silent or missing clip fails rather than only a missing label.
import assert from 'node:assert/strict'
import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { chromium, expect, webkit } from '@playwright/test'
import { build } from 'esbuild'

const url = (process.env.DEMO_TEST_URL || 'http://localhost:3000/retale-demo').replace(/\/$/, '')
await mkdir('test-results', { recursive: true })
const outfile = resolve('test-results/voice-ui.cjs')
await build({ stdin: { contents: 'export {demoBooks} from "./demo/catalog"; export {scenarioFor} from "./demo/fixtures"', resolveDir: process.cwd(), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' })
const { demoBooks, scenarioFor } = createRequire(import.meta.url)(outfile)

const clips = JSON.parse(await readFile('demo/voice-clips.json', 'utf8'))
let bytes = 0
for (const book of demoBooks) {
  const { reply, responses } = scenarioFor(book.id).roleplay
  for (const line of [reply, ...responses]) {
    const voices = Object.values(clips[line] ?? {})
    assert.equal(voices.length, 2, `${book.id} needs both voices for: ${line}`)
    for (const file of voices) { await access(`public/voice/${file}`); bytes += (await stat(`public/voice/${file}`)).size }
  }
}
console.log(`${demoBooks.length} books, ${Object.keys(clips).length} lines, ${(bytes / 1048576).toFixed(1)} MB of clips`)

const words = {
  zh: { nav: '打开章节导航', voice: '语音聊天', play: '播放语音', start: '开始通话', end: '结束通话', speaking: '角色正在说话', speech: '你现在说话方便吗？' },
  en: { nav: 'Open chapter navigation', voice: 'Voice chat', play: 'Play voice', start: 'Start call', end: 'End call', speaking: 'Character is speaking', speech: 'Is now a good time to talk?' },
}
const heard = (page) => page.evaluate(() => window.voiceProbe)

async function openContext(type) {
  const browser = await type.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  page.setDefaultTimeout(30000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
  await page.addInitScript(() => {
    localStorage.setItem('retale.demo.tutorial.v1', 'skipped')
    window.voiceProbe = { seconds: 0, peak: 0 }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      const samples = this.buffer.getChannelData(0)
      window.voiceProbe.seconds += this.buffer.duration
      for (let i = 0; i < samples.length; i += 16) window.voiceProbe.peak = Math.max(window.voiceProbe.peak, Math.abs(samples[i]))
      return start.apply(this, args)
    }
  })
  return { browser, page, errors }
}

async function exerciseBook(page, book) {
  const language = book.locale ?? 'zh'
  const t = words[language]
  const { reply, responses } = scenarioFor(book.id).roleplay
  await page.goto(`${url}/library/`)
  await page.getByTestId(`app-language-option-${language}`).click()
  await page.getByRole('button').filter({ has: page.getByRole('heading', { name: book.title, exact: true }) }).click()
  await page.getByRole('button', { name: t.nav, exact: true }).click()
  await page.getByText('RP-01').first().click()

  // The seeded reply plays its clip before any call starts.
  await expect(page.getByText(reply, { exact: true })).toBeVisible()
  const before = await heard(page)
  await page.getByRole('button', { name: t.play }).first().click()
  await expect.poll(async () => (await heard(page)).seconds).toBeGreaterThan(before.seconds + 1)
  await page.getByRole('button', { name: t.play }).first().waitFor({ state: 'attached' }).catch(() => undefined)

  await page.getByRole('button', { name: t.voice, exact: true }).click()
  const called = await heard(page)
  await page.getByRole('button', { name: t.start }).click()
  await expect(page.getByText(t.speech, { exact: true })).toBeVisible()
  await expect(page.getByText(t.speaking, { exact: true })).toBeVisible()
  await expect.poll(async () => (await heard(page)).seconds).toBeGreaterThan(called.seconds + 1)
  assert.ok((await heard(page)).peak > 0.05, `${book.id} played silence`)
  await expect(page.getByText(responses[1], { exact: true }).or(page.getByText(responses[0], { exact: true })).first()).toBeVisible()
  await page.getByRole('button', { name: t.end }).click()
  await expect(page.getByRole('button', { name: t.start })).toBeEnabled()
  console.log(`ok ${book.id}`)
}

const chromiumRun = await openContext(chromium)
for (const book of demoBooks) await exerciseBook(chromiumRun.page, book)
await chromiumRun.browser.close()
assert.deepEqual(chromiumRun.errors, [])

// Safari cannot transfer streams and takes the mic-release path, so it runs a real call too.
const webkitRun = await openContext(webkit)
await exerciseBook(webkitRun.page, demoBooks[0])
await webkitRun.browser.close()
assert.deepEqual(webkitRun.errors, [])
console.log('voice ui ok')

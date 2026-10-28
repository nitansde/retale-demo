import { chromium, devices, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const url = process.env.DEMO_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch();
await mkdir('test-results', { recursive: true });
const catalogFile = resolve('test-results/tutorial-catalog.cjs');
await build({ stdin: { contents: 'export {demoBooks} from "./demo/catalog"', resolveDir: process.cwd() }, outfile: catalogFile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
const { demoBooks } = createRequire(import.meta.url)(catalogFile);
try {
  for (const book of demoBooks) for (const mobile of [false, true]) {
    const en = book.locale === 'en';
    const labels = en ? { start: 'Start tutorial', sample: 'Select the first paragraph', generate: 'Generate version', save: 'Save as continue block', open: 'Open story knowledge', finish: 'Finish and explore' } : { start: '开始体验', sample: '帮我选取第一段', generate: '生成版本', save: '保存为续写块', open: '打开故事知识库', finish: '完成，继续探索' };
    const context = await browser.newContext({ ...(mobile ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } }), reducedMotion: mobile ? 'reduce' : 'no-preference' });
    await context.addInitScript(locale => localStorage.setItem('retale.locale', locale), en ? 'en' : 'zh');
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const tutorial = page.getByTestId('first-run-tutorial');
    const step = name => expect(tutorial).toHaveAttribute('data-step', name, { timeout: 20000 });
    await page.goto(url);
    await step('welcome');
    await page.screenshot({ path: `test-results/tutorial-${book.id}-${mobile ? 'mobile' : 'desktop'}-welcome.png` });
    await tutorial.getByRole('button', { name: new RegExp(labels.start) }).click();
    await step('book');
    await page.getByRole('button').filter({ has: page.getByRole('heading', { name: book.title, exact: true }) }).click();
    await step('select');
    await expect(page.getByTestId('tutorial-current-book')).toContainText(book.title);
    if (mobile) {
      await tutorial.getByRole('button', { name: en ? /Select & rewrite a passage/ : /选一段并魔改/ }).tap();
    } else {
      await tutorial.getByRole('button', { name: new RegExp(labels.sample) }).click();
      await step('rewrite');
      await page.getByTestId('workspace-chapter-rewrite-entry').filter({ visible: true }).first().click();
    }
    await step('generate');
    await page.getByTestId('workspace-action-overlay').locator('textarea').first().fill('让主角换一种选择，主动说出真相。');
    await page.getByTestId('rewrite-actions').getByRole('button', { name: labels.generate, exact: true }).click();
    await step('save');
    if (mobile) await expect(page.getByTestId('rewrite-result')).toBeInViewport();
    await page.screenshot({ path: `test-results/tutorial-${book.id}-${mobile ? 'mobile' : 'desktop'}-save.png` });
    await page.getByTestId('rewrite-actions').getByRole('button', { name: labels.save, exact: true }).click();
    await step('knowledge');
    await expect(page.getByTestId('workspace-continue-block-view')).toContainText(book.scenario.rewriteText.split('\n\n').at(-1));
    await expect(page.getByTestId('tutorial-current-book')).toContainText(book.title);
    await tutorial.getByRole('button', { name: new RegExp(labels.open) }).click();
    await step('inspect');
    await expect(page.getByTestId('workspace-reference-panel').filter({ visible: true })).toBeVisible();
    await page.screenshot({ path: `test-results/tutorial-${book.id}-${mobile ? 'mobile' : 'desktop'}-knowledge.png` });
    await tutorial.getByRole('button', { name: new RegExp(labels.finish) }).click();
    await expect(tutorial).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('workspace-continue-block-view')).toBeVisible();
    await expect(tutorial).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('retale.demo.tutorial.v1'))).toBe('completed');
    expect(errors).toEqual([]);
    await context.close();
    console.log(`PASS ${book.title} ${mobile ? 'mobile, reduced motion' : 'desktop'}: first rewrite, save, knowledge, completion persistence`);
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: '跳过教程', exact: true }).click();
  await expect(page.getByTestId('first-run-tutorial')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('article').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('first-run-tutorial')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('retale.demo.tutorial.v1'))).toBe('skipped');
  await context.close();
  console.log('PASS skip persists across reload');
  const english = await browser.newContext();
  await english.addInitScript(() => localStorage.setItem('retale.locale', 'en'));
  const englishPage = await english.newPage();
  await englishPage.goto(url);
  await englishPage.getByRole('button', { name: 'Start tutorial', exact: false }).click();
  await expect(englishPage.getByTestId('first-run-tutorial')).toHaveAttribute('data-step', 'book');
  await englishPage.keyboard.press('Escape');
  await expect(englishPage.getByTestId('first-run-tutorial')).toHaveCount(0);
  expect(await englishPage.evaluate(() => localStorage.getItem('retale.demo.tutorial.v1'))).toBe('skipped');
  await english.close();
  console.log('PASS English tutorial and Escape to skip mid-tour');
} finally { await browser.close(); }

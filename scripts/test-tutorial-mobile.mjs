import { chromium, devices, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Use touch events and hit testing: merely resizing a desktop page misses overlays.
const browser = await chromium.launch();
await mkdir('test-results', { recursive: true });
const url = process.env.DEMO_TEST_URL || 'http://localhost:3000';
try {
  for (const [device, locale] of [['iPhone SE', 'zh'], ['iPhone 13', 'zh'], ['Pixel 7', 'en']]) {
    const context = await browser.newContext({ ...devices[device] });
    await context.addInitScript(locale => {
      localStorage.setItem('retale.locale', locale);
      // A returning visitor may have looked at a graph before starting the guide.
      localStorage.setItem('retale.workspace-preferences.v1', JSON.stringify({ version: 1, centerPaneView: 'graph', refTab: 'characters' }));
    }, locale);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const touch = await context.newCDPSession(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const en = locale === 'en';
    const label = en ? {
      start: /Start tutorial/, book: 'Dracula', sample: /Select & rewrite a passage/,
      more: 'More options', graph: 'Graph', body: 'Body', home: 'Back to library',
      generate: 'Generate version', save: 'Save as continue block', knowledge: /Open story knowledge/,
      expand: 'Expand details', close: 'Close story context', finish: /Finish and explore/,
      minimize: 'Minimize', resume: 'Resume guide', skip: 'Skip tutorial',
    } : {
      start: /开始体验/, book: '西游记·大闹天宫', sample: /选一段并魔改/,
      more: '更多选项', graph: '图谱', body: '正文', home: '返回书库',
      generate: '生成版本', save: '保存为续写块', knowledge: /打开故事知识库/,
      expand: '展开详情', close: '关闭故事上下文', finish: /完成，继续探索/,
      minimize: '收起', resume: '继续引导', skip: '跳过教程',
    };
    const guide = page.getByTestId('first-run-tutorial');
    const step = value => expect(guide).toHaveAttribute('data-step', value, { timeout: 20000 });
    const shot = name => page.screenshot({ path: `test-results/mobile-walk-${device.replaceAll(' ', '-')}-${locale}-${name}.png` });
    const tapVisible = async locator => {
      await expect(locator).toBeInViewport();
      const hit = await locator.evaluate(el => {
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        return x > 0 && x < innerWidth && y > 0 && y < innerHeight && el.contains(document.elementFromPoint(x, y));
      });
      expect(hit, `Touch target must be visible and uncovered: ${await locator.innerText()}`).toBe(true);
      await locator.tap();
    };
    const swipe = async (up = true) => {
      const { width, height } = page.viewportSize();
      const x = width / 2, from = height * (up ? .76 : .3), to = height * (up ? .3 : .76);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
      for (let i = 1; i <= 8; i++) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * i / 8 }] });
        await page.waitForTimeout(30);
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(200);
    };
    const revealWithSwipes = async (locator, up = true) => {
      for (let i = 0; i < 16; i++) {
        const box = await locator.boundingBox();
        if (box && box.y > 80 && box.y + box.height < page.viewportSize().height - 12) return;
        await swipe(up);
      }
      throw new Error('Could not reach control by swiping');
    };
    try {
      await page.goto(url);
      await tapVisible(guide.getByRole('button', { name: label.start }));
      await step('book');
      for (const targetLocale of [en ? 'zh' : 'en', locale]) {
        const option = page.getByTestId(`app-language-option-${targetLocale}`);
        await expect(option).toBeInViewport({ ratio: 1 });
        await tapVisible(option);
        await expect(option).toHaveAttribute('aria-pressed', 'true');
      }
      await shot('library');
      // Book choice is arbitrary, including books below the first screen.
      const book = page.getByRole('button').filter({ has: page.getByRole('heading', { name: label.book, exact: true }) });
      await revealWithSwipes(book);
      await tapVisible(book);
      await step('select');
      await expect(page.getByTestId('workspace-chapter-reader')).toBeInViewport();
      const noOverlap = await guide.evaluate(el => {
        const r = el.getBoundingClientRect();
        const reader = document.querySelector('[data-testid="workspace-chapter-reader"]').getBoundingClientRect();
        return r.bottom <= reader.top && getComputedStyle(el).position === 'relative';
      });
      expect(noOverlap).toBe(true);
      await shot('reader');
      await tapVisible(guide.getByRole('button', { name: label.minimize, exact: true }));
      await tapVisible(guide.getByRole('button', { name: label.resume, exact: true }));
      // Graph is still available, and returning to prose takes one tap.
      await tapVisible(page.getByRole('button', { name: label.more, exact: true }));
      await expect(guide).toHaveCount(0);
      await tapVisible(page.getByRole('dialog').getByRole('button', { name: label.graph, exact: true }));
      await step('explore');
      await tapVisible(page.getByTestId('workspace-mobile-toolbar').getByRole('button', { name: label.body, exact: true }));
      await step('select');
      await tapVisible(guide.getByRole('button', { name: label.sample }));
      await step('generate');
      const overlay = page.getByTestId('workspace-action-overlay');
      const prompt = overlay.locator('textarea').first();
      await shot('prompt');
      await revealWithSwipes(prompt);
      await tapVisible(prompt);
      await prompt.fill(en ? 'Let the protagonist make a different choice.' : '让主角主动做出不同的选择。');
      // A short visual viewport approximates the space left by a software keyboard.
      const originalViewport = page.viewportSize();
      await page.setViewportSize({ width: originalViewport.width, height: 400 });
      await tapVisible(page.getByTestId('rewrite-actions').getByRole('button', { name: label.generate, exact: true }));
      await page.setViewportSize(originalViewport);
      await step('save');
      await expect(page.getByTestId('rewrite-result')).toBeInViewport();
      await shot('result');
      await swipe();
      await tapVisible(page.getByTestId('rewrite-actions').getByRole('button', { name: label.save, exact: true }));
      await step('knowledge');
      await tapVisible(guide.getByRole('button', { name: label.knowledge }));
      await step('inspect');
      await shot('knowledge');
      const knowledge = page.getByTestId('workspace-reference-panel');
      const expand = knowledge.getByRole('button', { name: label.expand, exact: true }).first();
      await revealWithSwipes(expand);
      const profile = await expand.getAttribute('aria-controls');
      await tapVisible(expand);
      await expect(knowledge.locator(`button[aria-controls="${profile}"]`)).toHaveAttribute('aria-expanded', 'true');
      await shot('character');
      // Closing a panel must not dismiss/complete the guide.
      await tapVisible(page.getByRole('button', { name: label.close, exact: true }));
      await step('knowledge');
      await tapVisible(guide.getByRole('button', { name: label.knowledge }));
      await step('inspect');
      await tapVisible(guide.getByRole('button', { name: label.finish }));
      await expect(guide).toHaveCount(0);
      await tapVisible(page.getByRole('button', { name: label.close, exact: true }));
      await tapVisible(page.getByRole('link', { name: label.home, exact: true }).filter({ visible: true }));
      await expect(page.getByTestId('demo-site-disclosure')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      console.log(`PASS ${device} ${locale}: touch/swipe, persisted graph, prose, minimize, graph detour, rewrite, short viewport, readable result, save, character details, close/reopen, complete`);
    } catch (error) {
      await shot('failure');
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }

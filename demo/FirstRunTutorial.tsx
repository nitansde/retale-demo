'use client';

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, MousePointer2, Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import styles from './FirstRunTutorial.module.css';

const STORAGE_KEY = 'retale.demo.tutorial.v1';
type Step = 'welcome' | 'book' | 'select' | 'rewrite' | 'generate' | 'save' | 'knowledge' | 'inspect';
const steps: Step[] = ['book', 'select', 'rewrite', 'generate', 'save', 'knowledge', 'inspect'];
const testId = (name: string) => `[data-testid="${name}"]`;
const visible = (element: Element): element is HTMLElement => element instanceof HTMLElement && element.getClientRects().length > 0;
function find(selector: string) {
  return Array.from(document.querySelectorAll(selector)).find(visible);
}

const copy = {
  zh: {
    welcome: ['让故事，按你的想法重来', '用一分钟亲手完成第一次魔改，再看看人物、关系和原文依据。演示中的 AI 结果为预先编写，放心尝试。'],
    book: ['01 · 打开一本书', '点击任意样书进入工作区。你将在原文上创建自己的故事分支。'],
    select: ['02 · 选中想改变的片段', '在正文里拖选一段文字；手机上长按后拖动选区。也可以先用下方按钮选取第一段试试。'],
    rewrite: ['03 · 点击「魔改」', '选区已准备好。点击高亮的「魔改」按钮，打开改写面板。'],
    generate: ['04 · 写下你的新走向', '在改写要求里输入想改变的情节，例如「让主角换一种选择」，再点击「生成版本」。'],
    save: ['05 · 留住你的第一个分支', '看看生成结果，然后点击「保存为续写块」。保存后就可以从这个新版本继续写。'],
    knowledge: ['06 · 看看故事知识库', '魔改分支已保存！接下来打开「故事上下文」，查看故事中的人物、关系、设定与时间线。'],
    inspect: ['第一次魔改，完成！', '这里是故事知识库。点开人物卡查看详情，切换设定、时间线；正文的「图谱」还能查看关系与原文依据。知识会随当前章节切换。'],
    start: '开始体验', skip: '跳过教程', sample: '帮我选取第一段', open: '打开故事知识库', finish: '完成，继续探索', label: '新手引导', waiting: '请在高亮区域完成操作',
  },
  en: {
    welcome: ['Give this story a new beginning', 'Make your first rewrite in about a minute, then explore characters, relationships and source evidence. AI results in this demo are prewritten.'],
    book: ['01 · Open a book', 'Choose any sample book. You will create your own branch from its original prose.'],
    select: ['02 · Select a passage', 'Drag to select some prose. On touch screens, long-press and adjust the selection. Or use the button below to try the first paragraph.'],
    rewrite: ['03 · Choose Rewrite', 'Your selection is ready. Click the highlighted Rewrite button to open the editor.'],
    generate: ['04 · Describe your new direction', 'Enter a rewrite instruction, such as “Let the protagonist make a different choice”, then click Generate version.'],
    save: ['05 · Save your first branch', 'Read the result, then click Save as continue block. You can continue writing from this new version.'],
    knowledge: ['06 · Explore story knowledge', 'Your rewrite is saved! Open Story context to explore characters, relationships, settings and the timeline.'],
    inspect: ['Your first rewrite is complete!', 'This is your story knowledge panel. Open character cards and explore settings and the timeline. The Graph tab shows relationships and source evidence. Knowledge follows the current chapter.'],
    start: 'Start tutorial', skip: 'Skip tutorial', sample: 'Select the first paragraph', open: 'Open story knowledge', finish: 'Finish and explore', label: 'Getting started', waiting: 'Complete the action in the highlighted area',
  },
};

export function FirstRunTutorial() {
  const { locale, t } = useI18n();
  const text = copy[locale];
  const [step, setStep] = useState<Step | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ? null : 'welcome'; } catch { return 'welcome'; }
  });
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [cardAtTop, setCardAtTop] = useState(false);
  const saveRequested = useRef(false);
  const card = useRef<HTMLElement>(null);

  function finish(status: 'skipped' | 'completed') {
    try { localStorage.setItem(STORAGE_KEY, status); } catch { /* The tutorial can still close without browser storage. */ }
    setStep(null);
  }

  useEffect(() => {
    if (!step) return;
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') finish('skipped');
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [step]);

  useEffect(() => {
    if (!step || step === 'welcome') return;
    let target: HTMLElement | undefined;
    let previousTarget: HTMLElement | undefined;
    const update = () => {
      const reader = find(testId('workspace-chapter-reader'));
      const actions = find(testId('rewrite-actions'));
      const save = actions && Array.from(actions.querySelectorAll('button')).find(button => visible(button) && button.textContent?.trim() === t('workspace.shell.saveAsContinueBlock'));
      if (step !== 'book' && find('article button[aria-busy]')) { saveRequested.current = false; setStep('book'); return; }
      if (step === 'book' && reader) { setStep('select'); return; }
      if ((step === 'select' || step === 'rewrite') && actions) { setStep('generate'); return; }
      if (step === 'select' && find(`${testId('workspace-chapter-rewrite-entry')}:not(:disabled)`)) { setStep('rewrite'); return; }
      if (step === 'rewrite' && !find(`${testId('workspace-chapter-rewrite-entry')}:not(:disabled)`) && reader) { setStep('select'); return; }
      if (step === 'generate' && save && !save.hasAttribute('disabled') && find(testId('rewrite-result'))) { setStep('save'); return; }
      if ((step === 'generate' || step === 'save') && saveRequested.current && !actions && find(testId('workspace-continue-block-view'))) { setStep('knowledge'); return; }
      // Closing a rewrite without saving lets the visitor try again.
      if ((step === 'generate' || step === 'save') && !actions && reader) { saveRequested.current = false; setStep('select'); return; }
      target = step === 'book' ? find('article button[aria-busy]')
        : step === 'select' ? reader
        : step === 'rewrite' ? find(`${testId('workspace-chapter-rewrite-entry')}:not(:disabled)`)
        : step === 'generate' ? find(`${testId('workspace-action-overlay')} textarea`)
        : step === 'save' ? save
        : step === 'inspect' ? find(testId('workspace-reference-panel'))
        : find(testId('workspace-reference-panel'));
      if (target !== previousTarget) {
        if (step === 'book' || step === 'inspect') target?.scrollIntoView({ block: 'center', behavior: 'instant' });
        previousTarget = target;
      }
      if (target) {
        const rect = target.getBoundingClientRect();
        const next = { top: Math.max(4, rect.top - 4), left: Math.max(4, rect.left - 4), width: Math.min(rect.width + 8, innerWidth - 8), height: Math.min(rect.height + 8, innerHeight - Math.max(4, rect.top - 4) - 4) };
        setBox(old => old && Object.keys(next).every(key => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
        // Keep the compact coach card away from the control being taught.
        setCardAtTop(rect.top > innerHeight / 2);
      } else setBox(null);
    };
    const clicked = (event: MouseEvent) => {
      if ((step !== 'save' && step !== 'generate') || !(event.target instanceof Element)) return;
      const button = event.target.closest('button');
      if (button?.closest(testId('rewrite-actions')) && button.textContent?.trim() === t('workspace.shell.saveAsContinueBlock')) saveRequested.current = true;
    };
    update();
    const timer = window.setInterval(update, 200);
    document.addEventListener('click', clicked, true);
    return () => { clearInterval(timer); document.removeEventListener('click', clicked, true); };
  }, [step, t]);

  function selectSample() {
    const reader = find(testId('workspace-chapter-reader'));
    const paragraph = reader?.querySelector('p');
    if (!reader || !paragraph) return;
    paragraph.scrollIntoView({ block: 'center', behavior: 'instant' });
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    reader.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }

  function openKnowledge() {
    const panel = find(testId('workspace-reference-panel'));
    if (panel) { setStep('inspect'); return; }
    const button = Array.from(document.querySelectorAll('button')).find(element => visible(element) && element.getAttribute('aria-label') === t('workspace.header.openContext'));
    button?.click();
    if (button) setStep('inspect');
  }

  if (!step) return null;
  const index = steps.indexOf(step);
  return <div className={styles.root} data-testid="first-run-tutorial" data-step={step}>
    {step === 'welcome' && <div className={styles.scrim} />}
    {step !== 'welcome' && box && box.height > 0 && <div className={styles.spotlight} style={box} aria-hidden="true" />}
    <section ref={card} onKeyDown={event => {
      if (step !== 'welcome' || event.key !== 'Tab') return;
      const buttons = card.current?.querySelectorAll('button');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }} className={`${styles.card} ${step === 'welcome' ? styles.welcome : cardAtTop ? styles.top : styles.bottom}`} role={step === 'welcome' ? 'dialog' : 'region'} aria-label={text.label} aria-modal={step === 'welcome' ? true : undefined}>
      <div className={styles.heading}><span>{text.label}{step !== 'welcome' && ` · ${index + 1} / ${steps.length}`}</span><button type="button" onClick={() => finish('skipped')}>{text.skip}</button></div>
      <div className={styles.scene} aria-hidden="true"><BookOpen size={30} /><div className={styles.lines}><i /><i /><i /></div><MousePointer2 className={styles.cursor} size={20} /><Sparkles className={styles.spark} size={24} />{step === 'inspect' && <Check size={24} />}</div>
      <div key={step} className={styles.content} aria-live="polite"><h2>{text[step][0]}</h2><p>{text[step][1]}</p></div>
      {step !== 'welcome' && <div className={styles.progress} aria-hidden="true">{steps.map((item, i) => <span key={item} className={i <= index ? styles.active : ''} />)}</div>}
      <div className={styles.footer}>
        {step === 'welcome' ? <button autoFocus className={styles.primary} onClick={() => setStep(find(testId('workspace-chapter-reader')) ? 'select' : 'book')}>{text.start} →</button>
          : step === 'select' ? <button className={styles.primary} onMouseDown={event => event.preventDefault()} onClick={selectSample}>{text.sample} →</button>
          : step === 'knowledge' ? <button className={styles.primary} onClick={openKnowledge}>{text.open} →</button>
          : step === 'inspect' ? <button className={styles.primary} onClick={() => finish('completed')}>{text.finish} <Check size={16} /></button>
          : <span className={styles.hint}>{text.waiting}</span>}
      </div>
    </section>
  </div>;
}

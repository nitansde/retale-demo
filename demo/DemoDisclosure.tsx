'use client';

import { Code2, ArrowUpRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import styles from './DemoDisclosure.module.css';

export const RETALE_GITHUB_URL = 'https://github.com/nitansde/ReTale';

export function DemoDisclosure({ compact = false }: { compact?: boolean }) {
  const { locale } = useI18n();
  const en = locale === 'en';
  return (
    <section className={compact ? styles.compact : styles.banner} aria-label={en ? 'About this demo' : '演示站说明'} data-testid={compact ? 'tutorial-demo-disclosure' : 'demo-site-disclosure'}>
      <div>
        <p className={styles.title}>{en ? 'Demo site · Self-host for real use' : '演示站 · 真实使用需自行部署'}</p>
        <p className={styles.description}>{en
          ? 'This site only showcases ReTale’s features. AI results are simulated. For real use, get ReTale from GitHub and follow the documentation to deploy your own instance.'
          : '本站仅用于功能展示，AI 结果为模拟内容。真实使用请前往 GitHub 获取 ReTale，并按照文档自行部署。'}</p>
      </div>
      <a className={styles.link} href={RETALE_GITHUB_URL} target="_blank" rel="noopener noreferrer">
        <Code2 size={16} aria-hidden="true" />
        {en ? 'GitHub · Deploy your own' : 'GitHub · 自行部署'}
        <ArrowUpRight size={16} aria-hidden="true" />
      </a>
    </section>
  );
}

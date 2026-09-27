"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { Notice } from '@/components/ui/Notice'
import { useI18n } from '@/lib/i18n/provider'
import type {
  WritingSkillCard,
  WritingSkillCardDetail,
  WritingSkillDistillationJob,
} from '@/lib/writing-skill-types'
import {
  DEFAULT_WRITING_SKILL_CONTEXT_WINDOW,
  DEFAULT_WRITING_SKILL_TOTAL_BUDGET,
  WRITING_SKILL_RUNTIME_EXAMPLE_COUNTS,
  type WritingSkillContextWindow,
  type WritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'

type AgentState =
  | { kind: 'ready' }
  | { kind: 'running'; job: WritingSkillDistillationJob }
  | { kind: 'result'; card: WritingSkillCardDetail }
  | { kind: 'error'; message: string }

const TERMINAL_JOB_STATUSES = new Set(['COMPLETED', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'CANCELLED'])

async function fetchLibraryWritingSkillCards(libraryId: string) {
  const response = await fetch(`/api/material-libraries/${encodeURIComponent(libraryId)}/writing-skills`, { cache: 'no-store' })
  const data = await response.json() as { ok?: boolean; cards?: WritingSkillCard[]; error?: string }
  if (!response.ok || !data.ok) throw new Error(data.error || '')
  return data.cards ?? []
}

export function WritingSkillDistillationPanel({
  open,
  library,
  onClose,
}: {
  open: boolean
  library: { id: string; title: string } | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const [instruction, setInstruction] = useState('')
  const [agentState, setAgentState] = useState<AgentState>({ kind: 'ready' })
  const [cards, setCards] = useState<WritingSkillCard[]>([])
  const [cardsLoading, setCardsLoading] = useState(true)
  const [refineInstruction, setRefineInstruction] = useState('')
  const [scanContextWindow, setScanContextWindow] = useState<WritingSkillContextWindow>(DEFAULT_WRITING_SKILL_CONTEXT_WINDOW)
  const [scanTotalBudget, setScanTotalBudget] = useState<WritingSkillTotalBudget>(DEFAULT_WRITING_SKILL_TOTAL_BUDGET)
  const [saving, setSaving] = useState(false)
  const pollingJobIdRef = useRef<string | null>(null)
  const instructionInputRef = useRef<HTMLInputElement>(null)

  const loadCardDetail = useCallback(async (cardId: string) => {
    const response = await fetch(`/api/writing-skills/${encodeURIComponent(cardId)}`, { cache: 'no-store' })
    const data = await response.json() as { ok?: boolean; card?: WritingSkillCardDetail; error?: string }
    if (!response.ok || !data.ok || !data.card) throw new Error(data.error || t('writingSkill.loadFailed'))
    return data.card
  }, [t])

  const loadCards = useCallback(async () => {
    if (!library) return
    try {
      setCards(await fetchLibraryWritingSkillCards(library.id))
    } catch (error) {
      setAgentState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.loadFailed') })
    } finally {
      setCardsLoading(false)
    }
  }, [library, t])

  useEffect(() => {
    if (!open || !library) return
    let cancelled = false
    void fetchLibraryWritingSkillCards(library.id).then((nextCards) => {
      if (!cancelled) setCards(nextCards)
    }).catch((error) => {
      if (!cancelled) {
        setAgentState({ kind: 'error', message: error instanceof Error && error.message ? error.message : t('writingSkill.loadFailed') })
      }
    }).finally(() => {
      if (!cancelled) setCardsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, library, t])

  const pollJob = useCallback(async (jobId: string) => {
    pollingJobIdRef.current = jobId
    while (pollingJobIdRef.current === jobId) {
      const response = await fetch(`/api/writing-skill-jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      const data = await response.json() as { ok?: boolean; job?: WritingSkillDistillationJob; error?: string }
      if (!response.ok || !data.ok || !data.job) throw new Error(data.error || t('writingSkill.jobFailed'))
      const job = data.job
      if (pollingJobIdRef.current !== jobId) return
      setAgentState({ kind: 'running', job })
      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        pollingJobIdRef.current = null
        if (job.status === 'COMPLETED' && job.resultCardId) {
          const card = await loadCardDetail(job.resultCardId)
          setAgentState({ kind: 'result', card })
          await loadCards()
          return
        }
        if (job.status === 'CANCELLED') {
          setAgentState({ kind: 'ready' })
          return
        }
        setAgentState({ kind: 'error', message: job.errorMessage || job.message || t('writingSkill.jobFailed') })
        return
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 900))
    }
  }, [loadCardDetail, loadCards, t])

  useEffect(() => () => {
    pollingJobIdRef.current = null
  }, [])

  const startJob = async (url: string, body?: Record<string, unknown>) => {
    try {
      setAgentState({
        kind: 'running',
        job: {
          id: 'pending',
          libraryId: library?.id ?? '',
          libraryVersion: null,
          userInstruction: instruction,
          modelConfigId: 'knowledgeExtraction',
          status: 'PENDING',
          message: t('writingSkill.starting'),
          randomSeed: 0,
          roundCount: 0,
          sampledRanges: [],
          candidateRefs: [],
          candidateCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          errorMessage: null,
          resultCardId: null,
          createdAt: '',
          updatedAt: '',
        },
      })
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      const data = await response.json() as { ok?: boolean; jobId?: string; error?: string }
      if (!response.ok || !data.ok || !data.jobId) throw new Error(data.error || t('writingSkill.jobFailed'))
      await pollJob(data.jobId)
    } catch (error) {
      pollingJobIdRef.current = null
      setAgentState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.jobFailed') })
    }
  }

  const startCreate = () => {
    if (!library || !instruction.trim()) return
    void startJob(`/api/material-libraries/${encodeURIComponent(library.id)}/writing-skills`, {
      instruction: instruction.trim(),
      scanContextWindow,
      scanTotalBudget,
    })
  }

  const cancelJob = async () => {
    const jobId = agentState.kind === 'running' ? agentState.job.id : null
    if (!jobId || jobId === 'pending') return
    pollingJobIdRef.current = null
    await fetch(`/api/writing-skill-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => undefined)
    setAgentState({ kind: 'ready' })
  }

  const updateCard = async (card: WritingSkillCardDetail) => {
    setSaving(true)
    try {
      const response = await fetch(`/api/writing-skills/${encodeURIComponent(card.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: card.title,
          defaultExampleCount: card.defaultExampleCount,
          examples: card.examples.map((example) => ({ id: example.id, enabled: example.enabled })),
        }),
      })
      const data = await response.json() as { ok?: boolean; card?: WritingSkillCardDetail; error?: string }
      if (!response.ok || !data.ok || !data.card) throw new Error(data.error || t('writingSkill.saveFailed'))
      await loadCards()
      onClose()
    } catch (error) {
      setAgentState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  const deleteCard = async (cardId: string) => {
    if (!window.confirm(t('writingSkill.deleteConfirm'))) return
    setSaving(true)
    try {
      const response = await fetch(`/api/writing-skills/${encodeURIComponent(cardId)}`, { method: 'DELETE' })
      const data = await response.json() as { ok?: boolean; error?: string }
      if (!response.ok || !data.ok) throw new Error(data.error || t('writingSkill.deleteFailed'))
      setAgentState({ kind: 'ready' })
      await loadCards()
    } catch (error) {
      setAgentState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.deleteFailed') })
    } finally {
      setSaving(false)
    }
  }

  const running = agentState.kind === 'running'
  const scanBudgetControls = (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-zinc-200">{t('writingSkill.contextWindowLabel')}</span>
        <select
          aria-label={t('writingSkill.contextWindowLabel')}
          value={scanContextWindow}
          onChange={(event) => setScanContextWindow(event.target.value as WritingSkillContextWindow)}
          className="w-full rounded-2xl border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none"
        >
          <option value="32k">{t('writingSkill.contextWindow32k')}</option>
          <option value="64k">{t('writingSkill.contextWindow64k')}</option>
          <option value="96k">{t('writingSkill.contextWindow96k')}</option>
          <option value="128k">{t('writingSkill.contextWindow128k')}</option>
          <option value="256k">{t('writingSkill.contextWindow256k')}</option>
          <option value="512k">{t('writingSkill.contextWindow512k')}</option>
          <option value="1m">{t('writingSkill.contextWindow1m')}</option>
        </select>
        <span className="mt-2 block text-xs leading-5 text-zinc-500">{t('writingSkill.contextWindowHint')}</span>
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-zinc-200">{t('writingSkill.totalBudgetLabel')}</span>
        <select
          aria-label={t('writingSkill.totalBudgetLabel')}
          value={scanTotalBudget}
          onChange={(event) => setScanTotalBudget(event.target.value as WritingSkillTotalBudget)}
          className="w-full rounded-2xl border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none"
        >
          <option value="128k">{t('writingSkill.totalBudget128k')}</option>
          <option value="256k">{t('writingSkill.totalBudget256k')}</option>
          <option value="512k">{t('writingSkill.totalBudget512k')}</option>
          <option value="1m">{t('writingSkill.totalBudget1m')}</option>
          <option value="2m">{t('writingSkill.totalBudget2m')}</option>
          <option value="full">{t('writingSkill.totalBudgetFull')}</option>
        </select>
        <span className="mt-2 block text-xs leading-5 text-zinc-500">{t('writingSkill.totalBudgetHint')}</span>
      </label>
    </div>
  )
  return (
    <DialogSurface
      open={open}
      onClose={onClose}
      closeDisabled={running}
      closeLabel={t('common.close')}
      busy={running || saving}
      title={t('writingSkill.agentTitle')}
      description={library ? t('writingSkill.agentDescription', { title: library.title }) : ''}
      className="max-w-2xl"
      initialFocusRef={instructionInputRef}
    >
      {agentState.kind === 'ready' ? (
        <div className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-200">{t('writingSkill.question')}</span>
            <input
              ref={instructionInputRef}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && instruction.trim()) startCreate()
              }}
              maxLength={120}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-zinc-100 outline-none focus:border-violet-300/40"
              placeholder={t('writingSkill.placeholder')}
            />
          </label>
          {scanBudgetControls}
          <p className="text-xs leading-6 text-zinc-500">{t('writingSkill.examples')}</p>
          <button
            type="button"
            onClick={startCreate}
            disabled={!instruction.trim()}
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-400 disabled:opacity-40"
          >
            <Sparkles className="h-4 w-4" /> {t('writingSkill.start')}
          </button>

          <div className="border-t border-line/8 pt-5">
            <p className="mb-3 text-xs uppercase tracking-[0.16em] text-zinc-500">{t('writingSkill.existing')}</p>
            {cardsLoading ? (
              <p className="flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle className="h-4 w-4 animate-spin" /> {t('writingSkill.loading')}</p>
            ) : cards.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {cards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      void loadCardDetail(card.id).then((detail) => setAgentState({ kind: 'result', card: detail }))
                    }}
                    className="rounded-2xl border border-line/8 bg-overlay/[0.03] p-3 text-left transition hover:bg-overlay/[0.06]"
                  >
                    <p className="text-sm font-medium text-zinc-100">{card.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{card.summary}</p>
                    {card.status !== 'ACTIVE' ? <span className="mt-2 inline-block text-[10px] uppercase tracking-wider text-amber-300">{card.status}</span> : null}
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-zinc-500">{t('writingSkill.noExisting')}</p>}
          </div>
        </div>
      ) : null}

      {agentState.kind === 'running' ? (
        <div className="space-y-4">
          <Notice variant="info" title={agentState.job.message || t('writingSkill.processing')}>
            {agentState.job.candidateCount > 0
              ? t('writingSkill.foundCandidates', { count: agentState.job.candidateCount })
              : t('writingSkill.processingHint')}
          </Notice>
          <div className="h-2 overflow-hidden rounded-full bg-overlay/5">
            <div
              className="h-full rounded-full bg-violet-400 transition-all"
              style={{ width: `${Math.min(96, 12 + agentState.job.roundCount * 18 + (agentState.job.candidateCount > 0 ? 24 : 0))}%` }}
            />
          </div>
          <button type="button" onClick={() => void cancelJob()} className="inline-flex items-center gap-2 rounded-2xl border border-line/10 px-4 py-2.5 text-sm text-zinc-300">
            <X className="h-4 w-4" /> {t('writingSkill.cancel')}
          </button>
        </div>
      ) : null}

      {agentState.kind === 'result' ? (
        <div className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-zinc-500">{t('writingSkill.titleLabel')}</span>
            <input
              value={agentState.card.title}
              onChange={(event) => setAgentState({ kind: 'result', card: { ...agentState.card, title: event.target.value } })}
              maxLength={120}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-lg font-semibold text-zinc-100 outline-none"
            />
          </label>
          <p className="text-sm leading-7 text-zinc-300">{agentState.card.summary}</p>
          <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
            <span className="rounded-full border border-line/10 px-3 py-1">{t('writingSkill.ruleCount', { count: agentState.card.rules.length })}</span>
            <span className="rounded-full border border-line/10 px-3 py-1">{t('writingSkill.avoidCount', { count: agentState.card.avoid.length })}</span>
            <span className="rounded-full border border-line/10 px-3 py-1">{t('writingSkill.exampleCount', { count: agentState.card.examples.length })}</span>
          </div>
          <div className="space-y-2">
            {agentState.card.rules.map((rule, index) => (
              <div key={`${rule.text}-${index}`} className="rounded-2xl border border-line/8 bg-overlay/[0.03] p-3">
                <p className="text-sm text-zinc-200">{index + 1}. {rule.text}</p>
              </div>
            ))}
          </div>
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-zinc-200">{t('writingSkill.avoidTitle')}</h3>
            <ul className="space-y-2">
              {agentState.card.avoid.map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-3 rounded-2xl border border-amber-300/10 bg-amber-300/[0.04] px-4 py-3 text-sm leading-6 text-amber-100/90">
                  <span aria-hidden="true" className="text-amber-300">—</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">{t('writingSkill.examplePreviewTitle')}</h3>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{t('writingSkill.examplePreviewDescription')}</p>
            </div>
            <div className="space-y-3">
              {agentState.card.examples.map((example, index) => (
                <article key={example.id} className="rounded-2xl border border-line/8 bg-overlay/[0.03] p-4">
                  <p className="text-xs font-medium text-violet-200">{t('writingSkill.exampleLabel', { count: index + 1 })}</p>
                  {example.anonymizedText ? (
                    <p className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap pr-2 text-sm leading-7 text-zinc-300">
                      {example.anonymizedText}
                    </p>
                  ) : (
                    <p className="mt-3 text-xs leading-5 text-amber-300">{t('writingSkill.exampleUnavailable')}</p>
                  )}
                </article>
              ))}
            </div>
          </section>
          <details className="rounded-2xl border border-line/8 bg-shade/20 p-4">
            <summary className="cursor-pointer text-sm text-zinc-300">{t('writingSkill.advanced')}</summary>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs text-zinc-500">{t('writingSkill.defaultExampleCount')}</span>
                <select
                  value={agentState.card.defaultExampleCount}
                  onChange={(event) => setAgentState({ kind: 'result', card: { ...agentState.card, defaultExampleCount: Number(event.target.value) } })}
                  className="rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100"
                >
                  {WRITING_SKILL_RUNTIME_EXAMPLE_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
              {scanBudgetControls}
              <div className="space-y-2">
                {agentState.card.examples.map((example, index) => (
                  <label key={example.id} className="flex items-center justify-between gap-3 rounded-xl border border-line/8 px-3 py-2 text-xs text-zinc-400">
                    <span>{t('writingSkill.exampleLabel', { count: index + 1 })}</span>
                    <input
                      type="checkbox"
                      checked={example.enabled}
                      onChange={(event) => setAgentState({
                        kind: 'result',
                        card: {
                          ...agentState.card,
                          examples: agentState.card.examples.map((item) => item.id === example.id ? { ...item, enabled: event.target.checked } : item),
                        },
                      })}
                    />
                  </label>
                ))}
              </div>
            </div>
          </details>
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-300">{t('writingSkill.refineLabel')}</span>
            <textarea
              value={refineInstruction}
              onChange={(event) => setRefineInstruction(event.target.value)}
              maxLength={300}
              className="min-h-24 w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
              placeholder={t('writingSkill.refinePlaceholder')}
            />
            <span className="mt-2 block text-xs leading-5 text-zinc-500">{t('writingSkill.refineHint')}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void updateCard(agentState.card)} disabled={saving} className="rounded-2xl bg-violet-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              {saving ? t('writingSkill.saving') : t('writingSkill.saveAndUse')}
            </button>
            <button type="button" onClick={() => void startJob(`/api/writing-skills/${encodeURIComponent(agentState.card.id)}/regenerate`, { resample: true, scanContextWindow, scanTotalBudget })} className="inline-flex items-center gap-2 rounded-2xl border border-line/10 px-4 py-2.5 text-sm text-zinc-300">
              <RefreshCw className="h-4 w-4" /> {t('writingSkill.regenerate')}
            </button>
            <button type="button" onClick={() => refineInstruction.trim() && void startJob(`/api/writing-skills/${encodeURIComponent(agentState.card.id)}/refine`, { instruction: refineInstruction.trim() })} disabled={!refineInstruction.trim()} className="rounded-2xl border border-violet-400/30 bg-violet-500/10 px-4 py-2.5 text-sm text-violet-100 disabled:opacity-40">
              {t('writingSkill.refine')}
            </button>
            <button type="button" onClick={() => void deleteCard(agentState.card.id)} disabled={saving} className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/20 px-4 py-2.5 text-sm text-rose-200 disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> {t('writingSkill.delete')}
            </button>
          </div>
        </div>
      ) : null}

      {agentState.kind === 'error' ? (
        <div className="space-y-4">
          <Notice variant="error">{agentState.message}</Notice>
          <button type="button" onClick={() => setAgentState({ kind: 'ready' })} className="rounded-2xl border border-line/10 px-4 py-2.5 text-sm text-zinc-300">{t('writingSkill.tryAgain')}</button>
        </div>
      ) : null}
    </DialogSurface>
  )
}

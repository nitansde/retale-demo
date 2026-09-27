"use client"

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  FilePlus2,
  House,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { LibraryPageShell, LIBRARY_ACTION_ROW_CLASS_NAME, LIBRARY_PRIMARY_ACTION_CLASS_NAME, LIBRARY_SECONDARY_ACTION_CLASS_NAME } from '@/components/library/LibraryPageShell'
import { Notice } from '@/components/ui/Notice'
import { useI18n } from '@/lib/i18n/provider'
import {
  DEFAULT_WRITING_SKILL_CONTEXT_WINDOW,
  DEFAULT_WRITING_SKILL_TOTAL_BUDGET,
  WRITING_SKILL_RUNTIME_EXAMPLE_COUNTS,
  type WritingSkillContextWindow,
  type WritingSkillTotalBudget,
} from '@/lib/writing-skill-defaults'
import type {
  WritingSkillCard,
  WritingSkillCardDetail,
  WritingSkillDistillationJob,
  WritingSkillMaterialSourceSummary,
  WritingSkillSourceRef,
} from '@/lib/writing-skill-types'

type StudioState =
  | { kind: 'cards' }
  | { kind: 'running'; job: WritingSkillDistillationJob }
  | { kind: 'result'; card: WritingSkillCardDetail }
  | { kind: 'error'; message: string }

type SourcesResponse = {
  ok?: boolean
  librarySources?: WritingSkillMaterialSourceSummary[]
  uploadedSources?: WritingSkillMaterialSourceSummary[]
  model?: {
    modelConfigId: string
    provider: 'openai-compatible' | 'ollama'
    model: string
  } | null
  modelError?: string
  error?: string
}

const TERMINAL_JOB_STATUSES = new Set(['COMPLETED', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'CANCELLED'])

function sourceKey(source: WritingSkillSourceRef) {
  return `${source.sourceType}:${source.sourceId}`
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

async function readJson<T>(response: Response) {
  return response.json() as Promise<T>
}

export function WritingSkillStudio() {
  const { t } = useI18n()
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const pollingJobIdRef = useRef<string | null>(null)
  const [librarySources, setLibrarySources] = useState<WritingSkillMaterialSourceSummary[]>([])
  const [uploadedSources, setUploadedSources] = useState<WritingSkillMaterialSourceSummary[]>([])
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<Set<string>>(new Set())
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [cards, setCards] = useState<WritingSkillCard[]>([])
  const [cardsLoading, setCardsLoading] = useState(true)
  const [instruction, setInstruction] = useState('')
  const [scanContextWindow, setScanContextWindow] = useState<WritingSkillContextWindow>(DEFAULT_WRITING_SKILL_CONTEXT_WINDOW)
  const [scanTotalBudget, setScanTotalBudget] = useState<WritingSkillTotalBudget>(DEFAULT_WRITING_SKILL_TOTAL_BUDGET)
  const [studioState, setStudioState] = useState<StudioState>({ kind: 'cards' })
  const [refineInstruction, setRefineInstruction] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sourceError, setSourceError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const [activeModel, setActiveModel] = useState<SourcesResponse['model']>(null)
  const [modelError, setModelError] = useState('')

  const allSources = useMemo(
    () => [...librarySources, ...uploadedSources],
    [librarySources, uploadedSources],
  )
  const selectedSources = useMemo(() => allSources.filter((source) => (
    selectedSourceKeys.has(sourceKey(source))
  )), [allSources, selectedSourceKeys])

  const loadSources = useCallback(async () => {
    const response = await fetch('/api/writing-skill-sources', { cache: 'no-store' })
    const data = await readJson<SourcesResponse>(response)
    if (!response.ok || !data.ok) throw new Error(data.error || t('writingSkill.sourcesLoadFailed'))
    const nextLibrarySources = data.librarySources ?? []
    const nextUploadedSources = data.uploadedSources ?? []
    const availableKeys = new Set([...nextLibrarySources, ...nextUploadedSources].map(sourceKey))
    setLibrarySources(nextLibrarySources)
    setUploadedSources(nextUploadedSources)
    setActiveModel(data.model ?? null)
    setModelError(data.modelError ?? '')
    setSelectedSourceKeys((current) => new Set(Array.from(current).filter((key) => availableKeys.has(key))))
  }, [t])

  const loadCards = useCallback(async () => {
    const response = await fetch('/api/writing-skills', { cache: 'no-store' })
    const data = await readJson<{ ok?: boolean; cards?: WritingSkillCard[]; error?: string }>(response)
    if (!response.ok || !data.ok) throw new Error(data.error || t('writingSkill.loadFailed'))
    setCards(data.cards ?? [])
  }, [t])

  const loadCardDetail = useCallback(async (cardId: string) => {
    const response = await fetch(`/api/writing-skills/${encodeURIComponent(cardId)}`, { cache: 'no-store' })
    const data = await readJson<{ ok?: boolean; card?: WritingSkillCardDetail; error?: string }>(response)
    if (!response.ok || !data.ok || !data.card) throw new Error(data.error || t('writingSkill.loadFailed'))
    return data.card
  }, [t])

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      const results = await Promise.allSettled([loadSources(), loadCards()])
      if (cancelled) return
      const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined
      if (failure) setSourceError(failure.reason instanceof Error ? failure.reason.message : t('writingSkill.loadFailed'))
      setSourcesLoading(false)
      setCardsLoading(false)
    }
    void hydrate()
    return () => {
      cancelled = true
      pollingJobIdRef.current = null
    }
  }, [loadCards, loadSources, t])

  const pollJob = useCallback(async (jobId: string) => {
    pollingJobIdRef.current = jobId
    while (pollingJobIdRef.current === jobId) {
      const response = await fetch(`/api/writing-skill-jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      const data = await readJson<{ ok?: boolean; job?: WritingSkillDistillationJob; error?: string }>(response)
      if (!response.ok || !data.ok || !data.job) throw new Error(data.error || t('writingSkill.jobFailed'))
      const job = data.job
      if (pollingJobIdRef.current !== jobId) return
      setStudioState({ kind: 'running', job })
      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        pollingJobIdRef.current = null
        if (job.status === 'COMPLETED' && job.resultCardId) {
          const card = await loadCardDetail(job.resultCardId)
          setStudioState({ kind: 'result', card })
          await loadCards()
          return
        }
        if (job.status === 'CANCELLED') {
          setStudioState({ kind: 'cards' })
          return
        }
        setStudioState({ kind: 'error', message: job.errorMessage || job.message || t('writingSkill.jobFailed') })
        return
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 900))
    }
  }, [loadCardDetail, loadCards, t])

  const startJob = async (url: string, body: Record<string, unknown>) => {
    try {
      setStudioState({
        kind: 'running',
        job: {
          id: 'pending',
          libraryId: '',
          libraryVersion: null,
          userInstruction: instruction,
          modelConfigId: activeModel?.modelConfigId ?? 'rewrite',
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
        body: JSON.stringify(body),
      })
      const data = await readJson<{ ok?: boolean; jobId?: string; error?: string }>(response)
      if (!response.ok || !data.ok || !data.jobId) throw new Error(data.error || t('writingSkill.jobFailed'))
      await pollJob(data.jobId)
    } catch (error) {
      pollingJobIdRef.current = null
      setStudioState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.jobFailed') })
    }
  }

  const startCreate = () => {
    if (!instruction.trim() || !selectedSources.length) return
    void startJob('/api/writing-skills', {
      instruction: instruction.trim(),
      sourceRefs: selectedSources.map(({ sourceType, sourceId }) => ({ sourceType, sourceId })),
      scanContextWindow,
      scanTotalBudget,
    })
  }

  const cancelJob = async () => {
    const jobId = studioState.kind === 'running' ? studioState.job.id : null
    if (!jobId || jobId === 'pending') return
    pollingJobIdRef.current = null
    await fetch(`/api/writing-skill-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).catch(() => undefined)
    setStudioState({ kind: 'cards' })
  }

  const toggleSource = (source: WritingSkillMaterialSourceSummary) => {
    const key = sourceKey(source)
    setSelectedSourceKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const uploadMaterial = async (file: File) => {
    setUploading(true)
    setSourceError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/writing-skill-materials', { method: 'POST', body: formData })
      const data = await readJson<{ ok?: boolean; material?: WritingSkillMaterialSourceSummary; error?: string }>(response)
      if (!response.ok || !data.ok || !data.material) throw new Error(data.error || t('writingSkill.materialUploadFailed'))
      await loadSources()
      setSelectedSourceKeys((current) => new Set([...current, sourceKey(data.material!)]))
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : t('writingSkill.materialUploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const deleteMaterial = async (source: WritingSkillMaterialSourceSummary) => {
    if (!window.confirm(t('writingSkill.materialDeleteConfirm', { title: source.title }))) return
    setSaving(true)
    try {
      const response = await fetch(`/api/writing-skill-materials/${encodeURIComponent(source.sourceId)}`, { method: 'DELETE' })
      const data = await readJson<{ ok?: boolean; error?: string }>(response)
      if (!response.ok || !data.ok) throw new Error(data.error || t('writingSkill.materialDeleteFailed'))
      await loadSources()
      await loadCards()
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : t('writingSkill.materialDeleteFailed'))
    } finally {
      setSaving(false)
    }
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
      const data = await readJson<{ ok?: boolean; card?: WritingSkillCardDetail; error?: string }>(response)
      if (!response.ok || !data.ok || !data.card) throw new Error(data.error || t('writingSkill.saveFailed'))
      await loadCards()
      setStudioState({ kind: 'cards' })
      setSaveNotice(t('writingSkill.saved'))
      window.setTimeout(() => setSaveNotice(''), 2400)
    } catch (error) {
      setStudioState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  const deleteCard = async (cardId: string) => {
    if (!window.confirm(t('writingSkill.deleteConfirm'))) return
    setSaving(true)
    try {
      const response = await fetch(`/api/writing-skills/${encodeURIComponent(cardId)}`, { method: 'DELETE' })
      const data = await readJson<{ ok?: boolean; error?: string }>(response)
      if (!response.ok || !data.ok) throw new Error(data.error || t('writingSkill.deleteFailed'))
      setStudioState({ kind: 'cards' })
      await loadCards()
    } catch (error) {
      setStudioState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.deleteFailed') })
    } finally {
      setSaving(false)
    }
  }

  const budgetControls = (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center justify-between gap-4 border-t border-line/10 py-3">
        <span className="shrink-0 text-xs text-zinc-500">{t('writingSkill.currentModel')}</span>
        <span className={`min-w-0 text-right text-sm [overflow-wrap:anywhere] ${activeModel ? 'text-zinc-100' : 'text-amber-200'}`}>
          {activeModel?.model || modelError || t('writingSkill.modelUnavailable')}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-zinc-200">{t('writingSkill.contextWindowLabel')}</span>
          <select
            aria-label={t('writingSkill.contextWindowLabel')}
            value={scanContextWindow}
            onChange={(event) => setScanContextWindow(event.target.value as WritingSkillContextWindow)}
            className="min-h-11 w-full rounded-xl border border-line/10 bg-surface px-4 py-3 text-base text-zinc-100 outline-none sm:text-sm"
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
            className="min-h-11 w-full rounded-xl border border-line/10 bg-surface px-4 py-3 text-base text-zinc-100 outline-none sm:text-sm"
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
    </div>
  )

  const sourceGroup = (title: string, sources: WritingSkillMaterialSourceSummary[], uploaded = false) => (
    <section className="min-w-0 max-w-full space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
        <span className="text-xs text-zinc-500">{sources.length}</span>
      </div>
      {sources.length ? (
        <div className="min-w-0 max-w-full space-y-2">
          {sources.map((source) => {
            const selected = selectedSourceKeys.has(sourceKey(source))
            return (
              <div key={sourceKey(source)} className={`flex min-w-0 max-w-full items-center gap-3 overflow-hidden border-b px-1 py-3 transition sm:rounded-xl sm:border sm:p-3 ${selected ? 'border-violet-300/30 bg-violet-500/10' : 'border-line/8 sm:bg-overlay/[0.025]'}`}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleSource(source)}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 overflow-hidden text-left"
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-violet-300/40 bg-violet-400 text-white' : 'border-line/15 text-transparent'}`}>
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block max-w-full whitespace-normal text-sm leading-5 text-zinc-100 [overflow-wrap:anywhere]">{source.title}</span>
                    <span className="mt-1 block max-w-full whitespace-normal text-xs leading-5 text-zinc-500 [overflow-wrap:anywhere]">
                      {t('writingSkill.sourceMeta', { chapters: source.chapterCount, tokens: formatTokenCount(source.estimatedTokens) })}
                    </span>
                  </span>
                </button>
                {uploaded ? (
                  <button
                    type="button"
                    onClick={() => void deleteMaterial(source)}
                    disabled={saving}
                    aria-label={t('writingSkill.materialDeleteAria', { title: source.title })}
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="py-4 text-sm text-zinc-500">
          {uploaded ? t('writingSkill.noUploadedSources') : t('writingSkill.noLibrarySources')}
        </p>
      )}
    </section>
  )

  return (
    <LibraryPageShell title={t('writingSkill.pageTitle')} description={t('writingSkill.pageDescription')}>
        <div className="mb-6">
          <div className={LIBRARY_ACTION_ROW_CLASS_NAME}>
            <Link href="/library" aria-label={t('writingSkill.backToLibrary')} className={LIBRARY_SECONDARY_ACTION_CLASS_NAME}>
              <House className="h-4 w-4 shrink-0" aria-hidden="true" /> {t('workspace.header.home')}
            </Link>
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              className={LIBRARY_PRIMARY_ACTION_CLASS_NAME}
            >
              {uploading ? <LoaderCircle className="h-4 w-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />}
              {uploading ? t('writingSkill.materialUploading') : t('writingSkill.materialUpload')}
            </button>
          </div>
          <input
            ref={uploadRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void uploadMaterial(file)
              event.target.value = ''
            }}
          />
        </div>

        {saveNotice ? <Notice variant="success" className="mb-5">{saveNotice}</Notice> : null}
        {sourceError ? <Notice variant="error" className="mb-5">{sourceError}</Notice> : null}

        {studioState.kind === 'running' ? (
          <section className="border-b border-line/10 pb-6 sm:rounded-[24px] sm:border sm:bg-overlay/[0.04] sm:p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-violet-500/15 p-3 text-violet-200"><LoaderCircle className="h-6 w-6 animate-spin" /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-medium">{studioState.job.message || t('writingSkill.processing')}</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {studioState.job.candidateCount > 0
                    ? t('writingSkill.foundCandidates', { count: studioState.job.candidateCount })
                    : t('writingSkill.processingHint')}
                </p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-overlay/5">
                  <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${Math.min(96, 12 + studioState.job.roundCount * 10 + (studioState.job.candidateCount > 0 ? 24 : 0))}%` }} />
                </div>
                <button type="button" onClick={() => void cancelJob()} className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-line/10 px-4 py-2.5 text-sm text-zinc-300">
                  <X className="h-4 w-4" /> {t('writingSkill.cancel')}
                </button>
              </div>
            </div>
          </section>
        ) : studioState.kind === 'result' ? (
          <section className="border-b border-line/10 pb-6 sm:rounded-[24px] sm:border sm:bg-overlay/[0.04] sm:p-5">
            <button type="button" onClick={() => setStudioState({ kind: 'cards' })} className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100">
              <ArrowLeft className="h-4 w-4" /> {t('writingSkill.backToCards')}
            </button>
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-zinc-500">{t('writingSkill.titleLabel')}</span>
              <input
                value={studioState.card.title}
                onChange={(event) => setStudioState({ kind: 'result', card: { ...studioState.card, title: event.target.value } })}
                maxLength={120}
                className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-2xl font-semibold text-zinc-100 outline-none"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              {(studioState.card.sources ?? []).map((source) => (
                <span key={`${source.sourceType}:${source.sourceId}`} className="rounded-full border border-line/10 px-3 py-1 text-xs text-zinc-400">{source.sourceName}</span>
              ))}
            </div>
            <p className="mt-5 text-sm leading-7 text-zinc-300">{studioState.card.summary}</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs text-zinc-400">
              <span className="rounded-full border border-line/10 px-3 py-1">{t('writingSkill.ruleCount', { count: studioState.card.rules.length })}</span>
              <span className="rounded-full border border-line/10 px-3 py-1">{t('writingSkill.avoidCount', { count: studioState.card.avoid.length })}</span>
              <span className="rounded-full border border-line/10 px-3 py-1">{t('writingSkill.exampleCount', { count: studioState.card.examples.length })}</span>
            </div>
            <div className="mt-6 grid gap-3 lg:grid-cols-2">
              {studioState.card.rules.map((rule, index) => (
                <div key={`${rule.text}-${index}`} className="rounded-2xl border border-line/8 bg-overlay/[0.03] p-4 text-sm leading-6 text-zinc-200">
                  <span className="mr-2 text-violet-300">{index + 1}.</span>{rule.text}
                </div>
              ))}
            </div>
            <section className="mt-7 space-y-3">
              <h3 className="text-sm font-medium text-zinc-200">{t('writingSkill.avoidTitle')}</h3>
              <ul className="grid gap-2 lg:grid-cols-2">
                {studioState.card.avoid.map((item, index) => (
                  <li key={`${item}-${index}`} className="flex gap-3 rounded-2xl border border-amber-300/10 bg-amber-300/[0.04] px-4 py-3 text-sm leading-6 text-amber-100/90">
                    <span className="text-amber-300">—</span><span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="mt-7 space-y-3">
              <div>
                <h3 className="text-sm font-medium text-zinc-200">{t('writingSkill.examplePreviewTitle')}</h3>
                <p className="mt-1 text-xs leading-5 text-zinc-500">{t('writingSkill.examplePreviewDescription')}</p>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {studioState.card.examples.map((example, index) => (
                  <article key={example.id} className="rounded-2xl border border-line/8 bg-overlay/[0.03] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-medium text-violet-200">{t('writingSkill.exampleLabel', { count: index + 1 })}</p>
                      <input
                        type="checkbox"
                        checked={example.enabled}
                        aria-label={t('writingSkill.exampleEnabledLabel', { count: index + 1 })}
                        onChange={(event) => setStudioState({
                          kind: 'result',
                          card: {
                            ...studioState.card,
                            examples: studioState.card.examples.map((item) => item.id === example.id ? { ...item, enabled: event.target.checked } : item),
                          },
                        })}
                      />
                    </div>
                    {example.anonymizedText ? (
                      <p className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap pr-2 text-sm leading-7 text-zinc-300">{example.anonymizedText}</p>
                    ) : <p className="mt-3 text-xs text-amber-300">{t('writingSkill.exampleUnavailable')}</p>}
                  </article>
                ))}
              </div>
            </section>
            <details className="mt-7 rounded-2xl border border-line/8 bg-shade/20 p-4">
              <summary className="cursor-pointer text-sm text-zinc-300">{t('writingSkill.advanced')}</summary>
              <div className="mt-4 space-y-5">
                <label className="block">
                  <span className="mb-2 block text-xs text-zinc-500">{t('writingSkill.defaultExampleCount')}</span>
                  <select
                    value={studioState.card.defaultExampleCount}
                    onChange={(event) => setStudioState({ kind: 'result', card: { ...studioState.card, defaultExampleCount: Number(event.target.value) } })}
                    className="rounded-xl border border-line/10 bg-surface px-3 py-2 text-sm text-zinc-100"
                  >
                    {WRITING_SKILL_RUNTIME_EXAMPLE_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
                  </select>
                </label>
                {budgetControls}
              </div>
            </details>
            <label className="mt-7 block">
              <span className="mb-2 block text-sm text-zinc-300">{t('writingSkill.refineLabel')}</span>
              <textarea
                value={refineInstruction}
                onChange={(event) => setRefineInstruction(event.target.value)}
                maxLength={300}
                className="min-h-24 w-full rounded-xl border border-line/10 bg-shade/20 px-4 py-3 text-base text-zinc-100 outline-none sm:text-sm"
                placeholder={t('writingSkill.refinePlaceholder')}
              />
              <span className="mt-2 block text-xs leading-5 text-zinc-500">{t('writingSkill.refineHint')}</span>
            </label>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => void updateCard(studioState.card)} disabled={saving} className={LIBRARY_PRIMARY_ACTION_CLASS_NAME}>
                {saving ? t('writingSkill.saving') : t('writingSkill.saveAndUse')}
              </button>
              <button type="button" onClick={() => void startJob(`/api/writing-skills/${encodeURIComponent(studioState.card.id)}/regenerate`, { scanContextWindow, scanTotalBudget })} className="inline-flex items-center gap-2 rounded-2xl border border-line/10 px-4 py-2.5 text-sm text-zinc-300">
                <RefreshCw className="h-4 w-4" /> {t('writingSkill.regenerate')}
              </button>
              <button type="button" onClick={() => refineInstruction.trim() && void startJob(`/api/writing-skills/${encodeURIComponent(studioState.card.id)}/refine`, { instruction: refineInstruction.trim() })} disabled={!refineInstruction.trim()} className="rounded-2xl border border-violet-400/30 bg-violet-500/10 px-4 py-2.5 text-sm text-violet-100 disabled:opacity-40">
                {t('writingSkill.refine')}
              </button>
              <button type="button" onClick={() => void deleteCard(studioState.card.id)} disabled={saving} className="inline-flex items-center gap-2 rounded-2xl border border-rose-400/20 px-4 py-2.5 text-sm text-rose-200 disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> {t('writingSkill.delete')}
              </button>
            </div>
          </section>
        ) : studioState.kind === 'error' ? (
          <section className="space-y-4 border-b border-line/10 pb-6 sm:rounded-[24px] sm:border sm:bg-overlay/[0.04] sm:p-5">
            <Notice variant="error">{studioState.message}</Notice>
            <button type="button" onClick={() => setStudioState({ kind: 'cards' })} className="rounded-2xl border border-line/10 px-4 py-2.5 text-sm text-zinc-300">{t('writingSkill.tryAgain')}</button>
          </section>
        ) : (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <aside className="min-w-0 max-w-full space-y-6 overflow-hidden border-b border-line/10 pb-6 sm:rounded-[24px] sm:border sm:bg-overlay/[0.04] sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-base font-medium sm:text-lg"><BookOpen className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" /> {t('writingSkill.sourcesTitle')}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">{t('writingSkill.sourcesDescription')}</p>
                </div>
                <span className="shrink-0 py-1 text-xs text-zinc-500">{t('writingSkill.selectedSources', { count: selectedSources.length })}</span>
              </div>
              {sourcesLoading ? (
                <p className="flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle className="h-4 w-4 animate-spin" /> {t('writingSkill.sourcesLoading')}</p>
              ) : (
                <>
                  {sourceGroup(t('writingSkill.librarySourcesTitle'), librarySources)}
                  {sourceGroup(t('writingSkill.uploadedSourcesTitle'), uploadedSources, true)}
                  <button type="button" onClick={() => uploadRef.current?.click()} disabled={uploading} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-violet-300/20 px-4 py-3 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-50">
                    <FilePlus2 className="h-4 w-4" /> {t('writingSkill.materialUploadSecondary')}
                  </button>
                </>
              )}
            </aside>

            <div className="min-w-0 space-y-6">
              <section className="min-w-0 overflow-hidden border-b border-line/10 pb-6 sm:rounded-[24px] sm:border sm:bg-overlay/[0.04] sm:p-5">
                <div className="mb-5">
                  <p className="text-xs text-zinc-500">{t('writingSkill.createEyebrow')}</p>
                  <h2 className="mt-2 text-base font-medium sm:text-lg">{t('writingSkill.createTitle')}</h2>
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-zinc-200">{t('writingSkill.question')}</span>
                  <input
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && instruction.trim() && selectedSources.length) startCreate()
                    }}
                    maxLength={120}
                    className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-zinc-100 outline-none focus:border-violet-300/40"
                    placeholder={t('writingSkill.placeholder')}
                  />
                </label>
                <div className="mt-5">{budgetControls}</div>
                <button
                  type="button"
                  onClick={startCreate}
                  disabled={!instruction.trim() || !selectedSources.length}
                  className={`mt-5 ${LIBRARY_PRIMARY_ACTION_CLASS_NAME}`}
                >
                  <Sparkles className="h-4 w-4" /> {t('writingSkill.start')}
                </button>
              </section>

              <section className="min-w-0 overflow-hidden border-b border-line/10 pb-6 sm:rounded-[24px] sm:border sm:bg-overlay/[0.04] sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-base font-medium sm:text-lg">{t('writingSkill.cardsTitle')}</h2>
                  <span className="text-xs text-zinc-500">{cards.length}</span>
                </div>
                {cardsLoading ? (
                  <p className="flex items-center gap-2 text-sm text-zinc-400"><LoaderCircle className="h-4 w-4 animate-spin" /> {t('writingSkill.loading')}</p>
                ) : cards.length ? (
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                    {cards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => void loadCardDetail(card.id).then((detail) => setStudioState({ kind: 'result', card: detail })).catch((error) => setStudioState({ kind: 'error', message: error instanceof Error ? error.message : t('writingSkill.loadFailed') }))}
                        className="min-h-11 min-w-0 max-w-full overflow-hidden border-b border-line/8 py-4 text-left transition hover:border-violet-300/20 hover:bg-overlay/[0.05] sm:rounded-xl sm:border sm:bg-overlay/[0.025] sm:p-4"
                      >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <p className="min-w-0 flex-1 whitespace-normal text-sm font-medium text-zinc-100 [overflow-wrap:anywhere]">{card.title}</p>
                          {card.status !== 'ACTIVE' ? <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">{card.status}</span> : null}
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{card.summary}</p>
                        <p className="mt-3 max-w-full truncate text-[11px] text-zinc-600">{card.libraryName}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center">
                    <FilePlus2 className="mx-auto h-4 w-4 text-zinc-600" aria-hidden="true" />
                    <p className="mt-3 text-sm text-zinc-500">{t('writingSkill.noExisting')}</p>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
    </LibraryPageShell>
  )
}

"use client"

import { formatProgressMessage } from '@/lib/i18n/progress-message'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { TaskAbortButton } from './task-abort-button'
import { readBrowserWorkspaceSession } from '@/lib/browser-preferences'
import { useI18n } from '@/lib/i18n/provider'

type BackgroundTask = {
  jobId: string
  novelTitle: string | null
  novelId: string | null
  branchId: string | null
  updatedAt: string | Date | null
  createdAt: string | Date | null
  status: string
  jobType: string
  currentStep: string | null
  progress: number | null
  errorMessage: string | null
}

function formatDate(value: string | Date | null | undefined, locale: string) {
  if (!value) return null

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatProgress(progress: number | null | undefined) {
  if (typeof progress !== 'number' || Number.isNaN(progress)) {
    return null
  }

  const normalized = progress <= 1 ? progress * 100 : progress
  return `${Math.round(Math.max(0, Math.min(100, normalized)))}%`
}

function getStatusClasses(status: string) {
  switch (status) {
    case 'running':
      return 'border-indigo-400/30 bg-indigo-500/12 text-indigo-100'
    case 'paused':
      return 'border-amber-300/30 bg-amber-500/12 text-amber-100'
    case 'queued':
      return 'border-violet-400/30 bg-violet-500/12 text-violet-100'
    default:
      return 'border-line/10 bg-overlay/[0.04] text-zinc-200'
  }
}

function TaskMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-line/8 bg-shade/20 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm text-zinc-200">{value}</dd>
    </div>
  )
}

export function TaskPageClient() {
  const { locale, t } = useI18n()
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [novelId, setNovelId] = useState('')
  const browserLocale = locale === 'zh' ? 'zh-CN' : 'en'

  useEffect(() => {
    const currentNovelId = readBrowserWorkspaceSession().currentNovelId
    if (!currentNovelId) return

    const controller = new AbortController()
    void fetch(`/api/task?novelId=${encodeURIComponent(currentNovelId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json() as { tasks?: BackgroundTask[] }
        if (response.ok && Array.isArray(payload.tasks)) {
          setNovelId(currentNovelId)
          setTasks(payload.tasks)
        }
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) console.error(error)
      })

    return () => controller.abort()
  }, [])

  const sortedTasks = [...tasks].sort((left, right) => {
    const leftTime = new Date(left.updatedAt ?? 0).getTime()
    const rightTime = new Date(right.updatedAt ?? 0).getTime()

    return rightTime - leftTime
  })

  const renderNovelLine = (task: BackgroundTask) => {
    if (task.novelTitle?.trim()) {
      return task.novelId ? `${task.novelTitle} (${task.novelId})` : task.novelTitle
    }

    if (task.novelId) {
      return task.novelId
    }

    return t('task.notAttached')
  }

  const renderBranchLine = (task: BackgroundTask) => task.branchId ?? t('task.defaultBranch')

  const formatStatus = (status: string) => {
    if (status === 'queued' || status === 'running' || status === 'paused') {
      return t(`task.status.${status}`)
    }

    return status || t('task.unknown')
  }

  const formatJobType = (jobType: string) => {
    if (jobType === 'extract_chapter_knowledge' || jobType === 'rebuild_retrieval_index' || jobType === 'rewrite_generation') {
      return t(`task.job.${jobType}`)
    }

    return jobType.replace(/_/g, ' ')
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-zinc-100 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/library" className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-2xl border border-line/10 bg-overlay/[0.04] px-4 text-sm text-zinc-300 transition hover:bg-overlay/[0.08]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t('task.backToLibrary')}
        </Link>
        <header className="mb-8">
          <p className="text-sm uppercase tracking-[0.28em] text-zinc-500">{t('task.eyebrow')}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-heading">{t('task.title')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{t('task.description')}</p>
        </header>

        <section className="mb-6 rounded-[28px] border border-line/8 bg-[radial-gradient(circle_at_top_left,_rgba(124,58,237,0.16),_transparent_38%),rgba(255,255,255,0.04)] p-5 shadow-[0_20px_60px_rgb(0_0_0/calc(0.35*var(--shadow-strength)))] backdrop-blur">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{t('task.activeTasks')}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-heading">{sortedTasks.length}</p>
          </div>
        </section>

        {sortedTasks.length === 0 ? (
          <section className="rounded-[28px] border border-dashed border-line/10 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.08),_transparent_36%),var(--surface)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
            <div className="mx-auto max-w-2xl">
              <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{t('task.allQuiet')}</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-heading">{t('task.noActiveTasks')}</h2>
            </div>
          </section>
        ) : (
          <div className="space-y-4">
            {sortedTasks.map((task) => {
              const progress = formatProgress(task.progress) ?? t('task.unknown')
              const currentStep = formatProgressMessage(task.currentStep, t) || t('task.noCurrentStep')
              return (
                <article
                  key={task.jobId}
                  className="rounded-[28px] border border-line/8 bg-overlay/[0.04] p-5 shadow-[0_20px_60px_rgb(0_0_0/calc(0.35*var(--shadow-strength)))] backdrop-blur"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${getStatusClasses(task.status)}`}>
                          {formatStatus(task.status)}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-xs text-zinc-300">
                          {formatJobType(task.jobType)}
                        </span>
                      </div>

                      <h2 className="mt-4 text-lg font-semibold tracking-tight text-heading">{task.jobId}</h2>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">{currentStep}</p>
                    </div>

                    <div className="flex flex-col gap-3 lg:items-end">
                      <TaskAbortButton
                        jobId={task.jobId}
                        novelId={task.novelId ?? novelId}
                        onAborted={() => setTasks((current) => current.filter((item) => item.jobId !== task.jobId))}
                      />
                      <div className="rounded-[20px] border border-line/8 bg-shade/20 px-4 py-3 text-sm text-zinc-300 lg:min-w-56">
                        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                          <span>{t('task.progress')}</span>
                          <span>{progress}</span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-overlay/10">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(129,140,248,0.9),rgba(168,85,247,0.95))]"
                            style={{
                              width: typeof task.progress === 'number'
                                ? `${Math.max(0, Math.min(100, task.progress <= 1 ? task.progress * 100 : task.progress))}%`
                                : '0%',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <TaskMetaRow label={t('task.novel')} value={renderNovelLine(task)} />
                    <TaskMetaRow label={t('task.branch')} value={renderBranchLine(task)} />
                    <TaskMetaRow label={t('task.updated')} value={formatDate(task.updatedAt, browserLocale) ?? t('task.unknown')} />
                    <TaskMetaRow label={t('task.created')} value={formatDate(task.createdAt, browserLocale) ?? t('task.unknown')} />
                    <TaskMetaRow label={t('task.status')} value={formatStatus(task.status)} />
                    <TaskMetaRow label={t('task.jobType')} value={formatJobType(task.jobType)} />
                  </dl>

                  {task.errorMessage?.trim() ? (
                    <div className="mt-4 rounded-[20px] border border-amber-300/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-amber-200/80">{t('task.note')}</div>
                      <p className="mt-1 leading-6">{task.errorMessage}</p>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}

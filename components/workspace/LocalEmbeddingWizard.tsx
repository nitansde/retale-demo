"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LocalEmbeddingRuntimeStatus } from '@/lib/local-embedding'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'

type LocalEmbeddingWizardProps = {
  active?: boolean
  onConfigured: (settings: { baseUrl: string; apiKey: string; model: string }) => void
}

const ACTIVE_PHASES = new Set([
  'downloading-runtime',
  'extracting-runtime',
  'downloading-model',
  'verifying',
  'starting',
])
const CUSTOM_MODEL_VALUE = '__custom-hugging-face-gguf__'

function formatBytes(bytes: number, locale: string) {
  if (bytes >= 1_000_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1_000_000_000)} GB`
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1_000_000)} MB`
}

export function LocalEmbeddingWizard({ active = true, onConfigured }: LocalEmbeddingWizardProps) {
  const { locale, t } = useI18n()
  const [status, setStatus] = useState<LocalEmbeddingRuntimeStatus | null>(null)
  const [loadError, setLoadError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedModelId, setSelectedModelId] = useState('')
  const [customRepository, setCustomRepository] = useState('')
  const [customFileName, setCustomFileName] = useState('')
  const [customRiskConfirmed, setCustomRiskConfirmed] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const configuredSignatureRef = useRef('')

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/ai/local-embedding', { cache: 'no-store' })
      const data = await response.json() as LocalEmbeddingRuntimeStatus & { error?: string }
      if (!response.ok || !data.ok) throw new Error(data.error || t('aiSettings.local.loadFailed'))
      setStatus(data)
      setLoadError('')
      setSelectedModelId((current) => {
        if (current) return current
        const installedCatalogModel = data.models.find((model) => model.id === data.selectedModelId)?.id
        return installedCatalogModel || data.models.find((model) => model.recommended)?.id || data.models[0]?.id || ''
      })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('aiSettings.local.loadFailed'))
    }
  }, [t])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshStatus(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshStatus])

  useEffect(() => {
    if (!status || !ACTIVE_PHASES.has(status.phase)) return
    const timer = window.setInterval(() => void refreshStatus(), 750)
    return () => window.clearInterval(timer)
  }, [refreshStatus, status])

  useEffect(() => {
    const model = status?.connection.model
    if (!active) {
      configuredSignatureRef.current = ''
      return
    }
    if (!status?.installed || !status.configured || !model) return
    const signature = `${status.connection.baseUrl}\u0000${model}`
    if (configuredSignatureRef.current === signature) return
    configuredSignatureRef.current = signature
    onConfigured({
      baseUrl: status.connection.baseUrl,
      apiKey: status.connection.apiKey,
      model,
    })
  }, [active, onConfigured, status])

  const selectedModel = useMemo(
    () => status?.models.find((model) => model.id === selectedModelId) ?? null,
    [selectedModelId, status],
  )
  const customSelected = selectedModelId === CUSTOM_MODEL_VALUE
  const customReady = customSelected
    && Boolean(customRepository.trim())
    && Boolean(customFileName.trim())
    && customRiskConfirmed
  const busy = actionPending || Boolean(status && ACTIVE_PHASES.has(status.phase))

  const runAction = async (action: 'install' | 'start' | 'stop') => {
    if (actionPending) return
    setActionPending(true)
    setLoadError('')
    try {
      const response = await fetch('/api/settings/ai/local-embedding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'install'
          ? customSelected
            ? {
                action: 'install-custom',
                repository: customRepository.trim(),
                fileName: customFileName.trim(),
                riskAccepted: customRiskConfirmed,
                installConfirmed: confirmed,
              }
            : { action, modelId: selectedModelId }
          : { action }),
      })
      const data = await response.json() as LocalEmbeddingRuntimeStatus & { error?: string }
      if (!response.ok || !data.ok) throw new Error(data.error || t('aiSettings.local.actionFailed'))
      setStatus(data)
      if (action === 'install') setStep(3)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('aiSettings.local.actionFailed'))
    } finally {
      setActionPending(false)
      void refreshStatus()
    }
  }

  const phaseLabel = status ? t(`aiSettings.local.phase.${status.phase}`) : t('aiSettings.local.loading')
  const displayedModel = status?.installed
    ? status.connection.model || status.selectedModelId
    : customSelected
      ? customFileName.trim() || t('aiSettings.local.customOption')
      : selectedModel?.id

  return (
    <div className="mt-4 rounded-[22px] border border-violet-300/15 bg-violet-500/[0.06] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="text-[11px] uppercase tracking-[0.16em] text-violet-200/70">llama.cpp · Local RAG</p>
          <h5 className="mt-1 text-sm font-medium text-zinc-100">{t('aiSettings.local.title')}</h5>
          <p className="mt-2 text-xs leading-5 text-zinc-400">{t('aiSettings.local.summary')}</p>
          {displayedModel ? <p className="mt-3 text-sm leading-6">
            <span className="text-zinc-400">{t(status?.installed ? 'aiSettings.local.installedModel' : 'aiSettings.local.installModel')}</span>
            <span className="block font-medium text-zinc-100 [overflow-wrap:anywhere]">{displayedModel}</span>
          </p> : null}
        </div>
        <span className={cn(
          'rounded-full border px-3 py-1 text-[11px]',
          status?.running
            ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-200'
            : status?.phase === 'error'
              ? 'border-rose-300/20 bg-rose-500/10 text-rose-200'
              : 'border-line/10 bg-shade/20 text-zinc-300',
        )}>
          {phaseLabel}
        </span>
      </div>

      <div className="mt-3 rounded-2xl border border-amber-300/10 bg-amber-500/[0.05] px-3 py-2 text-xs leading-5 text-amber-100/80">
        {t('aiSettings.local.noRagImpact')}
      </div>

      {status ? (
        <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
          <div className="rounded-2xl border border-line/8 bg-shade/15 px-3 py-2">{status.platformLabel}</div>
          <div className="rounded-2xl border border-line/8 bg-shade/15 px-3 py-2">{t(`aiSettings.local.accelerator.${status.backend}`)}</div>
        </div>
      ) : null}

      {loadError || status?.error ? (
        <p className="mt-3 rounded-2xl border border-rose-300/15 bg-rose-500/[0.06] px-3 py-2 text-xs leading-5 text-rose-200">
          {loadError || status?.error}
        </p>
      ) : null}

      {status?.progress ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs text-zinc-400">
            <span>{phaseLabel}</span>
            <span>
              {formatBytes(status.progress.downloadedBytes, locale)}
              {status.progress.totalBytes > 0 ? ` / ${formatBytes(status.progress.totalBytes, locale)}` : ` · ${t('aiSettings.local.unknownTotal')}`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-shade/30">
            <div className="h-full rounded-full bg-violet-400 transition-[width]" style={{ width: `${status.progress.percent}%` }} />
          </div>
        </div>
      ) : null}

      {!expanded ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setExpanded(true)
              setStep(status?.installed ? 3 : 1)
            }}
            disabled={!status || !status.supported}
            className="min-h-10 rounded-2xl bg-violet-500 px-4 text-xs font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status?.installed ? t('aiSettings.local.manageButton') : t('aiSettings.local.installButton')}
          </button>
          {status && !status.supported ? <p className="self-center text-xs text-rose-200">{t('aiSettings.local.unsupported')}</p> : null}
        </div>
      ) : (
        <div className="mt-4 rounded-[20px] border border-line/10 bg-shade/20 p-4">
          {!status?.installed && step === 1 ? (
            <div>
              <p className="text-xs font-medium text-zinc-200">{t('aiSettings.local.step1Title')}</p>
              <p className="mt-2 text-xs leading-5 text-zinc-400">{t('aiSettings.local.step1Body')}</p>
              <div className="mt-4 flex justify-end">
                <button type="button" onClick={() => setStep(2)} className="min-h-10 rounded-2xl bg-violet-500 px-4 text-xs text-white hover:bg-violet-400">{t('aiSettings.local.next')}</button>
              </div>
            </div>
          ) : null}

          {!status?.installed && step === 2 ? (
            <div>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-zinc-200">{t('aiSettings.local.chooseModel')}</span>
                <select
                  value={selectedModelId}
                  onChange={(event) => {
                    setSelectedModelId(event.target.value)
                    setConfirmed(false)
                    setCustomRiskConfirmed(false)
                  }}
                  className="w-full rounded-2xl border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none"
                >
                  {status?.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}{model.recommended ? ` · ${t('aiSettings.local.recommended')}` : ''}
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL_VALUE}>{t('aiSettings.local.customOption')}</option>
                </select>
              </label>

              {customSelected ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-xs text-zinc-300">{t('aiSettings.local.customRepository')}</span>
                      <input
                        value={customRepository}
                        onChange={(event) => {
                          setCustomRepository(event.target.value)
                          setConfirmed(false)
                        }}
                        placeholder="Qwen/Qwen3-Embedding-4B-GGUF"
                        autoComplete="off"
                        className="w-full rounded-2xl border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs text-zinc-300">{t('aiSettings.local.customFileName')}</span>
                      <input
                        value={customFileName}
                        onChange={(event) => {
                          setCustomFileName(event.target.value)
                          setConfirmed(false)
                        }}
                        placeholder="Qwen3-Embedding-4B-Q4_K_M.gguf"
                        autoComplete="off"
                        className="w-full rounded-2xl border border-line/10 bg-surface px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                      />
                    </label>
                  </div>
                  <p className="text-xs leading-5 text-zinc-500">{t('aiSettings.local.customSourceNote')}</p>
                  <div className="rounded-2xl border border-amber-300/15 bg-amber-500/[0.06] p-3 text-xs leading-5 text-amber-100/85">
                    {t('aiSettings.local.customRisk')}
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line/8 bg-shade/15 p-3">
                    <input
                      type="checkbox"
                      checked={customRiskConfirmed}
                      onChange={(event) => {
                        setCustomRiskConfirmed(event.target.checked)
                        setConfirmed(false)
                      }}
                      className="mt-0.5 h-4 w-4 accent-violet-500"
                    />
                    <span className="text-xs leading-5 text-zinc-300">{t('aiSettings.local.customRiskConfirm')}</span>
                  </label>
                </div>
              ) : selectedModel ? (
                <>
                  <p className="mt-3 text-xs leading-5 text-zinc-400">{t(`aiSettings.local.model.${selectedModel.profile}Description`)}</p>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-2xl border border-line/8 px-3 py-2 text-zinc-400">{t('aiSettings.local.download')}: {formatBytes(selectedModel.downloadBytes + (status?.runtimeDownloadBytes ?? 0), locale)}</div>
                    <div className="rounded-2xl border border-line/8 px-3 py-2 text-zinc-400">{t('aiSettings.local.disk')}: {formatBytes(selectedModel.diskEstimateBytes, locale)}</div>
                    <div className="rounded-2xl border border-line/8 px-3 py-2 text-zinc-400">{t('aiSettings.local.memory')}: {formatBytes(selectedModel.memoryMinBytes, locale)}–{formatBytes(selectedModel.memoryMaxBytes, locale)}</div>
                    <div className="rounded-2xl border border-line/8 px-3 py-2 text-zinc-400">{selectedModel.dimension} dim · {selectedModel.quantization} · {selectedModel.license}</div>
                  </div>
                </>
              ) : null}
              <p className="mt-3 text-xs leading-5 text-zinc-500">{t('aiSettings.local.runtimeNote')}</p>
              <div className="mt-4 flex justify-between gap-2">
                <button type="button" onClick={() => { setStep(1); setConfirmed(false) }} className="min-h-10 rounded-2xl border border-line/10 px-4 text-xs text-zinc-300 hover:bg-overlay/[0.06]">{t('aiSettings.local.back')}</button>
                <button type="button" onClick={() => setStep(3)} disabled={customSelected ? !customReady : !selectedModel} className="min-h-10 rounded-2xl bg-violet-500 px-4 text-xs text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">{t('aiSettings.local.next')}</button>
              </div>
            </div>
          ) : null}

          {(!status?.installed && step === 3) || status?.installed ? (
            <div>
              {!status?.installed ? (
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line/8 bg-shade/15 p-3">
                  <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-500" />
                  <span className="text-xs leading-5 text-zinc-300">
                    {customSelected
                      ? t('aiSettings.local.confirmCustom')
                      : t('aiSettings.local.confirm', { size: selectedModel ? formatBytes(selectedModel.downloadBytes + (status?.runtimeDownloadBytes ?? 0), locale) : '' })}
                  </span>
                </label>
              ) : (
                <p className="text-xs leading-5 text-zinc-300">{status.running ? t('aiSettings.local.runningBody') : t('aiSettings.local.stoppedBody')}</p>
              )}
              <div className="mt-4 flex flex-wrap justify-between gap-2">
                <button type="button" onClick={() => { setExpanded(false); setConfirmed(false); setCustomRiskConfirmed(false) }} disabled={busy} className="min-h-10 rounded-2xl border border-line/10 px-4 text-xs text-zinc-300 hover:bg-overlay/[0.06] disabled:opacity-50">{t('aiSettings.local.closeWizard')}</button>
                {!status?.installed ? (
                  <button type="button" onClick={() => void runAction('install')} disabled={!confirmed || (customSelected ? !customReady : !selectedModel) || busy} className="min-h-10 rounded-2xl bg-violet-500 px-4 text-xs font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50">{busy ? phaseLabel : t('aiSettings.local.confirmInstall')}</button>
                ) : status.running ? (
                  <button type="button" onClick={() => void runAction('stop')} disabled={busy} className="min-h-10 rounded-2xl border border-line/10 px-4 text-xs text-zinc-300 hover:bg-overlay/[0.06] disabled:opacity-50">{t('aiSettings.local.stop')}</button>
                ) : (
                  <button type="button" onClick={() => void runAction('start')} disabled={busy} className="min-h-10 rounded-2xl bg-violet-500 px-4 text-xs font-medium text-white hover:bg-violet-400 disabled:opacity-50">{t('aiSettings.local.start')}</button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

"use client"

import { useId, useState } from 'react'
import { ChevronDown, RefreshCw, TriangleAlert } from 'lucide-react'
import { isAIScenarioConfigured } from '@/lib/ai-settings'
import { LOCAL_EMBEDDING_BASE_URL } from '@/lib/local-embedding'
import {
  AI_SCENARIO_META,
  getAIScenarioMeta,
  type OllamaModelOption,
  type OpenAICompatibleModelOption,
} from '@/components/workspace/selection-novel-studio-helpers'
import { DialogSurface } from '@/components/ui/DialogSurface'
import { LocalEmbeddingWizard } from '@/components/workspace/LocalEmbeddingWizard'
import { WorkspaceAppearanceSettings } from '@/components/workspace/WorkspaceAppearanceSettings'
import { useI18n } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils'
import type { AIProvider, AISettings, AIScenarioKey } from '@/lib/types'

type WorkspaceAISettingsModalProps = {
  open: boolean
  initialSection?: 'appearance' | 'models'
  onClose: () => void
  onSave: () => Promise<void> | void
  scenarioStatusLabels: string[]
  resolvedAISettings: AISettings
  ollamaModelsByScenario: Record<AIScenarioKey, OllamaModelOption[]>
  ollamaModelsLoading: Record<AIScenarioKey, boolean>
  ollamaModelsError: Record<AIScenarioKey, string>
  openAICompatibleModelsByScenario: Record<AIScenarioKey, OpenAICompatibleModelOption[]>
  openAICompatibleModelsLoading: Record<AIScenarioKey, boolean>
  updateScenarioProvider: (scenario: AIScenarioKey, provider: AIProvider) => void
  updateScenarioOpenAIField: (scenario: AIScenarioKey, field: 'baseUrl' | 'apiKey' | 'model', value: string) => void
  updateScenarioOllamaField: (scenario: AIScenarioKey, field: 'baseUrl' | 'model', value: string) => void
  updateKnowledgeExtractionParallelism: (provider: AIProvider, value: string) => void
  updateEmbeddingBatchSize: (value: string) => void
  applyLocalEmbeddingSettings: (settings: { baseUrl: string; apiKey: string; model: string }) => void
  loadOpenAICompatibleModels: (scenario: AIScenarioKey, baseUrl?: string, apiKey?: string) => void
  loadOllamaModels: (scenario: AIScenarioKey, baseUrl?: string) => void
}

export function WorkspaceAISettingsModal(props: WorkspaceAISettingsModalProps) {
  const { locale, t } = useI18n()
  const metaByScenario = getAIScenarioMeta(locale)
  const [saving, setSaving] = useState(false)
  const [expandedScenario, setExpandedScenario] = useState<AIScenarioKey | null>(props.initialSection === 'models' ? 'rewrite' : null)
  const [localInstallSelected, setLocalInstallSelected] = useState(() => (
    props.resolvedAISettings.embeddings.provider === 'openai-compatible'
    && props.resolvedAISettings.embeddings.openAICompatible.baseUrl.trim().replace(/\/$/, '') === LOCAL_EMBEDDING_BASE_URL
  ))
  const formId = useId()
  const [section, setSection] = useState<'appearance' | 'models'>(props.initialSection ?? 'appearance')

  if (!props.open) return null

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      await props.onSave()
    } catch {
      // The workspace owns the user-facing error notice and keeps this dialog open.
    } finally {
      setSaving(false)
    }
  }

  const fieldClass = 'min-h-11 w-full min-w-0 rounded-xl border border-line/10 bg-surface px-3 py-2.5 text-base text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 sm:text-sm'

  const renderFields = (scenario: AIScenarioKey) => {
    const settings = props.resolvedAISettings[scenario]
    const isOpenAI = settings.provider === 'openai-compatible'
    const connection = isOpenAI ? settings.openAICompatible : settings.ollama
    const models = isOpenAI ? props.openAICompatibleModelsByScenario[scenario] : props.ollamaModelsByScenario[scenario]
    const loading = isOpenAI ? props.openAICompatibleModelsLoading[scenario] : props.ollamaModelsLoading[scenario]
    const error = isOpenAI ? '' : props.ollamaModelsError[scenario]
    const modelInputId = `${formId}-${scenario}-model`
    const listId = `${modelInputId}-options`
    const updateField = (field: 'baseUrl' | 'model', value: string) => {
      if (isOpenAI) props.updateScenarioOpenAIField(scenario, field, value)
      else props.updateScenarioOllamaField(scenario, field, value)
    }

    return <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm text-zinc-300">{isOpenAI ? 'Base URL' : 'Ollama Base URL'}</span>
        <input value={connection.baseUrl} onChange={(event) => updateField('baseUrl', event.target.value)} className={fieldClass} placeholder={isOpenAI ? 'https://api.openai.com/v1' : 'http://127.0.0.1:11434'} autoCapitalize="none" spellCheck={false} />
      </label>
      {isOpenAI ? <label className="block">
        <span className="mb-1.5 block text-sm text-zinc-300">API Key</span>
        <input type="password" autoComplete="off" value={settings.openAICompatible.apiKey} onChange={(event) => props.updateScenarioOpenAIField(scenario, 'apiKey', event.target.value)} className={fieldClass} placeholder={settings.openAICompatible.apiKeyMasked || 'sk-...'} />
        {settings.openAICompatible.apiKeyConfigured && !settings.openAICompatible.apiKey ? <p className="mt-1.5 text-xs leading-5 text-zinc-500">{t('aiSettings.apiKeyHint')}</p> : null}
      </label> : null}
      <div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={modelInputId} className="text-sm text-zinc-300">Model</label>
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => {
              if (isOpenAI) props.loadOpenAICompatibleModels(scenario, connection.baseUrl, settings.openAICompatible.apiKey)
              else props.loadOllamaModels(scenario, connection.baseUrl)
            }}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-xs text-violet-300 disabled:opacity-50"
          >
            <RefreshCw aria-hidden="true" className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {loading ? t('aiSettings.refreshing') : t('aiSettings.refreshModels')}
          </button>
        </div>
        <input id={modelInputId} list={listId} value={connection.model} onChange={(event) => updateField('model', event.target.value)} className={fieldClass} placeholder={isOpenAI ? metaByScenario[scenario].openAIPlaceholder : metaByScenario[scenario].ollamaPlaceholder} autoCapitalize="none" spellCheck={false} />
        <datalist id={listId}>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist>
        <p className="mt-1.5 text-xs leading-5 text-zinc-500">{t(isOpenAI ? 'aiSettings.modelInputHint' : 'aiSettings.localModelInputHint')}</p>
        {error ? <p role="alert" className="mt-2 text-xs leading-5 text-rose-300">{error}</p> : null}
      </div>
    </div>
  }

  return (
    <DialogSurface
      open={props.open}
      onClose={props.onClose}
      closeLabel={t('common.close')}
      closeDisabled={saving}
      busy={saving}
      title={t('settings.title')}
      description={t('settings.description')}
      className="max-w-2xl"
      mobileFullscreen
      footer={section === 'models' ? <div className="flex justify-end gap-2">
        <button onClick={props.onClose} disabled={saving} className="min-h-11 rounded-xl px-4 text-sm text-zinc-300 disabled:opacity-50">{t('workspace.shell.cancel')}</button>
        <button onClick={() => void handleSave()} disabled={saving} className="min-h-11 rounded-xl bg-violet-500 px-4 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-60">{saving ? t('aiSettings.saving') : t('aiSettings.saveSettings')}</button>
      </div> : undefined}
    >
      <div role="group" aria-label={t('settings.sections')} className="mb-6 flex gap-2 rounded-2xl border border-line/10 bg-shade/20 p-1.5">
        {(['appearance', 'models'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={section === item}
            onClick={() => setSection(item)}
            disabled={saving}
            className={cn(
              'min-h-11 flex-1 rounded-xl px-4 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70 disabled:opacity-50',
              section === item ? 'bg-violet-500/15 text-violet-100' : 'text-zinc-400 hover:bg-overlay/[0.06] hover:text-zinc-200',
            )}
          >
            {t(`settings.${item}`)}
          </button>
        ))}
      </div>
      {section === 'appearance' ? <WorkspaceAppearanceSettings /> : (
        <>
          <p className="mb-3 text-sm leading-6 text-zinc-400">{t('aiSettings.description')}</p>
          <div className="divide-y divide-line/10">
            {(Object.keys(AI_SCENARIO_META) as AIScenarioKey[]).map((scenario) => {
              const meta = metaByScenario[scenario]
              const settings = props.resolvedAISettings[scenario]
              const configured = isAIScenarioConfigured(settings)
              const connection = settings.provider === 'openai-compatible' ? settings.openAICompatible : settings.ollama
              const expanded = expandedScenario === scenario
              const showLocalInstall = scenario === 'embeddings' && localInstallSelected
              const panelId = `${formId}-${scenario}-panel`
              const headingId = `${formId}-${scenario}-heading`

              return <section key={scenario} data-testid={`ai-settings-scenario-${scenario}`}>
                <h3>
                  <button
                    type="button"
                    id={headingId}
                    aria-label={meta.title}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    disabled={saving}
                    onClick={() => setExpandedScenario(expanded ? null : scenario)}
                    className="flex w-full items-center gap-3 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium text-zinc-100">{meta.title}</span>
                        <span className={cn('shrink-0 text-[11px]', scenario === 'embeddings' ? 'text-zinc-500' : 'text-violet-300')}>{t(scenario === 'embeddings' ? 'aiSettings.optional' : 'aiSettings.required')}</span>
                      </span>
                      <span className="mt-1 block text-sm font-normal leading-5 text-zinc-400">{meta.description}</span>
                      <span className={cn('mt-2 block truncate text-xs font-normal', configured ? 'text-emerald-300' : 'text-zinc-500')}>
                        {configured ? connection.model : t(scenario === 'embeddings' ? 'aiSettings.notAdded' : 'aiSettings.needsSetup')}
                      </span>
                    </span>
                    <ChevronDown aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-zinc-500 transition-transform', expanded && 'rotate-180')} />
                  </button>
                </h3>
                <div id={panelId} role="region" aria-labelledby={headingId} hidden={!expanded} className="pb-5">
                  {scenario !== 'embeddings' ? <p className="mb-4 text-sm leading-6 text-zinc-400">{meta.recommendation}</p> : null}
                  <fieldset disabled={saving} className="min-w-0">
                    <legend className="sr-only">{t('aiSettings.connectionType')}</legend>
                    <div className={cn('mb-4 grid gap-1', scenario === 'embeddings' ? 'grid-cols-3' : 'grid-cols-2')}>
                      {([
                        ['openai-compatible', t('aiSettings.modelApi')],
                        ['ollama', t('aiSettings.localModel')],
                      ] as Array<[AIProvider, string]>).map(([provider, label]) => <button
                        key={provider}
                        type="button"
                        aria-pressed={!showLocalInstall && settings.provider === provider}
                        onClick={() => {
                          if (scenario === 'embeddings') setLocalInstallSelected(false)
                          props.updateScenarioProvider(scenario, provider)
                        }}
                        className={cn('min-h-12 rounded-xl px-2 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60', !showLocalInstall && settings.provider === provider ? 'bg-violet-500/15 text-violet-100' : 'text-zinc-400 hover:bg-overlay/5')}
                      >{label}</button>)}
                      {scenario === 'embeddings' ? <button
                        type="button"
                        aria-pressed={showLocalInstall}
                        onClick={() => setLocalInstallSelected(true)}
                        className={cn('min-h-12 rounded-xl px-2 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60', showLocalInstall ? 'bg-violet-500/15 text-violet-100' : 'text-zinc-400 hover:bg-overlay/5')}
                      >{t('aiSettings.localSetup')}</button> : null}
                    </div>
                    {scenario === 'embeddings' ? <p className="mb-4 text-sm leading-6 text-zinc-400 [overflow-wrap:anywhere]">
                      <span className="block">{t(!showLocalInstall && settings.provider === 'openai-compatible' ? 'aiSettings.embeddingApiRecommendation' : 'aiSettings.embeddingLocalRecommendation')}</span>
                      <span className="block">{meta.recommendation}</span>
                    </p> : null}
                    <div hidden={showLocalInstall}>{renderFields(scenario)}</div>
                    {scenario === 'embeddings' ? <div hidden={!showLocalInstall}>
                      <p className="flex gap-2 text-sm leading-6 text-amber-200/90">
                        <TriangleAlert aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
                        <span>{t('aiSettings.local.hardwareRecommendation')}</span>
                      </p>
                      <LocalEmbeddingWizard active={showLocalInstall} onConfigured={props.applyLocalEmbeddingSettings} />
                    </div> : null}
                    {scenario !== 'rewrite' ? <details className="group mt-4 border-t border-line/10">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-base font-medium text-zinc-200 [&::-webkit-details-marker]:hidden">
                        {t('aiSettings.advancedOptions')}
                        <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-open:rotate-180" />
                      </summary>
                      <label className="block pb-2">
                        <span className="mb-1.5 block text-sm text-zinc-300">{t(scenario === 'embeddings' ? 'aiSettings.embeddingBatchSize' : 'aiSettings.parallelism')}</span>
                        <input
                          type="number" min={1} max={scenario === 'embeddings' ? 128 : 20}
                          value={scenario === 'embeddings' ? props.resolvedAISettings.embeddings.embeddingBatchSize : settings.provider === 'openai-compatible' ? props.resolvedAISettings.knowledgeExtraction.openAICompatible.parallelism : props.resolvedAISettings.knowledgeExtraction.ollama.parallelism}
                          onChange={(event) => {
                            if (scenario === 'embeddings') props.updateEmbeddingBatchSize(event.target.value)
                            else props.updateKnowledgeExtractionParallelism(settings.provider, event.target.value)
                          }}
                          className={fieldClass}
                        />
                      </label>
                    </details> : null}
                  </fieldset>
                </div>
              </section>
            })}
          </div>

        </>
      )}
    </DialogSurface>
  )
}

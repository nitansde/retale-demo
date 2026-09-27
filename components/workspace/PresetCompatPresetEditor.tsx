"use client"

import { useEffect, useState, type ChangeEvent } from 'react'
import {
  PRESET_COMPAT_EDITABLE_SURFACE_META,
  PRESET_COMPAT_EDITABLE_SURFACE_REGISTRY_IDS,
  PRESET_COMPAT_OPTED_IN_SURFACE_IDS,
} from '@/lib/preset-compat/surface-contract'
import { buildPresetCompatCreativeRuntimePreview } from '@/lib/preset-compat/creative-runtime-preview'
import { resolvePresetCompatRuntime } from '@/lib/preset-compat/resolve-runtime'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  type PresetCompatCreativeSurfaceId,
  type PresetCompatEditableSurfaceId,
  type PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import type {
  PresetCompatLibrary,
  PresetCompatBuiltinSystemPrompt,
  PresetCompatPresetRecord,
  PresetCompatPromptRule,
  PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'
import { PresetCompatRegexEditor } from '@/components/workspace/PresetCompatRegexEditor'
import { createDefaultAISettings } from '@/lib/ai-settings'
import { useI18n } from '@/lib/i18n/provider'
import { createPresetCompatSessionStateKey } from '@/lib/workspace-state'
import type {
  AIScenarioSettings,
  PresetCompatSessionPhase,
  PresetCompatSessionWorkspaceSelection,
} from '@/lib/types'
import { useNovelStore } from '@/store/novel-store'

type PresetCompatPresetEditorProps = {
  activeSurfaceId?: PresetCompatCreativeSurfaceId | null
  activeSelection?: PresetCompatSessionWorkspaceSelection | null
  preset: PresetCompatPresetRecord
  library: PresetCompatLibrary
  onBindSurface: (surfaceId: PresetCompatEditableSurfaceId, presetId: string | null) => void
  onUpdateBuiltinSystemPrompt: (surfaceId: PresetCompatCreativeSurfaceId, updates: Partial<Omit<PresetCompatBuiltinSystemPrompt, 'surfaceId'>>) => void
  onUpdatePromptRule: (promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
  onUpdateEmbeddedRegex: (regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  onUpdateRuntimeSampler: (updates: Partial<PresetCompatPresetRecord['runtimeSampler']>) => void
  onUpdateTransport: (updates: Partial<PresetCompatPresetRecord['transport']>) => void
  onUpdateStandaloneRegex: (regexId: string, updates: Partial<PresetCompatRegexRecord>) => void
  onToggleStandaloneRegexAttachment: (regexId: string) => void
  onDeletePreset: () => void
  onExportPreset: () => void
}

type SurfaceRuntimePreview = {
  surfaceId: PresetCompatCreativeSurfaceId
  promptPreview: {
    systemPrompt: string
    userPrompt: string
  }
  sessionPhase: PresetCompatSessionPhase
  resetPending: boolean
  canReset: boolean
}

type PresetCompatBuiltinSystemPromptEditorProps = {
  library: PresetCompatLibrary
  onUpdateBuiltinSystemPrompt: (surfaceId: PresetCompatCreativeSurfaceId, updates: Partial<Omit<PresetCompatBuiltinSystemPrompt, 'surfaceId'>>) => void
}

const INITIAL_DEFERRED_PROMPT_RULE_BATCH = 4
const DEFERRED_PROMPT_RULE_BATCH_SIZE = 8
const DEFERRED_PROMPT_RULE_INITIAL_DELAY_MS = 150
const DEFERRED_PROMPT_RULE_BATCH_DELAY_MS = 32
type PreviewGenerationStatus = 'idle' | 'generating' | 'ready'

const SURFACE_LABELS: Record<PresetCompatSurfaceId, string> = {
  rewrite: PRESET_COMPAT_EDITABLE_SURFACE_META.rewrite.label,
  future_jump: PRESET_COMPAT_EDITABLE_SURFACE_META.future_jump.label,
  roleplay: PRESET_COMPAT_EDITABLE_SURFACE_META.roleplay.label,
  future_jump_bridge: 'Future Jump bridge',
  what_if_delta_extraction: 'What-if delta extraction',
  knowledge_extraction: 'Knowledge extraction',
  embeddings: 'Embeddings',
}

function buildProviderDefaults(settings: AIScenarioSettings) {
  return {
    provider: settings.provider,
    openAICompatible: {
      config: settings.openAICompatible,
    },
    ollama: {
      config: settings.ollama,
    },
  } as const
}

function getPreviewSessionPhase(_surfaceId: PresetCompatCreativeSurfaceId, phase: PresetCompatSessionPhase | null) {
  if (phase) return phase
  return 'new_chat'
}

function getResetPhaseForSurface(): PresetCompatSessionPhase {
  return 'new_chat'
}

function formatSurfaceSelectionLabel(selection: PresetCompatSessionWorkspaceSelection | null | undefined) {
  if (!selection) return 'preset.surface.currentWorkspaceContext'
  if (selection.kind === 'chapter') return `preset.surface.chapter:${selection.chapterId}`
  if (selection.kind === 'rewrite') return `preset.surface.rewriteNode:${selection.continueBlockId}`
  if (selection.kind === 'continue_block') return `preset.surface.continueBlock:${selection.continueBlockId}`
  if (selection.kind === 'what_if') return `preset.surface.whatIf:${selection.sessionId}`
  if (selection.kind === 'roleplay_session') return `preset.surface.roleplay:${selection.roleplaySessionId}`
  return `preset.surface.futureJump:${selection.runId}`
}

function isPreviewableSurfaceId(surfaceId: PresetCompatCreativeSurfaceId | null): surfaceId is PresetCompatCreativeSurfaceId {
  return surfaceId !== null && (PRESET_COMPAT_OPTED_IN_SURFACE_IDS as readonly string[]).includes(surfaceId)
}

function getDefaultPreviewSurfaceId(activeSurfaceId: PresetCompatCreativeSurfaceId | null): PresetCompatCreativeSurfaceId {
  if (isPreviewableSurfaceId(activeSurfaceId)) {
    return activeSurfaceId
  }

  return 'rewrite'
}

function resolveActiveSurfaceFromSessionState(params: {
    activeSelection: PresetCompatSessionWorkspaceSelection | null
    presetCompatSessionState: ReturnType<typeof useNovelStore.getState>['presetCompatSessionState']
    explicitActiveSurfaceId: PresetCompatCreativeSurfaceId | null
}) {
  if (params.explicitActiveSurfaceId) {
    return params.explicitActiveSurfaceId
  }

  if (!params.activeSelection) {
    return null
  }

  const activeSurfaceIds = PRESET_COMPAT_CREATIVE_SURFACE_IDS.filter((surfaceId) => {
    const entryKey = createPresetCompatSessionStateKey(params.activeSelection!, surfaceId)
    return Boolean(params.presetCompatSessionState[entryKey])
  })

  return activeSurfaceIds.length === 1 ? activeSurfaceIds[0] : null
}

function buildPreviewPromptRuntimeContext(sessionPhase: PresetCompatSessionPhase) {
  return {
    sessionPhase,
    surfaceContextBlocks: [
      {
        id: 'preview-named-transcript',
        label: 'Preview named transcript',
        content: 'Alice: Hello\nBob: Hi',
        abstraction: 'named_transcript' as const,
      },
    ],
    namedTranscript: {
      kind: 'chat' as const,
      userName: 'Alice',
      assistantName: 'Bob',
    },
  }
}

function handleRuleContentChange(
  event: ChangeEvent<HTMLTextAreaElement>,
  promptRuleId: string,
  locked: boolean,
  onUpdatePromptRule: (promptRuleId: string, updates: Partial<PresetCompatPromptRule>) => void
) {
  if (locked) {
    return
  }

  onUpdatePromptRule(promptRuleId, { content: event.target.value })
}

function parseNullableNumber(rawValue: string) {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function updateRuntimeSamplerNumberField(
  event: ChangeEvent<HTMLInputElement>,
  field: keyof Pick<
    PresetCompatPresetRecord['runtimeSampler'],
    'openaiMaxContext' | 'maxTokens' | 'temperature' | 'frequencyPenalty' | 'presencePenalty' | 'topP'
  >,
  onUpdateRuntimeSampler: (updates: Partial<PresetCompatPresetRecord['runtimeSampler']>) => void
) {
  onUpdateRuntimeSampler({ [field]: parseNullableNumber(event.target.value) })
}

function updateTransportStreamField(
  event: ChangeEvent<HTMLSelectElement>,
  onUpdateTransport: (updates: Partial<PresetCompatPresetRecord['transport']>) => void
) {
  const nextValue = event.target.value === '' ? null : event.target.value === 'true'
  onUpdateTransport({ streamOpenAI: nextValue })
}

export function PresetCompatBuiltinSystemPromptEditor({
  library,
  onUpdateBuiltinSystemPrompt,
}: PresetCompatBuiltinSystemPromptEditorProps) {
  const { t } = useI18n()
  return (
    <div className="rounded-[24px] border border-violet-400/16 bg-violet-500/8 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-violet-200/80">{t('preset.builtin.systemPrompt')}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            {t('preset.builtin.description')}
          </p>
        </div>
        <span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1 text-[11px] text-violet-100">
          {t('preset.builtin.appliedFirst')}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {PRESET_COMPAT_CREATIVE_SURFACE_IDS.map((surfaceId) => {
          const rule = library.builtinSystemPrompts[surfaceId]
          const surfaceMeta = PRESET_COMPAT_EDITABLE_SURFACE_META[surfaceId]
          return (
            <div key={surfaceId} className="rounded-[20px] border border-line/8 bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{surfaceMeta.label}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{t('preset.builtin.ownedNoExport')}</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{surfaceMeta.builtinPromptSummary}</p>
                </div>
                <label className="inline-flex items-center gap-2 rounded-2xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    data-testid={`preset-compat-builtin-system-toggle-${surfaceId}`}
                    checked={rule.enabled}
                    onChange={(event) => onUpdateBuiltinSystemPrompt(surfaceId, { enabled: event.target.checked })}
                    className="h-3.5 w-3.5 rounded border-line/20 bg-transparent"
                  />
                  {t('preset.enabled')}
                </label>
              </div>
              <label className="mt-3 block">
                <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">System prompt</span>
                <textarea
                  data-testid={`preset-compat-builtin-system-content-${surfaceId}`}
                  value={rule.content}
                  onChange={(event) => onUpdateBuiltinSystemPrompt(surfaceId, { content: event.target.value })}
                  className="h-40 w-full rounded-[20px] border border-line/10 bg-shade/20 px-4 py-3 text-sm leading-6 text-zinc-100 outline-none"
                />
              </label>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PresetCompatPresetEditor({
  activeSurfaceId = null,
  activeSelection = null,
  preset,
  library,
  onBindSurface,
  onUpdateBuiltinSystemPrompt,
  onUpdatePromptRule,
  onUpdateEmbeddedRegex,
  onUpdateRuntimeSampler,
  onUpdateTransport,
  onUpdateStandaloneRegex,
  onToggleStandaloneRegexAttachment,
  onDeletePreset,
  onExportPreset,
}: PresetCompatPresetEditorProps) {
  const { t } = useI18n()
  const [surfacePreview, setSurfacePreview] = useState<SurfaceRuntimePreview | null>(null)
  const [previewGenerationStatus, setPreviewGenerationStatus] = useState<PreviewGenerationStatus>('idle')
  const [visibleDeferredPromptRuleCount, setVisibleDeferredPromptRuleCount] = useState(0)
  const aiSettings = useNovelStore((state) => state.aiSettings)
  const currentChapterId = useNovelStore((state) => state.currentChapterId)
  const presetCompatSessionState = useNovelStore((state) => state.presetCompatSessionState)
  const resetPresetCompatSessionStateForSelection = useNovelStore((state) => state.resetPresetCompatSessionStateForSelection)
  const rewriteAISettings = aiSettings?.rewrite ?? createDefaultAISettings().rewrite
  const effectiveSelection = activeSelection ?? (currentChapterId
    ? {
        kind: 'chapter' as const,
        chapterId: currentChapterId,
      }
    : null)
  const standardSurfaces = PRESET_COMPAT_EDITABLE_SURFACE_REGISTRY_IDS
  const standaloneRegexes = Object.values(library.standaloneRegexes)
  const [firstPromptRule, ...deferredPromptRules] = preset.promptRules
  const rawActiveSelectionLabel = formatSurfaceSelectionLabel(effectiveSelection)
  const activeSelectionLabel = rawActiveSelectionLabel.startsWith('preset.surface.chapter:')
    ? t('preset.surface.chapter', { id: rawActiveSelectionLabel.split(':')[1] })
    : rawActiveSelectionLabel.startsWith('preset.surface.rewriteNode:')
      ? t('preset.surface.rewriteNode', { id: rawActiveSelectionLabel.split(':')[1] })
      : rawActiveSelectionLabel.startsWith('preset.surface.continueBlock:')
        ? t('preset.surface.continueBlock', { id: rawActiveSelectionLabel.split(':')[1] })
        : rawActiveSelectionLabel.startsWith('preset.surface.whatIf:')
          ? t('preset.surface.whatIf', { id: rawActiveSelectionLabel.split(':')[1] })
          : rawActiveSelectionLabel.startsWith('preset.surface.roleplay:')
            ? t('preset.surface.roleplay', { id: rawActiveSelectionLabel.split(':')[1] })
            : rawActiveSelectionLabel.startsWith('preset.surface.futureJump:')
              ? t('preset.surface.futureJump', { id: rawActiveSelectionLabel.split(':')[1] })
              : t(rawActiveSelectionLabel as 'preset.surface.currentWorkspaceContext')
  const effectiveActiveSurfaceId = resolveActiveSurfaceFromSessionState({
    activeSelection: effectiveSelection,
    presetCompatSessionState,
    explicitActiveSurfaceId: activeSurfaceId,
  })
  const activeSurfaceLabel = effectiveActiveSurfaceId ? SURFACE_LABELS[effectiveActiveSurfaceId] : null
  const defaultPreviewSurfaceId = getDefaultPreviewSurfaceId(effectiveActiveSurfaceId)
  const [selectedPreviewSurfaceId, setSelectedPreviewSurfaceId] = useState<PresetCompatCreativeSurfaceId>(() => defaultPreviewSurfaceId)

  const handleGenerateSurfacePreviews = () => {
    setPreviewGenerationStatus('generating')
    const providerDefaults = buildProviderDefaults(rewriteAISettings)
    const surfaceId = selectedPreviewSurfaceId
    const sessionEntry = effectiveSelection
      ? presetCompatSessionState[createPresetCompatSessionStateKey(effectiveSelection, surfaceId)] ?? null
      : null
    const sessionPhase = getPreviewSessionPhase(surfaceId, sessionEntry?.phase ?? null)
    const previewLibrary: PresetCompatLibrary = {
      ...library,
      surfaceBindings: {
        ...library.surfaceBindings,
        [surfaceId]: {
          ...library.surfaceBindings[surfaceId],
          presetId: preset.id,
          enabled: true,
        },
      },
    }
    const runtime = resolvePresetCompatRuntime({
      library: previewLibrary,
      surfaceId,
      providerDefaults,
      promptRuleRuntimeContext: buildPreviewPromptRuntimeContext(sessionPhase),
    })
    const standalone = runtime.activePreset
      ? runtime.activePreset.attachedStandaloneRegexIds
          .map((regexId) => previewLibrary.standaloneRegexes[regexId])
          .filter((regex): regex is PresetCompatRegexRecord => Boolean(regex))
      : []
    const embedded = runtime.activePreset?.embeddedRegexes ?? []
    const promptPreview = buildPresetCompatCreativeRuntimePreview({
      surfaceId,
      resolvedRuntime: runtime,
      systemPrompt: '',
      userPrompt: '',
      standalone,
      embedded,
    })

    setSurfacePreview({
      surfaceId,
      promptPreview: {
        systemPrompt: promptPreview.systemPrompt,
        userPrompt: promptPreview.userPrompt,
      },
      sessionPhase,
      resetPending: sessionEntry?.resetPending ?? false,
      canReset: Boolean(effectiveSelection && effectiveActiveSurfaceId && surfaceId === effectiveActiveSurfaceId),
    })
    setPreviewGenerationStatus('ready')
  }

  const handleSelectedPreviewSurfaceChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedPreviewSurfaceId(event.target.value as PresetCompatCreativeSurfaceId)
    setSurfacePreview(null)
    setPreviewGenerationStatus('idle')
  }

  useEffect(() => {
    let deferredRulesTimer: number | null = null

    const deferredRulesInitialTimer = window.setTimeout(() => {
      deferredRulesTimer = window.setTimeout(() => {
        setVisibleDeferredPromptRuleCount(Math.min(INITIAL_DEFERRED_PROMPT_RULE_BATCH, deferredPromptRules.length))
      }, DEFERRED_PROMPT_RULE_INITIAL_DELAY_MS)
    }, 0)

    return () => {
      window.clearTimeout(deferredRulesInitialTimer)
      if (deferredRulesTimer !== null) {
        window.clearTimeout(deferredRulesTimer)
      }
    }
  }, [deferredPromptRules.length, preset.id])

  useEffect(() => {
    if (visibleDeferredPromptRuleCount === 0 || visibleDeferredPromptRuleCount >= deferredPromptRules.length) {
      return
    }

    const nextBatchTimer = window.setTimeout(() => {
      setVisibleDeferredPromptRuleCount((currentCount) => Math.min(currentCount + DEFERRED_PROMPT_RULE_BATCH_SIZE, deferredPromptRules.length))
    }, DEFERRED_PROMPT_RULE_BATCH_DELAY_MS)

    return () => {
      window.clearTimeout(nextBatchTimer)
    }
  }, [deferredPromptRules.length, visibleDeferredPromptRuleCount])

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-line/8 bg-shade/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.details')}</p>
            <h4 className="mt-2 text-lg font-semibold text-zinc-100">{preset.name}</h4>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              {t('preset.promptRuleSummary', { rules: preset.promptRules.length, embedded: preset.embeddedRegexes.length, attached: preset.attachedStandaloneRegexIds.length })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid={`preset-compat-preset-delete-${preset.id}`}
              onClick={onDeletePreset}
              className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition hover:bg-rose-500/20"
            >
              {t('preset.deletePreset')}
            </button>
            <button
              type="button"
              data-testid={`preset-compat-preset-export-${preset.id}`}
              onClick={onExportPreset}
              className="rounded-2xl border border-line/10 bg-overlay/[0.04] px-4 py-2 text-sm text-zinc-100 transition hover:bg-overlay/[0.08]"
            >
              {t('preset.exportPresetJson')}
            </button>
          </div>
        </div>

      </div>

      <div className="rounded-[24px] border border-line/8 bg-shade/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.surfaceBindings')}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{t('preset.surfaceBindingsDescription')}</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {standardSurfaces.map((surfaceId) => {
            const binding = library.surfaceBindings[surfaceId]
            const surfaceMeta = PRESET_COMPAT_EDITABLE_SURFACE_META[surfaceId]
            return (
              <label key={surfaceId} className="block rounded-[20px] border border-line/8 bg-surface p-3">
                <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">{surfaceMeta.label}</span>
                <span
                  className="mb-3 block text-xs leading-5 text-zinc-500"
                  data-testid={`preset-compat-binding-summary-${surfaceId}`}
                >
                  {surfaceMeta.bindingSummary}
                </span>
                <select
                  data-testid={`preset-compat-binding-${surfaceId}`}
                  value={binding?.presetId ?? ''}
                  onChange={(event) => onBindSurface(surfaceId, event.target.value || null)}
                  className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
                >
                  <option value="">{t('preset.noPreset')}</option>
                  {Object.values(library.presets).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )
          })}
        </div>

      </div>

      <div className="rounded-[24px] border border-line/8 bg-shade/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.generationSettings')}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{t('preset.generationSettingsDescription')}</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block rounded-[20px] border border-line/8 bg-surface p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Context length</span>
            <input
              type="number"
              min={0}
              data-testid="preset-compat-runtime-openai-max-context"
              value={preset.runtimeSampler.openaiMaxContext ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'openaiMaxContext', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-line/8 bg-surface p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Max reply length</span>
            <input
              type="number"
              min={0}
              data-testid="preset-compat-runtime-max-tokens"
              value={preset.runtimeSampler.maxTokens ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'maxTokens', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-line/8 bg-surface p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Temperature</span>
            <input
              type="number"
              step="0.01"
              data-testid="preset-compat-runtime-temperature"
              value={preset.runtimeSampler.temperature ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'temperature', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-line/8 bg-surface p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Top P</span>
            <input
              type="number"
              step="0.01"
              data-testid="preset-compat-runtime-top-p"
              value={preset.runtimeSampler.topP ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'topP', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-line/8 bg-surface p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Frequency penalty</span>
            <input
              type="number"
              step="0.01"
              data-testid="preset-compat-runtime-frequency-penalty"
              value={preset.runtimeSampler.frequencyPenalty ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'frequencyPenalty', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-line/8 bg-surface p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Presence penalty</span>
            <input
              type="number"
              step="0.01"
              data-testid="preset-compat-runtime-presence-penalty"
              value={preset.runtimeSampler.presencePenalty ?? ''}
              onChange={(event) => updateRuntimeSamplerNumberField(event, 'presencePenalty', onUpdateRuntimeSampler)}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            />
          </label>
          <label className="block rounded-[20px] border border-line/8 bg-surface p-3">
            <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">Stream</span>
            <select
              data-testid="preset-compat-transport-stream-openai"
              value={preset.transport.streamOpenAI === null ? '' : String(preset.transport.streamOpenAI)}
              onChange={(event) => updateTransportStreamField(event, onUpdateTransport)}
              className="w-full rounded-2xl border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none"
            >
              <option value="">{t('preset.unset')}</option>
              <option value="true">{t('preset.enabled')}</option>
              <option value="false">{t('preset.disabled')}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-[24px] border border-line/8 bg-shade/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.runtimePromptPreview')}</p>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{t('preset.runtimePromptPreviewDescription', { selection: activeSelectionLabel })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {effectiveSelection ? (
              <span className="rounded-full border border-line/10 bg-shade/20 px-3 py-1 text-[11px] text-zinc-300">
                {t('preset.scopeLabel', { value: activeSelectionLabel })}
              </span>
            ) : null}
            {activeSurfaceLabel ? (
              <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[11px] text-violet-100">
                {t('preset.currentSurfaceLabel', { value: activeSurfaceLabel })}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-[20px] border border-line/8 bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm leading-6 text-zinc-400">
                {t('preset.previewManualHint')}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="block rounded-[18px] border border-line/8 bg-shade/20 px-3 py-2">
                  <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">Surface</span>
                  <select
                    data-testid="preset-compat-preview-surface-select"
                    value={selectedPreviewSurfaceId}
                    onChange={handleSelectedPreviewSurfaceChange}
                    className="w-full rounded-2xl border border-line/10 bg-floating px-4 py-2 text-sm text-zinc-100 outline-none"
                  >
                    {PRESET_COMPAT_OPTED_IN_SURFACE_IDS.map((surfaceId) => <option key={surfaceId} value={surfaceId}>{SURFACE_LABELS[surfaceId]}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  data-testid="preset-compat-preview-generate"
                  onClick={handleGenerateSurfacePreviews}
                  className="rounded-2xl border border-line/10 bg-shade/20 px-4 py-2 text-sm text-zinc-100 transition hover:bg-overlay/[0.06]"
                >
                  {previewGenerationStatus === 'idle' ? t('preset.preview.generate') : previewGenerationStatus === 'generating' ? t('preset.preview.refreshing') : t('preset.preview.refresh')}
                </button>
              </div>
            </div>
          </div>

          {surfacePreview ? (
            <div
              className="rounded-[22px] border border-line/8 bg-surface p-4"
              data-testid={`preset-compat-preview-surface-${surfacePreview.surfaceId}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-zinc-100">{SURFACE_LABELS[surfacePreview.surfaceId]}</p>
                  </div>
                  <p
                    className="mt-2 text-xs leading-5 text-zinc-400"
                    data-testid={`preset-compat-session-state-${surfacePreview.surfaceId}`}
                  >
                    {t('preset.sessionPhaseLabel', { phase: `${surfacePreview.sessionPhase}${surfacePreview.resetPending ? ` · ${t('preset.preview.sessionResetPending')}` : ` · ${t('preset.preview.sessionNormal')}`}` })}
                  </p>
                </div>

                {surfacePreview.canReset && effectiveSelection ? (
                  <button
                    type="button"
                    data-testid={`preset-compat-session-reset-${surfacePreview.surfaceId}`}
                    onClick={() => resetPresetCompatSessionStateForSelection(effectiveSelection, [surfacePreview.surfaceId], getResetPhaseForSurface())}
                    className="rounded-2xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-200 transition hover:bg-overlay/[0.06]"
                  >
                    {t('preset.resetCurrentContext')}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <label className="block rounded-[18px] border border-line/8 bg-shade/20 p-3">
                  <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">System preview</span>
                  <textarea
                    readOnly
                    value={surfacePreview.promptPreview.systemPrompt}
                    data-testid={`preset-compat-preview-system-${surfacePreview.surfaceId}`}
                    className="h-28 w-full rounded-2xl border border-line/10 bg-floating px-4 py-3 text-xs leading-6 text-zinc-200 outline-none"
                  />
                </label>
                <label className="block rounded-[18px] border border-line/8 bg-shade/20 p-3">
                  <span className="mb-2 block text-[11px] uppercase tracking-[0.14em] text-zinc-500">User preview</span>
                  <textarea
                    readOnly
                    value={surfacePreview.promptPreview.userPrompt}
                    data-testid={`preset-compat-preview-user-${surfacePreview.surfaceId}`}
                    className="h-28 w-full rounded-2xl border border-line/10 bg-floating px-4 py-3 text-xs leading-6 text-zinc-200 outline-none"
                  />
                </label>
              </div>
            </div>
          ) : previewGenerationStatus === 'generating' ? (
            <div className="rounded-[20px] border border-line/8 bg-surface p-4 text-sm text-zinc-400">
              {t('preset.generatingRuntimePreview')}
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-line/8 bg-surface p-4 text-sm text-zinc-500">
              {t('preset.generatePreviewHint')}
            </div>
          )}
        </div>
      </div>

      <PresetCompatBuiltinSystemPromptEditor
        library={library}
        onUpdateBuiltinSystemPrompt={onUpdateBuiltinSystemPrompt}
      />

      <div className="rounded-[24px] border border-line/8 bg-shade/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.promptRules')}</p>
        <div className="mt-4 space-y-3">
          {firstPromptRule ? (() => {
            const activeOnSurfaceCount = PRESET_COMPAT_OPTED_IN_SURFACE_IDS.filter((surfaceId) => preset.promptOrderLists[surfaceId]?.includes(firstPromptRule.id)).length

            return (
              <div key={firstPromptRule.id} className="rounded-[22px] border border-line/8 bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">{firstPromptRule.name}</p>
                      <span className="rounded-full border border-line/10 px-2 py-0.5 text-[10px] text-zinc-400">{t('preset.roleLabel', { role: firstPromptRule.role })}</span>
                      <span className="rounded-full border border-line/10 px-2 py-0.5 text-[10px] text-zinc-400">{t('preset.activeOnSurfaceCount', { count: activeOnSurfaceCount })}</span>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 rounded-2xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      data-testid={`preset-compat-rule-toggle-${firstPromptRule.id}`}
                      checked={firstPromptRule.enabled}
                      onChange={(event) => onUpdatePromptRule(firstPromptRule.id, { enabled: event.target.checked })}
                      className="h-3.5 w-3.5 rounded border-line/20 bg-transparent"
                    />
                    {t('preset.enabled')}
                  </label>
                </div>

                <label className="mt-3 block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">{t('preset.content')}</span>
                  <textarea
                    data-testid={`preset-compat-rule-content-${firstPromptRule.id}`}
                    value={firstPromptRule.content}
                    disabled={firstPromptRule.forbidOverrides}
                    onChange={(event) => handleRuleContentChange(event, firstPromptRule.id, firstPromptRule.forbidOverrides, onUpdatePromptRule)}
                    className="h-28 w-full rounded-[20px] border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none disabled:cursor-not-allowed disabled:text-zinc-500"
                  />
                </label>
              </div>
            )
          })() : null}

          {deferredPromptRules.slice(0, visibleDeferredPromptRuleCount).map((rule) => {
            const activeOnSurfaceCount = PRESET_COMPAT_OPTED_IN_SURFACE_IDS.filter((surfaceId) => preset.promptOrderLists[surfaceId]?.includes(rule.id)).length

            return (
              <div key={rule.id} className="rounded-[22px] border border-line/8 bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-zinc-100">{rule.name}</p>
                      <span className="rounded-full border border-line/10 px-2 py-0.5 text-[10px] text-zinc-400">{t('preset.roleLabel', { role: rule.role })}</span>
                      <span className="rounded-full border border-line/10 px-2 py-0.5 text-[10px] text-zinc-400">{t('preset.activeOnSurfaceCount', { count: activeOnSurfaceCount })}</span>
                    </div>
                  </div>

                  <label className="inline-flex items-center gap-2 rounded-2xl border border-line/10 bg-shade/20 px-3 py-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      data-testid={`preset-compat-rule-toggle-${rule.id}`}
                      checked={rule.enabled}
                      onChange={(event) => onUpdatePromptRule(rule.id, { enabled: event.target.checked })}
                      className="h-3.5 w-3.5 rounded border-line/20 bg-transparent"
                    />
                    {t('preset.enabled')}
                  </label>
                </div>

                <label className="mt-3 block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.14em] text-zinc-500">{t('preset.content')}</span>
                  <textarea
                    data-testid={`preset-compat-rule-content-${rule.id}`}
                    value={rule.content}
                    disabled={rule.forbidOverrides}
                    onChange={(event) => handleRuleContentChange(event, rule.id, rule.forbidOverrides, onUpdatePromptRule)}
                    className="h-28 w-full rounded-[20px] border border-line/10 bg-shade/20 px-4 py-3 text-sm text-zinc-100 outline-none disabled:cursor-not-allowed disabled:text-zinc-500"
                  />
                </label>
              </div>
            )
          })}

          {visibleDeferredPromptRuleCount < deferredPromptRules.length ? (
            <div className="rounded-[20px] border border-line/8 bg-surface p-4 text-sm text-zinc-400">
              {t('preset.remainingRulesLoading', { count: deferredPromptRules.length - visibleDeferredPromptRuleCount })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-[24px] border border-line/8 bg-shade/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.embeddedRegex')}</p>
        <div className="mt-4 space-y-3">
          {preset.embeddedRegexes.length ? preset.embeddedRegexes.map((regexRecord) => (
            <PresetCompatRegexEditor
              key={regexRecord.id}
                title={t('preset.regex.embedded')}
              regexRecord={regexRecord}
              onUpdate={(updates) => onUpdateEmbeddedRegex(regexRecord.id, updates)}
            />
          )) : (
            <div className="rounded-[20px] border border-line/8 bg-surface p-4 text-sm text-zinc-400">{t('preset.noEmbeddedRegex')}</div>
          )}
        </div>
      </div>

      <div className="rounded-[24px] border border-line/8 bg-shade/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t('preset.standaloneRegexLibrary')}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{t('preset.standaloneRegexLibraryDescription')}</p>
        <div className="mt-4 space-y-3">
          {standaloneRegexes.length ? standaloneRegexes.map((regexRecord) => {
            const attached = preset.attachedStandaloneRegexIds.includes(regexRecord.id)
            return (
              <PresetCompatRegexEditor
                key={regexRecord.id}
                title={t('preset.regex.standalone')}
                regexRecord={regexRecord}
                onUpdate={(updates) => onUpdateStandaloneRegex(regexRecord.id, updates)}
                attachment={{
                  attached,
                  onToggle: () => onToggleStandaloneRegexAttachment(regexRecord.id),
                  testId: `preset-compat-standalone-regex-attach-${regexRecord.id}`,
                }}
              />
            )
          }) : (
            <div className="rounded-[20px] border border-line/8 bg-surface p-4 text-sm text-zinc-400">{t('preset.importStandaloneRegexFirst')}</div>
          )}
        </div>
      </div>
    </div>
  )
}

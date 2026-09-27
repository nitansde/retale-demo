import type { PresetCompatCreativeRuntime } from '@/lib/preset-compat/apply-runtime'
import type {
  PresetCompatPromptAssemblyMetadata,
  PresetCompatPromptAssemblyStage,
  PresetCompatPromptAssemblyStageStatus,
} from '@/lib/preset-compat/prompt-assembly'
import { registerPresetCompatCoreMacroBuiltins } from '@/lib/preset-compat/macro-builtins-core'
import { createPresetCompatEnvMacroBuiltins } from '@/lib/preset-compat/macro-builtins-env'
import { createPresetCompatRandomTimeMacroBuiltins } from '@/lib/preset-compat/macro-builtins-random-time'
import { registerPresetCompatVariableMacroBuiltins } from '@/lib/preset-compat/macro-builtins-variables'
import {
  createPresetCompatMacroContext,
  type PresetCompatMacroContext,
  type PresetCompatMacroDiagnostic,
} from '@/lib/preset-compat/macro-context'
import { createPresetCompatMacroRegistry, type PresetCompatMacroRegistry } from '@/lib/preset-compat/macro-registry'
import type { PresetCompatResolvedRuntime } from '@/lib/preset-compat/resolve-runtime'
import type {
  PresetCompatResolvedFieldStatus,
  PresetCompatResolvedProviderControlIntent,
  PresetCompatPromptRuleRuntimeContext,
  PresetCompatRuntimeSnapshot,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import { estimateTokenCount } from '@/lib/utils'

const DEFAULT_SAFE_CONTEXT_MAX_TOKENS = 12000

type RouteContextBlock = {
  id: string
  priority: 'highest' | 'high' | 'medium'
  content: string
}

type PresetCompatContextWindowMetadata = {
  supported: boolean
  requestedMaxContextTokens: number | null
  effectiveMaxContextTokens: number | null
  unlockMaximum: boolean
  tokenEstimate: number | null
  trimmedBlockIds: string[]
}

type PresetCompatStreamPolicyMetadata = {
  supported: boolean
  requested: boolean | null
  effective: boolean
  source: 'explicit_request' | 'preset' | 'provider_default' | 'route_unsupported'
}

export type PresetCompatRuntimeMacroProcessing = {
  context: PresetCompatMacroContext
  registry: PresetCompatMacroRegistry
}

export type PresetCompatRuntimeMetadata = {
  macroDiagnostics: PresetCompatMacroDiagnostic[]
}

type PresetCompatPromptAssemblyResponseMetadata = {
  stageOrder: readonly PresetCompatPromptAssemblyStage[]
  system: {
    stages: PresetCompatPromptAssemblyStageStatus[]
  }
  user: {
    stages: PresetCompatPromptAssemblyStageStatus[]
  }
}

export type PresetCompatResponseMetadata = PresetCompatRuntimeMetadata & {
  runtimeSnapshot: PresetCompatRuntimeSnapshot
  warnings: string[]
  promptAssembly: PresetCompatPromptAssemblyResponseMetadata
  fieldStatuses: PresetCompatResolvedFieldStatus[]
  providerControlIntents: PresetCompatResolvedProviderControlIntent[]
  contextWindow: PresetCompatContextWindowMetadata | null
  streamPolicy: PresetCompatStreamPolicyMetadata | null
}

type ContextWindowResolution = {
  blocks: RouteContextBlock[]
  metadata: PresetCompatContextWindowMetadata | null
  statusOverrides: Map<string, PresetCompatResolvedFieldStatus['status']>
  reasonOverrides: Map<string, PresetCompatResolvedFieldStatus['reason']>
}

type CreativeRouteMetadataResolution = {
  fieldStatuses: PresetCompatResolvedFieldStatus[]
  contextWindow: PresetCompatContextWindowMetadata | null
  streamPolicy: PresetCompatStreamPolicyMetadata | null
  metadata: PresetCompatResponseMetadata
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readNumericSeed(runtime: PresetCompatResolvedRuntime) {
  const rootSeed = runtime.activePreset?.passthrough?.root
  if (isRecord(rootSeed) && typeof rootSeed.seed === 'number' && Number.isFinite(rootSeed.seed)) {
    return rootSeed.seed
  }

  if (runtime.providerRuntime.provider === 'ollama') {
    const seed = runtime.providerRuntime.request.options.seed
    if (typeof seed === 'number' && Number.isFinite(seed)) {
      return seed
    }
  }

  const openAiSeed = runtime.activePreset?.runtimeSampler.seed
  return typeof openAiSeed === 'number' && Number.isFinite(openAiSeed) ? openAiSeed : 0
}

function buildRuntimeValues(runtime: PresetCompatResolvedRuntime, runtimeContext?: PresetCompatPromptRuleRuntimeContext) {
  const values: Record<string, unknown> = {}
  const namesBehavior = runtime.namesBehavior
  if (namesBehavior) {
    values.user = namesBehavior.userName
    values.userName = namesBehavior.userName
    values.bot = namesBehavior.assistantName
    values.assistant = namesBehavior.assistantName
    values.assistantName = namesBehavior.assistantName
    values.characterName = namesBehavior.assistantName
  }

  const namedTranscript = runtimeContext?.namedTranscript
  const runtimeUserName = namedTranscript?.userName?.trim()
  const runtimeAssistantName = namedTranscript?.assistantName?.trim()
  const protagonistName = runtimeContext?.protagonistName?.trim()
  if (runtimeUserName) {
    values.user = runtimeUserName
    values.userName = runtimeUserName
  } else if (protagonistName) {
    values.user = protagonistName
    values.userName = protagonistName
    values.protagonistName = protagonistName
  }
  if (runtimeAssistantName) {
    values.bot = runtimeAssistantName
    values.assistant = runtimeAssistantName
    values.assistantName = runtimeAssistantName
    values.char = runtimeAssistantName
    values.charName = runtimeAssistantName
    values.character = runtimeAssistantName
    values.characterName = runtimeAssistantName
  }

  if (runtime.providerRuntime.provider === 'openai-compatible') {
    if (typeof runtime.providerRuntime.request.max_tokens === 'number') {
      values.maxTokens = runtime.providerRuntime.request.max_tokens
      values.maxResponse = runtime.providerRuntime.request.max_tokens
    }
  } else {
    if (typeof runtime.providerRuntime.request.options.num_predict === 'number') {
      values.maxTokens = runtime.providerRuntime.request.options.num_predict
      values.maxResponse = runtime.providerRuntime.request.options.num_predict
    }
    if (typeof runtime.providerRuntime.request.options.seed === 'number') {
      values.seed = runtime.providerRuntime.request.options.seed
    }
  }

  const openaiMaxContext = runtime.activePreset?.runtimeSampler.openaiMaxContext
  if (typeof openaiMaxContext === 'number') {
    values.openaiMaxContext = openaiMaxContext
    values.maxContext = openaiMaxContext
  }

  return values
}

function findProviderControlIntent(
  intents: readonly PresetCompatResolvedProviderControlIntent[],
  field: string,
  target: 'request' | 'route',
  path: string,
) {
  return intents.find((intent) => intent.field === field && intent.target === target && intent.path === path) ?? null
}

function cloneFieldStatuses(
  fieldStatuses: readonly PresetCompatResolvedFieldStatus[],
  statusOverrides: ReadonlyMap<string, PresetCompatResolvedFieldStatus['status']>,
  reasonOverrides: ReadonlyMap<string, PresetCompatResolvedFieldStatus['reason']>,
) {
  return fieldStatuses.map((status) => {
    const nextStatus = statusOverrides.get(status.field)
    const nextReason = reasonOverrides.get(status.field)

    if (!nextStatus && !nextReason) {
      return status
    }

    return {
      ...status,
      status: nextStatus ?? status.status,
      reason: nextReason ?? status.reason,
    }
  })
}

function joinedBlockText(blocks: readonly RouteContextBlock[]) {
  return blocks.map((block) => block.content).join('\n\n')
}

function redactPromptAssemblyMetadata(metadata: PresetCompatPromptAssemblyMetadata): PresetCompatPromptAssemblyResponseMetadata {
  return {
    stageOrder: metadata.stageOrder,
    system: {
      stages: metadata.system.stages,
    },
    user: {
      stages: metadata.user.stages,
    },
  }
}

function trimContextBlocksToBudget(blocks: readonly RouteContextBlock[], budget: number) {
  const remaining = [...blocks]
  const trimmedBlockIds: string[] = []
  const weightByPriority = {
    highest: 3,
    high: 2,
    medium: 1,
  } as const

  while (remaining.length > 0 && estimateTokenCount(joinedBlockText(remaining)) > budget) {
    let removeIndex = -1
    let removeWeight = Number.POSITIVE_INFINITY

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      // Generated history carries the current story. Keep it available for
      // explicit compression instead of silently dropping it at the budget.
      if (['roleplay-history', 'branch-lineage-full-text'].includes(remaining[index].id)) continue
      const weight = weightByPriority[remaining[index].priority]
      if (weight <= removeWeight) {
        removeWeight = weight
        removeIndex = index
      }
    }

    if (removeIndex < 0) {
      break
    }

    trimmedBlockIds.push(remaining[removeIndex].id)
    remaining.splice(removeIndex, 1)
  }

  return {
    blocks: remaining,
    trimmedBlockIds,
    tokenEstimate: estimateTokenCount(joinedBlockText(remaining)),
  }
}

export function createPresetCompatRuntimeMacroProcessing(params: {
  surfaceId: PresetCompatSurfaceId
  resolvedRuntime: PresetCompatResolvedRuntime
  runtimeContext?: PresetCompatPromptRuleRuntimeContext
}) : PresetCompatRuntimeMacroProcessing {
  const context = createPresetCompatMacroContext({
    surfaceId: params.surfaceId,
    phase: 'apply-runtime',
    seed: readNumericSeed(params.resolvedRuntime),
    runtimeValues: buildRuntimeValues(params.resolvedRuntime, params.runtimeContext),
  })
  const registry = createPresetCompatMacroRegistry([
    ...registerPresetCompatCoreMacroBuiltins(),
    ...registerPresetCompatVariableMacroBuiltins(),
    ...createPresetCompatEnvMacroBuiltins(),
    ...createPresetCompatRandomTimeMacroBuiltins(),
  ])

  return {
    context,
    registry,
  }
}

export function createPresetCompatRuntimeMetadata(processing: PresetCompatRuntimeMacroProcessing): PresetCompatRuntimeMetadata {
  return {
    macroDiagnostics: [...processing.context.diagnostics],
  }
}

export function resolveRewriteContextWindow(params: {
  providerControlIntents: readonly PresetCompatResolvedProviderControlIntent[]
  blocks: RouteContextBlock[] | null
  unlockMaximum?: boolean | null
}) : ContextWindowResolution {
  const requestedBudgetIntent = findProviderControlIntent(
    params.providerControlIntents,
    'openai_max_context',
    'route',
    'contextWindow.maxContextTokens',
  )
  const statusOverrides = new Map<string, PresetCompatResolvedFieldStatus['status']>()
  const reasonOverrides = new Map<string, PresetCompatResolvedFieldStatus['reason']>()

  const requestedMaxContextTokens = typeof requestedBudgetIntent?.value === 'number'
    ? requestedBudgetIntent.value
    : null
  const requestedUnlockMaximum = params.unlockMaximum === true

  if (requestedMaxContextTokens === null) {
    return {
      blocks: params.blocks ?? [],
      metadata: null,
      statusOverrides,
      reasonOverrides,
    }
  }

  if (!params.blocks) {
    statusOverrides.set('openai_max_context', 'degraded')
    reasonOverrides.set('openai_max_context', 'ROUTE_UNSUPPORTED')

    return {
      blocks: [],
      metadata: {
        supported: false,
        requestedMaxContextTokens,
        effectiveMaxContextTokens: null,
        unlockMaximum: false,
        tokenEstimate: null,
        trimmedBlockIds: [],
      },
      statusOverrides,
      reasonOverrides,
    }
  }

  const unlockMaximum = requestedUnlockMaximum
  const effectiveMaxContextTokens = unlockMaximum
    ? requestedMaxContextTokens
    : Math.min(requestedMaxContextTokens, DEFAULT_SAFE_CONTEXT_MAX_TOKENS)
  const trimmed = trimContextBlocksToBudget(params.blocks, effectiveMaxContextTokens)
  const applied = trimmed.tokenEstimate <= effectiveMaxContextTokens

  statusOverrides.set('openai_max_context', applied ? 'applied' : 'degraded')
  reasonOverrides.set('openai_max_context', applied ? 'SUPPORTED_RUNTIME' : 'ROUTE_UNSUPPORTED')

  return {
    blocks: trimmed.blocks,
    metadata: {
      supported: true,
      requestedMaxContextTokens,
      effectiveMaxContextTokens,
      unlockMaximum,
      tokenEstimate: trimmed.tokenEstimate,
      trimmedBlockIds: trimmed.trimmedBlockIds,
    },
    statusOverrides,
    reasonOverrides,
  }
}

export function resolveStreamPolicy(params: {
  providerControlIntents: readonly PresetCompatResolvedProviderControlIntent[]
  requestOverride: { present: boolean; value: boolean | null }
  providerDefaultEnabled?: boolean
  supported: boolean
}) {
  const streamIntent = findProviderControlIntent(
    params.providerControlIntents,
    'stream_openai',
    'route',
    'stream.enabled',
  )
  const providerDefaultEnabled = params.providerDefaultEnabled ?? false
  const presetValue = typeof streamIntent?.value === 'boolean' ? streamIntent.value : null

  if (!params.supported) {
    return {
      supported: false,
      requested: presetValue,
      effective: false,
      source: 'route_unsupported',
    } satisfies PresetCompatStreamPolicyMetadata
  }

  if (params.requestOverride.present) {
    return {
      supported: true,
      requested: presetValue,
      effective: params.requestOverride.value === true,
      source: 'explicit_request',
    } satisfies PresetCompatStreamPolicyMetadata
  }

  if (presetValue !== null) {
    return {
      supported: true,
      requested: presetValue,
      effective: presetValue,
      source: 'preset',
    } satisfies PresetCompatStreamPolicyMetadata
  }

  return {
    supported: true,
    requested: null,
    effective: providerDefaultEnabled,
    source: 'provider_default',
  } satisfies PresetCompatStreamPolicyMetadata
}

export function buildPresetCompatResponseMetadata(params: {
  runtime: PresetCompatCreativeRuntime
  fieldStatuses?: PresetCompatResolvedFieldStatus[]
  contextWindow?: PresetCompatContextWindowMetadata | null
  streamPolicy?: PresetCompatStreamPolicyMetadata | null
}) : PresetCompatResponseMetadata {
  return {
    runtimeSnapshot: params.runtime.resolvedRuntime.snapshot,
    warnings: params.runtime.warnings,
    macroDiagnostics: params.runtime.metadata.macroDiagnostics,
    promptAssembly: redactPromptAssemblyMetadata(params.runtime.promptAssembly),
    fieldStatuses: params.fieldStatuses ?? params.runtime.resolvedRuntime.fieldStatuses,
    providerControlIntents: params.runtime.resolvedRuntime.providerControlIntents,
    contextWindow: params.contextWindow ?? null,
    streamPolicy: params.streamPolicy ?? null,
  }
}

export function overridePresetCompatFieldStatuses(params: {
  runtime: PresetCompatCreativeRuntime
  statusOverrides: ReadonlyMap<string, PresetCompatResolvedFieldStatus['status']>
  reasonOverrides: ReadonlyMap<string, PresetCompatResolvedFieldStatus['reason']>
}) {
  return cloneFieldStatuses(
    params.runtime.resolvedRuntime.fieldStatuses,
    params.statusOverrides,
    params.reasonOverrides,
  )
}

export function resolveCreativeRoutePresetCompatMetadata(params: {
  runtime: PresetCompatCreativeRuntime
  blocks: RouteContextBlock[] | null
  requestOverride: { present: boolean; value: boolean | null }
  providerDefaultEnabled?: boolean
  streamSupported: boolean
}) : CreativeRouteMetadataResolution {
  const contextWindowResolution = resolveRewriteContextWindow({
    providerControlIntents: params.runtime.resolvedRuntime.providerControlIntents,
    blocks: params.blocks,
    unlockMaximum: params.runtime.resolvedRuntime.activePreset?.transport.maxContextUnlocked ?? null,
  })
  const streamPolicy = resolveStreamPolicy({
    providerControlIntents: params.runtime.resolvedRuntime.providerControlIntents,
    requestOverride: params.requestOverride,
    providerDefaultEnabled: params.providerDefaultEnabled,
    supported: params.streamSupported,
  })
  const statusOverrides = new Map(contextWindowResolution.statusOverrides)
  const reasonOverrides = new Map(contextWindowResolution.reasonOverrides)

  if (!params.streamSupported && params.runtime.resolvedRuntime.fieldStatuses.some((status) => status.field === 'stream_openai')) {
    statusOverrides.set('stream_openai', 'degraded')
    reasonOverrides.set('stream_openai', 'ROUTE_UNSUPPORTED')
  }

  const fieldStatuses = overridePresetCompatFieldStatuses({
    runtime: params.runtime,
    statusOverrides,
    reasonOverrides,
  })
  const metadata = buildPresetCompatResponseMetadata({
    runtime: params.runtime,
    fieldStatuses,
    contextWindow: contextWindowResolution.metadata,
    streamPolicy,
  })

  return {
    fieldStatuses,
    contextWindow: contextWindowResolution.metadata,
    streamPolicy,
    metadata,
  }
}

export function serializePresetCompatResponseMetadata(metadata: PresetCompatResponseMetadata) {
  return Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64')
}

export function deserializePresetCompatResponseMetadata(value: string) {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as PresetCompatResponseMetadata
}

import type {
  AIProvider,
  OllamaProviderSettings,
  OpenAICompatibleProviderSettings,
} from '@/lib/types'
import {
  PRESET_COMPAT_FIELD_FAMILY_MATRIX,
  PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES,
  getPresetCompatProviderCapability,
  isPresetCompatImageRequestField,
  isPresetCompatPreservedOnlyField,
  type PresetCompatProviderSamplerField,
} from '@/lib/preset-compat/capability-matrix'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  type PresetCompatCreativeSurfaceId,
  type PresetCompatNamedTranscriptContext,
  type PresetCompatLibrary,
  type PresetCompatPresetRecord,
  type PresetCompatPromptRule,
  type PresetCompatPromptTemplateSettings,
  type PresetCompatPromptRuleRuntimeContext,
  type PresetCompatRuntimeContextBlock,
  type PresetCompatResolvedFieldStatus,
  type PresetCompatResolvedProviderControlIntent,
  type PresetCompatRuntimePromptRuleRole,
  type PresetCompatRuntimeSnapshot,
  type PresetCompatStatusReasonCode,
  type PresetCompatSurfaceId,
  type PresetCompatTransportSettings,
  type PresetCompatPreservedFieldSettings,
} from '@/lib/preset-compat/types'

type PresetCompatOpenAICompatibleRequest = Partial<{
  temperature: number
  top_p: number
  frequency_penalty: number
  presence_penalty: number
  max_tokens: number
}>

type PresetCompatOllamaRequestOptions = Partial<{
  temperature: number
  top_p: number
  top_k: number
  min_p: number
  repeat_penalty: number
  num_predict: number
  seed: number
}>

export type PresetCompatRuntimeProviderDefaults = {
  provider: AIProvider
  openAICompatible?: {
    config?: Partial<OpenAICompatibleProviderSettings>
    request?: PresetCompatOpenAICompatibleRequest
  }
  ollama?: {
    config?: Partial<OllamaProviderSettings>
    request?: PresetCompatOllamaRequestOptions
  }
}

export type PresetCompatRuntimeSessionOverrides = Partial<PresetCompatRuntimeProviderDefaults>

export type PresetCompatResolvedPromptRule = {
  id: string
  name: string
  role: PresetCompatRuntimePromptRuleRole
  channel: 'system' | 'user'
  content: string
  sourceIndex: number
  injectionPosition: PresetCompatPromptRule['injectionPosition']
  injectionDepth: number | null
  injectionOrder: number | null
  forbidOverrides: boolean
}

export type PresetCompatResolvedPromptRuleSet = {
  ordered: PresetCompatResolvedPromptRule[]
  system: PresetCompatResolvedPromptRule[]
  user: PresetCompatResolvedPromptRule[]
}

export type PresetCompatResolvedTemplateFragment = {
  field: string
  channel: 'system' | 'user'
  placement?: 'append'
  text: string
}

export type PresetCompatResolvedTemplateFragmentSet = {
  ordered: PresetCompatResolvedTemplateFragment[]
  system: PresetCompatResolvedTemplateFragment[]
  user: PresetCompatResolvedTemplateFragment[]
}

export type PresetCompatResolvedContextBlockFormat = {
  field: 'wi_format' | 'scenario_format' | 'personality_format'
  abstraction: 'world_info' | 'scenario' | 'personality'
  format: string
  blockIds: string[]
}

export type PresetCompatResolvedNamesBehavior = {
  mode: number
  kind: 'chat' | 'roleplay'
  userName: string
  assistantName: string
}

export type PresetCompatResolvedProviderRuntime =
  | {
      provider: 'openai-compatible'
      config: Partial<OpenAICompatibleProviderSettings>
      request: PresetCompatOpenAICompatibleRequest
    }
  | {
      provider: 'ollama'
      config: Partial<OllamaProviderSettings>
      request: {
        options: PresetCompatOllamaRequestOptions
      }
    }

export type PresetCompatResolvedRuntime = {
  snapshot: PresetCompatRuntimeSnapshot
  activePreset: PresetCompatPresetRecord | null
  builtinSystemPrompt: string | null
  providerRuntime: PresetCompatResolvedProviderRuntime
  templateFragments: PresetCompatResolvedTemplateFragmentSet
  contextBlockFormats: PresetCompatResolvedContextBlockFormat[]
  namesBehavior: PresetCompatResolvedNamesBehavior | null
  promptRules: PresetCompatResolvedPromptRuleSet
  warnings: string[]
  fieldStatuses: PresetCompatResolvedFieldStatus[]
  providerControlIntents: PresetCompatResolvedProviderControlIntent[]
  preservedSamplerFields: Record<string, unknown>
  preservedPromptMetadata: Array<{
    ruleId: string
    metadata: Record<string, unknown>
  }>
}

type PresetCompatResolvedPromptRuleCandidate = {
  resolvedRule: PresetCompatResolvedPromptRule
  rule: PresetCompatPromptRule
}

type PresetCompatRuntimeContext = {
  preset: PresetCompatPresetRecord | null
  surfaceId: PresetCompatSurfaceId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPresetCompatCreativeSurfaceId(surfaceId: PresetCompatSurfaceId): surfaceId is PresetCompatCreativeSurfaceId {
  return PRESET_COMPAT_CREATIVE_SURFACE_IDS.includes(surfaceId as PresetCompatCreativeSurfaceId)
}

function getPresetRootPassthrough(preset: PresetCompatPresetRecord | null) {
  const root = preset?.passthrough.root
  return isRecord(root) ? root : {}
}

function getPresetSeed(preset: PresetCompatPresetRecord | null) {
  const samplerSeed = preset?.runtimeSampler.seed
  if (isFiniteNumber(samplerSeed)) {
    return samplerSeed
  }

  const root = getPresetRootPassthrough(preset)
  return isFiniteNumber(root.seed) ? root.seed : null
}

function getPresetExtensionsPassthrough(preset: PresetCompatPresetRecord | null) {
  const extensions = preset?.passthrough.extensions
  return isRecord(extensions) ? extensions : {}
}

function getPresetTransport(preset: PresetCompatPresetRecord | null) {
  const transport = preset?.transport
  return (isRecord(transport) ? transport : {}) as Partial<PresetCompatTransportSettings>
}

function getPresetPromptTemplate(preset: PresetCompatPresetRecord | null) {
  const promptTemplate = preset?.promptTemplate
  return (isRecord(promptTemplate) ? promptTemplate : {}) as Partial<PresetCompatPromptTemplateSettings>
}

function getPresetPreservedFields(preset: PresetCompatPresetRecord | null) {
  const preservedFields = preset?.preservedFields
  return (isRecord(preservedFields) ? preservedFields : {}) as Partial<PresetCompatPreservedFieldSettings>
}

function getPromptRuleInjectionTriggers(rule: PresetCompatPromptRule) {
  return Array.isArray(rule.injectionTrigger)
    ? rule.injectionTrigger.filter((trigger): trigger is string => typeof trigger === 'string' && trigger.trim().length > 0)
    : []
}

function getPresetBoundToSurface(library: PresetCompatLibrary, surfaceId: PresetCompatSurfaceId) {
  const binding = library.surfaceBindings[surfaceId]
  if (!binding?.enabled || !binding.presetId) {
    return null
  }

  return library.presets[binding.presetId] ?? null
}

function pickNumericPresetFields(context: PresetCompatRuntimeContext) {
  return {
    temperature: context.preset?.runtimeSampler.temperature ?? null,
    top_p: context.preset?.runtimeSampler.topP ?? null,
    top_k: context.preset?.runtimeSampler.topK ?? null,
    top_a: context.preset?.runtimeSampler.topA ?? null,
    min_p: context.preset?.runtimeSampler.minP ?? null,
    presence_penalty: context.preset?.runtimeSampler.presencePenalty ?? null,
    frequency_penalty: context.preset?.runtimeSampler.frequencyPenalty ?? null,
    repetition_penalty: context.preset?.runtimeSampler.repetitionPenalty ?? null,
    openai_max_tokens: context.preset?.runtimeSampler.maxTokens ?? null,
    openai_max_context: context.preset?.runtimeSampler.openaiMaxContext ?? null,
    seed: getPresetSeed(context.preset),
  } satisfies Partial<Record<PresetCompatProviderSamplerField, number | null>>
}

function mergeOpenAICompatibleRequest(
  defaults: PresetCompatOpenAICompatibleRequest | undefined,
  fromPreset: PresetCompatOpenAICompatibleRequest,
  overrides: PresetCompatOpenAICompatibleRequest | undefined
) {
  return {
    ...(defaults ?? {}),
    ...fromPreset,
    ...(overrides ?? {}),
  }
}

function mergeOllamaRequest(
  defaults: PresetCompatOllamaRequestOptions | undefined,
  fromPreset: PresetCompatOllamaRequestOptions,
  overrides: PresetCompatOllamaRequestOptions | undefined
) {
  return {
    ...(defaults ?? {}),
    ...fromPreset,
    ...(overrides ?? {}),
  }
}

function getFieldSurfaceClassification(
  field: string,
  surfaceId: PresetCompatSurfaceId,
  provider: AIProvider,
) {
  const contract = PRESET_COMPAT_FIELD_FAMILY_MATRIX[field]
  if (!contract) {
    return {
      status: 'preserved' as const,
      reason: 'PRESERVED_EXPORT_ONLY' as const,
    }
  }

  if (contract.routeClassification && field === 'n') {
    return contract.routeClassification
  }

  return contract.providerClassifications?.[provider] ?? contract.surfaceClassifications[surfaceId]
}

function createFieldStatus(params: {
  field: string
  surface: PresetCompatSurfaceId
  provider: AIProvider | null
  value: unknown
  reason?: PresetCompatStatusReasonCode
  status?: PresetCompatResolvedFieldStatus['status']
  fragmentId?: string
  fragmentName?: string
  providerIntent?: PresetCompatResolvedProviderControlIntent
}) : PresetCompatResolvedFieldStatus {
  return {
    field: params.field,
    surface: params.surface,
    status: params.status ?? 'preserved',
    reason: params.reason ?? 'PRESERVED_EXPORT_ONLY',
    provider: params.provider,
    value: params.value,
    ...(params.fragmentId ? { fragmentId: params.fragmentId } : {}),
    ...(params.fragmentName ? { fragmentName: params.fragmentName } : {}),
    ...(params.providerIntent ? { providerIntent: params.providerIntent } : {}),
  }
}

function createProviderIntent(
  provider: AIProvider,
  field: string,
  value: unknown,
): PresetCompatResolvedProviderControlIntent | null {
  if (value === null || typeof value === 'undefined') {
    return null
  }

  const appliedPath = getPresetCompatProviderCapability(provider).appliedFields[field as PresetCompatProviderSamplerField]
  if (appliedPath) {
    return {
      field,
      provider,
      target: 'request',
      path: appliedPath,
      value,
    }
  }

  switch (field) {
    case 'openai_max_context':
      return {
        field,
        provider,
        target: 'route',
        path: 'contextWindow.maxContextTokens',
        value,
      }
    case 'stream_openai':
      return {
        field,
        provider,
        target: 'route',
        path: 'stream.enabled',
        value,
      }
    case 'seed':
      if (provider !== 'ollama') {
        return null
      }

      return {
        field,
        provider,
        target: 'request',
        path: 'options.seed',
        value,
      }
    case 'n':
      return {
        field,
        provider,
        target: 'route',
        path: 'candidateCount',
        value,
      }
    default:
      return null
  }
}

function isAppliedIntentField(field: string) {
  return field === 'openai_max_context'
    || field === 'stream_openai'
}

function shouldWarnForFieldStatus(status: PresetCompatResolvedFieldStatus['status']) {
  return status !== 'applied'
}

function buildProviderWarnings(provider: AIProvider, context: PresetCompatRuntimeContext) {
  const warnings: string[] = []
  const preserved: Record<string, unknown> = {}
  const fieldStatuses: PresetCompatResolvedFieldStatus[] = []
  const providerControlIntents: PresetCompatResolvedProviderControlIntent[] = []
  const capability = getPresetCompatProviderCapability(provider)
  const root = getPresetRootPassthrough(context.preset)
  const extensions = getPresetExtensionsPassthrough(context.preset)
  const transport = getPresetTransport(context.preset)
  const promptTemplate = getPresetPromptTemplate(context.preset)
  const preservedFields = getPresetPreservedFields(context.preset)
  const numericFields = pickNumericPresetFields(context)
  const numericFieldsByName = numericFields as Partial<Record<string, number | null>>

  const statusFieldValues: Record<string, unknown> = {
    temperature: context.preset?.runtimeSampler.temperature ?? null,
    top_p: context.preset?.runtimeSampler.topP ?? null,
    top_k: context.preset?.runtimeSampler.topK ?? null,
    top_a: context.preset?.runtimeSampler.topA ?? null,
    min_p: context.preset?.runtimeSampler.minP ?? null,
    presence_penalty: context.preset?.runtimeSampler.presencePenalty ?? null,
    frequency_penalty: context.preset?.runtimeSampler.frequencyPenalty ?? null,
    repetition_penalty: context.preset?.runtimeSampler.repetitionPenalty ?? null,
    openai_max_tokens: context.preset?.runtimeSampler.maxTokens ?? null,
    openai_max_context: context.preset?.runtimeSampler.openaiMaxContext ?? null,
    seed: getPresetSeed(context.preset),
    n: context.preset?.runtimeSampler.candidateCount ?? null,
    max_context_unlocked: transport.maxContextUnlocked ?? null,
    stream_openai: transport.streamOpenAI ?? null,
    send_if_empty: promptTemplate.sendIfEmpty ?? null,
    assistant_prefill: promptTemplate.assistantPrefill ?? null,
    assistant_impersonation: promptTemplate.assistantImpersonation ?? null,
    continue_prefill: transport.continuePrefill ?? null,
    continue_postfix: promptTemplate.continuePostfix ?? null,
    use_sysprompt: transport.useSysprompt ?? null,
    squash_system_messages: transport.squashSystemMessages ?? null,
    function_calling: transport.functionCalling ?? null,
    show_thoughts: transport.showThoughts ?? null,
    reasoning_effort: transport.reasoningEffort ?? null,
    verbosity: transport.verbosity ?? null,
    bias_preset_selected: preservedFields.biasPresetSelected ?? null,
    media_inlining: transport.mediaInlining ?? null,
    inline_image_quality: transport.inlineImageQuality ?? null,
    enable_web_search: transport.enableWebSearch ?? null,
    request_images: transport.requestImages ?? null,
    request_image_aspect_ratio: transport.requestImageAspectRatio ?? null,
    request_image_resolution: transport.requestImageResolution ?? null,
  }

  for (const [field, value] of Object.entries(statusFieldValues)) {
    if (value === null || typeof value === 'undefined') {
      continue
    }

    const classification = getFieldSurfaceClassification(field, context.surfaceId, provider)
    const providerIntent = createProviderIntent(provider, field, value)
    if (providerIntent) {
      providerControlIntents.push(providerIntent)
    }

    fieldStatuses.push(createFieldStatus({
      field,
      surface: context.surfaceId,
      provider,
      value,
      status: classification.status,
      reason: classification.reason,
      providerIntent: providerIntent ?? undefined,
    }))

    if (shouldWarnForFieldStatus(classification.status) && !isAppliedIntentField(field)) {
      warnings.push(`Preset field \`${field}\` was preserved for export but not applied to ${provider}.`)
    }
  }

  for (const fieldName of capability.preservedOnlyFields) {
    const value = fieldName in statusFieldValues
      ? statusFieldValues[fieldName]
      : fieldName in numericFieldsByName
      ? numericFieldsByName[fieldName]
      : root[fieldName]

    if (value === null || typeof value === 'undefined') {
      continue
    }

    preserved[fieldName] = value
    if (!isAppliedIntentField(fieldName) && !(fieldName in statusFieldValues)) {
      warnings.push(`Preset field \`${fieldName}\` was preserved for export but not applied to ${provider}.`)
    }
  }

  for (const [fieldName, value] of Object.entries(root)) {
    if (
      typeof value === 'undefined'
      || fieldName in capability.appliedFields
      || isPresetCompatPreservedOnlyField(fieldName)
      || numericFieldsByName[fieldName] === value
    ) {
      continue
    }

    if (isPresetCompatImageRequestField(fieldName)) {
      preserved[fieldName] = value
      warnings.push(`Preset image field \`${fieldName}\` was preserved for export but not applied to ${provider}.`)
    }
  }

  if (isRecord(extensions.SPreset)) {
    preserved.SPreset = extensions.SPreset
    warnings.push(`Preset extension \`SPreset\` was preserved for export but not applied to ${provider}.`)
  }

  return {
    warnings,
    preserved,
    fieldStatuses,
    providerControlIntents,
  }
}

function resolveOpenAICompatibleProviderRuntime(
  context: PresetCompatRuntimeContext,
  providerDefaults: PresetCompatRuntimeProviderDefaults,
  sessionOverrides: PresetCompatRuntimeSessionOverrides
): PresetCompatResolvedProviderRuntime {
  const fields = pickNumericPresetFields(context)

  return {
    provider: 'openai-compatible',
    config: {
      ...(providerDefaults.openAICompatible?.config ?? {}),
      ...(sessionOverrides.openAICompatible?.config ?? {}),
    },
    request: mergeOpenAICompatibleRequest(
      providerDefaults.openAICompatible?.request,
      {
        ...(isFiniteNumber(fields.temperature) ? { temperature: fields.temperature } : {}),
        ...(isFiniteNumber(fields.top_p) ? { top_p: fields.top_p } : {}),
        ...(isFiniteNumber(fields.frequency_penalty) ? { frequency_penalty: fields.frequency_penalty } : {}),
        ...(isFiniteNumber(fields.presence_penalty) ? { presence_penalty: fields.presence_penalty } : {}),
        ...(isFiniteNumber(fields.openai_max_tokens) ? { max_tokens: fields.openai_max_tokens } : {}),
      },
      sessionOverrides.openAICompatible?.request,
    ),
  }
}

function resolveOllamaProviderRuntime(
  context: PresetCompatRuntimeContext,
  providerDefaults: PresetCompatRuntimeProviderDefaults,
  sessionOverrides: PresetCompatRuntimeSessionOverrides
): PresetCompatResolvedProviderRuntime {
  const fields = pickNumericPresetFields(context)

  return {
    provider: 'ollama',
    config: {
      ...(providerDefaults.ollama?.config ?? {}),
      ...(sessionOverrides.ollama?.config ?? {}),
    },
    request: {
      options: mergeOllamaRequest(
        providerDefaults.ollama?.request,
        {
          ...(isFiniteNumber(fields.temperature) ? { temperature: fields.temperature } : {}),
          ...(isFiniteNumber(fields.top_p) ? { top_p: fields.top_p } : {}),
          ...(isFiniteNumber(fields.top_k) ? { top_k: fields.top_k } : {}),
          ...(isFiniteNumber(fields.min_p) ? { min_p: fields.min_p } : {}),
          ...(isFiniteNumber(fields.repetition_penalty) ? { repeat_penalty: fields.repetition_penalty } : {}),
          ...(isFiniteNumber(fields.openai_max_tokens) ? { num_predict: fields.openai_max_tokens } : {}),
          ...(isFiniteNumber(fields.seed) ? { seed: fields.seed } : {}),
        },
        sessionOverrides.ollama?.request,
      ),
    },
  }
}

function sortResolvedPromptRules(left: PresetCompatResolvedPromptRule, right: PresetCompatResolvedPromptRule) {
  return left.sourceIndex - right.sourceIndex
}

function resolvePromptRuleChannel(rule: PresetCompatPromptRule): 'system' | 'user' {
  return rule.role === 'system' ? 'system' : 'user'
}

function createEmptyTemplateFragmentSet(): PresetCompatResolvedTemplateFragmentSet {
  return {
    ordered: [],
    system: [],
    user: [],
  }
}

function isFailClosedSurface(surfaceId: PresetCompatSurfaceId) {
  return surfaceId === 'future_jump_bridge'
    || surfaceId === 'what_if_delta_extraction'
    || surfaceId === 'knowledge_extraction'
    || surfaceId === 'embeddings'
}

function normalizeContextBlocks(blocks: PresetCompatRuntimeContextBlock[] | undefined) {
  return (blocks ?? []).filter((block) => block.content.trim())
}

function getBlocksForAbstraction(
  blocks: PresetCompatRuntimeContextBlock[],
  abstraction: PresetCompatResolvedContextBlockFormat['abstraction']
) {
  return blocks.filter((block) => block.abstraction === abstraction)
}

function getNamedTranscriptBlocks(blocks: PresetCompatRuntimeContextBlock[]) {
  return blocks.filter((block) => block.abstraction === 'named_transcript')
}

function getNamedTranscriptContext(namedTranscript: PresetCompatNamedTranscriptContext | null | undefined) {
  if (!namedTranscript) {
    return null
  }

  const userName = namedTranscript.userName?.trim() ?? ''
  const assistantName = namedTranscript.assistantName?.trim() ?? ''
  if (!userName || !assistantName) {
    return null
  }

  return {
    kind: namedTranscript.kind,
    userName,
    assistantName,
  }
}

function resolveFormattingRuntime(
  preset: PresetCompatPresetRecord | null,
  surfaceId: PresetCompatSurfaceId,
  runtimeContext: PresetCompatPromptRuleRuntimeContext = {}
) {
  const warnings: string[] = []
  const fieldStatuses: PresetCompatResolvedFieldStatus[] = []
  const contextBlockFormats: PresetCompatResolvedContextBlockFormat[] = []
  let namesBehavior: PresetCompatResolvedNamesBehavior | null = null
  if (!preset) {
    return {
      contextBlockFormats,
      namesBehavior,
      warnings,
      fieldStatuses,
    }
  }

  const promptTemplate = getPresetPromptTemplate(preset)
  const contextBlocks = normalizeContextBlocks(runtimeContext.surfaceContextBlocks)
  const failClosedSurface = isFailClosedSurface(surfaceId)

  const formattingFields = [
    {
      field: 'wi_format' as const,
      value: promptTemplate.wiFormat ?? null,
      abstraction: 'world_info' as const,
      reason: 'WORLD_INFO_CONTEXT_REQUIRED' as const,
    },
    {
      field: 'scenario_format' as const,
      value: promptTemplate.scenarioFormat ?? null,
      abstraction: 'scenario' as const,
      reason: 'SCENARIO_CONTEXT_REQUIRED' as const,
    },
    {
      field: 'personality_format' as const,
      value: promptTemplate.personalityFormat ?? null,
      abstraction: 'personality' as const,
      reason: 'PERSONA_CONTEXT_REQUIRED' as const,
    },
  ]

  for (const formattingField of formattingFields) {
    const trimmedValue = formattingField.value?.trim() ?? ''
    if (!trimmedValue) {
      continue
    }

    if (failClosedSurface) {
      fieldStatuses.push(createFieldStatus({
        field: formattingField.field,
        surface: surfaceId,
        provider: null,
        value: trimmedValue,
        status: 'degraded',
        reason: 'ANALYTICAL_SURFACE_FAIL_CLOSED',
      }))
      warnings.push(`Prompt formatting field \`${formattingField.field}\` was preserved but not applied because runtime reason \`ANALYTICAL_SURFACE_FAIL_CLOSED\` blocked it on surface \`${surfaceId}\`.`)
      continue
    }

    const matchingBlocks = getBlocksForAbstraction(contextBlocks, formattingField.abstraction)
    if (matchingBlocks.length === 0) {
      fieldStatuses.push(createFieldStatus({
        field: formattingField.field,
        surface: surfaceId,
        provider: null,
        value: trimmedValue,
        status: 'degraded',
        reason: formattingField.reason,
      }))
      warnings.push(`Prompt formatting field \`${formattingField.field}\` was preserved but not applied because runtime reason \`${formattingField.reason}\` blocked it on surface \`${surfaceId}\`.`)
      continue
    }

    contextBlockFormats.push({
      field: formattingField.field,
      abstraction: formattingField.abstraction,
      format: trimmedValue,
      blockIds: matchingBlocks.map((block) => block.id),
    })
    fieldStatuses.push(createFieldStatus({
      field: formattingField.field,
      surface: surfaceId,
      provider: null,
      value: {
        format: trimmedValue,
        blockIds: matchingBlocks.map((block) => block.id),
      },
      status: 'applied',
      reason: 'SUPPORTED_RUNTIME',
    }))
  }

  if (typeof promptTemplate.namesBehavior === 'number') {
    const namesValue = promptTemplate.namesBehavior
    if (failClosedSurface) {
      fieldStatuses.push(createFieldStatus({
        field: 'names_behavior',
        surface: surfaceId,
        provider: null,
        value: namesValue,
        status: 'degraded',
        reason: 'ANALYTICAL_SURFACE_FAIL_CLOSED',
      }))
      warnings.push(`Prompt formatting field \`names_behavior\` was preserved but not applied because runtime reason \`ANALYTICAL_SURFACE_FAIL_CLOSED\` blocked it on surface \`${surfaceId}\`.`)
    } else {
      const namedTranscript = getNamedTranscriptContext(runtimeContext.namedTranscript)
      const namedTranscriptBlocks = getNamedTranscriptBlocks(contextBlocks)
      if (!namedTranscript || namedTranscriptBlocks.length === 0) {
        fieldStatuses.push(createFieldStatus({
          field: 'names_behavior',
          surface: surfaceId,
          provider: null,
          value: namesValue,
          status: 'degraded',
          reason: 'NO_CHAT_HISTORY',
        }))
        warnings.push(`Prompt formatting field \`names_behavior\` was preserved but not applied because runtime reason \`NO_CHAT_HISTORY\` blocked it on surface \`${surfaceId}\`.`)
      } else {
        namesBehavior = {
          mode: namesValue,
          kind: namedTranscript.kind,
          userName: namedTranscript.userName,
          assistantName: namedTranscript.assistantName,
        }
        fieldStatuses.push(createFieldStatus({
          field: 'names_behavior',
          surface: surfaceId,
          provider: null,
          value: namesBehavior,
          status: 'applied',
          reason: 'SUPPORTED_RUNTIME',
        }))
      }
    }
  }

  return {
    contextBlockFormats,
    namesBehavior,
    warnings,
    fieldStatuses,
  }
}

function resolvePromptTemplateFragments(
  preset: PresetCompatPresetRecord | null,
  surfaceId: PresetCompatSurfaceId,
  runtimeContext: PresetCompatPromptRuleRuntimeContext = {}
) {
  const warnings: string[] = []
  const fieldStatuses: PresetCompatResolvedFieldStatus[] = []
  const templateFragments = createEmptyTemplateFragmentSet()
  if (!preset) {
    return {
      templateFragments,
      warnings,
      fieldStatuses,
    }
  }

  const promptTemplate = getPresetPromptTemplate(preset)
  const pushFragment = (field: string, text: string) => {
    const fragment = {
      field,
      channel: 'system' as const,
      placement: 'append' as const,
      text,
    }
    templateFragments.ordered.push(fragment)
    templateFragments.system.push(fragment)
  }

  const pushTemplateStatus = (params: {
    field: string
    value: string
    status: PresetCompatResolvedFieldStatus['status']
    reason: PresetCompatStatusReasonCode
  }) => {
    fieldStatuses.push(createFieldStatus({
      field: params.field,
      surface: surfaceId,
      provider: null,
      value: params.value,
      status: params.status,
      reason: params.reason,
    }))
  }

  const pushTemplateWarning = (field: string, reason: PresetCompatStatusReasonCode) => {
    warnings.push(`Prompt template field \`${field}\` was preserved but not applied because runtime reason \`${reason}\` blocked it on surface \`${surfaceId}\`.`)
  }

  const resolvedSessionPhase = runtimeContext.sessionPhase ?? null
  const hasGroupContext = runtimeContext.hasGroupContext === true || resolvedSessionPhase === 'new_group_chat'

  const templateFields = [
    {
      field: 'group_nudge_prompt',
      value: promptTemplate.groupNudgePrompt ?? null,
      shouldApply: hasGroupContext,
      degradedReason: 'NO_GROUP_CONTEXT' as const,
    },
  ] as const

  for (const templateField of templateFields) {
    const trimmedValue = templateField.value?.trim() ?? ''
    if (!trimmedValue) {
      continue
    }

    if (isFailClosedSurface(surfaceId)) {
      pushTemplateStatus({
        field: templateField.field,
        value: trimmedValue,
        status: 'degraded',
        reason: 'ANALYTICAL_SURFACE_FAIL_CLOSED',
      })
      pushTemplateWarning(templateField.field, 'ANALYTICAL_SURFACE_FAIL_CLOSED')
      continue
    }

    if (templateField.shouldApply) {
      pushFragment(templateField.field, trimmedValue)
      pushTemplateStatus({
        field: templateField.field,
        value: trimmedValue,
        status: 'applied',
        reason: 'SUPPORTED_RUNTIME',
      })
      continue
    }

    pushTemplateStatus({
      field: templateField.field,
      value: trimmedValue,
      status: 'degraded',
      reason: templateField.degradedReason,
    })
    pushTemplateWarning(templateField.field, templateField.degradedReason)
  }

  return {
    templateFragments,
    warnings,
    fieldStatuses,
  }
}

function doesPromptRuleTriggerMatch(
  trigger: string,
  surfaceId: PresetCompatSurfaceId,
  runtimeContext: PresetCompatPromptRuleRuntimeContext
) {
  switch (trigger) {
    case 'new_chat':
      return runtimeContext.sessionPhase === 'new_chat'
    case 'new_group_chat':
      return runtimeContext.sessionPhase === 'new_group_chat'
    case 'new_example_chat':
      return runtimeContext.sessionPhase === 'new_example_chat'
    case 'continue':
      return runtimeContext.sessionPhase === 'continue'
    case 'group':
      return runtimeContext.hasGroupContext === true
    case 'impersonation':
      return runtimeContext.hasImpersonationContext === true
    default:
      return false
  }
}

function evaluatePromptRuleCondition(params: {
  condition: string | null
  surfaceId: PresetCompatSurfaceId
  runtimeContext: PresetCompatPromptRuleRuntimeContext
}) {
  const trimmedCondition = params.condition?.trim() ?? ''
  if (!trimmedCondition) {
    return {
      status: 'pass' as const,
      result: true,
    }
  }

  if (!/^[\w\s!-]+$/.test(trimmedCondition)) {
    return {
      status: 'unsafe' as const,
      reason: 'UNSAFE_CONDITION' as const,
      value: trimmedCondition,
    }
  }

  const normalized = trimmedCondition.replace(/\s+/g, '').toLowerCase()
  const isNegated = normalized.startsWith('!')
  const token = isNegated ? normalized.slice(1) : normalized

  let result: boolean | null = null
  switch (token) {
    case 'true':
      result = true
      break
    case 'false':
      result = false
      break
    case 'new_chat':
    case 'newchat':
      result = doesPromptRuleTriggerMatch('new_chat', params.surfaceId, params.runtimeContext)
      break
    case 'newgroupchat':
    case 'new_group_chat':
      result = doesPromptRuleTriggerMatch('new_group_chat', params.surfaceId, params.runtimeContext)
      break
    case 'new_example_chat':
    case 'newexamplechat':
      result = doesPromptRuleTriggerMatch('new_example_chat', params.surfaceId, params.runtimeContext)
      break
    case 'continue':
      result = doesPromptRuleTriggerMatch('continue', params.surfaceId, params.runtimeContext)
      break
    case 'group':
      result = doesPromptRuleTriggerMatch('group', params.surfaceId, params.runtimeContext)
      break
    case 'impersonation':
      result = doesPromptRuleTriggerMatch('impersonation', params.surfaceId, params.runtimeContext)
      break
    default:
      return {
        status: 'unknown' as const,
        reason: 'UNKNOWN_CONDITION' as const,
        value: trimmedCondition,
      }
  }

  return {
    status: 'pass' as const,
    result: isNegated ? !result : result,
  }
}

function resolvePromptRules(
  preset: PresetCompatPresetRecord | null,
  surfaceId: PresetCompatSurfaceId,
  runtimeContext: PresetCompatPromptRuleRuntimeContext = {}
) {
  const warnings: string[] = []
  const preservedPromptMetadata: PresetCompatResolvedRuntime['preservedPromptMetadata'] = []
  const fieldStatuses: PresetCompatResolvedFieldStatus[] = []
  if (!preset) {
    return {
      promptRules: {
        ordered: [],
        system: [],
        user: [],
      } satisfies PresetCompatResolvedPromptRuleSet,
      warnings,
      preservedPromptMetadata,
      fieldStatuses,
    }
  }

  const configuredOrderIds = preset.promptOrderLists[surfaceId] ?? []
  const rulesById = new Map(preset.promptRules.map((rule) => [rule.id, rule]))
  const orderedRules = configuredOrderIds.length > 0
    ? configuredOrderIds.map((ruleId) => rulesById.get(ruleId)).filter((rule): rule is PresetCompatPromptRule => Boolean(rule))
    : preset.promptRules
  const candidates = orderedRules.flatMap((rule, sourceIndex) => {
    if (!rule.enabled) {
      return [] as PresetCompatResolvedPromptRuleCandidate[]
    }

    const trimmedContent = rule.content.trim()
    const hasSupportedRole = PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES.includes(rule.role as PresetCompatRuntimePromptRuleRole)

    if (!trimmedContent) {
      // SillyTavern's context markers intentionally contain no text. ReTale
      // supplies that context through its native route rather than these slots.
      if (!rule.marker) {
        warnings.push(`Prompt rule \`${rule.name}\` was active but skipped because its content was empty.`)
      }
      return [] as PresetCompatResolvedPromptRuleCandidate[]
    }

    if (rule.marker) {
      preservedPromptMetadata.push({
        ruleId: rule.id,
        metadata: {
          marker: true,
        },
      })
      fieldStatuses.push(createFieldStatus({
        field: 'prompts.marker',
        surface: surfaceId,
        provider: null,
        value: true,
        fragmentId: rule.id,
        fragmentName: rule.name,
      }))
    }

    if (!hasSupportedRole) {
      warnings.push(`Prompt rule \`${rule.name}\` was preserved but not applied because role \`${rule.role}\` is unsupported in MVP runtime.`)
      return [] as PresetCompatResolvedPromptRuleCandidate[]
    }

    if (rule.injectAsSystemPrompt) {
      fieldStatuses.push(createFieldStatus({
        field: 'prompts.system_prompt',
        surface: surfaceId,
        provider: null,
        value: true,
        fragmentId: rule.id,
        fragmentName: rule.name,
      }))
    }

    if (rule.condition !== null) {
      const conditionEvaluation = evaluatePromptRuleCondition({
        condition: rule.condition,
        surfaceId,
        runtimeContext,
      })

      if (conditionEvaluation.status === 'unsafe' || conditionEvaluation.status === 'unknown') {
        preservedPromptMetadata.push({
          ruleId: rule.id,
          metadata: {
            condition: rule.condition,
          },
        })
        fieldStatuses.push(createFieldStatus({
          field: 'prompts.condition',
          surface: surfaceId,
          provider: null,
          value: conditionEvaluation.value,
          status: 'degraded',
          reason: conditionEvaluation.reason,
          fragmentId: rule.id,
          fragmentName: rule.name,
        }))
        warnings.push(
          `Prompt rule \`${rule.name}\` was preserved but not applied because condition \`${rule.condition}\` is ${conditionEvaluation.status}.`
        )
        return [] as PresetCompatResolvedPromptRuleCandidate[]
      }

      fieldStatuses.push(createFieldStatus({
        field: 'prompts.condition',
        surface: surfaceId,
        provider: null,
        value: {
          expression: rule.condition,
          result: conditionEvaluation.result,
        },
        status: 'applied',
        reason: 'SUPPORTED_RUNTIME',
        fragmentId: rule.id,
        fragmentName: rule.name,
      }))

      if (!conditionEvaluation.result) {
        return [] as PresetCompatResolvedPromptRuleCandidate[]
      }
    }

    const injectionTriggers = getPromptRuleInjectionTriggers(rule)
    if (injectionTriggers.length > 0) {
      preservedPromptMetadata.push({
        ruleId: rule.id,
        metadata: {
          injectionTrigger: injectionTriggers,
        },
      })
      fieldStatuses.push(createFieldStatus({
        field: 'prompts.injection_trigger',
        surface: surfaceId,
        provider: null,
        value: injectionTriggers,
        fragmentId: rule.id,
        fragmentName: rule.name,
      }))
    }

    if (rule.injectionPosition !== 'none') {
      preservedPromptMetadata.push({
        ruleId: rule.id,
        metadata: {
          injectionPosition: rule.injectionPosition,
        },
      })
      fieldStatuses.push(createFieldStatus({
        field: 'prompts.injection_position',
        surface: surfaceId,
        provider: null,
        value: rule.injectionPosition,
        fragmentId: rule.id,
        fragmentName: rule.name,
      }))
    }

    if (rule.injectionDepth !== null) {
      preservedPromptMetadata.push({
        ruleId: rule.id,
        metadata: {
          injectionDepth: rule.injectionDepth,
        },
      })
      fieldStatuses.push(createFieldStatus({
        field: 'prompts.injection_depth',
        surface: surfaceId,
        provider: null,
        value: rule.injectionDepth,
        fragmentId: rule.id,
        fragmentName: rule.name,
      }))
    }

    if (rule.injectionOrder !== null) {
      preservedPromptMetadata.push({
        ruleId: rule.id,
        metadata: {
          injectionOrder: rule.injectionOrder,
        },
      })
      fieldStatuses.push(createFieldStatus({
        field: 'prompts.injection_order',
        surface: surfaceId,
        provider: null,
        value: rule.injectionOrder,
        fragmentId: rule.id,
        fragmentName: rule.name,
      }))
    }

    if (rule.forbidOverrides) {
      preservedPromptMetadata.push({
        ruleId: rule.id,
        metadata: {
          forbidOverrides: true,
        },
      })
      fieldStatuses.push(createFieldStatus({
        field: 'prompts.forbid_overrides',
        surface: surfaceId,
        provider: null,
        value: true,
        fragmentId: rule.id,
        fragmentName: rule.name,
      }))
    }

    return [{
      rule,
      resolvedRule: {
        id: rule.id,
        name: rule.name,
        role: rule.role as PresetCompatRuntimePromptRuleRole,
        channel: resolvePromptRuleChannel(rule),
        content: trimmedContent,
        sourceIndex,
        injectionPosition: rule.injectionPosition,
        injectionDepth: rule.injectionDepth,
        injectionOrder: rule.injectionOrder,
        forbidOverrides: rule.forbidOverrides,
      },
    }]
  })
    .sort((left, right) => sortResolvedPromptRules(left.resolvedRule, right.resolvedRule))

  const ordered = candidates.map((candidate) => candidate.resolvedRule)

  return {
    promptRules: {
      ordered,
      system: ordered.filter((rule) => rule.channel === 'system'),
      user: ordered.filter((rule) => rule.channel === 'user'),
    } satisfies PresetCompatResolvedPromptRuleSet,
    warnings,
    preservedPromptMetadata,
    fieldStatuses,
  }
}

export function resolvePresetCompatRuntime(params: {
  library: PresetCompatLibrary
  surfaceId: PresetCompatSurfaceId
  providerDefaults: PresetCompatRuntimeProviderDefaults
  sessionOverrides?: PresetCompatRuntimeSessionOverrides
  promptRuleRuntimeContext?: PresetCompatPromptRuleRuntimeContext
}) : PresetCompatResolvedRuntime {
  const sessionOverrides = params.sessionOverrides ?? {}
  const activePreset = getPresetBoundToSurface(params.library, params.surfaceId)
  const builtinSystemPromptRule = isPresetCompatCreativeSurfaceId(params.surfaceId)
    ? params.library.builtinSystemPrompts[params.surfaceId]
    : null
  const builtinSystemPrompt = builtinSystemPromptRule?.enabled && builtinSystemPromptRule.content.trim()
    ? builtinSystemPromptRule.content.trim()
    : null
  const provider = sessionOverrides.provider ?? params.providerDefaults.provider
  const context = {
    preset: activePreset,
    surfaceId: params.surfaceId,
  } satisfies PresetCompatRuntimeContext
  const providerWarnings = buildProviderWarnings(provider, context)
  const templateResolution = resolvePromptTemplateFragments(activePreset, params.surfaceId, params.promptRuleRuntimeContext)
  const formattingResolution = resolveFormattingRuntime(activePreset, params.surfaceId, params.promptRuleRuntimeContext)
  const promptResolution = resolvePromptRules(activePreset, params.surfaceId, params.promptRuleRuntimeContext)
  const providerRuntime = provider === 'ollama'
    ? resolveOllamaProviderRuntime(context, params.providerDefaults, sessionOverrides)
    : resolveOpenAICompatibleProviderRuntime(context, params.providerDefaults, sessionOverrides)

  const warnings = [
    ...providerWarnings.warnings,
    ...templateResolution.warnings,
    ...formattingResolution.warnings,
    ...promptResolution.warnings,
  ]
  if (params.library.surfaceBindings[params.surfaceId]?.enabled && params.library.surfaceBindings[params.surfaceId]?.presetId && !activePreset) {
    warnings.unshift(`Surface \`${params.surfaceId}\` is bound to a missing preset and fell back to provider defaults.`)
  }

  return {
    snapshot: {
      activePresetId: activePreset?.id ?? null,
      activeSurfaceId: params.surfaceId,
      importedAt: params.library.lastImportedAt,
      warnings,
    },
    activePreset,
    builtinSystemPrompt,
    providerRuntime,
    templateFragments: templateResolution.templateFragments,
    contextBlockFormats: formattingResolution.contextBlockFormats,
    namesBehavior: formattingResolution.namesBehavior,
    promptRules: promptResolution.promptRules,
    warnings,
    fieldStatuses: [
      ...providerWarnings.fieldStatuses,
      ...templateResolution.fieldStatuses,
      ...formattingResolution.fieldStatuses,
      ...promptResolution.fieldStatuses,
    ],
    providerControlIntents: providerWarnings.providerControlIntents,
    preservedSamplerFields: providerWarnings.preserved,
    preservedPromptMetadata: promptResolution.preservedPromptMetadata,
  }
}

export function resolvePresetCompatPromptRuleSubset(params: {
  preset: PresetCompatPresetRecord | null
  surfaceId: PresetCompatSurfaceId
  runtimeContext?: PresetCompatPromptRuleRuntimeContext
}) {
  return resolvePromptRules(params.preset, params.surfaceId, params.runtimeContext)
}

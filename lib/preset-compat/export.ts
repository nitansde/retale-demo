import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  type PresetCompatPresetRecord,
  type PresetCompatPromptRule,
  type PresetCompatRegexPlacement,
  type PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'
import {
  getPromptExportMeta,
  getRegexExportMeta,
  stripInternalRegexPassthroughMeta,
} from '@/lib/preset-compat/normalize'

const ACTIVE_PROMPT_ORDER_CHARACTER_ID = 100001

const REGEX_PLACEMENT_TO_ST: Record<PresetCompatRegexPlacement, number> = {
  md_display: 0,
  user_input: 1,
  assistant_output: 2,
  slash_command: 3,
  world_info: 6,
  reasoning: 7,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function getPresetPassthroughBucket(preset: PresetCompatPresetRecord, bucket: 'root' | 'extensions' | 'unknownPromptFields' | 'legacyFlatPrompts') {
  const value = preset.passthrough[bucket]
  return isRecord(value) ? cloneValue(value) : {}
}

function getActiveOrderIds(preset: PresetCompatPresetRecord) {
  for (const surfaceId of PRESET_COMPAT_CREATIVE_SURFACE_IDS) {
    const ids = preset.promptOrderLists[surfaceId]
    if (Array.isArray(ids) && ids.length > 0) {
      return ids
    }
  }
  return [] as string[]
}

function exportPromptRule(
  promptRule: PresetCompatPromptRule,
  unknownPromptFields: Record<string, unknown>,
  rawPrompt: Record<string, unknown> | null
) {
  const promptMeta = getPromptExportMeta(promptRule)
  const exported: Record<string, unknown> = {
    identifier: promptRule.id,
    name: promptRule.name,
    system_prompt: promptRule.injectAsSystemPrompt,
    role: promptRule.role,
    injection_position: promptRule.injectionPosition === 'in_chat'
      ? 1
      : typeof promptMeta.injectionPosition === 'number'
        ? promptMeta.injectionPosition
        : 0,
  }

  if (rawPrompt ? 'content' in rawPrompt : Boolean(promptRule.content)) {
    exported.content = promptRule.content
  }
  if (rawPrompt && 'enabled' in rawPrompt) {
    exported.enabled = rawPrompt.enabled
  }
  if (rawPrompt ? 'marker' in rawPrompt : promptRule.marker) {
    exported.marker = promptRule.marker
  }
  if (rawPrompt ? 'forbid_overrides' in rawPrompt : promptRule.forbidOverrides) {
    exported.forbid_overrides = promptRule.forbidOverrides
  }

  if (promptRule.injectionDepth !== null) {
    exported.injection_depth = promptRule.injectionDepth
  }
  if (promptRule.injectionOrder !== null) {
    exported.injection_order = promptRule.injectionOrder
  }
  if (Array.isArray(promptMeta.injectionTrigger)) {
    exported.injection_trigger = cloneValue(promptMeta.injectionTrigger)
  } else if (Array.isArray(promptRule.injectionTrigger) && promptRule.injectionTrigger.length > 0) {
    exported.injection_trigger = cloneValue(promptRule.injectionTrigger)
  } else if ('injectionTrigger' in promptMeta && rawPrompt && 'injection_trigger' in rawPrompt) {
    exported.injection_trigger = cloneValue(promptMeta.injectionTrigger)
  }
  if (promptRule.condition !== null) {
    exported.condition = promptRule.condition
  }

  return {
    ...exported,
    ...unknownPromptFields,
  }
}

function exportPromptOrder(preset: PresetCompatPresetRecord) {
  const passthroughRoot = getPresetPassthroughBucket(preset, 'root')
  const rawPromptOrder = Array.isArray(passthroughRoot.prompt_order)
    ? cloneValue(passthroughRoot.prompt_order).filter(isRecord)
    : []
  const promptById = new Map(preset.promptRules.map((promptRule) => [promptRule.id, promptRule]))
  const activeOrderIds = getActiveOrderIds(preset)
  const rawActiveOrder = rawPromptOrder
    .find((entry) => entry.character_id === ACTIVE_PROMPT_ORDER_CHARACTER_ID)?.order
  const rawEnabledById = new Map(
    (Array.isArray(rawActiveOrder) ? rawActiveOrder.filter(isRecord) : [])
      .filter((entry) => typeof entry.identifier === 'string')
      .map((entry) => [entry.identifier as string, entry.enabled])
  )
  const nextOrder = activeOrderIds.map((identifier) => {
    const promptRule = promptById.get(identifier)
    const rawEnabled = rawEnabledById.get(identifier)
    return {
      identifier,
      enabled: promptRule?.enabled ?? (typeof rawEnabled === 'boolean' ? rawEnabled : true),
    }
  })

  if (rawPromptOrder.length === 0) {
    return [{
      character_id: ACTIVE_PROMPT_ORDER_CHARACTER_ID,
      order: nextOrder,
    }]
  }

  const activeIndex = rawPromptOrder.findIndex((entry) => entry.character_id === ACTIVE_PROMPT_ORDER_CHARACTER_ID)
  if (activeIndex === -1) {
    return [
      ...rawPromptOrder,
      {
        character_id: ACTIVE_PROMPT_ORDER_CHARACTER_ID,
        order: nextOrder,
      },
    ]
  }

  return rawPromptOrder.map((entry, index) => {
    if (index !== activeIndex) {
      return entry
    }

    return {
      ...entry,
      character_id: ACTIVE_PROMPT_ORDER_CHARACTER_ID,
      order: nextOrder,
    }
  })
}

function exportRegexRecord(regexRecord: PresetCompatRegexRecord) {
  const regexMeta = getRegexExportMeta(regexRecord)
  const rawPlacement = Array.isArray(regexMeta.placement)
    ? regexMeta.placement.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : []
  const nextPlacement = Array.from(new Set([
    ...rawPlacement.filter((value) => !Object.values(REGEX_PLACEMENT_TO_ST).includes(value)),
    ...regexRecord.placements.map((placement) => REGEX_PLACEMENT_TO_ST[placement]),
  ]))

  const exported: Record<string, unknown> = {
    id: regexRecord.id,
    scriptName: regexRecord.name,
    findRegex: regexRecord.pattern,
    replaceString: regexRecord.replacement,
    trimStrings: cloneValue(regexRecord.trimStrings),
    placement: nextPlacement,
    disabled: regexRecord.disabled,
    markdownOnly: regexRecord.markdownOnly,
    promptOnly: regexRecord.promptOnly,
    runOnEdit: regexRecord.runOnEdit,
    substituteRegex: typeof regexMeta.substituteRegex === 'undefined'
      ? regexRecord.substituteRegex
      : cloneValue(regexMeta.substituteRegex),
    minDepth: regexRecord.minDepth,
    maxDepth: regexRecord.maxDepth,
  }

  return {
    ...exported,
    ...stripInternalRegexPassthroughMeta(regexRecord.passthrough),
  }
}

export function exportPresetCompatPreset(preset: PresetCompatPresetRecord) {
  const root = getPresetPassthroughBucket(preset, 'root')
  const extensions = getPresetPassthroughBucket(preset, 'extensions')
  const unknownPromptFieldsById = getPresetPassthroughBucket(preset, 'unknownPromptFields')
  const legacyFlatPrompts = getPresetPassthroughBucket(preset, 'legacyFlatPrompts')
  const rawPrompts = Array.isArray(root.prompts) ? root.prompts.filter(isRecord) : []
  const rawPromptsById = new Map(
    rawPrompts
      .filter((prompt) => typeof prompt.identifier === 'string')
      .map((prompt) => [prompt.identifier as string, prompt])
  )

  const exportedExtensions: Record<string, unknown> = {
    ...extensions,
    regex_scripts: preset.embeddedRegexes.map(exportRegexRecord),
  }

  return {
    ...root,
    temperature: preset.runtimeSampler.temperature ?? root.temperature,
    top_p: preset.runtimeSampler.topP ?? root.top_p,
    top_k: preset.runtimeSampler.topK ?? root.top_k,
    top_a: preset.runtimeSampler.topA ?? root.top_a,
    min_p: preset.runtimeSampler.minP ?? root.min_p,
    presence_penalty: preset.runtimeSampler.presencePenalty ?? root.presence_penalty,
    frequency_penalty: preset.runtimeSampler.frequencyPenalty ?? root.frequency_penalty,
    repetition_penalty: preset.runtimeSampler.repetitionPenalty ?? root.repetition_penalty,
    max_context_unlocked: preset.transport.maxContextUnlocked ?? root.max_context_unlocked,
    openai_max_context: preset.runtimeSampler.openaiMaxContext ?? root.openai_max_context,
    openai_max_tokens: preset.runtimeSampler.maxTokens ?? root.openai_max_tokens,
    names_behavior: preset.promptTemplate.namesBehavior ?? root.names_behavior,
    send_if_empty: preset.promptTemplate.sendIfEmpty ?? root.send_if_empty,
    impersonation_prompt: preset.promptTemplate.impersonationPrompt ?? root.impersonation_prompt,
    new_chat_prompt: preset.promptTemplate.newChatPrompt ?? root.new_chat_prompt,
    new_group_chat_prompt: preset.promptTemplate.newGroupChatPrompt ?? root.new_group_chat_prompt,
    new_example_chat_prompt: preset.promptTemplate.newExampleChatPrompt ?? root.new_example_chat_prompt,
    continue_nudge_prompt: preset.promptTemplate.continueNudgePrompt ?? root.continue_nudge_prompt,
    bias_preset_selected: preset.preservedFields.biasPresetSelected ?? root.bias_preset_selected,
    wi_format: preset.promptTemplate.wiFormat ?? root.wi_format,
    scenario_format: preset.promptTemplate.scenarioFormat ?? root.scenario_format,
    personality_format: preset.promptTemplate.personalityFormat ?? root.personality_format,
    group_nudge_prompt: preset.promptTemplate.groupNudgePrompt ?? root.group_nudge_prompt,
    stream_openai: preset.transport.streamOpenAI ?? root.stream_openai,
    prompts: preset.promptRules.map((promptRule) => {
      const rawUnknownPromptFields = unknownPromptFieldsById[promptRule.id]
      return exportPromptRule(
        promptRule,
        isRecord(rawUnknownPromptFields) ? rawUnknownPromptFields : {},
        rawPromptsById.get(promptRule.id) ?? null
      )
    }),
    prompt_order: exportPromptOrder(preset),
    assistant_prefill: preset.promptTemplate.assistantPrefill ?? root.assistant_prefill,
    assistant_impersonation: preset.promptTemplate.assistantImpersonation ?? root.assistant_impersonation,
    use_sysprompt: preset.transport.useSysprompt ?? root.use_sysprompt,
    squash_system_messages: preset.transport.squashSystemMessages ?? root.squash_system_messages,
    media_inlining: preset.transport.mediaInlining ?? root.media_inlining,
    inline_image_quality: preset.transport.inlineImageQuality ?? root.inline_image_quality,
    continue_prefill: preset.transport.continuePrefill ?? root.continue_prefill,
    continue_postfix: preset.promptTemplate.continuePostfix ?? root.continue_postfix,
    function_calling: preset.transport.functionCalling ?? root.function_calling,
    show_thoughts: preset.transport.showThoughts ?? root.show_thoughts,
    reasoning_effort: preset.transport.reasoningEffort ?? root.reasoning_effort,
    verbosity: preset.transport.verbosity ?? root.verbosity,
    enable_web_search: preset.transport.enableWebSearch ?? root.enable_web_search,
    seed: preset.runtimeSampler.seed ?? root.seed,
    n: preset.runtimeSampler.candidateCount ?? root.n,
    request_images: preset.transport.requestImages ?? root.request_images,
    request_image_aspect_ratio: preset.transport.requestImageAspectRatio ?? root.request_image_aspect_ratio,
    request_image_resolution: preset.transport.requestImageResolution ?? root.request_image_resolution,
    main_prompt: 'main' in legacyFlatPrompts ? (preset.promptTemplate.legacyMainPrompt ?? root.main_prompt) : root.main_prompt,
    nsfw_prompt: 'nsfw' in legacyFlatPrompts ? (preset.promptTemplate.legacyNsfwPrompt ?? root.nsfw_prompt) : root.nsfw_prompt,
    jailbreak_prompt: 'jailbreak' in legacyFlatPrompts ? (preset.promptTemplate.legacyJailbreakPrompt ?? root.jailbreak_prompt) : root.jailbreak_prompt,
    extensions: exportedExtensions,
  }
}

export function exportPresetCompatStandaloneRegex(regexes: PresetCompatRegexRecord[]) {
  return {
    regex_scripts: regexes.map(exportRegexRecord),
  }
}

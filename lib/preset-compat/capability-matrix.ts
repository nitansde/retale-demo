import type { AIProvider } from '@/lib/types'
import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_FIELD_STATUS,
  PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
  PRESET_COMPAT_STATUS_REASON_CODES,
  type PresetCompatFieldStatus,
  type PresetCompatSurfaceId,
  type PresetCompatStatusReasonCode,
} from '@/lib/preset-compat/types'
import {
  PRESET_COMPAT_MACRO_CAPABILITY_MATRIX,
  PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS,
} from '@/lib/preset-compat/macro-types'

export { PRESET_COMPAT_FIELD_STATUS, PRESET_COMPAT_STATUS_REASON_CODES } from '@/lib/preset-compat/types'

export type PresetCompatProviderSamplerField =
  | 'temperature'
  | 'top_p'
  | 'top_k'
  | 'top_a'
  | 'min_p'
  | 'presence_penalty'
  | 'frequency_penalty'
  | 'repetition_penalty'
  | 'openai_max_tokens'
  | 'openai_max_context'
  | 'max_context_unlocked'
  | 'names_behavior'
  | 'send_if_empty'
  | 'impersonation_prompt'
  | 'new_chat_prompt'
  | 'new_group_chat_prompt'
  | 'new_example_chat_prompt'
  | 'continue_nudge_prompt'
  | 'bias_preset_selected'
  | 'wi_format'
  | 'scenario_format'
  | 'personality_format'
  | 'group_nudge_prompt'
  | 'stream_openai'
  | 'function_calling'
  | 'show_thoughts'
  | 'reasoning_effort'
  | 'seed'

export type PresetCompatPromptRulePreservedField =
  | 'injectionPosition'
  | 'injectionDepth'
  | 'injectionTrigger'
  | 'forbidOverrides'

export type PresetCompatProviderCapability = {
  provider: AIProvider
  appliedFields: Partial<Record<PresetCompatProviderSamplerField, string>>
  preservedOnlyFields: readonly PresetCompatProviderSamplerField[]
}

export type PresetCompatFieldSurfaceClassification = {
  status: PresetCompatFieldStatus
  reason: PresetCompatStatusReasonCode
}

export type PresetCompatFieldFamilyCategory =
  | 'provider-sampler'
  | 'prompt-template'
  | 'transport-flag'
  | 'prompt-entry'
  | 'prompt-order'
  | 'regex'
  | 'extension'
  | 'macro'

export type PresetCompatFieldFamilyContract = {
  id: string
  category: PresetCompatFieldFamilyCategory
  fieldPaths: readonly string[]
  creativeResetPromptFamily: boolean
  macroContractNames?: readonly (keyof typeof PRESET_COMPAT_MACRO_CAPABILITY_MATRIX)[]
  providerClassifications?: Partial<Record<AIProvider, PresetCompatFieldSurfaceClassification>>
  routeClassification?: PresetCompatFieldSurfaceClassification
  surfaceClassifications: Record<PresetCompatSurfaceId, PresetCompatFieldSurfaceClassification>
}

const PRESET_COMPAT_ALL_SURFACE_IDS = [
  ...PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  ...PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
] as const satisfies readonly PresetCompatSurfaceId[]

function applied(reason: PresetCompatStatusReasonCode = 'SUPPORTED_RUNTIME'): PresetCompatFieldSurfaceClassification {
  return {
    status: 'applied',
    reason,
  }
}

function degraded(reason: PresetCompatStatusReasonCode): PresetCompatFieldSurfaceClassification {
  return {
    status: 'degraded',
    reason,
  }
}

function preserved(reason: PresetCompatStatusReasonCode = 'PRESERVED_EXPORT_ONLY'): PresetCompatFieldSurfaceClassification {
  return {
    status: 'preserved',
    reason,
  }
}

function createSurfaceClassificationMap(params: {
  creative: PresetCompatFieldSurfaceClassification
  creativeOverrides?: Partial<Record<(typeof PRESET_COMPAT_CREATIVE_SURFACE_IDS)[number], PresetCompatFieldSurfaceClassification>>
  analytical?: PresetCompatFieldSurfaceClassification
  analyticalOverrides?: Partial<Record<(typeof PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS)[number], PresetCompatFieldSurfaceClassification>>
}): Record<PresetCompatSurfaceId, PresetCompatFieldSurfaceClassification> {
  const creativeOverrides = params.creativeOverrides ?? {}
  const analytical = params.analytical ?? degraded('ANALYTICAL_SURFACE_FAIL_CLOSED')
  const analyticalOverrides = params.analyticalOverrides ?? {}

  return Object.fromEntries(
    PRESET_COMPAT_ALL_SURFACE_IDS.map((surfaceId) => {
      const classification = PRESET_COMPAT_CREATIVE_SURFACE_IDS.includes(surfaceId as (typeof PRESET_COMPAT_CREATIVE_SURFACE_IDS)[number])
        ? (creativeOverrides[surfaceId as (typeof PRESET_COMPAT_CREATIVE_SURFACE_IDS)[number]] ?? params.creative)
        : (analyticalOverrides[surfaceId as (typeof PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS)[number]] ?? analytical)
      return [surfaceId, classification]
    })
  ) as Record<PresetCompatSurfaceId, PresetCompatFieldSurfaceClassification>
}

const PRESET_COMPAT_FIELD_FAMILY_ENTRIES = [
  {
    id: 'temperature',
    category: 'provider-sampler',
    fieldPaths: ['temperature'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'frequency_penalty',
    category: 'provider-sampler',
    fieldPaths: ['frequency_penalty'],
    creativeResetPromptFamily: false,
    providerClassifications: {
      'openai-compatible': applied(),
      ollama: degraded('PROVIDER_ONLY'),
    },
    surfaceClassifications: createSurfaceClassificationMap({ creative: degraded('PROVIDER_ONLY') }),
  },
  {
    id: 'presence_penalty',
    category: 'provider-sampler',
    fieldPaths: ['presence_penalty'],
    creativeResetPromptFamily: false,
    providerClassifications: {
      'openai-compatible': applied(),
      ollama: degraded('PROVIDER_ONLY'),
    },
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROVIDER_ONLY') }),
  },
  {
    id: 'top_p',
    category: 'provider-sampler',
    fieldPaths: ['top_p'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'top_k',
    category: 'provider-sampler',
    fieldPaths: ['top_k'],
    creativeResetPromptFamily: false,
    providerClassifications: {
      'openai-compatible': degraded('PROVIDER_ONLY'),
      ollama: applied(),
    },
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROVIDER_ONLY') }),
  },
  {
    id: 'top_a',
    category: 'provider-sampler',
    fieldPaths: ['top_a'],
    creativeResetPromptFamily: false,
    providerClassifications: {
      'openai-compatible': degraded('PROVIDER_UNSUPPORTED'),
      ollama: degraded('PROVIDER_UNSUPPORTED'),
    },
    surfaceClassifications: createSurfaceClassificationMap({ creative: degraded('PROVIDER_UNSUPPORTED') }),
  },
  {
    id: 'min_p',
    category: 'provider-sampler',
    fieldPaths: ['min_p'],
    creativeResetPromptFamily: false,
    providerClassifications: {
      'openai-compatible': degraded('PROVIDER_ONLY'),
      ollama: applied(),
    },
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROVIDER_ONLY') }),
  },
  {
    id: 'repetition_penalty',
    category: 'provider-sampler',
    fieldPaths: ['repetition_penalty'],
    creativeResetPromptFamily: false,
    providerClassifications: {
      'openai-compatible': degraded('PROVIDER_ONLY'),
      ollama: applied(),
    },
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROVIDER_ONLY') }),
  },
  {
    id: 'max_context_unlocked',
    category: 'provider-sampler',
    fieldPaths: ['max_context_unlocked'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'openai_max_context',
    category: 'provider-sampler',
    fieldPaths: ['openai_max_context'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'openai_max_tokens',
    category: 'provider-sampler',
    fieldPaths: ['openai_max_tokens'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'bias_preset_selected',
    category: 'provider-sampler',
    fieldPaths: ['bias_preset_selected'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'stream_openai',
    category: 'provider-sampler',
    fieldPaths: ['stream_openai'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'seed',
    category: 'provider-sampler',
    fieldPaths: ['seed'],
    creativeResetPromptFamily: false,
    providerClassifications: {
      'openai-compatible': degraded('PROVIDER_ONLY'),
      ollama: applied(),
    },
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROVIDER_ONLY') }),
  },
  {
    id: 'n',
    category: 'provider-sampler',
    fieldPaths: ['n'],
    creativeResetPromptFamily: false,
    routeClassification: degraded('ROUTE_UNSUPPORTED'),
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROVIDER_ONLY') }),
  },
  {
    id: 'names_behavior',
    category: 'prompt-template',
    fieldPaths: ['names_behavior'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: degraded('NO_CHAT_HISTORY'),
      creativeOverrides: {
        future_jump: applied(),
        roleplay: applied(),
      },
    }),
  },
  {
    id: 'send_if_empty',
    category: 'prompt-template',
    fieldPaths: ['send_if_empty'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: degraded('NO_EMPTY_SEND_CONTEXT'),
    }),
  },
  {
    id: 'impersonation_prompt',
    category: 'prompt-template',
    fieldPaths: ['impersonation_prompt'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'new_chat_prompt',
    category: 'prompt-template',
    fieldPaths: ['new_chat_prompt'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'new_group_chat_prompt',
    category: 'prompt-template',
    fieldPaths: ['new_group_chat_prompt'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'new_example_chat_prompt',
    category: 'prompt-template',
    fieldPaths: ['new_example_chat_prompt'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'continue_nudge_prompt',
    category: 'prompt-template',
    fieldPaths: ['continue_nudge_prompt'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'wi_format',
    category: 'prompt-template',
    fieldPaths: ['wi_format'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: applied('WORLD_INFO_CONTEXT_REQUIRED'),
    }),
  },
  {
    id: 'scenario_format',
    category: 'prompt-template',
    fieldPaths: ['scenario_format'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: applied('SCENARIO_CONTEXT_REQUIRED'),
    }),
  },
  {
    id: 'personality_format',
    category: 'prompt-template',
    fieldPaths: ['personality_format'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: applied('PERSONA_CONTEXT_REQUIRED'),
    }),
  },
  {
    id: 'group_nudge_prompt',
    category: 'prompt-template',
    fieldPaths: ['group_nudge_prompt'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: degraded('NO_GROUP_CONTEXT'),
      creativeOverrides: {
        roleplay: applied(),
      },
    }),
  },
  {
    id: 'assistant_prefill',
    category: 'prompt-template',
    fieldPaths: ['assistant_prefill'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: degraded('ASSISTANT_PREFILL_UNSUPPORTED'),
    }),
    providerClassifications: {
      'openai-compatible': degraded('ASSISTANT_PREFILL_UNSUPPORTED'),
      ollama: degraded('ASSISTANT_PREFILL_UNSUPPORTED'),
    },
  },
  {
    id: 'assistant_impersonation',
    category: 'prompt-template',
    fieldPaths: ['assistant_impersonation'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
    }),
  },
  {
    id: 'continue_prefill',
    category: 'prompt-template',
    fieldPaths: ['continue_prefill'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: degraded('ASSISTANT_PREFILL_UNSUPPORTED'),
    }),
    providerClassifications: {
      'openai-compatible': degraded('ASSISTANT_PREFILL_UNSUPPORTED'),
      ollama: degraded('ASSISTANT_PREFILL_UNSUPPORTED'),
    },
  },
  {
    id: 'continue_postfix',
    category: 'prompt-template',
    fieldPaths: ['continue_postfix'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
    }),
  },
  {
    id: 'use_sysprompt',
    category: 'transport-flag',
    fieldPaths: ['use_sysprompt'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved('PRESERVED_EXPORT_ONLY'),
      analytical: preserved('PRESERVED_EXPORT_ONLY'),
    }),
  },
  {
    id: 'squash_system_messages',
    category: 'transport-flag',
    fieldPaths: ['squash_system_messages'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: degraded('MESSAGE_SQUASH_UNSUPPORTED') }),
  },
  {
    id: 'media_inlining',
    category: 'transport-flag',
    fieldPaths: ['media_inlining'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'inline_image_quality',
    category: 'transport-flag',
    fieldPaths: ['inline_image_quality'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'function_calling',
    category: 'transport-flag',
    fieldPaths: ['function_calling'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'show_thoughts',
    category: 'transport-flag',
    fieldPaths: ['show_thoughts'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'reasoning_effort',
    category: 'transport-flag',
    fieldPaths: ['reasoning_effort'],
    creativeResetPromptFamily: false,
    providerClassifications: {
      'openai-compatible': preserved(),
      ollama: preserved(),
    },
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'verbosity',
    category: 'transport-flag',
    fieldPaths: ['verbosity'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'enable_web_search',
    category: 'transport-flag',
    fieldPaths: ['enable_web_search'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved('WEB_SEARCH_IMPORT_DISABLED'),
      analytical: preserved('WEB_SEARCH_IMPORT_DISABLED'),
    }),
  },
  {
    id: 'request_images',
    category: 'transport-flag',
    fieldPaths: ['request_images'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved('IMAGE_REQUEST_METADATA_ONLY'),
      analytical: preserved('IMAGE_REQUEST_METADATA_ONLY'),
    }),
  },
  {
    id: 'request_image_aspect_ratio',
    category: 'transport-flag',
    fieldPaths: ['request_image_aspect_ratio'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved('IMAGE_REQUEST_METADATA_ONLY'),
      analytical: preserved('IMAGE_REQUEST_METADATA_ONLY'),
    }),
  },
  {
    id: 'request_image_resolution',
    category: 'transport-flag',
    fieldPaths: ['request_image_resolution'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved('IMAGE_REQUEST_METADATA_ONLY'),
      analytical: preserved('IMAGE_REQUEST_METADATA_ONLY'),
    }),
  },
  {
    id: 'prompts.identifier',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].identifier'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'prompts.name',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].name'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'prompts.system_prompt',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].system_prompt'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'prompts.role',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].role'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('UNSUPPORTED_ROLE') }),
  },
  {
    id: 'prompts.content',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].content'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'prompts.marker',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].marker'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'prompts.enabled',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].enabled'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROMPT_ORDER_CANONICAL') }),
  },
  {
    id: 'prompts.injection_position',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].injection_position'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'prompts.injection_depth',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].injection_depth'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'prompts.forbid_overrides',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].forbid_overrides'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'prompts.injection_order',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].injection_order'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'prompts.injection_trigger',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].injection_trigger'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'prompts.condition',
    category: 'prompt-entry',
    fieldPaths: ['prompts[].condition'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('UNSAFE_CONDITION') }),
  },
  {
    id: 'prompt_order',
    category: 'prompt-order',
    fieldPaths: ['prompt_order'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROMPT_ORDER_CANONICAL') }),
  },
  {
    id: 'prompt_order.character_id',
    category: 'prompt-order',
    fieldPaths: ['prompt_order[].character_id'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROMPT_ORDER_CANONICAL') }),
  },
  {
    id: 'prompt_order.order.identifier',
    category: 'prompt-order',
    fieldPaths: ['prompt_order[].order[].identifier'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROMPT_ORDER_CANONICAL') }),
  },
  {
    id: 'prompt_order.order.enabled',
    category: 'prompt-order',
    fieldPaths: ['prompt_order[].order[].enabled'],
    creativeResetPromptFamily: true,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('PROMPT_ORDER_CANONICAL') }),
  },
  {
    id: 'extensions.regex_scripts',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'regex_script.id',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].id'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'regex_script.scriptName',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].scriptName'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'regex_script.findRegex',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].findRegex'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'regex_script.replaceString',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].replaceString'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'regex_script.trimStrings',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].trimStrings'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'regex_script.placement',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].placement'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'regex_script.disabled',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].disabled'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'regex_script.markdownOnly',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].markdownOnly'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: degraded('MARKDOWN_CHANNEL_REQUIRED') }),
  },
  {
    id: 'regex_script.promptOnly',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].promptOnly'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied() }),
  },
  {
    id: 'regex_script.runOnEdit',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].runOnEdit'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved('EDIT_HOOK_UNSUPPORTED') }),
  },
  {
    id: 'regex_script.substituteRegex',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].substituteRegex'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: degraded('REGEX_SUBSTITUTE_MODE_UNSUPPORTED') }),
  },
  {
    id: 'regex_script.minDepth',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].minDepth'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('VIRTUAL_DEPTH_REQUIRED') }),
  },
  {
    id: 'regex_script.maxDepth',
    category: 'regex',
    fieldPaths: ['extensions.regex_scripts[].maxDepth'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({ creative: applied('VIRTUAL_DEPTH_REQUIRED') }),
  },
  {
    id: 'extensions.SPreset.ChatSquash',
    category: 'extension',
    fieldPaths: ['extensions.SPreset.ChatSquash'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'extensions.SPreset.RegexBinding',
    category: 'extension',
    fieldPaths: ['extensions.SPreset.RegexBinding'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'extensions.MacroNest',
    category: 'extension',
    fieldPaths: ['extensions.MacroNest'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'extensions.ToolBindings',
    category: 'extension',
    fieldPaths: ['extensions.ToolBindings'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'extensions.tavern_helper',
    category: 'extension',
    fieldPaths: ['extensions.tavern_helper'],
    creativeResetPromptFamily: false,
    surfaceClassifications: createSurfaceClassificationMap({
      creative: preserved(),
      analytical: preserved(),
    }),
  },
  {
    id: 'macro.setvar',
    category: 'macro',
    fieldPaths: ['prompts[].content:{{setvar::...}}'],
    creativeResetPromptFamily: true,
    macroContractNames: PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS['macro.setvar'],
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'macro.getvar',
    category: 'macro',
    fieldPaths: ['prompts[].content:{{getvar::...}}'],
    creativeResetPromptFamily: true,
    macroContractNames: PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS['macro.getvar'],
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'macro.trim',
    category: 'macro',
    fieldPaths: ['prompts[].content:{{trim}}'],
    creativeResetPromptFamily: true,
    macroContractNames: PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS['macro.trim'],
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'macro.comment',
    category: 'macro',
    fieldPaths: ['prompts[].content:comment-macros'],
    creativeResetPromptFamily: true,
    macroContractNames: PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS['macro.comment'],
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
  {
    id: 'macro.user_bot_variable',
    category: 'macro',
    fieldPaths: ['prompts[].content:user/bot-variables'],
    creativeResetPromptFamily: true,
    macroContractNames: PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS['macro.user_bot_variable'],
    surfaceClassifications: createSurfaceClassificationMap({ creative: preserved() }),
  },
] as const satisfies readonly PresetCompatFieldFamilyContract[]

export const PRESET_COMPAT_FIELD_FAMILY_IDS = PRESET_COMPAT_FIELD_FAMILY_ENTRIES.map((entry) => entry.id)

export const PRESET_COMPAT_FIELD_FAMILY_MATRIX = Object.fromEntries(
  PRESET_COMPAT_FIELD_FAMILY_ENTRIES.map((entry) => [entry.id, entry])
) as Record<string, PresetCompatFieldFamilyContract>

export const PRESET_COMPAT_PROMPT_RULE_SUPPORTED_ROLES = ['system', 'user'] as const

export const PRESET_COMPAT_PROMPT_RULE_PRESERVED_ONLY_FIELDS = [
  'injectionPosition',
  'injectionDepth',
  'injectionTrigger',
  'forbidOverrides',
] as const satisfies readonly PresetCompatPromptRulePreservedField[]

export const PRESET_COMPAT_IMAGE_REQUEST_FIELD_PREFIXES = ['image_', 'inline_image_'] as const

export const PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX: Record<AIProvider, PresetCompatProviderCapability> = {
  'openai-compatible': {
    provider: 'openai-compatible',
    appliedFields: {
      temperature: 'temperature',
      top_p: 'top_p',
      frequency_penalty: 'frequency_penalty',
      presence_penalty: 'presence_penalty',
      openai_max_tokens: 'max_tokens',
    },
    preservedOnlyFields: [
      'top_k',
      'top_a',
      'min_p',
      'repetition_penalty',
      'openai_max_context',
      'max_context_unlocked',
      'names_behavior',
      'send_if_empty',
      'impersonation_prompt',
      'new_chat_prompt',
      'new_group_chat_prompt',
      'new_example_chat_prompt',
      'continue_nudge_prompt',
      'bias_preset_selected',
      'wi_format',
      'scenario_format',
      'personality_format',
      'group_nudge_prompt',
      'stream_openai',
      'function_calling',
      'show_thoughts',
      'reasoning_effort',
      'seed',
    ],
  },
  ollama: {
    provider: 'ollama',
    appliedFields: {
      temperature: 'options.temperature',
      top_p: 'options.top_p',
      top_k: 'options.top_k',
      min_p: 'options.min_p',
      repetition_penalty: 'options.repeat_penalty',
      openai_max_tokens: 'options.num_predict',
      seed: 'options.seed',
    },
    preservedOnlyFields: [
      'presence_penalty',
      'frequency_penalty',
      'top_a',
      'openai_max_context',
      'max_context_unlocked',
      'names_behavior',
      'send_if_empty',
      'impersonation_prompt',
      'new_chat_prompt',
      'new_group_chat_prompt',
      'new_example_chat_prompt',
      'continue_nudge_prompt',
      'bias_preset_selected',
      'wi_format',
      'scenario_format',
      'personality_format',
      'group_nudge_prompt',
      'stream_openai',
      'function_calling',
      'show_thoughts',
      'reasoning_effort',
    ],
  },
}

const PRESET_COMPAT_PRESERVED_ONLY_FIELD_SET = new Set<PresetCompatProviderSamplerField>([
  ...PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX['openai-compatible'].preservedOnlyFields,
  ...PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX.ollama.preservedOnlyFields,
])

export function isPresetCompatImageRequestField(fieldName: string) {
  return PRESET_COMPAT_IMAGE_REQUEST_FIELD_PREFIXES.some((prefix) => fieldName.startsWith(prefix))
}

export function isPresetCompatPreservedOnlyField(fieldName: string): fieldName is PresetCompatProviderSamplerField {
  return PRESET_COMPAT_PRESERVED_ONLY_FIELD_SET.has(fieldName as PresetCompatProviderSamplerField)
}

export function getPresetCompatProviderCapability(provider: AIProvider) {
  return PRESET_COMPAT_PROVIDER_CAPABILITY_MATRIX[provider]
}

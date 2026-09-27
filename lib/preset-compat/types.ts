import { PRODUCT_SURFACE_IDS, type ProductSurfaceId } from '@/lib/types'

export const PRESET_COMPAT_LIBRARY_SCHEMA_VERSION = 1
export const PRESET_COMPAT_LIBRARY_INITIAL_REVISION = 0
export const PRESET_COMPAT_SOURCE_API_ID = 'openai' as const

export const PRESET_COMPAT_LEGACY_FLAT_PROMPT_KEYS = [
  'main_prompt',
  'nsfw_prompt',
  'jailbreak_prompt',
] as const

export const PRESET_COMPAT_CREATIVE_SURFACE_IDS = PRODUCT_SURFACE_IDS

export const PRESET_COMPAT_EDITABLE_SURFACE_IDS = PRODUCT_SURFACE_IDS

export const PRESET_COMPAT_OBSOLETE_SURFACE_IDS = [
  'expand',
  'polish',
  'continue',
  'future_jump_rewrite',
] as const

export const PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS = [
  'future_jump_bridge',
  'what_if_delta_extraction',
  'knowledge_extraction',
  'embeddings',
] as const

export const PRESET_COMPAT_SURFACE_IDS = [
  ...PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  ...PRESET_COMPAT_FAIL_CLOSED_SURFACE_IDS,
] as const

export const PRESET_COMPAT_FIELD_STATUS = [
  'applied',
  'degraded',
  'preserved',
  'unsupported',
] as const

export const PRESET_COMPAT_STATUS_REASON_CODES = [
  'SUPPORTED_RUNTIME',
  'PROVIDER_ONLY',
  'PROVIDER_UNSUPPORTED',
  'ROUTE_UNSUPPORTED',
  'NO_GROUP_CONTEXT',
  'NO_EXAMPLE_CONTEXT',
  'NO_CHAT_HISTORY',
  'NO_EMPTY_SEND_CONTEXT',
  'NO_IMPERSONATION_CONTEXT',
  'NEW_CHAT_CONTEXT_REQUIRED',
  'CONTINUE_SURFACE_ONLY',
  'WORLD_INFO_CONTEXT_REQUIRED',
  'SCENARIO_CONTEXT_REQUIRED',
  'PERSONA_CONTEXT_REQUIRED',
  'ASSISTANT_PREFILL_UNSUPPORTED',
  'SYSTEM_CHANNEL_REQUIRED',
  'MESSAGE_SQUASH_UNSUPPORTED',
  'WEB_SEARCH_IMPORT_DISABLED',
  'IMAGE_REQUEST_METADATA_ONLY',
  'PROMPT_ORDER_CANONICAL',
  'UNSUPPORTED_ROLE',
  'UNSUPPORTED_MARKER',
  'UNKNOWN_TRIGGER',
  'UNKNOWN_CONDITION',
  'UNSAFE_CONDITION',
  'MARKDOWN_CHANNEL_REQUIRED',
  'EDIT_HOOK_UNSUPPORTED',
  'REGEX_SUBSTITUTE_MODE_UNSUPPORTED',
  'VIRTUAL_DEPTH_REQUIRED',
  'FORBID_OVERRIDES_PROTECTED',
  'UNSUPPORTED_RUNTIME_SURFACE',
  'PRESERVED_EXPORT_ONLY',
  'ANALYTICAL_SURFACE_FAIL_CLOSED',
] as const

export type PresetCompatRuntimePromptRuleRole = 'system' | 'user'
export type PresetCompatFieldStatus = (typeof PRESET_COMPAT_FIELD_STATUS)[number]
export type PresetCompatStatusReasonCode = (typeof PRESET_COMPAT_STATUS_REASON_CODES)[number]

export type PresetCompatPromptRuleRole = PresetCompatRuntimePromptRuleRole | (string & {})

export type PresetCompatPromptRuleInjectionPosition = 'before' | 'after' | 'in_chat' | 'none'

export type PresetCompatPromptRuleInjectionTrigger = string

export const PRESET_COMPAT_PROMPT_RULE_RUNTIME_SESSION_PHASES = [
  'new_chat',
  'new_group_chat',
  'new_example_chat',
  'continue',
] as const

export type PresetCompatPromptRuleRuntimeSessionPhase =
  (typeof PRESET_COMPAT_PROMPT_RULE_RUNTIME_SESSION_PHASES)[number]

export type PresetCompatPromptRuleRuntimeContext = {
  sessionPhase?: PresetCompatPromptRuleRuntimeSessionPhase | null
  hasGroupContext?: boolean
  hasExampleContext?: boolean
  hasImpersonationContext?: boolean
  supportsVirtualDepth?: boolean
  surfaceContextBlocks?: PresetCompatRuntimeContextBlock[]
  namedTranscript?: PresetCompatNamedTranscriptContext | null
  protagonistName?: string | null
}

export type PresetCompatRuntimeContextBlockAbstraction =
  | 'world_info'
  | 'scenario'
  | 'personality'
  | 'named_transcript'

export type PresetCompatRuntimeContextBlock = {
  id: string
  label: string
  content: string
  abstraction: PresetCompatRuntimeContextBlockAbstraction
}

export type PresetCompatNamedTranscriptContext = {
  kind: 'chat' | 'roleplay'
  userName: string | null
  assistantName: string | null
}

export type PresetCompatLegacyFlatPromptKey = (typeof PRESET_COMPAT_LEGACY_FLAT_PROMPT_KEYS)[number]

export type PresetCompatPromptRule = {
  id: string
  name: string
  role: PresetCompatPromptRuleRole
  content: string
  enabled: boolean
  marker: boolean
  injectAsSystemPrompt: boolean
  injectionPosition: PresetCompatPromptRuleInjectionPosition
  injectionDepth: number | null
  injectionOrder: number | null
  injectionTrigger: PresetCompatPromptRuleInjectionTrigger[]
  forbidOverrides: boolean
  condition: string | null
  passthrough: Record<string, unknown>
}

export type PresetCompatRegexPlacement =
  | 'user_input'
  | 'assistant_output'
  | 'slash_command'
  | 'world_info'
  | 'reasoning'
  | 'md_display'

export type PresetCompatRegexRecord = {
  id: string
  name: string
  pattern: string
  replacement: string
  flags: string
  disabled: boolean
  placements: PresetCompatRegexPlacement[]
  trimStrings: string[]
  promptOnly: boolean
  markdownOnly: boolean
  minDepth: number | null
  maxDepth: number | null
  substituteRegex: string | null
  runOnEdit: boolean
  passthrough: Record<string, unknown>
}

export type PresetCompatSurfaceId = (typeof PRESET_COMPAT_SURFACE_IDS)[number]
export type PresetCompatCreativeSurfaceId = ProductSurfaceId
export type PresetCompatEditableSurfaceId = ProductSurfaceId
export type PresetCompatSurfaceBinding = {
  surfaceId: PresetCompatSurfaceId
  presetId: string | null
  enabled: boolean
  failClosed: boolean
}

export type PresetCompatBuiltinSystemPrompt = {
  surfaceId: PresetCompatCreativeSurfaceId
  enabled: boolean
  content: string
}

export type PresetCompatRuntimeSamplerSettings = {
  temperature: number | null
  topP: number | null
  topK: number | null
  topA: number | null
  minP: number | null
  presencePenalty: number | null
  frequencyPenalty: number | null
  repetitionPenalty: number | null
  openaiMaxContext: number | null
  maxTokens: number | null
  seed: number | null
  candidateCount: number | null
}

export type PresetCompatPromptTemplateSettings = {
  namesBehavior: number | null
  sendIfEmpty: string | null
  impersonationPrompt: string | null
  newChatPrompt: string | null
  newGroupChatPrompt: string | null
  newExampleChatPrompt: string | null
  continueNudgePrompt: string | null
  wiFormat: string | null
  scenarioFormat: string | null
  personalityFormat: string | null
  groupNudgePrompt: string | null
  assistantPrefill: string | null
  assistantImpersonation: string | null
  continuePostfix: string | null
  legacyMainPrompt: string | null
  legacyNsfwPrompt: string | null
  legacyJailbreakPrompt: string | null
}

export type PresetCompatTransportSettings = {
  maxContextUnlocked: boolean | null
  streamOpenAI: boolean | null
  useSysprompt: boolean | null
  squashSystemMessages: boolean | null
  mediaInlining: boolean | null
  inlineImageQuality: string | null
  continuePrefill: boolean | null
  functionCalling: boolean | null
  showThoughts: boolean | null
  reasoningEffort: string | null
  verbosity: string | null
  enableWebSearch: boolean | null
  requestImages: boolean | null
  requestImageAspectRatio: string | null
  requestImageResolution: string | null
}

export type PresetCompatPreservedFieldSettings = {
  biasPresetSelected: string | null
}

export type PresetCompatPresetPassthrough = Record<string, unknown> & Partial<{
  root: Record<string, unknown>
  extensions: Record<string, unknown>
  unknownPromptFields: Record<string, Record<string, unknown>>
  legacyFlatPrompts: Record<string, PresetCompatLegacyFlatPromptKey>
}>

export type PresetCompatRuntimeSnapshot = {
  activePresetId: string | null
  activeSurfaceId: PresetCompatSurfaceId | null
  importedAt: string | null
  warnings: string[]
}

export type PresetCompatResolvedProviderControlIntent = {
  field: string
  provider: 'openai-compatible' | 'ollama'
  target: 'request' | 'route'
  path: string
  value: unknown
}

export type PresetCompatResolvedFieldStatus = {
  field: string
  surface: PresetCompatSurfaceId
  status: PresetCompatFieldStatus
  reason: PresetCompatStatusReasonCode
  provider: 'openai-compatible' | 'ollama' | null
  value: unknown
  fragmentId?: string
  fragmentName?: string
  providerIntent?: PresetCompatResolvedProviderControlIntent
}

export type PresetCompatPresetRecord = {
  id: string
  name: string
  sourceApiId: typeof PRESET_COMPAT_SOURCE_API_ID
  promptRules: PresetCompatPromptRule[]
  promptOrderLists: Partial<Record<PresetCompatSurfaceId, string[]>>
  embeddedRegexes: PresetCompatRegexRecord[]
  attachedStandaloneRegexIds: string[]
  runtimeSampler: PresetCompatRuntimeSamplerSettings
  promptTemplate: PresetCompatPromptTemplateSettings
  transport: PresetCompatTransportSettings
  preservedFields: PresetCompatPreservedFieldSettings
  passthrough: PresetCompatPresetPassthrough
  importWarnings: string[]
  createdAt: string
  updatedAt: string
}

export type PresetCompatLibrary = {
  schemaVersion: number
  revision: number
  /** Tracks one-time bundled additions so deleting a default preset persists. */
  bundledDefaultsVersion?: number
  presets: Record<string, PresetCompatPresetRecord>
  standaloneRegexes: Record<string, PresetCompatRegexRecord>
  surfaceBindings: Record<PresetCompatSurfaceId, PresetCompatSurfaceBinding>
  novelRewritePresetIds?: Record<string, string | null>
  builtinSystemPrompts: Record<PresetCompatCreativeSurfaceId, PresetCompatBuiltinSystemPrompt>
  lastImportedAt: string | null
  lastExportedAt: string | null
}

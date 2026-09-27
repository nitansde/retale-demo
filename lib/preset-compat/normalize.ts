import {
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_LEGACY_FLAT_PROMPT_KEYS,
  PRESET_COMPAT_SOURCE_API_ID,
  type PresetCompatLegacyFlatPromptKey,
  type PresetCompatPresetPassthrough,
  type PresetCompatPresetRecord,
  type PresetCompatPromptRule,
  type PresetCompatPromptRuleInjectionTrigger,
  type PresetCompatRegexPlacement,
  type PresetCompatRegexRecord,
} from '@/lib/preset-compat/types'
import { createUuid } from '@/lib/utils'

const ACTIVE_PROMPT_ORDER_CHARACTER_ID = 100001
const PROMPT_EXPORT_META_KEY = '__presetCompatPromptMeta'
const REGEX_EXPORT_META_KEY = '__presetCompatRegexMeta'

const REGEX_PLACEMENT_FROM_ST: Record<number, PresetCompatRegexPlacement> = {
  0: 'md_display',
  1: 'user_input',
  2: 'assistant_output',
  3: 'slash_command',
  6: 'world_info',
  7: 'reasoning',
}

type NameConflictPolicy = 'copy'

type PromptExportMeta = {
  injectionPosition?: unknown
  injectionTrigger?: unknown
}

type RegexExportMeta = {
  placement?: unknown
  substituteRegex?: unknown
}

export type NormalizePresetCompatPresetOptions = {
  uploadedFileName?: string | null
  nameHint?: string | null
  existingNames?: Iterable<string>
  now?: string
  idFactory?: () => string
  conflictPolicy?: NameConflictPolicy
}

export type NormalizePresetCompatStandaloneRegexOptions = {
  existingNames?: Iterable<string>
  idFactory?: () => string
  conflictPolicy?: NameConflictPolicy
}

export type NormalizedPresetCompatPresetImport = {
  preset: PresetCompatPresetRecord
  warnings: string[]
}

export type NormalizedPresetCompatStandaloneRegexImport = {
  regexes: PresetCompatRegexRecord[]
  warnings: string[]
}

type RawPromptOrderEntry = {
  character_id?: unknown
  order?: unknown
  [key: string]: unknown
}

const LEGACY_FLAT_PROMPT_CONFIG: Record<
  PresetCompatLegacyFlatPromptKey,
  Pick<PresetCompatPromptRule, 'id' | 'name' | 'role' | 'injectAsSystemPrompt' | 'forbidOverrides'>
> = {
  main_prompt: {
    id: 'main',
    name: 'Main Prompt',
    role: 'user',
    injectAsSystemPrompt: true,
    forbidOverrides: false,
  },
  nsfw_prompt: {
    id: 'nsfw',
    name: 'NSFW Prompt',
    role: 'system',
    injectAsSystemPrompt: true,
    forbidOverrides: false,
  },
  jailbreak_prompt: {
    id: 'jailbreak',
    name: 'Jailbreak Prompt',
    role: 'system',
    injectAsSystemPrompt: true,
    forbidOverrides: false,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function asNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function asNullableBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string') {
    return [value]
  }
  return [] as string[]
}

export function normalizeDisplayName(baseName: string, existingNames: Iterable<string>, conflictPolicy: NameConflictPolicy = 'copy') {
  const trimmed = baseName.trim() || 'Imported preset'
  if (conflictPolicy !== 'copy') {
    return trimmed
  }

  const existing = new Set(Array.from(existingNames, (name) => name.trim()).filter(Boolean))
  if (!existing.has(trimmed)) {
    return trimmed
  }

  let copyIndex = 1
  while (true) {
    const nextName = copyIndex === 1 ? `${trimmed} (copy)` : `${trimmed} (copy ${copyIndex})`
    if (!existing.has(nextName)) {
      return nextName
    }
    copyIndex += 1
  }
}

function fileNameToDisplayName(fileName: string | null | undefined) {
  if (!fileName) {
    return ''
  }

  const basename = fileName.split(/[\\/]/).pop() ?? fileName
  return basename.replace(/\.[^.]+$/, '').trim()
}

function pickPresetName(rawPreset: Record<string, unknown>, options: NormalizePresetCompatPresetOptions) {
  const uploadedFileName = fileNameToDisplayName(options.uploadedFileName)
  const hintedName = typeof options.nameHint === 'string' ? options.nameHint.trim() : ''
  const rawName = typeof rawPreset.name === 'string' ? rawPreset.name.trim() : ''
  const baseName = uploadedFileName || hintedName || rawName || 'Imported preset'
  return normalizeDisplayName(baseName, options.existingNames ?? [], options.conflictPolicy)
}

function makeId(idFactory?: () => string) {
  return idFactory ? idFactory() : createUuid()
}

function normalizePromptOrderEntries(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord).map((entry) => entry as RawPromptOrderEntry) : []
}

function getActivePromptOrderEntry(entries: RawPromptOrderEntry[]) {
  return entries.find((entry) => entry.character_id === ACTIVE_PROMPT_ORDER_CHARACTER_ID) ?? null
}

function getActivePromptOrderState(activeEntry: RawPromptOrderEntry | null) {
  const activeOrder = Array.isArray(activeEntry?.order) ? activeEntry.order.filter(isRecord) : []
  const enabledById = new Map<string, boolean>()
  const orderedIds: string[] = []

  for (const entry of activeOrder) {
    const identifier = typeof entry.identifier === 'string' ? entry.identifier : ''
    if (!identifier) {
      continue
    }

    orderedIds.push(identifier)
    enabledById.set(identifier, asBoolean(entry.enabled, true))
  }

  return { activeOrder, enabledById, orderedIds }
}

function normalizePromptInjectionPosition(
  rawPrompt: Record<string, unknown>,
  orderedIds: string[],
  identifier: string
): PresetCompatPromptRule['injectionPosition'] {
  if (rawPrompt.injection_position === 1) {
    return 'in_chat'
  }

  const promptIndex = orderedIds.indexOf(identifier)
  const chatHistoryIndex = orderedIds.indexOf('chatHistory')
  if (promptIndex === -1) {
    return 'none'
  }
  if (chatHistoryIndex !== -1 && promptIndex > chatHistoryIndex) {
    return 'after'
  }
  return 'before'
}

function extractUnknownFields(source: Record<string, unknown>, knownKeys: string[]) {
  const known = new Set(knownKeys)
  return Object.fromEntries(Object.entries(source).filter(([key]) => !known.has(key)))
}

function normalizePromptRule(
  rawPrompt: unknown,
  orderedIds: string[],
  enabledById: Map<string, boolean>,
  idFactory?: () => string
) {
  if (!isRecord(rawPrompt)) {
    return null
  }

  const identifier = typeof rawPrompt.identifier === 'string' && rawPrompt.identifier.trim()
    ? rawPrompt.identifier
    : makeId(idFactory)
  const unknownFields = extractUnknownFields(rawPrompt, [
    'identifier',
    'name',
    'role',
    'content',
    'enabled',
    'marker',
    'system_prompt',
    'injection_position',
    'injection_depth',
    'injection_order',
    'injection_trigger',
    'forbid_overrides',
    'condition',
  ])

  const prompt: PresetCompatPromptRule = {
    id: identifier,
    name: asString(rawPrompt.name, identifier),
    role: asString(rawPrompt.role, 'system'),
    content: asString(rawPrompt.content),
    enabled: enabledById.has(identifier) ? enabledById.get(identifier) === true : asBoolean(rawPrompt.enabled, true),
    marker: asBoolean(rawPrompt.marker, false),
    injectAsSystemPrompt: asBoolean(rawPrompt.system_prompt, false),
    injectionPosition: normalizePromptInjectionPosition(rawPrompt, orderedIds, identifier),
    injectionDepth: asNullableNumber(rawPrompt.injection_depth),
    injectionOrder: asNullableNumber(rawPrompt.injection_order),
    injectionTrigger: asStringArray(rawPrompt.injection_trigger) as PresetCompatPromptRuleInjectionTrigger[],
    forbidOverrides: asBoolean(rawPrompt.forbid_overrides, false),
    condition: typeof rawPrompt.condition === 'string' ? rawPrompt.condition : null,
    passthrough: {
      ...unknownFields,
      [PROMPT_EXPORT_META_KEY]: {
        injectionPosition: rawPrompt.injection_position,
        injectionTrigger: cloneValue(rawPrompt.injection_trigger),
      } satisfies PromptExportMeta,
    },
  }

  return prompt
}

function normalizeLegacyFlatPromptRules(rawPreset: Record<string, unknown>) {
  const promptRules: PresetCompatPromptRule[] = []
  const orderedIds: string[] = []
  const legacyFlatPrompts: Record<string, PresetCompatLegacyFlatPromptKey> = {}

  for (const key of PRESET_COMPAT_LEGACY_FLAT_PROMPT_KEYS) {
    const content = typeof rawPreset[key] === 'string' ? rawPreset[key] : ''
    if (!content.trim()) {
      continue
    }

    const config = LEGACY_FLAT_PROMPT_CONFIG[key]
    promptRules.push({
      id: config.id,
      name: config.name,
      role: config.role,
      content,
      enabled: true,
      marker: false,
      injectAsSystemPrompt: config.injectAsSystemPrompt,
      injectionPosition: 'before',
      injectionDepth: null,
      injectionOrder: 100,
      injectionTrigger: [],
      forbidOverrides: config.forbidOverrides,
      condition: null,
      passthrough: {},
    })
    orderedIds.push(config.id)
    legacyFlatPrompts[config.id] = key
  }

  return {
    promptRules,
    orderedIds,
    legacyFlatPrompts,
  }
}

function normalizePlacementList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as PresetCompatRegexPlacement[]
  }

  const placements: PresetCompatRegexPlacement[] = []
  for (const rawPlacement of value) {
    const normalized = typeof rawPlacement === 'number' ? REGEX_PLACEMENT_FROM_ST[rawPlacement] : null
    if (normalized && !placements.includes(normalized)) {
      placements.push(normalized)
    }
  }
  return placements
}

function normalizeRuntimeSampler(rawPreset: Record<string, unknown>): PresetCompatPresetRecord['runtimeSampler'] {
  return {
    temperature: asNullableNumber(rawPreset.temperature),
    topP: asNullableNumber(rawPreset.top_p),
    topK: asNullableNumber(rawPreset.top_k),
    topA: asNullableNumber(rawPreset.top_a),
    minP: asNullableNumber(rawPreset.min_p),
    presencePenalty: asNullableNumber(rawPreset.presence_penalty),
    frequencyPenalty: asNullableNumber(rawPreset.frequency_penalty),
    repetitionPenalty: asNullableNumber(rawPreset.repetition_penalty),
    openaiMaxContext: asNullableNumber(rawPreset.openai_max_context),
    maxTokens: asNullableNumber(rawPreset.openai_max_tokens),
    seed: asNullableNumber(rawPreset.seed),
    candidateCount: asNullableNumber(rawPreset.n),
  }
}

function normalizePromptTemplate(rawPreset: Record<string, unknown>): PresetCompatPresetRecord['promptTemplate'] {
  return {
    namesBehavior: asNullableNumber(rawPreset.names_behavior),
    sendIfEmpty: asNullableString(rawPreset.send_if_empty),
    impersonationPrompt: asNullableString(rawPreset.impersonation_prompt),
    newChatPrompt: asNullableString(rawPreset.new_chat_prompt),
    newGroupChatPrompt: asNullableString(rawPreset.new_group_chat_prompt),
    newExampleChatPrompt: asNullableString(rawPreset.new_example_chat_prompt),
    continueNudgePrompt: asNullableString(rawPreset.continue_nudge_prompt),
    wiFormat: asNullableString(rawPreset.wi_format),
    scenarioFormat: asNullableString(rawPreset.scenario_format),
    personalityFormat: asNullableString(rawPreset.personality_format),
    groupNudgePrompt: asNullableString(rawPreset.group_nudge_prompt),
    assistantPrefill: asNullableString(rawPreset.assistant_prefill),
    assistantImpersonation: asNullableString(rawPreset.assistant_impersonation),
    continuePostfix: asNullableString(rawPreset.continue_postfix),
    legacyMainPrompt: asNullableString(rawPreset.main_prompt),
    legacyNsfwPrompt: asNullableString(rawPreset.nsfw_prompt),
    legacyJailbreakPrompt: asNullableString(rawPreset.jailbreak_prompt),
  }
}

function normalizeTransport(rawPreset: Record<string, unknown>): PresetCompatPresetRecord['transport'] {
  return {
    maxContextUnlocked: asNullableBoolean(rawPreset.max_context_unlocked),
    streamOpenAI: asNullableBoolean(rawPreset.stream_openai),
    useSysprompt: asNullableBoolean(rawPreset.use_sysprompt),
    squashSystemMessages: asNullableBoolean(rawPreset.squash_system_messages),
    mediaInlining: asNullableBoolean(rawPreset.media_inlining),
    inlineImageQuality: asNullableString(rawPreset.inline_image_quality),
    continuePrefill: asNullableBoolean(rawPreset.continue_prefill),
    functionCalling: asNullableBoolean(rawPreset.function_calling),
    showThoughts: asNullableBoolean(rawPreset.show_thoughts),
    reasoningEffort: asNullableString(rawPreset.reasoning_effort),
    verbosity: asNullableString(rawPreset.verbosity),
    enableWebSearch: asNullableBoolean(rawPreset.enable_web_search),
    requestImages: asNullableBoolean(rawPreset.request_images),
    requestImageAspectRatio: asNullableString(rawPreset.request_image_aspect_ratio),
    requestImageResolution: asNullableString(rawPreset.request_image_resolution),
  }
}

function normalizePreservedFields(rawPreset: Record<string, unknown>): PresetCompatPresetRecord['preservedFields'] {
  return {
    biasPresetSelected: asNullableString(rawPreset.bias_preset_selected),
  }
}

function normalizeTrimStrings(value: unknown, warningPrefix: string, warnings: string[]) {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      warnings.push(`${warningPrefix} trimStrings was not an array and was replaced with an empty list.`)
    }
    return [] as string[]
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeRegexRecord(
  rawRegex: unknown,
  index: number,
  namesInUse: Set<string>,
  warnings: string[],
  options: NormalizePresetCompatStandaloneRegexOptions & { idFactory?: () => string }
) {
  if (!isRecord(rawRegex)) {
    warnings.push(`Regex entry ${index + 1} was not an object and was skipped.`)
    return null
  }

  const pattern = typeof rawRegex.findRegex === 'string' ? rawRegex.findRegex : null
  const replacement = typeof rawRegex.replaceString === 'string' ? rawRegex.replaceString : null
  if (pattern === null || replacement === null) {
    warnings.push(`Regex entry ${index + 1} was missing findRegex or replaceString and was skipped.`)
    return null
  }

  const rawName = typeof rawRegex.scriptName === 'string' && rawRegex.scriptName.trim()
    ? rawRegex.scriptName
    : `Imported regex ${index + 1}`
  const resolvedName = normalizeDisplayName(rawName, namesInUse, options.conflictPolicy)
  namesInUse.add(resolvedName)

  const unknownFields = extractUnknownFields(rawRegex, [
    'id',
    'scriptName',
    'findRegex',
    'replaceString',
    'trimStrings',
    'placement',
    'disabled',
    'markdownOnly',
    'promptOnly',
    'runOnEdit',
    'substituteRegex',
    'minDepth',
    'maxDepth',
  ])

  const regexRecord: PresetCompatRegexRecord = {
    id: typeof rawRegex.id === 'string' && rawRegex.id.trim() ? rawRegex.id : makeId(options.idFactory),
    name: resolvedName,
    pattern,
    replacement,
    flags: '',
    disabled: asBoolean(rawRegex.disabled, false),
    placements: normalizePlacementList(rawRegex.placement),
    trimStrings: normalizeTrimStrings(rawRegex.trimStrings, `Regex entry ${index + 1}`, warnings),
    promptOnly: asBoolean(rawRegex.promptOnly, false),
    markdownOnly: asBoolean(rawRegex.markdownOnly, false),
    minDepth: asNullableNumber(rawRegex.minDepth),
    maxDepth: asNullableNumber(rawRegex.maxDepth),
    substituteRegex: typeof rawRegex.substituteRegex === 'string' ? rawRegex.substituteRegex : null,
    runOnEdit: asBoolean(rawRegex.runOnEdit, false),
    passthrough: {
      ...unknownFields,
      [REGEX_EXPORT_META_KEY]: {
        placement: cloneValue(rawRegex.placement),
        substituteRegex: cloneValue(rawRegex.substituteRegex),
      } satisfies RegexExportMeta,
    },
  }

  return regexRecord
}

function getRegexArrayFromStandalonePayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }
  if (!isRecord(payload)) {
    return []
  }
  if (Array.isArray(payload.regex_scripts)) {
    return payload.regex_scripts
  }
  if (isRecord(payload.RegexBinding) && Array.isArray(payload.RegexBinding.regexes)) {
    return payload.RegexBinding.regexes
  }
  if (isRecord(payload.SPreset) && isRecord(payload.SPreset.RegexBinding) && Array.isArray(payload.SPreset.RegexBinding.regexes)) {
    return payload.SPreset.RegexBinding.regexes
  }
  return []
}

export function getPromptExportMeta(promptRule: PresetCompatPromptRule) {
  const meta = isRecord(promptRule.passthrough[PROMPT_EXPORT_META_KEY])
    ? promptRule.passthrough[PROMPT_EXPORT_META_KEY]
    : {}
  return meta as PromptExportMeta
}

export function getRegexExportMeta(regexRecord: PresetCompatRegexRecord) {
  const meta = isRecord(regexRecord.passthrough[REGEX_EXPORT_META_KEY])
    ? regexRecord.passthrough[REGEX_EXPORT_META_KEY]
    : {}
  return meta as RegexExportMeta
}

export function stripInternalPromptPassthroughMeta(passthrough: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(passthrough).filter(([key]) => key !== PROMPT_EXPORT_META_KEY))
}

export function stripInternalRegexPassthroughMeta(passthrough: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(passthrough).filter(([key]) => key !== REGEX_EXPORT_META_KEY))
}

export function normalizePresetCompatStandaloneRegexImport(
  payload: unknown,
  options: NormalizePresetCompatStandaloneRegexOptions = {}
): NormalizedPresetCompatStandaloneRegexImport {
  const warnings: string[] = []
  const regexPayload = getRegexArrayFromStandalonePayload(payload)
  const namesInUse = new Set(Array.from(options.existingNames ?? []).filter((name): name is string => typeof name === 'string'))

  if (!Array.isArray(regexPayload)) {
    return { regexes: [], warnings: ['Standalone regex payload was not an array and was skipped.'] }
  }

  const regexes = regexPayload
    .map((entry, index) => normalizeRegexRecord(entry, index, namesInUse, warnings, options))
    .filter((entry): entry is PresetCompatRegexRecord => entry !== null)

  return { regexes, warnings }
}

export function normalizePresetCompatPresetImport(
  payload: unknown,
  options: NormalizePresetCompatPresetOptions = {}
): NormalizedPresetCompatPresetImport {
  const rawPreset = isRecord(payload) ? payload : {}
  const warnings: string[] = []
  const now = options.now ?? new Date().toISOString()
  const presetId = makeId(options.idFactory)
  const promptOrderEntries = normalizePromptOrderEntries(rawPreset.prompt_order)
  const activeEntry = getActivePromptOrderEntry(promptOrderEntries)
  const { enabledById, orderedIds } = getActivePromptOrderState(activeEntry)

  const structuredPromptRules = Array.isArray(rawPreset.prompts)
    ? rawPreset.prompts
      .map((prompt) => normalizePromptRule(prompt, orderedIds, enabledById, options.idFactory))
      .filter((prompt): prompt is PresetCompatPromptRule => prompt !== null)
    : []
  const legacyPromptMigration = structuredPromptRules.length === 0
    ? normalizeLegacyFlatPromptRules(rawPreset)
    : {
        promptRules: [] as PresetCompatPromptRule[],
        orderedIds: [] as string[],
        legacyFlatPrompts: {} as Record<string, PresetCompatLegacyFlatPromptKey>,
      }
  const promptRules = structuredPromptRules.length > 0
    ? structuredPromptRules
    : legacyPromptMigration.promptRules

  const embeddedRegexResult = normalizePresetCompatStandaloneRegexImport(
    isRecord(rawPreset.extensions) ? rawPreset.extensions.regex_scripts : [],
    {
      conflictPolicy: options.conflictPolicy,
      existingNames: [],
      idFactory: options.idFactory,
    }
  )
  warnings.push(...embeddedRegexResult.warnings.map((warning) => `Preset embedded regex: ${warning}`))

  const naturalStructuredOrderIds = structuredPromptRules.map((promptRule) => promptRule.id)
  const promptOrderIds = orderedIds.length > 0
    ? orderedIds.slice()
    : structuredPromptRules.length > 0
      ? naturalStructuredOrderIds
      : legacyPromptMigration.orderedIds.slice()
  const promptOrderLists = Object.fromEntries(
    PRESET_COMPAT_CREATIVE_SURFACE_IDS.map((surfaceId) => [surfaceId, promptOrderIds])
  ) as PresetCompatPresetRecord['promptOrderLists']

  const passthroughRoot = Object.fromEntries(
    Object.entries(rawPreset)
      .filter(([key]) => key !== 'extensions')
      .map(([key, value]) => [key, cloneValue(value)])
  )
  const passthroughExtensions = isRecord(rawPreset.extensions) ? cloneValue(rawPreset.extensions) : {}
  const unknownPromptFields = Object.fromEntries(
    promptRules
      .map((promptRule) => [promptRule.id, stripInternalPromptPassthroughMeta(promptRule.passthrough)] as const)
      .filter(([, value]) => Object.keys(value).length > 0)
  )

  const passthrough: PresetCompatPresetPassthrough = {
    root: passthroughRoot,
    extensions: passthroughExtensions,
    unknownPromptFields,
  }
  if (Object.keys(legacyPromptMigration.legacyFlatPrompts).length > 0) {
    passthrough.legacyFlatPrompts = legacyPromptMigration.legacyFlatPrompts
  }

  const preset: PresetCompatPresetRecord = {
    id: presetId,
    name: pickPresetName(rawPreset, options),
    sourceApiId: PRESET_COMPAT_SOURCE_API_ID,
    promptRules,
    promptOrderLists,
    embeddedRegexes: embeddedRegexResult.regexes,
    attachedStandaloneRegexIds: [],
    runtimeSampler: normalizeRuntimeSampler(rawPreset),
    promptTemplate: normalizePromptTemplate(rawPreset),
    transport: normalizeTransport(rawPreset),
    preservedFields: normalizePreservedFields(rawPreset),
    passthrough,
    importWarnings: warnings,
    createdAt: now,
    updatedAt: now,
  }

  return { preset, warnings }
}

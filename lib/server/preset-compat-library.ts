import { createChineseDefaultPreset, PRESET_COMPAT_BUNDLED_DEFAULTS_VERSION, RETALE_DEFAULT_PRESET_ID } from '@/lib/preset-compat/default-preset'
import {
  createDefaultPresetCompatBuiltinSystemPrompts,
  createDefaultPresetCompatLibrary,
} from '@/lib/preset-compat/surface-contract'
import {
  PRESET_COMPAT_LEGACY_FLAT_PROMPT_KEYS,
  PRESET_COMPAT_CREATIVE_SURFACE_IDS,
  PRESET_COMPAT_OBSOLETE_SURFACE_IDS,
  PRESET_COMPAT_SOURCE_API_ID,
  PRESET_COMPAT_SURFACE_IDS,
  type PresetCompatBuiltinSystemPrompt,
  type PresetCompatCreativeSurfaceId,
  type PresetCompatLibrary,
  type PresetCompatLegacyFlatPromptKey,
  type PresetCompatPresetPassthrough,
  type PresetCompatPresetRecord,
  type PresetCompatPromptRule,
  type PresetCompatRegexPlacement,
  type PresetCompatRegexRecord,
  type PresetCompatSurfaceBinding,
  type PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import { findAppSettings, upsertAppSettings } from '@/lib/server/persistence'

export const PRESET_COMPAT_LIBRARY_V1_KEY = 'PRESET_COMPAT_LIBRARY_V1'
const PRESET_COMPAT_SURFACE_ID_SET = new Set<string>(PRESET_COMPAT_SURFACE_IDS)
const PRESET_COMPAT_OBSOLETE_SURFACE_ID_SET = new Set<string>(PRESET_COMPAT_OBSOLETE_SURFACE_IDS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseStoredLibraryBlob(value: string | null | undefined) {
  const raw = value?.trim()
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export type ProtectedPresetCompatLibraryResetSnapshot = {
  presetCompatLibraryV1: string | null
}

function normalizeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeNullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeInteger(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

function normalizeNullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizePromptTriggerArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string') {
    return [value]
  }
  return [] as string[]
}

function normalizePassthrough(value: unknown) {
  return isRecord(value) ? value : {}
}

function normalizeKnownSurfaceRecord(value: unknown) {
  if (!isRecord(value)) {
    return {} as Partial<Record<PresetCompatSurfaceId, unknown>>
  }

  return Object.fromEntries(
    Object.entries(value).filter(([surfaceId]) => (
      PRESET_COMPAT_SURFACE_ID_SET.has(surfaceId) && !PRESET_COMPAT_OBSOLETE_SURFACE_ID_SET.has(surfaceId)
    ))
  ) as Partial<Record<PresetCompatSurfaceId, unknown>>
}

function normalizeUnknownPromptFields(value: unknown) {
  if (!isRecord(value)) {
    return {} as Record<string, Record<string, unknown>>
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, promptValue]) => isRecord(promptValue))
      .map(([promptId, promptValue]) => [promptId, promptValue])
  ) as Record<string, Record<string, unknown>>
}

function normalizeLegacyFlatPrompts(value: unknown) {
  if (!isRecord(value)) {
    return {} as Record<string, PresetCompatLegacyFlatPromptKey>
  }

  const validKeys = new Set<string>(PRESET_COMPAT_LEGACY_FLAT_PROMPT_KEYS)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, promptKey]) => typeof promptKey === 'string' && validKeys.has(promptKey))
      .map(([promptId, promptKey]) => [promptId, promptKey])
  ) as Record<string, PresetCompatLegacyFlatPromptKey>
}

function normalizePresetPassthrough(value: unknown): PresetCompatPresetPassthrough {
  const record = normalizePassthrough(value)
  const normalized: PresetCompatPresetPassthrough = { ...record }

  if ('root' in record) {
    normalized.root = normalizePassthrough(record.root)
  }
  if ('extensions' in record) {
    normalized.extensions = normalizePassthrough(record.extensions)
  }
  if ('unknownPromptFields' in record) {
    normalized.unknownPromptFields = normalizeUnknownPromptFields(record.unknownPromptFields)
  }
  if ('legacyFlatPrompts' in record) {
    normalized.legacyFlatPrompts = normalizeLegacyFlatPrompts(record.legacyFlatPrompts)
  }

  return normalized
}

function normalizePromptRule(value: unknown): PresetCompatPromptRule | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    id: normalizeString(value.id),
    name: normalizeString(value.name),
    role: normalizeString(value.role, 'system'),
    content: normalizeString(value.content),
    enabled: normalizeBoolean(value.enabled),
    marker: normalizeBoolean(value.marker),
    injectAsSystemPrompt: normalizeBoolean(value.injectAsSystemPrompt),
    injectionPosition: value.injectionPosition === 'before'
      || value.injectionPosition === 'after'
      || value.injectionPosition === 'in_chat'
      || value.injectionPosition === 'none'
      ? value.injectionPosition
      : 'none',
    injectionDepth: typeof value.injectionDepth === 'number' && Number.isFinite(value.injectionDepth)
      ? value.injectionDepth
      : null,
    injectionOrder: typeof value.injectionOrder === 'number' && Number.isFinite(value.injectionOrder)
      ? value.injectionOrder
      : null,
    injectionTrigger: normalizePromptTriggerArray(value.injectionTrigger),
    forbidOverrides: normalizeBoolean(value.forbidOverrides),
    condition: typeof value.condition === 'string' ? value.condition : null,
    passthrough: normalizePassthrough(value.passthrough),
  }
}

function isRegexPlacement(value: unknown): value is PresetCompatRegexPlacement {
  return value === 'user_input'
    || value === 'assistant_output'
    || value === 'slash_command'
    || value === 'world_info'
    || value === 'reasoning'
    || value === 'md_display'
}

function normalizeRegexRecord(value: unknown): PresetCompatRegexRecord | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    id: normalizeString(value.id),
    name: normalizeString(value.name),
    pattern: normalizeString(value.pattern),
    replacement: normalizeString(value.replacement),
    flags: normalizeString(value.flags),
    disabled: normalizeBoolean(value.disabled),
    placements: Array.isArray(value.placements)
      ? value.placements.filter(isRegexPlacement)
      : [],
    trimStrings: normalizeStringArray(value.trimStrings),
    promptOnly: normalizeBoolean(value.promptOnly),
    markdownOnly: normalizeBoolean(value.markdownOnly),
    minDepth: normalizeNullableNumber(value.minDepth),
    maxDepth: normalizeNullableNumber(value.maxDepth),
    substituteRegex: typeof value.substituteRegex === 'string' ? value.substituteRegex : null,
    runOnEdit: normalizeBoolean(value.runOnEdit),
    passthrough: normalizePassthrough(value.passthrough),
  }
}

function normalizeRuntimeSampler(value: unknown): PresetCompatPresetRecord['runtimeSampler'] {
  const record = isRecord(value) ? value : {}

  return {
    temperature: normalizeNullableNumber(record.temperature),
    topP: normalizeNullableNumber(record.topP),
    topK: normalizeNullableNumber(record.topK),
    topA: normalizeNullableNumber(record.topA),
    minP: normalizeNullableNumber(record.minP),
    presencePenalty: normalizeNullableNumber(record.presencePenalty),
    frequencyPenalty: normalizeNullableNumber(record.frequencyPenalty),
    repetitionPenalty: normalizeNullableNumber(record.repetitionPenalty),
    openaiMaxContext: normalizeNullableNumber(record.openaiMaxContext),
    maxTokens: normalizeNullableNumber(record.maxTokens),
    seed: normalizeNullableNumber(record.seed),
    candidateCount: normalizeNullableNumber(record.candidateCount),
  }
}

function normalizePromptTemplate(value: unknown): PresetCompatPresetRecord['promptTemplate'] {
  const record = isRecord(value) ? value : {}

  return {
    namesBehavior: normalizeNullableNumber(record.namesBehavior),
    sendIfEmpty: normalizeNullableString(record.sendIfEmpty),
    impersonationPrompt: normalizeNullableString(record.impersonationPrompt),
    newChatPrompt: normalizeNullableString(record.newChatPrompt),
    newGroupChatPrompt: normalizeNullableString(record.newGroupChatPrompt),
    newExampleChatPrompt: normalizeNullableString(record.newExampleChatPrompt),
    continueNudgePrompt: normalizeNullableString(record.continueNudgePrompt),
    wiFormat: normalizeNullableString(record.wiFormat),
    scenarioFormat: normalizeNullableString(record.scenarioFormat),
    personalityFormat: normalizeNullableString(record.personalityFormat),
    groupNudgePrompt: normalizeNullableString(record.groupNudgePrompt),
    assistantPrefill: normalizeNullableString(record.assistantPrefill),
    assistantImpersonation: normalizeNullableString(record.assistantImpersonation),
    continuePostfix: normalizeNullableString(record.continuePostfix),
    legacyMainPrompt: normalizeNullableString(record.legacyMainPrompt),
    legacyNsfwPrompt: normalizeNullableString(record.legacyNsfwPrompt),
    legacyJailbreakPrompt: normalizeNullableString(record.legacyJailbreakPrompt),
  }
}

function normalizeTransport(value: unknown): PresetCompatPresetRecord['transport'] {
  const record = isRecord(value) ? value : {}

  return {
    maxContextUnlocked: typeof record.maxContextUnlocked === 'boolean' ? record.maxContextUnlocked : null,
    streamOpenAI: typeof record.streamOpenAI === 'boolean' ? record.streamOpenAI : null,
    useSysprompt: typeof record.useSysprompt === 'boolean' ? record.useSysprompt : null,
    squashSystemMessages: typeof record.squashSystemMessages === 'boolean' ? record.squashSystemMessages : null,
    mediaInlining: typeof record.mediaInlining === 'boolean' ? record.mediaInlining : null,
    inlineImageQuality: normalizeNullableString(record.inlineImageQuality),
    continuePrefill: typeof record.continuePrefill === 'boolean' ? record.continuePrefill : null,
    functionCalling: typeof record.functionCalling === 'boolean' ? record.functionCalling : null,
    showThoughts: typeof record.showThoughts === 'boolean' ? record.showThoughts : null,
    reasoningEffort: normalizeNullableString(record.reasoningEffort),
    verbosity: normalizeNullableString(record.verbosity),
    enableWebSearch: typeof record.enableWebSearch === 'boolean' ? record.enableWebSearch : null,
    requestImages: typeof record.requestImages === 'boolean' ? record.requestImages : null,
    requestImageAspectRatio: normalizeNullableString(record.requestImageAspectRatio),
    requestImageResolution: normalizeNullableString(record.requestImageResolution),
  }
}

function normalizePreservedFields(value: unknown): PresetCompatPresetRecord['preservedFields'] {
  const record = isRecord(value) ? value : {}

  return {
    biasPresetSelected: normalizeNullableString(record.biasPresetSelected),
  }
}

function normalizePromptOrderLists(value: unknown): PresetCompatPresetRecord['promptOrderLists'] {
  const record = normalizeKnownSurfaceRecord(value)

  const entries = PRESET_COMPAT_SURFACE_IDS.flatMap((surfaceId) => {
    const orderList = record[surfaceId]
    if (!Array.isArray(orderList)) {
      return [] as Array<[PresetCompatSurfaceId, string[]]>
    }

    return [[surfaceId, orderList.filter((item): item is string => typeof item === 'string')]]
  })

  return Object.fromEntries(entries) as PresetCompatPresetRecord['promptOrderLists']
}

function normalizePresetRecord(value: unknown): PresetCompatPresetRecord | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    id: normalizeString(value.id),
    name: normalizeString(value.name),
    sourceApiId: value.sourceApiId === PRESET_COMPAT_SOURCE_API_ID ? value.sourceApiId : PRESET_COMPAT_SOURCE_API_ID,
    promptRules: Array.isArray(value.promptRules)
      ? value.promptRules.map(normalizePromptRule).filter((item): item is PresetCompatPromptRule => item !== null)
      : [],
    promptOrderLists: normalizePromptOrderLists(value.promptOrderLists),
    embeddedRegexes: Array.isArray(value.embeddedRegexes)
      ? value.embeddedRegexes.map(normalizeRegexRecord).filter((item): item is PresetCompatRegexRecord => item !== null)
      : [],
    attachedStandaloneRegexIds: normalizeStringArray(value.attachedStandaloneRegexIds),
    runtimeSampler: normalizeRuntimeSampler(value.runtimeSampler),
    promptTemplate: normalizePromptTemplate(value.promptTemplate),
    transport: normalizeTransport(value.transport),
    preservedFields: normalizePreservedFields(value.preservedFields),
    passthrough: normalizePresetPassthrough(value.passthrough),
    importWarnings: normalizeStringArray(value.importWarnings),
    createdAt: normalizeString(value.createdAt),
    updatedAt: normalizeString(value.updatedAt),
  }
}

function normalizePresets(value: unknown) {
  if (!isRecord(value)) {
    return {} as PresetCompatLibrary['presets']
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([presetId, preset]) => [presetId, normalizePresetRecord(preset)] as const)
      .filter((entry): entry is readonly [string, PresetCompatPresetRecord] => entry[1] !== null)
  ) as PresetCompatLibrary['presets']
}

function normalizeStandaloneRegexes(value: unknown) {
  if (!isRecord(value)) {
    return {} as PresetCompatLibrary['standaloneRegexes']
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([regexId, regex]) => [regexId, normalizeRegexRecord(regex)] as const)
      .filter((entry): entry is readonly [string, PresetCompatRegexRecord] => entry[1] !== null)
  ) as PresetCompatLibrary['standaloneRegexes']
}

function normalizeSurfaceBinding(value: unknown, fallback: PresetCompatSurfaceBinding): PresetCompatSurfaceBinding {
  if (!isRecord(value)) {
    return fallback
  }

  return {
    surfaceId: fallback.surfaceId,
    presetId: typeof value.presetId === 'string' ? value.presetId : null,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
    failClosed: typeof value.failClosed === 'boolean' ? value.failClosed : fallback.failClosed,
  }
}

function normalizeSurfaceBindings(value: unknown): PresetCompatLibrary['surfaceBindings'] {
  const defaults = createDefaultPresetCompatLibrary().surfaceBindings
  const record = normalizeKnownSurfaceRecord(value)

  return Object.fromEntries(
    Object.entries(defaults).map(([surfaceId, binding]) => [
      surfaceId,
      normalizeSurfaceBinding(record[surfaceId as PresetCompatSurfaceId], binding),
    ])
  ) as PresetCompatLibrary['surfaceBindings']
}

function normalizeBuiltinSystemPrompt(
  value: unknown,
  fallback: PresetCompatBuiltinSystemPrompt
): PresetCompatBuiltinSystemPrompt {
  if (!isRecord(value)) {
    return fallback
  }

  return {
    surfaceId: fallback.surfaceId,
    enabled: normalizeBoolean(value.enabled, fallback.enabled),
    content: normalizeString(value.content, fallback.content),
  }
}

function normalizeBuiltinSystemPrompts(value: unknown): PresetCompatLibrary['builtinSystemPrompts'] {
  const defaults = createDefaultPresetCompatBuiltinSystemPrompts()
  const record = isRecord(value) ? value : {}

  return Object.fromEntries(
    PRESET_COMPAT_CREATIVE_SURFACE_IDS.map((surfaceId) => [
      surfaceId,
      normalizeBuiltinSystemPrompt(record[surfaceId], defaults[surfaceId]),
    ])
  ) as Record<PresetCompatCreativeSurfaceId, PresetCompatBuiltinSystemPrompt>
}

function normalizePresetCompatLibrary(value: unknown): PresetCompatLibrary {
  const defaults = createDefaultPresetCompatLibrary()
  if (!isRecord(value)) {
    return defaults
  }

  const presets = normalizePresets(value.presets)
  const bundledDefaultsVersion = normalizeInteger(value.bundledDefaultsVersion)
  const needsBundledDefaults = bundledDefaultsVersion < PRESET_COMPAT_BUNDLED_DEFAULTS_VERSION
  if (needsBundledDefaults && !presets[RETALE_DEFAULT_PRESET_ID]) {
    presets[RETALE_DEFAULT_PRESET_ID] = createChineseDefaultPreset()
  }

  return {
    schemaVersion: defaults.schemaVersion,
    revision: normalizeInteger(value.revision, defaults.revision),
    bundledDefaultsVersion: Math.max(bundledDefaultsVersion, PRESET_COMPAT_BUNDLED_DEFAULTS_VERSION),
    presets,
    standaloneRegexes: normalizeStandaloneRegexes(value.standaloneRegexes),
    surfaceBindings: normalizeSurfaceBindings(value.surfaceBindings),
    novelRewritePresetIds: isRecord(value.novelRewritePresetIds)
      ? Object.fromEntries(Object.entries(value.novelRewritePresetIds).filter((entry): entry is [string, string | null] => Boolean(entry[0].trim()) && (entry[1] === null || typeof entry[1] === 'string')))
      : {},
    builtinSystemPrompts: normalizeBuiltinSystemPrompts(value.builtinSystemPrompts),
    lastImportedAt: normalizeNullableString(value.lastImportedAt),
    lastExportedAt: normalizeNullableString(value.lastExportedAt),
  }
}

export function loadStoredPresetCompatLibrary(): PresetCompatLibrary {
  const entries = findAppSettings([PRESET_COMPAT_LIBRARY_V1_KEY])
  const map = Object.fromEntries(entries.map((item) => [item.key, item.value])) as Partial<Record<typeof PRESET_COMPAT_LIBRARY_V1_KEY, string>>
  const parsed = parseStoredLibraryBlob(map.PRESET_COMPAT_LIBRARY_V1)
  const library = normalizePresetCompatLibrary(parsed)
  // Invalidate pre-upgrade ETags and stale saves without counting migration as
  // an extra write when a legacy-shaped payload is submitted to the save route.
  if (isRecord(parsed) && normalizeInteger(parsed.bundledDefaultsVersion) < PRESET_COMPAT_BUNDLED_DEFAULTS_VERSION) {
    library.revision += 1
  }
  return library
}

export function bumpPresetCompatLibraryRevision(library: PresetCompatLibrary): PresetCompatLibrary {
  const normalized = normalizePresetCompatLibrary(library)
  return {
    ...normalized,
    revision: normalized.revision + 1,
  }
}

export async function saveStoredPresetCompatLibrary(library: PresetCompatLibrary) {
  const next = bumpPresetCompatLibraryRevision(library)
  await upsertAppSettings([[PRESET_COMPAT_LIBRARY_V1_KEY, JSON.stringify(next)]])
  return next
}

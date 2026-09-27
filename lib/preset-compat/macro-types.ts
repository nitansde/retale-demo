import type {
  PresetCompatFieldStatus,
  PresetCompatStatusReasonCode,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import { PRESET_COMPAT_SURFACE_IDS } from '@/lib/preset-compat/types'

export const PRESET_COMPAT_MACRO_RUNTIME_CAPABILITIES = [
  'supported-runtime',
  'context-partial',
  'preserve-storage-only',
  'unsupported-runtime',
] as const

export const PRESET_COMPAT_MACRO_DIAGNOSTIC_CODES = [
  'UNKNOWN_MACRO',
  'UNSUPPORTED_MACRO',
  'MISSING_CONTEXT_VALUE',
  'MALFORMED_MACRO',
  'INVALID_ARGUMENTS',
  'UNSUPPORTED_RUNTIME_SURFACE',
  'REGEX_MACRO_UNSUPPORTED_MODE',
  'MACRO_CONTEXT_WARNING',
] as const

export type PresetCompatMacroRuntimeCapability =
  (typeof PRESET_COMPAT_MACRO_RUNTIME_CAPABILITIES)[number]

export type PresetCompatMacroDiagnosticCode =
  (typeof PRESET_COMPAT_MACRO_DIAGNOSTIC_CODES)[number]

export type PresetCompatMacroStorageContract = {
  preserveRawTextInStoredPresetPayload: true
  preserveRawTextInExportedPresetPayload: true
  notes: string
}

export type PresetCompatMacroSurfaceContract = {
  capability: PresetCompatMacroRuntimeCapability
  status: PresetCompatFieldStatus
  reason: PresetCompatStatusReasonCode
  diagnostics: readonly PresetCompatMacroDiagnosticCode[]
  notes?: string
}

export type PresetCompatMacroContract = {
  canonicalName: string
  family:
    | 'text-control'
    | 'variables'
    | 'context-values'
    | 'time-random'
    | 'ui-runtime'
    | 'stscript'
  aliases: readonly string[]
  nameMatching: 'case-insensitive'
  storage: PresetCompatMacroStorageContract
  surfaces: Record<PresetCompatSurfaceId, PresetCompatMacroSurfaceContract>
  notes: string
}

function createSurfaceContractMap(params: {
  creative: PresetCompatMacroSurfaceContract
  creativeOverrides?: Partial<Record<PresetCompatSurfaceId, PresetCompatMacroSurfaceContract>>
  analytical?: PresetCompatMacroSurfaceContract
  analyticalOverrides?: Partial<Record<PresetCompatSurfaceId, PresetCompatMacroSurfaceContract>>
}): Record<PresetCompatSurfaceId, PresetCompatMacroSurfaceContract> {
  const creativeOverrides = params.creativeOverrides ?? {}
  const analytical = params.analytical ?? {
    capability: 'unsupported-runtime',
    status: 'degraded',
    reason: 'ANALYTICAL_SURFACE_FAIL_CLOSED',
    diagnostics: ['UNSUPPORTED_RUNTIME_SURFACE'],
    notes: 'Analytical preset-compat surfaces stay fail-closed for macro-bearing prompt content.',
  }
  const analyticalOverrides = params.analyticalOverrides ?? {}

  return Object.fromEntries(
    PRESET_COMPAT_SURFACE_IDS.map((surfaceId) => {
      const isAnalytical = surfaceId === 'future_jump_bridge'
        || surfaceId === 'what_if_delta_extraction'
        || surfaceId === 'knowledge_extraction'
        || surfaceId === 'embeddings'

      const contract = isAnalytical
        ? (analyticalOverrides[surfaceId] ?? analytical)
        : (creativeOverrides[surfaceId] ?? params.creative)

      return [surfaceId, contract]
    })
  ) as Record<PresetCompatSurfaceId, PresetCompatMacroSurfaceContract>
}

const PRESERVED_STORAGE_ONLY_SURFACE_CONTRACT: PresetCompatMacroSurfaceContract = {
  capability: 'preserve-storage-only',
  status: 'preserved',
  reason: 'PRESERVED_EXPORT_ONLY',
  diagnostics: ['MACRO_CONTEXT_WARNING'],
  notes: 'Wave 1 preserves raw macro text for round-trip storage/export but does not execute it yet.',
}

const SUPPORTED_RUNTIME_SURFACE_CONTRACT: PresetCompatMacroSurfaceContract = {
  capability: 'supported-runtime',
  status: 'preserved',
  reason: 'PRESERVED_EXPORT_ONLY',
  diagnostics: ['MALFORMED_MACRO', 'INVALID_ARGUMENTS'],
  notes: 'The capability contract reserves this family for later runtime implementation while preserving raw text today.',
}

const CONTEXT_PARTIAL_SURFACE_CONTRACT: PresetCompatMacroSurfaceContract = {
  capability: 'context-partial',
  status: 'preserved',
  reason: 'PRESERVED_EXPORT_ONLY',
  diagnostics: ['MISSING_CONTEXT_VALUE', 'MACRO_CONTEXT_WARNING'],
  notes: 'This family depends on surface context values that may be absent even on creative routes.',
}

const UNSUPPORTED_RUNTIME_SURFACE_CONTRACT: PresetCompatMacroSurfaceContract = {
  capability: 'unsupported-runtime',
  status: 'unsupported',
  reason: 'UNSUPPORTED_RUNTIME_SURFACE',
  diagnostics: ['UNSUPPORTED_MACRO', 'UNSUPPORTED_RUNTIME_SURFACE'],
  notes: 'This family is explicitly out of scope for ReTale preset-compat runtime execution.',
}

const RAW_MACRO_TEXT_STORAGE_CONTRACT: PresetCompatMacroStorageContract = {
  preserveRawTextInStoredPresetPayload: true,
  preserveRawTextInExportedPresetPayload: true,
  notes: 'Macro-bearing prompt text stays in promptRules[].content and is exported back unchanged.',
}

export const PRESET_COMPAT_MACRO_CAPABILITY_MATRIX = {
  setvar: {
    canonicalName: 'setvar',
    family: 'variables',
    aliases: ['SetVar'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: SUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Variable assignment macros are part of the planned creative-surface macro subset.',
  },
  getvar: {
    canonicalName: 'getvar',
    family: 'variables',
    aliases: ['GetVar'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: SUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Variable lookup macros are part of the planned creative-surface macro subset.',
  },
  trim: {
    canonicalName: 'trim',
    family: 'text-control',
    aliases: ['Trim'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: SUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Whitespace and simple text-control macros are contractually supported on creative surfaces.',
  },
  comment: {
    canonicalName: 'comment',
    family: 'text-control',
    aliases: ['//'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: PRESERVED_STORAGE_ONLY_SURFACE_CONTRACT }),
    notes: 'Comment-style macros are preserved explicitly without claiming runtime parity yet.',
  },
  user: {
    canonicalName: 'user',
    family: 'context-values',
    aliases: ['User'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: CONTEXT_PARTIAL_SURFACE_CONTRACT }),
    notes: 'User-name macros depend on current surface naming context.',
  },
  bot: {
    canonicalName: 'bot',
    family: 'context-values',
    aliases: ['Bot'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: CONTEXT_PARTIAL_SURFACE_CONTRACT }),
    notes: 'Assistant-name macros depend on current surface naming context.',
  },
  char: {
    canonicalName: 'char',
    family: 'context-values',
    aliases: ['charIfNotGroup'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: CONTEXT_PARTIAL_SURFACE_CONTRACT }),
    notes: 'Character naming aliases stay metadata-only for now because upstream alias semantics are ambiguous.',
  },
  input: {
    canonicalName: 'input',
    family: 'ui-runtime',
    aliases: ['Input'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Interactive UI/runtime macros are explicitly unsupported in ReTale preset-compat.',
  },
  outlet: {
    canonicalName: 'outlet',
    family: 'ui-runtime',
    aliases: [],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Extension outlet macros are explicitly unsupported in ReTale preset-compat.',
  },
  banned: {
    canonicalName: 'banned',
    family: 'ui-runtime',
    aliases: [],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Live UI state macros are explicitly unsupported in ReTale preset-compat.',
  },
  summary: {
    canonicalName: 'summary',
    family: 'ui-runtime',
    aliases: [],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Summary/runtime-history macros are explicitly unsupported in ReTale preset-compat.',
  },
  hasExtension: {
    canonicalName: 'hasExtension',
    family: 'ui-runtime',
    aliases: ['hasextension'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Extension presence macros are explicitly unsupported in ReTale preset-compat.',
  },
  lastGenerationType: {
    canonicalName: 'lastGenerationType',
    family: 'ui-runtime',
    aliases: ['lastgenerationtype'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'Live generation-state macros are explicitly unsupported in ReTale preset-compat.',
  },
  var: {
    canonicalName: 'var',
    family: 'stscript',
    aliases: [],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'STscript execution-context macros are explicitly unsupported in ReTale preset-compat.',
  },
  pipe: {
    canonicalName: 'pipe',
    family: 'stscript',
    aliases: [],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'STscript execution-context macros are explicitly unsupported in ReTale preset-compat.',
  },
  timesIndex: {
    canonicalName: 'timesIndex',
    family: 'stscript',
    aliases: ['timesindex'],
    nameMatching: 'case-insensitive',
    storage: RAW_MACRO_TEXT_STORAGE_CONTRACT,
    surfaces: createSurfaceContractMap({ creative: UNSUPPORTED_RUNTIME_SURFACE_CONTRACT }),
    notes: 'STscript loop-context macros are explicitly unsupported in ReTale preset-compat.',
  },
} as const satisfies Record<string, PresetCompatMacroContract>

export const PRESET_COMPAT_MACRO_FIELD_FAMILY_LINKS = {
  'macro.setvar': ['setvar'],
  'macro.getvar': ['getvar'],
  'macro.trim': ['trim'],
  'macro.comment': ['comment'],
  'macro.user_bot_variable': ['user', 'bot', 'char'],
} as const satisfies Record<string, readonly string[]>

export const PRESET_COMPAT_MACRO_ALIAS_MAP = Object.fromEntries(
  Object.values(PRESET_COMPAT_MACRO_CAPABILITY_MATRIX).flatMap((contract) => [
    [contract.canonicalName, contract.canonicalName],
    ...contract.aliases.map((alias) => [alias, contract.canonicalName]),
  ])
) as Record<string, keyof typeof PRESET_COMPAT_MACRO_CAPABILITY_MATRIX>

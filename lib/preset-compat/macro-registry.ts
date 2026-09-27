import {
  PRESET_COMPAT_MACRO_ALIAS_MAP,
  PRESET_COMPAT_MACRO_CAPABILITY_MATRIX,
  type PresetCompatMacroContract,
} from '@/lib/preset-compat/macro-types'
import type {
  PresetCompatMacroContext,
  PresetCompatMacroInvocationLike,
  PresetCompatMacroNodeLike,
} from '@/lib/preset-compat/macro-context'

export type PresetCompatMacroEvaluationMode = 'eager' | 'deferred'

export type PresetCompatMacroEvaluateParams = {
  context: PresetCompatMacroContext
  invocation: PresetCompatMacroInvocationLike
  registry: PresetCompatMacroRegistry
  rawArguments: readonly PresetCompatMacroNodeLike[]
  resolvedArguments?: readonly string[]
  rawBranches: readonly PresetCompatMacroNodeLike[]
  resolvedBranches?: readonly string[]
}

export type PresetCompatRegisteredMacro = {
  canonicalName: string
  aliases: readonly string[]
  supported: boolean
  argumentEvaluation: PresetCompatMacroEvaluationMode
  branchEvaluation: PresetCompatMacroEvaluationMode
  contract?: PresetCompatMacroContract
  evaluate: (params: PresetCompatMacroEvaluateParams) => string
}

export type CreatePresetCompatRegisteredMacroOptions = {
  name: string
  aliases?: readonly string[]
  supported?: boolean
  argumentEvaluation?: PresetCompatMacroEvaluationMode
  branchEvaluation?: PresetCompatMacroEvaluationMode
  evaluate: PresetCompatRegisteredMacro['evaluate']
}

export type PresetCompatMacroRegistry = {
  get: (name: string) => PresetCompatRegisteredMacro | null
  has: (name: string) => boolean
  list: () => PresetCompatRegisteredMacro[]
}

function normalizeMacroName(name: string) {
  return name.trim().toLowerCase()
}

function getMacroContract(name: string) {
  const aliasMatch = PRESET_COMPAT_MACRO_ALIAS_MAP[name as keyof typeof PRESET_COMPAT_MACRO_ALIAS_MAP]
  if (aliasMatch) {
    return PRESET_COMPAT_MACRO_CAPABILITY_MATRIX[aliasMatch]
  }

  const normalizedName = normalizeMacroName(name)

  for (const contract of Object.values(PRESET_COMPAT_MACRO_CAPABILITY_MATRIX)) {
    if (normalizeMacroName(contract.canonicalName) === normalizedName) {
      return contract
    }

    if (contract.aliases.some((alias) => normalizeMacroName(alias) === normalizedName)) {
      return contract
    }
  }

  return null
}

function createUnsupportedPlaceholder(contract: PresetCompatMacroContract): PresetCompatRegisteredMacro {
  return {
    canonicalName: contract.canonicalName,
    aliases: contract.aliases,
    supported: false,
    argumentEvaluation: 'eager',
    branchEvaluation: 'eager',
    contract,
    evaluate: () => '',
  }
}

export function createPresetCompatRegisteredMacro(
  options: CreatePresetCompatRegisteredMacroOptions,
): PresetCompatRegisteredMacro {
  const contract = getMacroContract(options.name) ?? undefined

  return {
    canonicalName: contract?.canonicalName ?? options.name,
    aliases: [...(contract?.aliases ?? []), ...(options.aliases ?? [])],
    supported: options.supported ?? true,
    argumentEvaluation: options.argumentEvaluation ?? 'eager',
    branchEvaluation: options.branchEvaluation ?? 'eager',
    contract,
    evaluate: options.evaluate,
  }
}

export function createPresetCompatMacroRegistry(
  entries: readonly PresetCompatRegisteredMacro[],
): PresetCompatMacroRegistry {
  const byName = new Map<string, PresetCompatRegisteredMacro>()
  const orderedEntries = [...entries]

  for (const entry of orderedEntries) {
    const names = [entry.canonicalName, ...entry.aliases]
    for (const name of names) {
      byName.set(normalizeMacroName(name), entry)
    }
  }

  return {
    get(name) {
      const directMatch = byName.get(normalizeMacroName(name))
      if (directMatch) {
        return directMatch
      }

      const contract = getMacroContract(name)
      return contract ? createUnsupportedPlaceholder(contract) : null
    },
    has(name) {
      return this.get(name) !== null
    },
    list() {
      return [...orderedEntries]
    },
  }
}

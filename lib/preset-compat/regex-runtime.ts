import { getRegexExportMeta } from '@/lib/preset-compat/normalize'
import type { PresetCompatMacroDiagnostic } from '@/lib/preset-compat/macro-context'
import {
  processPresetCompatMacroString,
  type ProcessPresetCompatMacroOptions,
} from '@/lib/preset-compat/macro-processor'
import type { PresetCompatRegexPlacement, PresetCompatRegexRecord } from '@/lib/preset-compat/types'

export const PRESET_COMPAT_REGEX_RUNTIME_MAX_ACTIVE_RULES = 100
export const PRESET_COMPAT_REGEX_RUNTIME_MAX_INPUT_LENGTH = 200000
export type PresetCompatRegexRuntimePhase = 'user_input' | 'assistant_output'

export type PresetCompatRegexRuntimeOptions = {
  value: string
  phase: PresetCompatRegexRuntimePhase
  standalone: readonly PresetCompatRegexRecord[]
  embedded: readonly PresetCompatRegexRecord[]
  depth?: number | null
  isPrompt?: boolean
  isMarkdown?: boolean
  isEdit?: boolean
  macroProcessor?: ProcessPresetCompatMacroOptions | null
}

export type PresetCompatRegexRuntimeResult = {
  value: string
  warnings: string[]
  appliedRuleIds: string[]
  skippedRuleIds: string[]
}

type ReplacementGroups = Record<string, string | undefined>

function shouldRunForPhase(rule: PresetCompatRegexRecord, phase: PresetCompatRegexRuntimePhase) {
  return rule.placements.includes(phase)
}

function mergeGlobalFlags(flags: string) {
  return flags.includes('g') ? flags : `${flags}g`
}

function splitRegexLiteral(source: string) {
  if (!source.startsWith('/')) {
    return null
  }

  for (let index = source.length - 1; index > 0; index -= 1) {
    if (source[index] !== '/') {
      continue
    }

    let backslashCount = 0
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
      backslashCount += 1
    }

    if (backslashCount % 2 === 1) {
      continue
    }

    return {
      pattern: source.slice(1, index),
      flags: source.slice(index + 1),
    }
  }

  return null
}

function compileRuleRegex(rule: PresetCompatRegexRecord) {
  const literal = splitRegexLiteral(rule.pattern)
  if (literal) {
    return new RegExp(literal.pattern, literal.flags)
  }

  return new RegExp(rule.pattern, mergeGlobalFlags(rule.flags))
}

function filterTrimStrings(value: string, trimStrings: readonly string[]) {
  let filteredValue = value
  for (const trimString of trimStrings) {
    if (!trimString) {
      continue
    }

    filteredValue = filteredValue.replaceAll(trimString, '')
  }
  return filteredValue
}

function applyReplacementTemplate(
  template: string,
  match: string,
  captures: string[],
  groups: ReplacementGroups,
  trimStrings: readonly string[]
) {
  return template
    .replaceAll(/{{match}}/gi, '$0')
    .replace(/\$0|\$(\d+)|\$<([^>]+)>/g, (token, captureIndex, groupName) => {
      let selectedValue: string | undefined

      if (token === '$0') {
        selectedValue = match
      } else if (captureIndex) {
        selectedValue = captures[Number(captureIndex) - 1]
      } else if (groupName) {
        selectedValue = groups[groupName]
      }

      return typeof selectedValue === 'string'
        ? filterTrimStrings(selectedValue, trimStrings)
        : ''
    })
}

function shouldRunPromptMode(rule: PresetCompatRegexRecord, isPrompt: boolean, isMarkdown: boolean) {
  return (rule.markdownOnly && isMarkdown)
    || (rule.promptOnly && isPrompt)
    || (!rule.markdownOnly && !rule.promptOnly && !isMarkdown && !isPrompt)
}

function isDepthAllowed(rule: PresetCompatRegexRecord, depth: number | null) {
  if (typeof depth !== 'number') {
    return true
  }

  if (typeof rule.minDepth === 'number' && rule.minDepth >= -1 && depth < rule.minDepth) {
    return false
  }

  if (typeof rule.maxDepth === 'number' && rule.maxDepth >= 0 && depth > rule.maxDepth) {
    return false
  }

  return true
}

function getEffectiveSubstituteRegex(rule: PresetCompatRegexRecord) {
  const preservedValue = getRegexExportMeta(rule).substituteRegex
  if (typeof preservedValue === 'number' && Number.isFinite(preservedValue)) {
    return preservedValue
  }

  if (typeof preservedValue === 'string' && preservedValue.trim()) {
    const parsedValue = Number(preservedValue)
    if (!Number.isNaN(parsedValue)) {
      return parsedValue
    }
  }

  if (typeof rule.substituteRegex === 'string' && rule.substituteRegex.trim()) {
    const parsedValue = Number(rule.substituteRegex)
    if (!Number.isNaN(parsedValue)) {
      return parsedValue
    }
    return 1
  }

  return 0
}

function getUnsupportedPlacementNames(rule: PresetCompatRegexRecord) {
  const unsupportedPlacements: PresetCompatRegexPlacement[] = []
  for (const placement of rule.placements) {
    if (placement !== 'user_input' && placement !== 'assistant_output') {
      unsupportedPlacements.push(placement)
    }
  }
  return unsupportedPlacements
}

function getOrderedRules(options: Pick<PresetCompatRegexRuntimeOptions, 'standalone' | 'embedded'>) {
  return [...options.standalone, ...options.embedded]
}

function formatReplacementMacroDiagnostic(ruleId: string, diagnostic: PresetCompatMacroDiagnostic) {
  return `Rule ${ruleId} replacement macro diagnostic [${diagnostic.code}]: ${diagnostic.message}`
}

function formatUnsupportedRegexMacroModeWarning(ruleId: string, substituteRegex: number) {
  return `Rule ${ruleId} replacement macro diagnostic [REGEX_MACRO_UNSUPPORTED_MODE]: substituteRegex=${substituteRegex} is not supported for replacement-time macro substitution.`
}

function resolveReplacementMacros(
  rule: PresetCompatRegexRecord,
  replacement: string,
  macroProcessor: ProcessPresetCompatMacroOptions,
  warnings: string[],
) {
  const diagnosticsStart = macroProcessor.context.diagnostics.length
  const nextReplacement = processPresetCompatMacroString(replacement, macroProcessor)

  for (const diagnostic of macroProcessor.context.diagnostics.slice(diagnosticsStart)) {
    warnings.push(formatReplacementMacroDiagnostic(rule.id, diagnostic))
  }

  return nextReplacement
}

export function runPresetCompatRegexRuntime(options: PresetCompatRegexRuntimeOptions): PresetCompatRegexRuntimeResult {
  const warnings: string[] = []
  const appliedRuleIds: string[] = []
  const skippedRuleIds: string[] = []
  const orderedRules = getOrderedRules(options)
  const depth = typeof options.depth === 'number' ? options.depth : null
  const isPrompt = options.isPrompt === true
  const isMarkdown = options.isMarkdown === true
  const isEdit = options.isEdit === true

  const phaseRules = orderedRules.filter((rule) => shouldRunForPhase(rule, options.phase) && !rule.disabled)

  if (options.value.length > PRESET_COMPAT_REGEX_RUNTIME_MAX_INPUT_LENGTH) {
    warnings.push(
      `Skipped preset-compat regex runtime for ${options.phase} because input length ${options.value.length} exceeds ${PRESET_COMPAT_REGEX_RUNTIME_MAX_INPUT_LENGTH} characters.`
    )
    return {
      value: options.value,
      warnings,
      appliedRuleIds,
      skippedRuleIds: phaseRules.map((rule) => rule.id),
    }
  }

  const activeRules = phaseRules.slice(0, PRESET_COMPAT_REGEX_RUNTIME_MAX_ACTIVE_RULES)
  const overflowRules = phaseRules.slice(PRESET_COMPAT_REGEX_RUNTIME_MAX_ACTIVE_RULES)
  if (overflowRules.length > 0) {
    warnings.push(
      `Skipped ${overflowRules.length} preset-compat regex rule(s) for ${options.phase} after reaching the ${PRESET_COMPAT_REGEX_RUNTIME_MAX_ACTIVE_RULES}-rule limit.`
    )
    skippedRuleIds.push(...overflowRules.map((rule) => rule.id))
  }

  let nextValue = options.value

  for (const rule of activeRules) {
    const unsupportedPlacements = getUnsupportedPlacementNames(rule)
    if (unsupportedPlacements.length > 0) {
      warnings.push(
        `Rule ${rule.id} preserves unsupported placements (${unsupportedPlacements.join(', ')}) which are not executed by the MVP runtime.`
      )
    }

    if (!shouldRunPromptMode(rule, isPrompt, isMarkdown)) {
      skippedRuleIds.push(rule.id)
      continue
    }

    if (!isDepthAllowed(rule, depth)) {
      skippedRuleIds.push(rule.id)
      continue
    }

    if (isEdit && !rule.runOnEdit) {
      skippedRuleIds.push(rule.id)
      continue
    }

    const substituteRegex = getEffectiveSubstituteRegex(rule)
    if (substituteRegex !== 0) {
      if (substituteRegex === 1 && options.macroProcessor) {
        // Supported below via replacement-time macro evaluation.
      } else if (options.macroProcessor) {
        warnings.push(formatUnsupportedRegexMacroModeWarning(rule.id, substituteRegex))
        skippedRuleIds.push(rule.id)
        continue
      } else {
      warnings.push(
        `Skipped rule ${rule.id} because substituteRegex=${substituteRegex} is outside the MVP runtime subset.`
      )
      skippedRuleIds.push(rule.id)
      continue
      }
    }

    let compiledRegex: RegExp
    try {
      compiledRegex = compileRuleRegex(rule)
    } catch {
      warnings.push(`Skipped rule ${rule.id} because its regex source could not be compiled.`)
      skippedRuleIds.push(rule.id)
      continue
    }

    nextValue = nextValue.replace(compiledRegex, (match, ...args) => {
      const groupsValue = args.at(-1)
      const maybeNamedGroups = typeof groupsValue === 'object' && groupsValue !== null && !Array.isArray(groupsValue)
        ? groupsValue as ReplacementGroups
        : {}
      const captures = args.slice(0, maybeNamedGroups === groupsValue ? -3 : -2)
      const resolvedReplacement = applyReplacementTemplate(
        rule.replacement,
        match,
        captures,
        maybeNamedGroups,
        rule.trimStrings,
      )

      if (substituteRegex === 1 && options.macroProcessor) {
        return resolveReplacementMacros(rule, resolvedReplacement, options.macroProcessor, warnings)
      }

      return resolvedReplacement
    })
    appliedRuleIds.push(rule.id)
  }

  return {
    value: nextValue,
    warnings,
    appliedRuleIds,
    skippedRuleIds,
  }
}

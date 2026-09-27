import type {
  PresetCompatPromptRuleRuntimeContext,
  PresetCompatRegexRecord,
  PresetCompatSurfaceId,
} from '@/lib/preset-compat/types'
import {
  assemblePresetCompatRuntimePrompts,
  type PresetCompatPromptAssemblyMetadata,
} from '@/lib/preset-compat/prompt-assembly'
import { runPresetCompatRegexRuntime } from '@/lib/preset-compat/regex-runtime'
import {
  resolvePresetCompatRuntime,
  type PresetCompatResolvedRuntime,
  type PresetCompatRuntimeProviderDefaults,
} from '@/lib/preset-compat/resolve-runtime'
import {
  createPresetCompatRuntimeMacroProcessing,
  type PresetCompatRuntimeMetadata,
} from '@/lib/preset-compat/runtime-integration'
import { loadStoredPresetCompatLibrary } from '@/lib/server/preset-compat-library'
import { withNovelRewritePreset } from '@/lib/preset-compat/novel-preset'

export type PresetCompatCreativeRuntime = {
  resolvedRuntime: PresetCompatResolvedRuntime
  systemPrompt: string
  userPrompt: string
  warnings: string[]
  promptAssembly: PresetCompatPromptAssemblyMetadata
  metadata: PresetCompatRuntimeMetadata
  hasActiveOutputRegex: boolean
  applyOutputRuntime: (value: string) => {
    value: string
    warnings: string[]
    appliedRuleIds: string[]
    skippedRuleIds: string[]
  }
}

function hasActiveAssistantOutputRegex(rules: readonly PresetCompatRegexRecord[]) {
  return rules.some((rule) => {
    if (rule.disabled || rule.promptOnly || rule.markdownOnly) {
      return false
    }

    if (!rule.placements.includes('assistant_output')) {
      return false
    }

    const substituteRegex = String(rule.substituteRegex ?? '').trim()
    return !substituteRegex || substituteRegex === '0'
  })
}

export function applyPresetCompatCreativeRuntime(params: {
  surfaceId: PresetCompatSurfaceId
  novelId?: string | null
  providerDefaults: PresetCompatRuntimeProviderDefaults
  systemPrompt: string
  userPrompt: string
  promptRuleRuntimeContext?: PresetCompatPromptRuleRuntimeContext
}) : PresetCompatCreativeRuntime {
  const library = withNovelRewritePreset(loadStoredPresetCompatLibrary(), params.novelId)
  const resolvedRuntime = resolvePresetCompatRuntime({
    library,
    surfaceId: params.surfaceId,
    providerDefaults: params.providerDefaults,
    promptRuleRuntimeContext: params.promptRuleRuntimeContext,
  })

  const standalone = resolvedRuntime.activePreset
    ? resolvedRuntime.activePreset.attachedStandaloneRegexIds
        .map((regexId) => library.standaloneRegexes[regexId])
        .filter((regex): regex is PresetCompatRegexRecord => Boolean(regex))
    : []
  const embedded = resolvedRuntime.activePreset?.embeddedRegexes ?? []
  const macroProcessing = createPresetCompatRuntimeMacroProcessing({
    surfaceId: params.surfaceId,
    resolvedRuntime,
    runtimeContext: params.promptRuleRuntimeContext,
  })
  const assembledPrompts = assemblePresetCompatRuntimePrompts({
    surfaceId: params.surfaceId,
    resolvedRuntime,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    macroProcessing,
    surfaceContextBlocks: params.promptRuleRuntimeContext?.surfaceContextBlocks?.map((block) => ({
      id: block.id,
      content: block.content,
      abstraction: block.abstraction,
    })),
  })
  const inputRuntime = runPresetCompatRegexRuntime({
    value: assembledPrompts.userPromptBeforeRegex,
    phase: 'user_input',
    standalone,
    embedded,
    isPrompt: true,
    macroProcessor: macroProcessing,
  })

  return {
    resolvedRuntime,
    systemPrompt: assembledPrompts.systemPrompt,
    userPrompt: inputRuntime.value,
    warnings: [...resolvedRuntime.warnings, ...inputRuntime.warnings],
    promptAssembly: {
      ...assembledPrompts.promptAssembly,
      user: {
        ...assembledPrompts.promptAssembly.user,
        stages: assembledPrompts.promptAssembly.user.stages.map((stage) => stage.stage === 'regex_processing'
          ? {
              stage: 'regex_processing',
              status: 'applied',
              segmentCount: inputRuntime.appliedRuleIds.length + inputRuntime.skippedRuleIds.length,
            }
          : stage),
      },
    },
    metadata: assembledPrompts.metadata,
    hasActiveOutputRegex: hasActiveAssistantOutputRegex([...standalone, ...embedded]),
    applyOutputRuntime(value: string) {
      return runPresetCompatRegexRuntime({
        value,
        phase: 'assistant_output',
        standalone,
        embedded,
      })
    },
  }
}

import { assemblePresetCompatRuntimePrompts } from '@/lib/preset-compat/prompt-assembly'
import { runPresetCompatRegexRuntime } from '@/lib/preset-compat/regex-runtime'
import {
  createPresetCompatRuntimeMacroProcessing,
  type PresetCompatRuntimeMetadata,
} from '@/lib/preset-compat/runtime-integration'
import type { PresetCompatResolvedRuntime } from '@/lib/preset-compat/resolve-runtime'
import type { PresetCompatRegexRecord, PresetCompatSurfaceId } from '@/lib/preset-compat/types'

export type PresetCompatCreativeRuntimePreview = {
  systemPrompt: string
  userPrompt: string
  warnings: string[]
  metadata: PresetCompatRuntimeMetadata
}

export function buildPresetCompatCreativeRuntimePreview(params: {
  surfaceId: PresetCompatSurfaceId
  resolvedRuntime: PresetCompatResolvedRuntime
  systemPrompt: string
  userPrompt: string
  standalone: readonly PresetCompatRegexRecord[]
  embedded: readonly PresetCompatRegexRecord[]
}) : PresetCompatCreativeRuntimePreview {
  const macroProcessing = createPresetCompatRuntimeMacroProcessing({
    surfaceId: params.surfaceId,
    resolvedRuntime: params.resolvedRuntime,
  })
  const assembledPrompts = assemblePresetCompatRuntimePrompts({
    surfaceId: params.surfaceId,
    resolvedRuntime: params.resolvedRuntime,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
    macroProcessing,
  })
  const inputRuntime = runPresetCompatRegexRuntime({
    value: assembledPrompts.userPrompt,
    phase: 'user_input',
    standalone: params.standalone,
    embedded: params.embedded,
    isPrompt: true,
    macroProcessor: macroProcessing,
  })

  return {
    systemPrompt: assembledPrompts.systemPrompt,
    userPrompt: inputRuntime.value,
    warnings: [...params.resolvedRuntime.warnings, ...inputRuntime.warnings],
    metadata: assembledPrompts.metadata,
  }
}

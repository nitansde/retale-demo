import { processPresetCompatMacroString } from '@/lib/preset-compat/macro-processor'
import type { PresetCompatResolvedRuntime } from '@/lib/preset-compat/resolve-runtime'
import {
  createPresetCompatRuntimeMacroProcessing,
  createPresetCompatRuntimeMetadata,
  type PresetCompatRuntimeMacroProcessing,
  type PresetCompatRuntimeMetadata,
} from '@/lib/preset-compat/runtime-integration'
import type { PresetCompatSurfaceId } from '@/lib/preset-compat/types'

export const PRESET_COMPAT_PROMPT_ASSEMBLY_STAGE_ORDER = [
  'builtin_system_prompt',
  'base_prompt',
  'template_fragments',
  'imported_prompt_rules',
  'metadata_insertions',
  'regex_processing',
] as const

export type PresetCompatPromptAssemblyStage = (typeof PRESET_COMPAT_PROMPT_ASSEMBLY_STAGE_ORDER)[number]
export type PresetCompatPromptAssemblyChannel = 'system' | 'user'
export type PresetCompatPromptAssemblyPlacement = 'prepend' | 'append'

export type PresetCompatPromptAssemblyContextBlock = {
  id: string
  content: string
  abstraction?: 'world_info' | 'scenario' | 'personality' | 'named_transcript'
}

export type PresetCompatPromptAssemblyContextBlockFormat = {
  field: 'wi_format' | 'scenario_format' | 'personality_format'
  format: string
  blockIds: string[]
}

export type PresetCompatPromptAssemblyNamesBehavior = {
  mode: number
  kind: 'chat' | 'roleplay'
  userName: string
  assistantName: string
}

export type PresetCompatPromptAssemblyImportedRule = {
  channel: PresetCompatPromptAssemblyChannel
  placement: PresetCompatPromptAssemblyPlacement
  text: string
}

export type PresetCompatPromptAssemblySegment = {
  channel: PresetCompatPromptAssemblyChannel
  stage: Exclude<PresetCompatPromptAssemblyStage, 'regex_processing'>
  placement: PresetCompatPromptAssemblyPlacement
  text: string
}

export type PresetCompatPromptAssemblyStageStatus = {
  stage: PresetCompatPromptAssemblyStage
  status: 'applied' | 'empty' | 'pending'
  segmentCount: number
}

export type PresetCompatPromptAssemblyMetadata = {
  stageOrder: readonly PresetCompatPromptAssemblyStage[]
  system: {
    segments: PresetCompatPromptAssemblySegment[]
    stages: PresetCompatPromptAssemblyStageStatus[]
  }
  user: {
    segments: PresetCompatPromptAssemblySegment[]
    stages: PresetCompatPromptAssemblyStageStatus[]
  }
}

export type PresetCompatPromptAssemblyResult = {
  systemPrompt: string
  userPromptBeforeRegex: string
  metadata: PresetCompatPromptAssemblyMetadata
}

export type PresetCompatRuntimePromptAssemblyResult = {
  systemPrompt: string
  userPrompt: string
  userPromptBeforeRegex: string
  promptAssembly: PresetCompatPromptAssemblyMetadata
  metadata: PresetCompatRuntimeMetadata
}

type PresetCompatPromptAssemblyParams = {
  builtinSystemPrompt?: string | null
  baseSystemPrompt: string
  baseUserPrompt: string
  systemTemplateFragments?: readonly string[]
  userTemplateFragments?: readonly string[]
  importedPromptRules?: readonly PresetCompatPromptAssemblyImportedRule[]
  importedSystemRuleContents?: readonly string[]
  importedUserRuleContents?: readonly string[]
  systemMetadataInsertions?: readonly string[]
  userMetadataInsertions?: readonly string[]
  surfaceContextBlocks?: readonly PresetCompatPromptAssemblyContextBlock[]
  contextBlockFormats?: readonly PresetCompatPromptAssemblyContextBlockFormat[]
  namesBehavior?: PresetCompatPromptAssemblyNamesBehavior | null
}

function normalizeText(value: string) {
  return value.trim()
}

function normalizeTexts(values: readonly string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean)
}

function buildImportedRulesSection(contents: readonly string[]) {
  return contents.map((content) => content.trim()).filter(Boolean).join('\n\n')
}

function appendSegment(
  segments: PresetCompatPromptAssemblySegment[],
  channel: PresetCompatPromptAssemblyChannel,
  stage: Exclude<PresetCompatPromptAssemblyStage, 'regex_processing'>,
  placement: PresetCompatPromptAssemblyPlacement,
  text: string,
) {
  const trimmedText = normalizeText(text)
  if (!trimmedText) {
    return
  }

  segments.push({
    channel,
    stage,
    placement,
    text: trimmedText,
  })
}

function buildChannelStages(segments: readonly PresetCompatPromptAssemblySegment[]) {
  return PRESET_COMPAT_PROMPT_ASSEMBLY_STAGE_ORDER.map((stage) => {
    if (stage === 'regex_processing') {
      return {
        stage,
        status: 'pending',
        segmentCount: 0,
      } satisfies PresetCompatPromptAssemblyStageStatus
    }

    const segmentCount = segments.filter((segment) => segment.stage === stage).length
    return {
      stage,
      status: segmentCount > 0 ? 'applied' : 'empty',
      segmentCount,
    } satisfies PresetCompatPromptAssemblyStageStatus
  })
}

function finalizeSegments(segments: readonly PresetCompatPromptAssemblySegment[]) {
  const prepended = segments.filter((segment) => segment.placement === 'prepend').map((segment) => segment.text)
  const appended = segments.filter((segment) => segment.placement === 'append').map((segment) => segment.text)
  return [...prepended, ...appended].join('\n\n')
}

function applyFirstReplacement(value: string, search: string, replacement: string) {
  const index = value.indexOf(search)
  if (index === -1) {
    return value
  }

  return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`
}

function applyFormatTemplate(format: string, content: string) {
  const replacements = [
    '{0}',
    '{{scenario}}',
    '{{personality}}',
    '{{wi}}',
    '{{world}}',
    '{{world_info}}',
  ]

  let next = format
  let replaced = false
  for (const token of replacements) {
    if (!next.includes(token)) {
      continue
    }
    next = next.split(token).join(content)
    replaced = true
  }

  return replaced ? next.trim() : [format.trim(), content].filter(Boolean).join('\n')
}

function applyNamesBehaviorToContent(content: string, namesBehavior: PresetCompatPromptAssemblyNamesBehavior | null | undefined) {
  if (!namesBehavior) {
    return content
  }

  return content
    .replaceAll(/^USER:/gm, `${namesBehavior.userName}:`)
    .replaceAll(/^ASSISTANT:/gm, `${namesBehavior.assistantName}:`)
}

function applyUserMetadataTransforms(params: {
  baseUserPrompt: string
  surfaceContextBlocks: readonly PresetCompatPromptAssemblyContextBlock[]
  contextBlockFormats: readonly PresetCompatPromptAssemblyContextBlockFormat[]
  namesBehavior: PresetCompatPromptAssemblyNamesBehavior | null | undefined
}) {
  const blockById = new Map(params.surfaceContextBlocks.map((block) => [block.id, block]))
  let nextPrompt = params.baseUserPrompt

  for (const directive of params.contextBlockFormats) {
    for (const blockId of directive.blockIds) {
      const block = blockById.get(blockId)
      if (!block) {
        continue
      }

      nextPrompt = applyFirstReplacement(nextPrompt, block.content, applyFormatTemplate(directive.format, block.content))
    }
  }

  const namedTranscriptBlocks = params.surfaceContextBlocks.filter((block) => block.abstraction === 'named_transcript')
  for (const block of namedTranscriptBlocks) {
    const transformed = applyNamesBehaviorToContent(block.content, params.namesBehavior)
    if (transformed === block.content) {
      continue
    }
    nextPrompt = applyFirstReplacement(nextPrompt, block.content, transformed)
  }

  return nextPrompt
}

function appendStructuredImportedRuleSections(
  segments: PresetCompatPromptAssemblySegment[],
  channel: PresetCompatPromptAssemblyChannel,
  rules: readonly PresetCompatPromptAssemblyImportedRule[]
) {
  for (const placement of ['prepend', 'append'] as const) {
    const contents = rules
      .filter((rule) => rule.channel === channel && rule.placement === placement)
      .map((rule) => rule.text)

    appendSegment(
      segments,
      channel,
      'imported_prompt_rules',
      placement,
      buildImportedRulesSection(normalizeTexts(contents))
    )
  }
}

export function assemblePresetCompatPrompts(params: PresetCompatPromptAssemblyParams): PresetCompatPromptAssemblyResult {
  const systemSegments: PresetCompatPromptAssemblySegment[] = []
  const userSegments: PresetCompatPromptAssemblySegment[] = []

  const baseUserPrompt = applyUserMetadataTransforms({
    baseUserPrompt: params.baseUserPrompt,
    surfaceContextBlocks: params.surfaceContextBlocks ?? [],
    contextBlockFormats: params.contextBlockFormats ?? [],
    namesBehavior: params.namesBehavior,
  })

  const structuredSystemRuleCount = (params.importedPromptRules ?? []).filter((rule) => rule.channel === 'system' && rule.text.trim()).length
  const fallbackSystemRuleCount = normalizeTexts(params.importedSystemRuleContents).length
  const hasImportedSystemRules = structuredSystemRuleCount > 0 || fallbackSystemRuleCount > 0

  appendSegment(systemSegments, 'system', 'builtin_system_prompt', 'prepend', params.builtinSystemPrompt ?? '')

  if (!hasImportedSystemRules) {
    appendSegment(systemSegments, 'system', 'base_prompt', 'append', params.baseSystemPrompt)
  }
  appendSegment(userSegments, 'user', 'base_prompt', 'append', baseUserPrompt)

  for (const fragment of normalizeTexts(params.systemTemplateFragments)) {
    appendSegment(systemSegments, 'system', 'template_fragments', 'append', fragment)
  }
  for (const fragment of normalizeTexts(params.userTemplateFragments)) {
    appendSegment(userSegments, 'user', 'template_fragments', 'append', fragment)
  }

  if (params.importedPromptRules && params.importedPromptRules.length > 0) {
    appendStructuredImportedRuleSections(
      systemSegments,
      'system',
      params.importedPromptRules
    )
    appendStructuredImportedRuleSections(
      userSegments,
      'user',
      params.importedPromptRules
    )
  } else {
    appendSegment(
      systemSegments,
      'system',
      'imported_prompt_rules',
      'append',
      buildImportedRulesSection(normalizeTexts(params.importedSystemRuleContents))
    )
    appendSegment(
      userSegments,
      'user',
      'imported_prompt_rules',
      'prepend',
      buildImportedRulesSection(normalizeTexts(params.importedUserRuleContents))
    )
  }

  for (const insertion of normalizeTexts(params.systemMetadataInsertions)) {
    appendSegment(systemSegments, 'system', 'metadata_insertions', 'append', insertion)
  }
  for (const insertion of normalizeTexts(params.userMetadataInsertions)) {
    appendSegment(userSegments, 'user', 'metadata_insertions', 'append', insertion)
  }

  return {
    systemPrompt: finalizeSegments(systemSegments),
    userPromptBeforeRegex: finalizeSegments(userSegments),
    metadata: {
      stageOrder: PRESET_COMPAT_PROMPT_ASSEMBLY_STAGE_ORDER,
      system: {
        segments: systemSegments,
        stages: buildChannelStages(systemSegments),
      },
      user: {
        segments: userSegments,
        stages: buildChannelStages(userSegments),
      },
    },
  }
}

export function assemblePresetCompatRuntimePrompts(params: {
  surfaceId: PresetCompatSurfaceId
  resolvedRuntime: PresetCompatResolvedRuntime
  systemPrompt: string
  userPrompt: string
  surfaceContextBlocks?: readonly PresetCompatPromptAssemblyContextBlock[]
  macroProcessing?: PresetCompatRuntimeMacroProcessing
}) : PresetCompatRuntimePromptAssemblyResult {
  const macroProcessing = params.macroProcessing ?? createPresetCompatRuntimeMacroProcessing({
    surfaceId: params.surfaceId,
    resolvedRuntime: params.resolvedRuntime,
  })
  const promptAssembly = assemblePresetCompatPrompts({
    baseSystemPrompt: params.systemPrompt,
    baseUserPrompt: params.userPrompt,
    systemTemplateFragments: params.resolvedRuntime.templateFragments.system.map((fragment) => fragment.text),
    userTemplateFragments: params.resolvedRuntime.templateFragments.user.map((fragment) => fragment.text),
    builtinSystemPrompt: params.resolvedRuntime.builtinSystemPrompt,
    surfaceContextBlocks: params.surfaceContextBlocks,
    contextBlockFormats: params.resolvedRuntime.contextBlockFormats,
    namesBehavior: params.resolvedRuntime.namesBehavior,
    importedPromptRules: params.resolvedRuntime.promptRules.ordered.map((rule) => ({
      channel: rule.channel,
      placement: rule.channel === 'system' ? 'append' : 'prepend',
      text: rule.content,
    })),
  })
  const systemPrompt = processPresetCompatMacroString(promptAssembly.systemPrompt, macroProcessing)
  const userPromptBeforeRegex = processPresetCompatMacroString(promptAssembly.userPromptBeforeRegex, macroProcessing)

  return {
    systemPrompt,
    userPrompt: userPromptBeforeRegex,
    userPromptBeforeRegex,
    promptAssembly: promptAssembly.metadata,
    metadata: createPresetCompatRuntimeMetadata(macroProcessing),
  }
}

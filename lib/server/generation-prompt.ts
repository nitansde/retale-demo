import { getGeneratedHistory } from '@/lib/server/generated-history'
import { normalizeBranchId } from '@/lib/server/knowledge-store'
import { estimateTokenCount } from '@/lib/utils'
import { resolveRewriteProviderPrompts } from '@/lib/rewrite-provider-prompt'
import { ApiRequestError } from '@/lib/server/api-route'
import { buildGenerationContext, type GenerationContextRagArtifacts, type GenerationContextBlock, type RoleplayContextMessage } from '@/lib/server/context-builder'
import { createGenerationContextSnapshot, loadGenerationContextSnapshot } from '@/lib/server/generation-context-snapshot'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { applyPresetCompatCreativeRuntime } from '@/lib/preset-compat/apply-runtime'
import { resolveCreativeRoutePresetCompatMetadata } from '@/lib/preset-compat/runtime-integration'
import type { PresetCompatPromptRuleRuntimeContext, PresetCompatRuntimeContextBlock } from '@/lib/preset-compat/types'
import { buildRewriteTaskPromptLines, CONTINUATION_SOURCE_BLOCK_LABEL, isContinuationRewriteTask } from '@/lib/server/rewrite-task-prompt'
import { buildRoleplayScriptPrompt, buildRoleplaySystemPrompt, buildRoleplayTurnPrompt, parseRoleplayTurn, roleplayTurnText, type RoleplayTurn } from '@/lib/roleplay-script'
import { buildRoleplayContextBlock } from '@/lib/roleplay-context'
import { isRequiredRoleplayContextBlock } from '@/lib/roleplay-generation'
import { PRODUCT_SURFACE_IDS, type ProductSurfaceId } from '@/lib/types'
import { createWritingSkillRuntimeSeed, isWritingSkillPromptBlockId, normalizeWritingSkillCardIds, readWritingSkillCardIdFromPromptBlockId } from '@/lib/writing-skill-selection'
import { resolveWritingSkillRuntimes } from '@/lib/server/writing-skill-runtime'
import { buildRequestPromptMessages } from '@/lib/generation-prompt-preview'

const INVALID_OPERATION_TYPE_ERROR = `Invalid operationType. Expected one of: ${PRODUCT_SURFACE_IDS.join(', ')}`

function mapSurfaceContextBlocks(promptBlocks: readonly GenerationContextBlock[] | null): PresetCompatRuntimeContextBlock[] {
  if (!promptBlocks) {
    return []
  }

  return promptBlocks.flatMap((block) => {
    const abstraction = block.id === 'worldbuilding'
      ? 'world_info'
      : block.id === 'characters'
        ? 'personality'
        : block.id === 'current-summary'
          || block.id === 'recent-summaries'
          || block.id === 'recent-chapters-full-text'
          || block.id === 'chapter-state'
          || block.id === 'authored-branch-context'
          || block.id === 'graph-context'
          || block.id === 'facts'
          || block.id === 'events'
            ? 'scenario'
            : null

    if (!abstraction) {
      return []
    }

    return [{
      id: block.id,
      label: block.label,
      content: block.content,
      abstraction,
    } satisfies PresetCompatRuntimeContextBlock]
  })
}

function normalizePresetCompatRuntimeContext(
  body: Record<string, unknown>,
  operationType: ProductSurfaceId,
  promptBlocks: readonly GenerationContextBlock[] | null
): PresetCompatPromptRuleRuntimeContext {
  const rawContext = body.presetCompatRuntimeContext
  const runtimeContext = rawContext && typeof rawContext === 'object' && !Array.isArray(rawContext)
    ? rawContext as Record<string, unknown>
    : {}
  const sessionPhase = typeof runtimeContext.sessionPhase === 'string'
    ? runtimeContext.sessionPhase
    : null
  const namedTranscript = runtimeContext.namedTranscript && typeof runtimeContext.namedTranscript === 'object' && !Array.isArray(runtimeContext.namedTranscript)
    ? runtimeContext.namedTranscript as Record<string, unknown>
    : null
  const explicitProtagonistName = typeof runtimeContext.protagonistName === 'string'
    ? runtimeContext.protagonistName.trim()
    : typeof runtimeContext.macroUserName === 'string'
      ? runtimeContext.macroUserName.trim()
      : ''

  return {
    sessionPhase: sessionPhase === 'new_chat'
      || sessionPhase === 'new_group_chat'
      || sessionPhase === 'new_example_chat'
      || sessionPhase === 'continue'
      ? sessionPhase
      : null,
    hasGroupContext: runtimeContext.hasGroupContext === true,
    hasExampleContext: runtimeContext.hasExampleContext === true,
    hasImpersonationContext: runtimeContext.hasImpersonationContext === true,
    supportsVirtualDepth: false,
    surfaceContextBlocks: mapSurfaceContextBlocks(promptBlocks),
    namedTranscript: namedTranscript
      ? {
          kind: namedTranscript.kind === 'roleplay' ? 'roleplay' : 'chat',
          userName: typeof namedTranscript.userName === 'string' ? namedTranscript.userName : null,
          assistantName: typeof namedTranscript.assistantName === 'string' ? namedTranscript.assistantName : null,
        }
      : null,
    protagonistName: explicitProtagonistName || inferProtagonistNameFromPromptBlocks(promptBlocks),
  }
}

function inferProtagonistNameFromPromptBlocks(promptBlocks: readonly GenerationContextBlock[] | null) {
  const charactersBlock = promptBlocks?.find((block) => block.id === 'characters')
  if (!charactersBlock) return null

  const match = charactersBlock.content.match(/^\s*-\s*([^｜|\n]+)[｜|]/m)
  const name = match?.[1]?.trim() ?? ''
  if (!name || name.startsWith('未命中')) return null
  return name
}

function parseOperationType(value: unknown): ProductSurfaceId | null {
  const operationType = String(value ?? '').trim()
  return PRODUCT_SURFACE_IDS.includes(operationType as ProductSurfaceId)
    ? operationType as ProductSurfaceId
    : null
}

function resolveRewriteRouteSurfaceId(operationType: ProductSurfaceId): ProductSurfaceId {
  return operationType === 'roleplay' ? 'roleplay' : 'rewrite'
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)))
}

function normalizeBranchContextInclusion(value: unknown) {
  return value === 'include_selected' || value === 'ancestors_only'
    ? value
    : undefined
}

export function buildUserPrompt(params: {
  roleplayTurn?: RoleplayTurn | null
  operationType: string
  userInstruction: string
  chapterNo?: number
  sourceText: string
  selectedText: string
  assembledContext: string
  contextBlocks?: readonly Pick<GenerationContextBlock, 'id' | 'content'>[]
  roleplayHistory?: string
  retrievedEvidence?: string
  writingSkillPrompt?: string
  hasBranchLineageContext?: boolean
}) {
  const roleplayContract = params.roleplayTurn ? buildRoleplayScriptPrompt(params.roleplayTurn) : params.operationType === 'roleplay'
    ? [
        '',
        '# 角色扮演回复契约',
        '- 你正在继续一段角色扮演对话。',
        '- 只回复当前这一轮的聊天内容。',
        '- 保持与上方角色扮演历史连续。',
        '- 不要把回复写成小说正文、章节改写、剧情大纲或说明。',
        '- 不要自动应用、改写或续写 chapter 正文。',
      ].join('\n')
    : ''

  const sourceText = params.sourceText.trim()
  const selectedText = params.selectedText.trim()
  const isContinuationBody = params.operationType !== 'roleplay' && isContinuationRewriteTask({
    selectedText,
    hasContinuationSource: Boolean(sourceText),
  })
  const sourceBlock = selectedText
    ? [params.roleplayTurn ? '# 原章节起始片段（仅作背景，当前进度见对话历史）' : '# 选中文本', selectedText, '']
    : sourceText && !params.hasBranchLineageContext
      ? [`# ${CONTINUATION_SOURCE_BLOCK_LABEL}`, sourceText, '']
      : []
  const neighborhoodIndex = selectedText
    ? params.contextBlocks?.findIndex((block) => block.id === 'neighborhood') ?? -1
    : -1
  const contextWithSource = neighborhoodIndex >= 0 && params.contextBlocks
    ? [
        ...params.contextBlocks.slice(0, neighborhoodIndex + 1).map((block) => block.content),
        sourceBlock.join('\n').trimEnd(),
        ...params.contextBlocks.slice(neighborhoodIndex + 1).map((block) => block.content),
      ].join('\n\n')
    : [params.assembledContext, ...sourceBlock].join('\n')

  // Fixed background precedes append-only history. Query-dependent evidence
  // and sampled examples follow it; the current task is always the final part.
  return [
    '# 当前章节',
    params.chapterNo ? `当前章节：第 ${params.chapterNo} 章` : '当前章节：未知',
    '',
    roleplayContract,
    contextWithSource,
    ...(params.roleplayHistory ? [params.roleplayHistory, ''] : []),
    ...(params.retrievedEvidence?.trim() ? [params.retrievedEvidence.trim(), ''] : []),
    ...(params.writingSkillPrompt?.trim() ? [
      params.writingSkillPrompt.trim(),
      params.operationType === 'roleplay'
        ? '技巧与范文仅用于表达方式，承接已有角色互动历史，并遵守 JSON blocks 输出格式。'
        : '严格遵守当前魔改输出契约，只返回本次任务要求的结果。',
      '',
    ] : []),
    ...(params.roleplayTurn
      ? [buildRoleplayTurnPrompt(params.roleplayTurn, Boolean(params.roleplayHistory))]
      : ['# 任务', ...buildRewriteTaskPromptLines({
          operationType: params.operationType,
          userInstruction: params.userInstruction,
          continuation: isContinuationBody,
        })]),
  ].join('\n')
}

function orderPromptBlocksForLlmRequest(promptBlocks: readonly GenerationContextBlock[]) {
  const stableBlocks: GenerationContextBlock[] = []
  const tailBlocks: GenerationContextBlock[] = []

  for (const block of promptBlocks) {
    if (block.id === 'user-instruction' || block.id === 'selected-text') {
      continue
    }

    if (block.id === 'branch-lineage-full-text') {
      tailBlocks.push(block)
      continue
    }

    stableBlocks.push(block)
  }

  return [...stableBlocks, ...tailBlocks]
}

function assemblePromptBlockContents(promptBlocks: readonly GenerationContextBlock[] | null) {
  return promptBlocks ? promptBlocks.map((block) => block.content).join('\n\n') : null
}

function normalizeRoleplayMessages(value: unknown) {
  if (!Array.isArray(value)) return [] as RoleplayContextMessage[]

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>
    const role = record.role
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    if ((role !== 'user' && role !== 'assistant') || !content) {
      return []
    }

    return [{ role, content } satisfies RoleplayContextMessage]
  })
}

function getExplicitStreamOverride(body: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(body, 'stream')
    ? { present: true, value: body.stream === true }
    : { present: false, value: null }
}

function buildRouteContextBlocks(promptBlocks: readonly GenerationContextBlock[] | null) {
  return promptBlocks
    ? promptBlocks.map((block) => ({
        id: block.id,
        priority: block.priority,
        content: block.content,
      }))
    : null
}

// Previews and provider requests use this same assembly path, including presets,
// macros, regex replacements and context-budget trimming.
export async function prepareGenerationPrompt(body: Record<string, unknown>, options: { previewOnly?: boolean } = {}) {
  const userInstruction = String(body.userInstruction ?? body.prompt ?? '')

  let sourceText = String(body.sourceText ?? '')
  let selectedText = String(body.selectedText ?? '')
  const operationType = parseOperationType(body.operationType)
  if (!operationType) {
    throw new ApiRequestError(400, INVALID_OPERATION_TYPE_ERROR)
  }
  const roleplayTurn = operationType === 'roleplay' && body.roleplayTurn !== undefined ? parseRoleplayTurn(body.roleplayTurn, { allowEmptyInput: options.previewOnly }) : null
  if (operationType === 'roleplay' && body.roleplayTurn !== undefined && !roleplayTurn) {
    throw new ApiRequestError(400, 'Invalid roleplay characters, input or target length')
  }
  const rewriteSettings = loadStoredAISettings().rewrite
  const rewriteProvider = rewriteSettings.provider
  const runtimeSurfaceId = resolveRewriteRouteSurfaceId(operationType)
  const generationOptions = roleplayTurn?.generationOptions ?? body
  const writingSkillCardIds = operationType === 'rewrite' || operationType === 'roleplay'
    ? normalizeWritingSkillCardIds(generationOptions)
    : []
  const rawWritingSkillSeed = generationOptions.writingSkillSeed
  const writingSkillSeed = typeof rawWritingSkillSeed === 'number' && Number.isFinite(rawWritingSkillSeed)
    ? Math.floor(rawWritingSkillSeed) & 0x7fffffff
    : createWritingSkillRuntimeSeed()
  const rawWritingSkillExampleCount = generationOptions.writingSkillExampleCount
  const writingSkillExampleCount = typeof rawWritingSkillExampleCount === 'number' && Number.isFinite(rawWritingSkillExampleCount)
    ? Math.floor(rawWritingSkillExampleCount)
    : undefined
  const disabledBlockIds = (Array.isArray(generationOptions.disabledBlockIds) ? generationOptions.disabledBlockIds.map((item: unknown) => String(item)) : [])
    .filter((id) => !['selected-text', 'user-instruction'].includes(id) && (operationType !== 'roleplay' || !isRequiredRoleplayContextBlock(id)))
  const disabledBlockIdSet = new Set(disabledBlockIds)
  const enabledWritingSkillCardIds = writingSkillCardIds.filter((cardId) => !disabledBlockIdSet.has(`writing-skill:${cardId}`))
  const resolvedWritingSkillCardIds = options.previewOnly ? writingSkillCardIds : enabledWritingSkillCardIds
  const writingSkillBundle = resolvedWritingSkillCardIds.length
    ? resolveWritingSkillRuntimes({
        cardIds: resolvedWritingSkillCardIds,
        count: writingSkillExampleCount,
        seed: writingSkillSeed,
      })
    : null
  const excludedGraphEdgeIds = normalizeStringArray(body.excludedGraphEdgeIds)
  const excludedEvidenceIds = normalizeStringArray(body.excludedEvidenceIds)
  const roleplayMessages = operationType === 'roleplay'
    ? normalizeRoleplayMessages(body.roleplayMessages)
    : []
  const generatedHistory = body.novelId && operationType === 'roleplay' && body.roleplaySessionId
    ? getGeneratedHistory({
        novelId: String(body.novelId), branchId: normalizeBranchId(String(body.novelId), body.branchId ? String(body.branchId) : undefined),
        branchContextNodeId: body.branchContextNodeId ? String(body.branchContextNodeId) : undefined,
        branchContextInclusion: normalizeBranchContextInclusion(body.branchContextInclusion),
        ...(operationType === 'roleplay' && body.roleplaySessionId ? {
          roleplaySessionId: String(body.roleplaySessionId),
          roleplayLeafMessageId: typeof body.roleplayLeafMessageId === 'string' ? body.roleplayLeafMessageId : null,
        } : {}),
      })
    : null
  // A roleplay launched from a generated node may also carry that same text
  // as its starting snapshot. Do not reintroduce it after compressing the node.
  const compressedSource = generatedHistory?.entries.slice(0, generatedHistory.preview.compressedChapters)
    .find((entry) => entry.id === generatedHistory.sourceNodeId && entry.content.trim() === sourceText.trim())
  if (compressedSource && generatedHistory?.preview.summary) {
    sourceText = generatedHistory.preview.summary
    if (selectedText.trim() && compressedSource.content.includes(selectedText.trim())) selectedText = sourceText
  }
  const contextRequest = body.novelId && body.chapterId
    ? {
        novelId: String(body.novelId),
        branchId: body.branchId ? String(body.branchId) : undefined,
        chapterId: String(body.chapterId),
        selectedText,
        sourceText,
        operationType: runtimeSurfaceId,
        userInstruction: roleplayTurn
          ? `扮演角色：${roleplayTurn.playerName}\n互动对象：${roleplayTurn.counterpartName}\n${roleplayTurnText(roleplayTurn)}`
          : userInstruction,
        roleplayMessages,
        excludedGraphEdgeIds,
        excludedEvidenceIds,
        whatIfSessionId: body.whatIfSessionId ? String(body.whatIfSessionId) : undefined,
        futureJumpRunId: body.futureJumpRunId ? String(body.futureJumpRunId) : undefined,
        branchContextNodeId: operationType !== 'roleplay' && body.branchContextNodeId ? String(body.branchContextNodeId) : undefined,
        branchContextInclusion: normalizeBranchContextInclusion(body.branchContextInclusion),
        writingSkillCardIds,
        writingSkillExampleCount,
        writingSkillSeed,
      } as const
    : null
  const cachedRagArtifacts = contextRequest
    ? loadGenerationContextSnapshot({
        snapshotId: typeof body.contextSnapshotId === 'string' ? body.contextSnapshotId : null,
        request: contextRequest,
      })
    : null
  let previewRagArtifacts: GenerationContextRagArtifacts | null = null
  const context = contextRequest
    ? await buildGenerationContext({
        ...contextRequest,
        writingSkillCardIds: resolvedWritingSkillCardIds,
      }, { cachedRagArtifacts, writingSkillBundle, ...(options.previewOnly ? { onRagArtifacts: (artifacts: GenerationContextRagArtifacts) => { previewRagArtifacts = artifacts } } : {}) })
    : null
  // History is required even when the session has no source chapter. Build it
  // independently of RAG so chapter context cannot silently drop a conversation.
  const roleplayHistoryBlock = operationType === 'roleplay'
    ? generatedHistory?.content
      ? { id: 'roleplay-history', label: '当前角色扮演对话', enabled: true, priority: 'highest' as const, content: `# 当前角色扮演对话\n以下是当前分支已经发生的故事，按顺序承接最新场景、人物状态和未回答的话。\n\n${generatedHistory.content}` }
      : buildRoleplayContextBlock(roleplayMessages)
    : null
  const isSourceContinuation = operationType !== 'roleplay' && isContinuationRewriteTask({
    selectedText,
    hasContinuationSource: Boolean(sourceText.trim()),
  })
  // Structured roleplay keeps output rules in its fixed script contract. Omit
  // the generic duplicate from both request assembly and context preview.
  const availablePromptBlocks = [
    ...(context?.promptBlocks ?? writingSkillBundle?.blocks ?? []).filter((block) =>
      block.id !== 'roleplay-history'
      && !(roleplayTurn && block.id === 'output-constraints')
      // An unselected continuation source is already sent in full as the
      // continuation body (or branch lineage); don't send it as a second window.
      && !(isSourceContinuation && block.id === 'neighborhood'
        && block.content.replace(/^#[^\n]*\n/, '').trim() === sourceText.trim())),
    ...(roleplayHistoryBlock ? [roleplayHistoryBlock] : []),
  ]
  const activePromptBlocks = context || availablePromptBlocks.length
    ? availablePromptBlocks.filter((block) => block.enabled && !disabledBlockIds.includes(block.id))
    : null
  const orderedActivePromptBlocks = activePromptBlocks
    ? orderPromptBlocksForLlmRequest(activePromptBlocks)
    : null
  const resolvePromptParts = (
    promptBlocks: readonly GenerationContextBlock[] | null,
    fallbackContext: string,
  ) => {
    if (!promptBlocks) {
      return {
        assembledContext: fallbackContext,
        contextBlocks: undefined,
        writingSkillPrompt: writingSkillBundle?.prompt ?? '',
        roleplayHistory: '',
        retrievedEvidence: '',
      }
    }

    const contextBlocks = promptBlocks.filter((block) => !isWritingSkillPromptBlockId(block.id) && block.id !== 'roleplay-history' && block.id !== 'evidence')
    // Earlier chapters are independent of the current selection. Keep their
    // large, stable text ahead of the current chapter and its knowledge blocks.
    const orderedContextBlocks = [
      ...contextBlocks.filter((block) => block.id === 'recent-chapters-full-text'),
      ...contextBlocks.filter((block) => block.id !== 'recent-chapters-full-text'),
    ]
    const writingSkillBlocks = promptBlocks.filter((block) => isWritingSkillPromptBlockId(block.id))
    return {
      assembledContext: assemblePromptBlockContents(orderedContextBlocks) ?? '',
      contextBlocks: orderedContextBlocks,
      writingSkillPrompt: assemblePromptBlockContents(writingSkillBlocks) ?? '',
      roleplayHistory: promptBlocks.find((block) => block.id === 'roleplay-history')?.content ?? '',
      retrievedEvidence: promptBlocks.find((block) => block.id === 'evidence')?.content ?? '',
    }
  }
  const buildRuntime = (
    promptParts: ReturnType<typeof resolvePromptParts>,
    promptBlocks: readonly GenerationContextBlock[] | null,
  ) => {
    const runtime = applyPresetCompatCreativeRuntime({
      surfaceId: runtimeSurfaceId,
      novelId: typeof body.novelId === 'string' ? body.novelId : null,
      providerDefaults: {
        provider: rewriteProvider,
        openAICompatible: {
          config: rewriteSettings.openAICompatible,
          request: { temperature: body.tone === 'keep' ? 0.7 : 0.9 },
        },
        ollama: {
          config: rewriteSettings.ollama,
          request: { temperature: body.tone === 'keep' ? 0.7 : 0.9 },
        },
      },
      systemPrompt: '',
      userPrompt: buildUserPrompt({
        roleplayTurn,
        operationType: runtimeSurfaceId,
        userInstruction: roleplayTurn ? roleplayTurnText(roleplayTurn) : userInstruction,
        chapterNo: context?.chapterNo,
        sourceText,
        selectedText,
        assembledContext: promptParts.assembledContext,
        contextBlocks: promptParts.contextBlocks,
        roleplayHistory: promptParts.roleplayHistory,
        retrievedEvidence: promptParts.retrievedEvidence,
        writingSkillPrompt: promptParts.writingSkillPrompt,
        hasBranchLineageContext: Boolean(promptBlocks?.some((block) => block.id === 'branch-lineage-full-text')),
      }),
      promptRuleRuntimeContext: normalizePresetCompatRuntimeContext(
        body as Record<string, unknown>,
        runtimeSurfaceId,
        promptBlocks,
      ),
    })
    // Saved presets can still contain the old rewrite-only RP instructions.
    // Keep the current mode contract after those instructions in the final request.
    return roleplayTurn ? { ...runtime, systemPrompt: [runtime.systemPrompt, buildRoleplaySystemPrompt(roleplayTurn)].filter(Boolean).join('\n\n') } : runtime
  }
  const fallbackContext = String(body.prompt ?? '')
  const initialPromptParts = resolvePromptParts(orderedActivePromptBlocks, fallbackContext)
  const initialRuntime = buildRuntime(initialPromptParts, orderedActivePromptBlocks)
  const requestStreamOverride = getExplicitStreamOverride(body as Record<string, unknown>)
  const initialRouteMetadata = resolveCreativeRoutePresetCompatMetadata({
    runtime: initialRuntime,
    blocks: buildRouteContextBlocks(orderedActivePromptBlocks),
    requestOverride: requestStreamOverride,
    providerDefaultEnabled: false,
    streamSupported: true,
  })
  const trimmedPromptBlocks = orderedActivePromptBlocks
    ? orderedActivePromptBlocks.filter((block) => !initialRouteMetadata.contextWindow?.trimmedBlockIds.includes(block.id))
    : null
  const promptParts = resolvePromptParts(trimmedPromptBlocks, fallbackContext)
  const assembledContext = promptParts.assembledContext
  const runtime = buildRuntime(promptParts, trimmedPromptBlocks)
  const routeMetadata = resolveCreativeRoutePresetCompatMetadata({
    runtime,
    blocks: buildRouteContextBlocks(trimmedPromptBlocks),
    requestOverride: requestStreamOverride,
    providerDefaultEnabled: false,
    streamSupported: true,
  })
  const presetCompatMetadata = {
    ...routeMetadata.metadata,
    contextWindow: initialRouteMetadata.contextWindow,
  }
  const activeWritingSkillCardIds = new Set(
    trimmedPromptBlocks
      ? trimmedPromptBlocks.flatMap((block) => {
          const cardId = readWritingSkillCardIdFromPromptBlockId(block.id)
          return cardId ? [cardId] : []
        })
      : enabledWritingSkillCardIds,
  )
  const writingSkillRecords = writingSkillBundle?.records.filter((record) => activeWritingSkillCardIds.has(record.skillCardId)) ?? []
  const providerRuntime = runtime.resolvedRuntime.providerRuntime
  const rewriteInput = {
    outputFormat: roleplayTurn ? 'roleplay-script' as const : 'rewrite' as const,
    sourceText,
    mode: String(body.mode ?? ''),
    tone: String(body.tone ?? ''),
    scope: String(body.scope ?? ''),
    prompt: context ? [String(body.prompt ?? ''), assembledContext].filter(Boolean).join('\n\n') : String(body.prompt ?? ''),
    keepCanon: Boolean(body.keepCanon),
    autoContinue: Boolean(body.autoContinue),
    thoughtLevel: String(body.thoughtLevel ?? ''),
    systemPrompt: runtime.systemPrompt,
    userPrompt: runtime.userPrompt,
    requestOptions: providerRuntime.provider === 'openai-compatible' ? providerRuntime.request : providerRuntime.request.options,
    presetCompat: presetCompatMetadata,
  }
  const requestPrompts = routeMetadata.streamPolicy?.effective ? runtime : resolveRewriteProviderPrompts(rewriteInput)
  return { generatedHistory, sourceText, roleplayTurn, context, contextRequest, previewRagArtifacts, availablePromptBlocks, disabledBlockIds, runtime, initialRouteMetadata, routeMetadata, presetCompatMetadata, operationType, writingSkillRecords, assembledContext, rewriteInput, requestPrompts }
}

export function buildGenerationPromptPreview(prepared: Awaited<ReturnType<typeof prepareGenerationPrompt>>) {
  const { context, contextRequest, previewRagArtifacts, availablePromptBlocks, disabledBlockIds, runtime, requestPrompts, initialRouteMetadata, operationType, writingSkillRecords } = prepared
  const promptBlocks = availablePromptBlocks.map((block) => ({
    ...block,
    enabled: block.enabled && !disabledBlockIds.includes(block.id),
    required: ['selected-text', 'user-instruction'].includes(block.id) || (operationType === 'roleplay' && isRequiredRoleplayContextBlock(block.id)),
    trimmed: initialRouteMetadata.contextWindow?.trimmedBlockIds.includes(block.id) ?? false,
  }))
  return {
    ...context,
    ok: true as const,
    compression: prepared.generatedHistory?.preview ?? context?.compression ?? null,
    tokenEstimate: estimateTokenCount(`${requestPrompts.systemPrompt}\n${requestPrompts.userPrompt}`),
    systemPrompt: requestPrompts.systemPrompt,
    userPrompt: requestPrompts.userPrompt,
    requestMessages: buildRequestPromptMessages(requestPrompts.systemPrompt, requestPrompts.userPrompt, {
      contextBlocks: promptBlocks,
      modeSystemPrompt: prepared.roleplayTurn ? buildRoleplaySystemPrompt(prepared.roleplayTurn) : undefined,
      baseUserPrompt: runtime.promptAssembly.user.segments.find((segment) => segment.stage === 'base_prompt')?.text,
      presetUserParts: runtime.promptAssembly.user.segments.filter((segment) => segment.stage !== 'base_prompt').map((segment) => segment.text),
    }),
    warnings: [...new Set([...(context?.warnings ?? []), ...runtime.warnings])],
    contextSnapshotId: contextRequest && previewRagArtifacts ? createGenerationContextSnapshot({ request: contextRequest, artifacts: previewRagArtifacts }) : null,
    promptBlocks,
    writingSkillRecords,
  }
}

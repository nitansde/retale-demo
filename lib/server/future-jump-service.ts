import { getGeneratedHistory } from '@/lib/server/generated-history'
import { InputValidationError, ResourceNotFoundError } from '@/lib/server/domain-errors'
import { parseRequestInput } from '@/lib/server/request-validation'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { loadExplicitAuthoredContext } from '@/lib/server/authored-context'
import { buildKnowledgeExtractionStoryState } from '@/lib/server/context-builder'
import { writeLlmDebugLog } from '@/lib/server/llm-debug-log'
import { extractProviderErrorDetail, throwIfProviderError } from '@/lib/server/provider-request'
import {
  appendFutureJumpRevision,
  createFutureJumpRun as createFutureJumpRunRecord,
  findFutureJumpRunById,
  markFutureJumpRunFailed,
} from '@/lib/server/future-jump-store'
import { findOutlineNodeById, listOutlineNodeChapters } from '@/lib/server/outline-node-store'
import { parseKnowledgeExtractionCandidates } from '@/lib/server/ollama-local'
import { normalizeOpenAICompatibleBaseUrl } from '@/lib/server/openai-compatible'
import { applyPresetCompatCreativeRuntime } from '@/lib/preset-compat/apply-runtime'
import {
  resolveCreativeRoutePresetCompatMetadata,
} from '@/lib/preset-compat/runtime-integration'
import type { PresetCompatResponseMetadata } from '@/lib/preset-compat/runtime-integration'
import {
  bridgeSummaryGenerationSchema,
  futureJumpCreateRequestSchema,
  futureJumpMutationResponseSchema,
  futureJumpReviseRequestSchema,
  targetRewriteGenerationSchema,
} from '@/lib/server/story-branch-contracts'
import {
  buildChildReadableLineageLabel,
  requireOptionalTimelineNodeInBranchContext,
} from '@/lib/server/story-branch-mutation-helpers'
import {
  createStoryTimelineNode,
  findStoryTimelineNodeById,
  findStoryTimelineNodeByFutureJumpRunId,
  getNextStoryTimelineLabelIndex,
} from '@/lib/server/story-timeline-store'
import { formatStoryBranchReadableLabel, prefixStoryBranchTitle } from '@/lib/story-branch-labels'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { findWhatIfSessionById } from '@/lib/server/what-if-store'
import { findRoleplaySessionById } from '@/lib/server/roleplay-store'
import type { DatabaseAccess } from '@/lib/server/database-access'
import type {
  FutureJumpCreateRequest,
  FutureJumpMutationResponse,
  FutureJumpRevisionRecord,
  FutureJumpReviseRequest,
  FutureJumpRunDetail,
  FutureJumpSourceContext,
  OutlineNodeChapterRecord,
  OutlineNodeRecord,
  WhatIfDeltaRecord,
  WhatIfSessionDetail,
} from '@/lib/story-branch-types'
import type { PresetCompatPromptRuleRuntimeContext } from '@/lib/preset-compat/types'
import { estimateTokenCount, uid } from '@/lib/utils'

const BRIDGE_SUMMARY_MIN_LENGTH = 300
const BRIDGE_SUMMARY_MAX_LENGTH = 600
const FUTURE_JUMP_RUNTIME_SURFACE_ID = 'future_jump' as const

type Db = DatabaseAccess

type StageKey = 'bridge' | 'rewrite'

type GenerateFutureJumpInput = {
  novelId: string
  branchId: string
  sourceContext: FutureJumpSourceContext
  targetOutlineNodeId: string
  targetOutlineChapterId: string
  parentTimelineNodeId?: string | null
  userDirection?: string
  presetCompatRuntimeContext?: PresetCompatPromptRuleRuntimeContext
}

type ReviseFutureJumpInput = {
  novelId: string
  branchId: string
  runId: string
  userFeedback: string
  presetCompatRuntimeContext?: PresetCompatPromptRuleRuntimeContext
}

type FutureJumpMutationResult = {
  run: FutureJumpRunDetail
  revision: FutureJumpRevisionRecord
  titleHint: string | null
  subtitleHint: string | null
  presetCompat: PresetCompatResponseMetadata | null
}

type LoadedFutureJumpGenerationContext = {
  generatedHistory?: ReturnType<typeof getGeneratedHistory> | null
  session: WhatIfSessionDetail | null
  sourceContext: FutureJumpSourceContext
  sourceNodeContext: {
    nodeType: FutureJumpSourceContext['nodeType']
    nodeTitle: string | null
    authoredText: string | null
  } | null
  outlineNode: OutlineNodeRecord
  targetAnchor: OutlineNodeChapterRecord
  sourceChapter: {
    id: string | null
    chapterNo: number
    title: string | null
    summary: string | null
    rawText: string
  }
  targetChapter: {
    id: string | null
    chapterNo: number
    title: string | null
    summary: string | null
    rawText: string
  }
  baseWorldState: string
  deltaSummary: string
  latestRevisionContext: {
    revisionNo: number
    bridgeSummary: string
    generatedTargetText: string
  } | null
}

type OpenAICompatibleChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    input_tokens?: unknown
    output_tokens?: unknown
  }
}

type OllamaChatResponse = {
  message?: {
    content?: string | null
  }
  prompt_eval_count?: number
  eval_count?: number
}

type StructuredResponse = {
  raw: string
  parsed: unknown
  usage: {
    inputTokens: number | null
    outputTokens: number | null
  }
}

function normalizeTokenCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
}

function addTokenUsage(
  left: { inputTokens: number | null; outputTokens: number | null },
  right: { inputTokens: number | null; outputTokens: number | null },
) {
  return {
    inputTokens: left.inputTokens === null && right.inputTokens === null ? null : (left.inputTokens ?? 0) + (right.inputTokens ?? 0),
    outputTokens: left.outputTokens === null && right.outputTokens === null ? null : (left.outputTokens ?? 0) + (right.outputTokens ?? 0),
  }
}

function formatDeltaSummary(delta: WhatIfDeltaRecord) {
  const subject = delta.subjectName?.trim() || '未知主体'
  const target = delta.targetName?.trim() ? ` -> ${delta.targetName.trim()}` : ''
  const key = delta.key.trim() || delta.deltaType.trim() || 'delta'
  const valueTransition = [delta.oldValue?.trim(), delta.newValue?.trim()].filter(Boolean).join(' -> ')
  const chapterText = typeof delta.validFromChapter === 'number' ? `｜自第 ${delta.validFromChapter} 章起` : ''
  const description = delta.description.trim() || valueTransition || key
  const changeText = valueTransition ? `｜${key}：${valueTransition}` : `｜${key}`
  return `- ${subject}${target}${changeText}${chapterText}｜${description}`
}

function trimLine(value: string | null | undefined) {
  return value?.trim() || ''
}

function compactLength(value: string) {
  return value.replace(/\s+/g, '').trim().length
}

function getRequiredString(value: string, fieldName: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${fieldName} is required`)
  }
  return trimmed
}

function sanitizeLineTitle(value: string) {
  const trimmed = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[「」『』【】]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!trimmed) return ''
  return trimmed.length > 18 ? `${trimmed.slice(0, 18).trim()}…` : trimmed
}

function buildFutureJumpNodeTitle(params: {
  readableLineageLabel: string
  titleHint: string | null
  outlineNode: OutlineNodeRecord
  targetAnchor: OutlineNodeChapterRecord
}) {
  const hinted = sanitizeLineTitle(params.titleHint ?? '')
  if (hinted) {
    return prefixStoryBranchTitle(params.readableLineageLabel, hinted)
  }

  const outlineTitle = sanitizeLineTitle(params.outlineNode.title)
  if (outlineTitle) {
    return prefixStoryBranchTitle(params.readableLineageLabel, outlineTitle)
  }

  const anchorTitle = sanitizeLineTitle(params.targetAnchor.chapterTitle ?? '')
  if (anchorTitle) {
    return prefixStoryBranchTitle(params.readableLineageLabel, anchorTitle)
  }

  return prefixStoryBranchTitle(params.readableLineageLabel, `第${params.targetAnchor.chapterNo}章`)
}

function buildFutureJumpNodeSubtitle(params: {
  subtitleHint: string | null
  userDirection: string
  targetAnchor: OutlineNodeChapterRecord
}) {
  const explicit = params.subtitleHint?.trim()
  if (explicit) {
    return explicit.slice(0, 48)
  }

  const direction = params.userDirection.trim()
  if (direction) {
    return direction.slice(0, 48)
  }

  const chapterTitle = params.targetAnchor.chapterTitle?.trim()
  return chapterTitle ? chapterTitle.slice(0, 48) : `跳至第 ${params.targetAnchor.chapterNo} 章`
}

function parseStructuredJson(content: string) {
  const [candidate] = parseKnowledgeExtractionCandidates(content)
  if (candidate === undefined) {
    throw new Error('Model did not return a parseable JSON object')
  }
  return candidate
}

function extractOpenAICompatibleText(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        const record = item as Record<string, unknown>
        return typeof record.text === 'string' ? record.text : ''
      })
      .join('')
      .trim()
  }

  return ''
}

function buildOllamaFormat(stage: StageKey) {
  if (stage === 'bridge') {
    return {
      type: 'object',
      properties: {
        bridgeSummary: { type: 'string' },
      },
      required: ['bridgeSummary'],
    }
  }

  return {
    type: 'object',
    properties: {
      generatedTargetText: { type: 'string' },
      titleHint: { type: 'string' },
      subtitleHint: { type: 'string' },
    },
    required: ['generatedTargetText'],
  }
}

function validateBridgeSummary(result: unknown) {
  const parsed = bridgeSummaryGenerationSchema.parse(result)
  const bridgeSummary = parsed.bridgeSummary.trim()
  const length = compactLength(bridgeSummary)

  if (length < BRIDGE_SUMMARY_MIN_LENGTH || length > BRIDGE_SUMMARY_MAX_LENGTH) {
    throw new Error(`bridgeSummary must be ${BRIDGE_SUMMARY_MIN_LENGTH}-${BRIDGE_SUMMARY_MAX_LENGTH} Chinese characters after whitespace is removed`)
  }

  return { bridgeSummary }
}

function validateTargetRewrite(result: unknown) {
  const parsed = targetRewriteGenerationSchema.parse(result)
  return {
    generatedTargetText: parsed.generatedTargetText.trim(),
    titleHint: parsed.titleHint?.trim() || null,
    subtitleHint: parsed.subtitleHint?.trim() || null,
  }
}

function buildDeltaContextLines(session: WhatIfSessionDetail | null) {
  if (!session) return '无 What-if 分歧；以来源正文作为分支上下文。'
  const lines = [
    `What-if 会话标题：${session.title}`,
    `分歧起点：第 ${session.sourceChapterNo} 章`,
  ]

  if (trimLine(session.premise)) {
    lines.push(`What-if 前提：${session.premise.trim()}`)
  }

  if (trimLine(session.selectedText)) {
    lines.push('触发选段：')
    lines.push(session.selectedText.trim())
  }

  lines.push('显式变更：')
  lines.push(...(session.deltas.length ? session.deltas.map(formatDeltaSummary) : ['- 暂无显式变更。']))
  return lines.join('\n')
}

function buildRevisionContextBlock(latestRevisionContext: LoadedFutureJumpGenerationContext['latestRevisionContext']) {
  if (!latestRevisionContext) {
    return '无历史 Future Jump 修订。'
  }

  return [
    `最近一次有效修订：第 ${latestRevisionContext.revisionNo} 版`,
    '上一版桥接摘要：',
    latestRevisionContext.bridgeSummary,
    '',
    '上一版未来节点正文：',
    latestRevisionContext.generatedTargetText,
  ].join('\n')
}

function buildSourceChapterExcerpt(sourceChapter: LoadedFutureJumpGenerationContext['sourceChapter']) {
  const lines = sourceChapter.rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)

  return lines.join('\n') || '（源章节正文缺失）'
}

function buildSourceNodeAuthoredExcerpt(sourceNodeContext: LoadedFutureJumpGenerationContext['sourceNodeContext']) {
  const text = sourceNodeContext?.authoredText?.trim()
  if (!text) return '（当前节点没有可用的已保存正文）'

  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18)
    .join('\n') || '（当前节点没有可用的已保存正文）'
}

function resolveSourceNodeContext(
  sourceNode: ReturnType<typeof findStoryTimelineNodeById>,
  session: WhatIfSessionDetail | null,
  db: Db,
) {
  if (!sourceNode) return null

  let authoredText: string | null = null
  if (sourceNode.nodeType === 'rewrite' || sourceNode.nodeType === 'continue_block') {
    authoredText = sourceNode.latestText ?? ''
  } else if (sourceNode.nodeType === 'what_if') {
    authoredText = session?.generatedText ?? ''
  } else if (sourceNode.nodeType === 'roleplay_session') {
    const roleplay = sourceNode.roleplaySessionId ? findRoleplaySessionById(sourceNode.roleplaySessionId, db) : null
    authoredText = roleplay?.messages.map(message => `${message.role}: ${message.content}`).join('\n') || null
  } else if (sourceNode.nodeType === 'future_jump') {
    const sourceRun = sourceNode.futureJumpRunId ? findFutureJumpRunById(sourceNode.futureJumpRunId, db) : null
    authoredText = sourceRun?.revisions.at(-1)?.generatedTargetText
      ?? sourceRun?.generatedTargetText
      ?? ''
  }

  return {
    nodeType: sourceNode.nodeType,
    nodeTitle: sourceNode.title?.trim() || null,
    authoredText,
  }
}

function resolveFutureJumpWhatIfSource(params: {
  novelId: string
  branchId: string
  sourceContext: FutureJumpSourceContext
  db: Db
}) {
  const explicitId = params.sourceContext.whatIfSessionId
  let inheritedId: string | null = null
  let cursorId = params.sourceContext.nodeId
  const visited = new Set<string>()
  while (cursorId) {
    if (visited.has(cursorId) || visited.size >= 1000) throw new InputValidationError('Invalid source timeline lineage')
    visited.add(cursorId)
    const node = requireOptionalTimelineNodeInBranchContext({ nodeId: cursorId, novelId: params.novelId, branchId: params.branchId, label: 'Source timeline node', db: params.db })!
    inheritedId = node.whatIfSessionId
    if (!inheritedId && node.futureJumpRunId) inheritedId = findFutureJumpRunById(node.futureJumpRunId, params.db)?.sourceContext.whatIfSessionId ?? null
    if (inheritedId) break
    cursorId = node.parentNodeId
  }
  if (explicitId && inheritedId && explicitId !== inheritedId) throw new InputValidationError('What-if source does not match source timeline lineage')
  const sessionId = explicitId ?? inheritedId
  if (sessionId) {
    const session = findWhatIfSessionById(sessionId, params.db)
    if (!session || session.novelId !== params.novelId || session.baseBranchId !== params.branchId) throw new ResourceNotFoundError('What-if session does not belong to the requested novel/branch')
  }
  return sessionId
}

function buildTargetReferenceBlock(context: LoadedFutureJumpGenerationContext) {
  return [
    `目标大纲节点：${context.outlineNode.title}`,
    `目标锚点章节：第 ${context.targetAnchor.chapterNo} 章 ${context.targetChapter.title?.trim() || context.targetAnchor.chapterTitle?.trim() || ''}`.trim(),
    `目标节点摘要：${context.outlineNode.summary}`,
    context.outlineNode.originalOutcome?.trim() ? `原线结果：${context.outlineNode.originalOutcome.trim()}` : '原线结果：未提供',
    context.targetChapter.summary?.trim() ? `原线目标章摘要：${context.targetChapter.summary.trim()}` : '原线目标章摘要：未提供',
    context.targetChapter.rawText.trim() ? ['原线目标章正文参考：', context.targetChapter.rawText.trim()].join('\n') : '原线目标章正文参考：未提供',
  ].join('\n')
}

async function requestStructuredResponse(params: {
  stage: StageKey
  systemPrompt: string
  userPrompt: string
  configOverride?: {
    openAICompatible?: Partial<{
      baseUrl: string
      apiKey: string
      model: string
    }>
    ollama?: Partial<{
      baseUrl: string
      model: string
    }>
  }
  requestOptions?: {
    openAICompatible?: Partial<{
      temperature: number
      top_p: number
      frequency_penalty: number
      presence_penalty: number
      max_tokens: number
    }>
    ollama?: Partial<{
      temperature: number
      top_p: number
      top_k: number
      min_p: number
      repeat_penalty: number
      num_predict: number
      seed: number
    }>
  }
}) {
  const settings = loadStoredAISettings().rewrite

  if (settings.provider === 'openai-compatible') {
    const baseUrl = normalizeOpenAICompatibleBaseUrl(params.configOverride?.openAICompatible?.baseUrl || settings.openAICompatible.baseUrl || '')
    const apiKey = (params.configOverride?.openAICompatible?.apiKey || settings.openAICompatible.apiKey).trim()
    const model = (params.configOverride?.openAICompatible?.model || settings.openAICompatible.model).trim()

    if (!baseUrl || !apiKey || !model) {
      throw new Error('OpenAI-compatible config not set')
    }

    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
    const messages = [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ]
    const requestBody = {
      model,
      temperature: params.requestOptions?.openAICompatible?.temperature ?? 0.7,
      ...(typeof params.requestOptions?.openAICompatible?.top_p === 'number' ? { top_p: params.requestOptions.openAICompatible.top_p } : {}),
      ...(typeof params.requestOptions?.openAICompatible?.frequency_penalty === 'number' ? { frequency_penalty: params.requestOptions.openAICompatible.frequency_penalty } : {}),
      ...(typeof params.requestOptions?.openAICompatible?.presence_penalty === 'number' ? { presence_penalty: params.requestOptions.openAICompatible.presence_penalty } : {}),
      ...(typeof params.requestOptions?.openAICompatible?.max_tokens === 'number' ? { max_tokens: params.requestOptions.openAICompatible.max_tokens } : {}),
      response_format: { type: 'json_object' },
      messages,
    }
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      })
    } catch (error) {
      await writeLlmDebugLog({
        folder: `future-jump/${params.stage}`,
        provider: 'openai-compatible',
        model,
        streamed: false,
        stage: params.stage,
        request: { url, body: requestBody, messages },
        response: { error: error instanceof Error ? error.message : 'OpenAI-compatible future jump request failed' },
      })
      throw error
    }

    if (!response.ok) {
      const rawText = await response.text().catch(() => '')
      const detail = extractProviderErrorDetail(rawText)
      const message = `OpenAI-compatible HTTP ${response.status}${detail ? `: ${detail}` : ''}`
      await writeLlmDebugLog({
        folder: `future-jump/${params.stage}`,
        provider: 'openai-compatible',
        model,
        streamed: false,
        stage: params.stage,
        request: { url, body: requestBody, messages },
        response: { status: response.status, rawText, error: message },
      })
      throw new Error(message)
    }

    const data = await response.json() as OpenAICompatibleChatCompletionResponse
    throwIfProviderError(data)
    const raw = extractOpenAICompatibleText(data.choices?.[0]?.message?.content)
    if (!raw) {
      await writeLlmDebugLog({
        folder: `future-jump/${params.stage}`,
        provider: 'openai-compatible',
        model,
        streamed: false,
        stage: params.stage,
        request: { url, body: requestBody, messages },
        response: { status: response.status, parsed: data, error: 'OpenAI-compatible API returned empty content' },
      })
      throw new Error('OpenAI-compatible API returned empty content')
    }

    let parsed: unknown
    try {
      parsed = parseStructuredJson(raw)
    } catch (error) {
      await writeLlmDebugLog({
        folder: `future-jump/${params.stage}`,
        provider: 'openai-compatible',
        model,
        streamed: false,
        stage: params.stage,
        request: { url, body: requestBody, messages },
        response: {
          status: response.status,
          rawText: raw,
          parsed: data,
          error: error instanceof Error ? error.message : 'Future jump JSON parse failed',
        },
      })
      throw error
    }

    await writeLlmDebugLog({
      folder: `future-jump/${params.stage}`,
      provider: 'openai-compatible',
      model,
      streamed: false,
      stage: params.stage,
      request: { url, body: requestBody, messages },
      response: { status: response.status, rawText: raw, parsed },
    })

    return {
      raw,
      parsed,
      usage: {
        inputTokens: normalizeTokenCount(data.usage?.input_tokens ?? data.usage?.prompt_tokens),
        outputTokens: normalizeTokenCount(data.usage?.output_tokens ?? data.usage?.completion_tokens),
      },
    } satisfies StructuredResponse
  }

  const baseUrl = (params.configOverride?.ollama?.baseUrl || settings.ollama.baseUrl).trim() || 'http://127.0.0.1:11434'
  const model = (params.configOverride?.ollama?.model || settings.ollama.model).trim()
  if (!model) {
    throw new Error('Ollama rewrite config not set')
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`
  const messages = [
    { role: 'system', content: params.systemPrompt },
    { role: 'user', content: params.userPrompt },
  ]
  const requestBody = {
    model,
    stream: false,
    think: false,
    keep_alive: '5m',
    format: buildOllamaFormat(params.stage),
    options: {
      temperature: params.requestOptions?.ollama?.temperature ?? 0.7,
      ...(typeof params.requestOptions?.ollama?.top_p === 'number' ? { top_p: params.requestOptions.ollama.top_p } : {}),
      ...(typeof params.requestOptions?.ollama?.top_k === 'number' ? { top_k: params.requestOptions.ollama.top_k } : {}),
      ...(typeof params.requestOptions?.ollama?.min_p === 'number' ? { min_p: params.requestOptions.ollama.min_p } : {}),
      ...(typeof params.requestOptions?.ollama?.repeat_penalty === 'number' ? { repeat_penalty: params.requestOptions.ollama.repeat_penalty } : {}),
      ...(typeof params.requestOptions?.ollama?.num_predict === 'number' ? { num_predict: params.requestOptions.ollama.num_predict } : {}),
      ...(typeof params.requestOptions?.ollama?.seed === 'number' ? { seed: params.requestOptions.ollama.seed } : {}),
    },
    messages,
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
  } catch (error) {
    await writeLlmDebugLog({
      folder: `future-jump/${params.stage}`,
      provider: 'ollama',
      model,
      streamed: false,
      stage: params.stage,
      request: { url, body: requestBody, messages },
      response: { error: error instanceof Error ? error.message : 'Ollama future jump request failed' },
    })
    throw error
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const detail = extractProviderErrorDetail(text)
    await writeLlmDebugLog({
      folder: `future-jump/${params.stage}`,
      provider: 'ollama',
      model,
      streamed: false,
      stage: params.stage,
      request: { url, body: requestBody, messages },
      response: { status: response.status, rawText: text, error: `Ollama HTTP ${response.status}` },
    })
    throw new Error(`Ollama HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }

  const data = await response.json() as OllamaChatResponse
  throwIfProviderError(data)
  const raw = data.message?.content?.trim() || ''
  if (!raw) {
    await writeLlmDebugLog({
      folder: `future-jump/${params.stage}`,
      provider: 'ollama',
      model,
      streamed: false,
      stage: params.stage,
      request: { url, body: requestBody, messages },
      response: { status: response.status, parsed: data, error: 'Ollama returned empty content' },
    })
    throw new Error('Ollama returned empty content')
  }

  let parsed: unknown
  try {
    parsed = parseStructuredJson(raw)
  } catch (error) {
    await writeLlmDebugLog({
      folder: `future-jump/${params.stage}`,
      provider: 'ollama',
      model,
      streamed: false,
      stage: params.stage,
      request: { url, body: requestBody, messages },
      response: {
        status: response.status,
        rawText: raw,
        parsed: data,
        error: error instanceof Error ? error.message : 'Future jump JSON parse failed',
      },
    })
    throw error
  }

  await writeLlmDebugLog({
    folder: `future-jump/${params.stage}`,
    provider: 'ollama',
    model,
    streamed: false,
    stage: params.stage,
    request: { url, body: requestBody, messages },
    response: { status: response.status, rawText: raw, parsed },
  })

  return {
    raw,
    parsed,
    usage: {
      inputTokens: normalizeTokenCount(data.prompt_eval_count),
      outputTokens: normalizeTokenCount(data.eval_count),
    },
  } satisfies StructuredResponse
}

async function runValidatedStage<T>(params: {
  stage: StageKey
  systemPrompt: string
  userPrompt: string
  validate: (value: unknown) => T
  postProcess?: (value: T) => T
  configOverride?: {
    openAICompatible?: Partial<{
      baseUrl: string
      apiKey: string
      model: string
    }>
    ollama?: Partial<{
      baseUrl: string
      model: string
    }>
  }
  requestOptions?: {
    openAICompatible?: Partial<{
      temperature: number
      top_p: number
      frequency_penalty: number
      presence_penalty: number
      max_tokens: number
    }>
    ollama?: Partial<{
      temperature: number
      top_p: number
      top_k: number
      min_p: number
      repeat_penalty: number
      num_predict: number
      seed: number
    }>
  }
}) {
  let lastRaw = ''
  let lastError = 'Unknown parse or validation failure'

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const isRetry = attempt === 1
    const response = await requestStructuredResponse({
      stage: params.stage,
      systemPrompt: isRetry
        ? [
            params.systemPrompt,
            '你正在修复上一轮不合格的 JSON。只修正输出，使其严格满足给定 schema 与内容约束。不要输出解释。',
          ].join('\n\n')
        : params.systemPrompt,
      userPrompt: isRetry
        ? [
            params.userPrompt,
            '',
            '上一轮输出未通过解析或校验，请只返回修正后的 JSON 对象。',
            `失败原因：${lastError}`,
            '上一轮原始输出：',
            lastRaw,
          ].join('\n')
        : params.userPrompt,
      configOverride: params.configOverride,
      requestOptions: params.requestOptions,
    })

    lastRaw = response.raw

    try {
      const validated = params.validate(response.parsed)
      return {
        value: params.postProcess ? params.postProcess(validated) : validated,
        usage: response.usage,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown parse or validation failure'
      if (!isRetry) {
        continue
      }
      throw new Error(`${params.stage} stage failed after 2 attempts: ${lastError}`)
    }
  }

  throw new Error(`${params.stage} stage failed after 2 attempts: ${lastError}`)
}

function buildBridgeSystemPrompt() {
  return [
    '你是 ReTale 的 Future Jump 桥接生成器。',
    '你必须严格依据已保存的源正文、故事状态、目标未来节点，以及提供的 What-if 分歧（如有）。',
    '你只返回一个 JSON 对象，不要解释，不要 markdown，不要额外字段。',
    'bridgeSummary 必须是 300-600 个中文字符，聚焦关系、动机、误会、阵营变化与情绪后果。',
    '不要按章节回顾，不要写成提纲列表，不要生成目标章节正文。',
  ].join('\n')
}

function buildBridgeUserPrompt(params: {
  context: LoadedFutureJumpGenerationContext
  userDirection: string
  userFeedback?: string
}) {
  return [
    '# 任务',
    '请解释：从已保存的源正文与分歧（如有）出发，如何自然演变到目标未来节点。',
    '输出 schema：{"bridgeSummary":"300-600字中文摘要"}',
    '硬性要求：不要逐章复盘；不要写分析；不要写目标正文；必须自然连贯。',
    params.userFeedback?.trim() ? `修订意见：${params.userFeedback.trim()}` : '修订意见：无',
    params.userDirection.trim() ? `额外方向：${params.userDirection.trim()}` : '额外方向：无',
    '',
    '# 源章节上下文',
    `源章节：第 ${params.context.sourceChapter.chapterNo} 章 ${params.context.sourceChapter.title?.trim() || ''}`.trim(),
    params.context.sourceChapter.summary?.trim() ? `源章节摘要：${params.context.sourceChapter.summary.trim()}` : '源章节摘要：未提供',
    '源章节正文摘录：',
    buildSourceChapterExcerpt(params.context.sourceChapter),
    ...(params.context.sourceNodeContext?.authoredText
      ? [
          '',
          '# 当前源节点已保存正文',
          `当前源节点：${params.context.sourceNodeContext.nodeTitle ?? params.context.sourceNodeContext.nodeType}`,
          params.context.generatedHistory?.content || buildSourceNodeAuthoredExcerpt(params.context.sourceNodeContext),
        ]
      : []),
    '',
    '# What-if 分歧与显式变更',
    params.context.deltaSummary,
    '',
    '# 截至源章节的故事状态',
    params.context.baseWorldState,
    '',
    '# 目标未来节点',
    buildTargetReferenceBlock(params.context),
    '',
    '# 最近一次修订（如有）',
    buildRevisionContextBlock(params.context.latestRevisionContext),
  ].join('\n')
}

function buildRewriteUserPrompt(params: {
  context: LoadedFutureJumpGenerationContext
  bridgeSummary: string
  userDirection: string
  userFeedback?: string
}) {
  return [
    '# 任务',
    '请直接生成目标未来节点的小说正文。',
    '输出 schema：{"generatedTargetText":"正文","titleHint":"可选","subtitleHint":"可选"}',
    '硬性要求：只写正文；不要分析；不要章节目录；不要中间章节；允许结果偏离原线，但要保持人物与世界一致。',
    params.userFeedback?.trim() ? `修订意见：${params.userFeedback.trim()}` : '修订意见：无',
    params.userDirection.trim() ? `额外方向：${params.userDirection.trim()}` : '额外方向：无',
    '',
    '# 已确认桥接摘要',
    params.bridgeSummary,
    ...(params.context.sourceNodeContext?.authoredText
      ? [
          '',
          '# 当前源节点已保存正文',
          `当前源节点：${params.context.sourceNodeContext.nodeTitle ?? params.context.sourceNodeContext.nodeType}`,
          params.context.generatedHistory?.content || buildSourceNodeAuthoredExcerpt(params.context.sourceNodeContext),
        ]
      : []),
    '',
    '# What-if 分歧与显式变更',
    params.context.deltaSummary,
    '',
    '# 截至源章节的故事状态',
    params.context.baseWorldState,
    '',
    '# 目标未来节点',
    buildTargetReferenceBlock(params.context),
    '',
    '# 最近一次修订（如有）',
    buildRevisionContextBlock(params.context.latestRevisionContext),
  ].join('\n')
}

function buildDeltaSummary(session: WhatIfSessionDetail | null) {
  return buildDeltaContextLines(session)
}

async function loadGenerationContext(params: {
  novelId: string
  branchId: string
  whatIfSessionId: string | null
  sourceContext: FutureJumpSourceContext
  targetOutlineNodeId: string
  targetOutlineChapterId: string
  futureJumpRunId?: string
  sourceTextSnapshot?: string
  db: Db
}) {
  const session = params.whatIfSessionId ? findWhatIfSessionById(params.whatIfSessionId, params.db) : null
  if (params.whatIfSessionId && !session) throw new ResourceNotFoundError(`What-if session not found: ${params.whatIfSessionId}`)
  if (session && (session.novelId !== params.novelId || session.baseBranchId !== params.branchId)) {
    throw new ResourceNotFoundError('What-if session does not belong to the requested novel/branch')
  }

  const outlineNode = findOutlineNodeById(params.targetOutlineNodeId, params.db)
  if (!outlineNode) {
    throw new ResourceNotFoundError(`Target outline node not found: ${params.targetOutlineNodeId}`)
  }
  if (outlineNode.novelId !== params.novelId || outlineNode.branchId !== params.branchId) {
    throw new ResourceNotFoundError('Target outline node does not belong to the requested novel/branch')
  }

  const targetAnchor = listOutlineNodeChapters(params.targetOutlineNodeId, params.db).find((chapter) => chapter.id === params.targetOutlineChapterId) ?? null
  if (!targetAnchor) {
    throw new ResourceNotFoundError(`Target outline chapter anchor not found: ${params.targetOutlineChapterId}`)
  }
  if (targetAnchor.chapterNo <= params.sourceContext.chapterNo) {
    throw new InputValidationError(
      targetAnchor.chapterNo === params.sourceContext.chapterNo
        ? 'Target chapter must be after the source chapter'
        : 'Target chapter must not be before the source chapter'
    )
  }

  const sourceNode = params.sourceContext.nodeId
    ? findStoryTimelineNodeById(params.sourceContext.nodeId, params.db)
    : null

  if (params.sourceContext.nodeId) {
    if (!sourceNode || sourceNode.branchId !== params.branchId || sourceNode.novelId !== params.novelId) {
      throw new ResourceNotFoundError(`Source timeline node not found: ${params.sourceContext.nodeId}`)
    }
  }

  if (sourceNode && sourceNode.nodeType !== params.sourceContext.nodeType) throw new InputValidationError('Source node type does not match the timeline node')
  if (sourceNode && sourceNode.anchorChapterNo !== params.sourceContext.chapterNo) throw new InputValidationError('Source chapter does not match the timeline node')
  if (!params.futureJumpRunId && params.sourceContext.nodeType !== 'chapter' && !sourceNode) throw new InputValidationError('A source timeline node is required for this source type')
  if (params.sourceContext.nodeType === 'chapter' && params.sourceContext.nodeId) throw new InputValidationError('Chapter sources cannot specify a timeline node')

  let sourceChapter = params.sourceContext.chapterId
    ? params.db.queryOne<LoadedFutureJumpGenerationContext['sourceChapter']>(
        `SELECT id, chapterNo, title, summary, rawText
           FROM KnowledgeChapter
          WHERE id = ? AND novelId = ? AND branchId = ?
          LIMIT 1`,
        params.sourceContext.chapterId,
        params.novelId,
        params.branchId,
      )
    : params.db.queryOne<LoadedFutureJumpGenerationContext['sourceChapter']>(
        `SELECT id, chapterNo, title, summary, rawText
           FROM KnowledgeChapter
          WHERE novelId = ? AND branchId = ? AND chapterNo = ?
          LIMIT 1`,
        params.novelId,
        params.branchId,
        params.sourceContext.chapterNo,
      )
  if (!sourceChapter && params.futureJumpRunId && params.sourceTextSnapshot !== undefined) {
    sourceChapter = { id: null, chapterNo: params.sourceContext.chapterNo, title: null, summary: null, rawText: '' }
  }
  if (!sourceChapter) {
    throw new ResourceNotFoundError(`Source chapter not found for branch context: chapter ${params.sourceContext.chapterNo}`)
  }
  if (sourceChapter.chapterNo !== params.sourceContext.chapterNo) {
    throw new InputValidationError('sourceContext.chapterId must match sourceContext.chapterNo')
  }

  if (params.sourceContext.nodeType === 'chapter' && params.sourceTextSnapshot !== undefined) {
    sourceChapter = { ...sourceChapter, rawText: params.sourceTextSnapshot }
  }

  const targetChapter = targetAnchor.chapterId
    ? params.db.queryOne<LoadedFutureJumpGenerationContext['targetChapter']>(
        `SELECT id, chapterNo, title, summary, rawText
           FROM KnowledgeChapter
          WHERE id = ? AND novelId = ? AND branchId = ?
          LIMIT 1`,
        targetAnchor.chapterId,
        params.novelId,
        params.branchId,
      )
    : params.db.queryOne<LoadedFutureJumpGenerationContext['targetChapter']>(
        `SELECT id, chapterNo, title, summary, rawText
           FROM KnowledgeChapter
          WHERE novelId = ? AND branchId = ? AND chapterNo = ?
          LIMIT 1`,
        params.novelId,
        params.branchId,
        targetAnchor.chapterNo,
      )

  const explicitContext = params.futureJumpRunId
    ? loadExplicitAuthoredContext({
        novelId: params.novelId,
        branchId: params.branchId,
        futureJumpRunId: params.futureJumpRunId,
        db: params.db,
      })
    : null

  const latestRevision = explicitContext?.futureJumpRun?.revisions.at(-1) ?? null
  const generatedHistory = sourceNode ? getGeneratedHistory({
    novelId: params.novelId, branchId: params.branchId, branchContextNodeId: sourceNode.id, branchContextInclusion: 'include_selected',
  }, params.db) : null

  return {
    generatedHistory,
    session,
    sourceContext: {
      ...params.sourceContext,
      whatIfSessionId: params.whatIfSessionId,
      chapterId: sourceChapter.id,
      chapterNo: sourceChapter.chapterNo,
    },
    sourceNodeContext: params.sourceTextSnapshot !== undefined
      ? { nodeType: params.sourceContext.nodeType, nodeTitle: sourceNode?.title ?? null, authoredText: params.sourceTextSnapshot }
      : resolveSourceNodeContext(sourceNode, session, params.db),
    outlineNode,
    targetAnchor,
    sourceChapter,
    targetChapter: {
      id: targetChapter?.id ?? targetAnchor.chapterId,
      chapterNo: targetChapter?.chapterNo ?? targetAnchor.chapterNo,
      title: targetChapter?.title ?? targetAnchor.chapterTitle,
      summary: targetChapter?.summary ?? null,
      rawText: targetChapter?.rawText ?? '',
    },
    baseWorldState: buildKnowledgeExtractionStoryState({
      novelId: params.novelId,
      branchId: params.branchId,
      asOfChapter: sourceChapter.chapterNo,
      currentChapterText: sourceChapter.rawText,
      db: params.db,
    }),
    deltaSummary: buildDeltaSummary(session),
    latestRevisionContext: latestRevision
      ? {
          revisionNo: latestRevision.revisionNo,
          bridgeSummary: latestRevision.bridgeSummary,
          generatedTargetText: latestRevision.generatedTargetText,
        }
      : null,
  } satisfies LoadedFutureJumpGenerationContext
}

export async function generateBridgeSummary(params: {
  context: LoadedFutureJumpGenerationContext
  userDirection?: string
  userFeedback?: string
}) {
  return await runValidatedStage({
    stage: 'bridge',
    systemPrompt: buildBridgeSystemPrompt(),
    userPrompt: buildBridgeUserPrompt({
      context: params.context,
      userDirection: params.userDirection?.trim() || '',
      userFeedback: params.userFeedback,
    }),
    validate: validateBridgeSummary,
  })
}

export async function generateTargetNodeRewrite(params: {
  context: LoadedFutureJumpGenerationContext
  bridgeSummary: string
  userDirection?: string
  userFeedback?: string
  presetCompatRuntimeContext?: PresetCompatPromptRuleRuntimeContext
}) {
  const rewriteSettings = loadStoredAISettings().rewrite
  const runtime = applyPresetCompatCreativeRuntime({
    surfaceId: FUTURE_JUMP_RUNTIME_SURFACE_ID,
    providerDefaults: {
      provider: rewriteSettings.provider,
      openAICompatible: {
        config: rewriteSettings.openAICompatible,
        request: { temperature: 0.7 },
      },
      ollama: {
        config: rewriteSettings.ollama,
        request: { temperature: 0.7 },
      },
    },
    systemPrompt: '',
    userPrompt: buildRewriteUserPrompt({
      context: params.context,
      bridgeSummary: params.bridgeSummary,
      userDirection: params.userDirection?.trim() || '',
      userFeedback: params.userFeedback,
    }),
    promptRuleRuntimeContext: params.presetCompatRuntimeContext,
  })
  const presetCompat = resolveCreativeRoutePresetCompatMetadata({
    runtime,
    blocks: null,
    requestOverride: { present: false, value: null },
    providerDefaultEnabled: false,
    streamSupported: false,
  }).metadata

  const rewrite = await runValidatedStage({
    stage: 'rewrite',
    systemPrompt: runtime.systemPrompt,
    userPrompt: runtime.userPrompt,
    validate: validateTargetRewrite,
    postProcess: (value) => ({
      ...value,
      generatedTargetText: runtime.applyOutputRuntime(value.generatedTargetText).value,
      titleHint: value.titleHint ? runtime.applyOutputRuntime(value.titleHint).value : null,
      subtitleHint: value.subtitleHint ? runtime.applyOutputRuntime(value.subtitleHint).value : null,
    }),
    requestOptions: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
      ? { openAICompatible: runtime.resolvedRuntime.providerRuntime.request }
      : { ollama: runtime.resolvedRuntime.providerRuntime.request.options },
    configOverride: runtime.resolvedRuntime.providerRuntime.provider === 'openai-compatible'
      ? { openAICompatible: runtime.resolvedRuntime.providerRuntime.config }
      : { ollama: runtime.resolvedRuntime.providerRuntime.config },
  })

  return {
    ...rewrite.value,
    usage: rewrite.usage,
    presetCompat,
  }
}

export async function previewFutureJumpContext(input: {
  novelId: string; branchId: string; sourceContext: FutureJumpSourceContext;
  targetOutlineNodeId: string; targetOutlineChapterId: string; userDirection?: string;
}) {
  const db = createNovelDatabaseAccess(input.novelId)
  const context = await loadGenerationContext({ ...input, whatIfSessionId: resolveFutureJumpWhatIfSource({ ...input, db }), db })
  const rewriteSettings = loadStoredAISettings().rewrite
  const runtime = applyPresetCompatCreativeRuntime({
    surfaceId: FUTURE_JUMP_RUNTIME_SURFACE_ID,
    providerDefaults: {
      provider: rewriteSettings.provider,
      openAICompatible: { config: rewriteSettings.openAICompatible, request: { temperature: 0.7 } },
      ollama: { config: rewriteSettings.ollama, request: { temperature: 0.7 } },
    },
    systemPrompt: '',
    userPrompt: buildRewriteUserPrompt({ context, bridgeSummary: '', userDirection: input.userDirection ?? '' }),
  })
  return {
    compression: context.generatedHistory?.preview ?? null,
    tokenEstimate: Math.max(
      estimateTokenCount(`${runtime.systemPrompt}\n${runtime.userPrompt}`) + 500,
      estimateTokenCount(buildBridgeSystemPrompt() + buildBridgeUserPrompt({ context, userDirection: input.userDirection ?? '' })),
    ),
  }
}

export async function generateFutureJump(input: GenerateFutureJumpInput): Promise<FutureJumpMutationResult> {
  const novelId = getRequiredString(input.novelId, 'novelId')
  const branchId = getRequiredString(input.branchId, 'branchId')
  const db = createNovelDatabaseAccess(novelId)
  const targetOutlineNodeId = getRequiredString(input.targetOutlineNodeId, 'targetOutlineNodeId')
  const targetOutlineChapterId = getRequiredString(input.targetOutlineChapterId, 'targetOutlineChapterId')
  const context = await loadGenerationContext({
    novelId,
    branchId,
    whatIfSessionId: resolveFutureJumpWhatIfSource({ novelId, branchId, sourceContext: input.sourceContext, db }),
    sourceContext: input.sourceContext,
    targetOutlineNodeId,
    targetOutlineChapterId,
    db,
  })

  const parentNode = requireOptionalTimelineNodeInBranchContext({ nodeId: input.parentTimelineNodeId, novelId, branchId, label: 'Parent timeline node', db })
  const pendingRun = createFutureJumpRunRecord({
    id: uid('future-jump-run'),
    sourceTextSnapshot: context.sourceContext.nodeType === 'chapter' ? context.sourceChapter.rawText : context.sourceNodeContext?.authoredText ?? '',
    baseBranchId: branchId,
    parentTimelineNodeId: parentNode?.id ?? null,
    sourceContext: context.sourceContext,
    targetOutlineNodeId: context.outlineNode.id,
    targetOutlineChapterId: context.targetAnchor.id,
    sourceChapterNo: context.sourceContext.chapterNo,
    targetChapterNo: context.targetAnchor.chapterNo,
    userDirection: input.userDirection?.trim() || '',
    bridgeSummary: 'pending',
    generatedTargetText: 'pending',
    latestRevisionNo: 1,
    errorMessage: null,
    status: 'pending',
  }, db)

  if (!pendingRun) {
    throw new Error('Failed to create pending future jump run')
  }

  try {
    const { value: bridgeResult, usage: bridgeUsage } = await generateBridgeSummary({
      context,
      userDirection: input.userDirection,
    })
    const bridgeSummary = bridgeResult.bridgeSummary
    const rewrite = await generateTargetNodeRewrite({
      context,
      bridgeSummary,
      userDirection: input.userDirection,
      presetCompatRuntimeContext: {
        ...input.presetCompatRuntimeContext,
        sessionPhase: input.presetCompatRuntimeContext?.sessionPhase ?? 'new_chat',
        supportsVirtualDepth: input.presetCompatRuntimeContext?.supportsVirtualDepth ?? false,
      },
    })
    const run = await appendFutureJumpRevision({
      runId: pendingRun.id,
      revisionKind: 'initial',
      userFeedback: null,
      bridgeSummary,
      generatedTargetText: rewrite.generatedTargetText,
      ...addTokenUsage(bridgeUsage, rewrite.usage),
      status: 'generated',
    }, db)

    if (!run) {
      throw new Error('Failed to finalize future jump run')
    }

    const revision = run.revisions.at(-1)
    if (!revision) {
      throw new Error('Initial future jump revision was not created')
    }

    return {
      run,
      revision,
      titleHint: rewrite.titleHint,
      subtitleHint: rewrite.subtitleHint,
      presetCompat: rewrite.presetCompat,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Future jump generation failed'
    markFutureJumpRunFailed(pendingRun.id, message, db)
    throw new Error(`Future jump generation failed: ${message}`)
  }
}

export async function reviseFutureJump(input: ReviseFutureJumpInput): Promise<FutureJumpMutationResult> {
  const novelId = getRequiredString(input.novelId, 'novelId')
  const branchId = getRequiredString(input.branchId, 'branchId')
  const db = createNovelDatabaseAccess(novelId)
  const runId = getRequiredString(input.runId, 'runId')
  const userFeedback = getRequiredString(input.userFeedback, 'userFeedback')
  const run = findFutureJumpRunById(runId, db)
  if (!run) {
    throw new ResourceNotFoundError(`Future jump run not found: ${runId}`)
  }
  if (run.baseBranchId !== branchId) {
    throw new ResourceNotFoundError('Future jump run does not belong to the requested branch')
  }

  const context = await loadGenerationContext({
    novelId,
    branchId,
    whatIfSessionId: run.sourceContext.whatIfSessionId,
    sourceContext: run.sourceContext,
    targetOutlineNodeId: run.targetOutlineNodeId,
    targetOutlineChapterId: run.targetOutlineChapterId,
    futureJumpRunId: run.id,
    sourceTextSnapshot: run.sourceTextSnapshot,
    db,
  })

  try {
    const { value: bridgeResult, usage: bridgeUsage } = await generateBridgeSummary({
      context,
      userDirection: run.userDirection,
      userFeedback,
    })
    const bridgeSummary = bridgeResult.bridgeSummary
    const rewrite = await generateTargetNodeRewrite({
      context,
      bridgeSummary,
      userDirection: run.userDirection,
      userFeedback,
      presetCompatRuntimeContext: {
        ...input.presetCompatRuntimeContext,
        sessionPhase: input.presetCompatRuntimeContext?.sessionPhase ?? 'continue',
        supportsVirtualDepth: input.presetCompatRuntimeContext?.supportsVirtualDepth ?? false,
      },
    })
    const nextRun = await appendFutureJumpRevision({
      runId: run.id,
      revisionKind: 'revise',
      userFeedback,
      bridgeSummary,
      generatedTargetText: rewrite.generatedTargetText,
      ...addTokenUsage(bridgeUsage, rewrite.usage),
      status: 'revised',
    }, db)

    if (!nextRun) {
      throw new Error('Failed to append future jump revision')
    }

    const revision = nextRun.revisions.at(-1)
    if (!revision) {
      throw new Error('New future jump revision was not created')
    }

    return {
      run: nextRun,
      revision,
      titleHint: rewrite.titleHint,
      subtitleHint: rewrite.subtitleHint,
      presetCompat: rewrite.presetCompat,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Future jump revision failed'
    markFutureJumpRunFailed(run.id, message, db)
    throw new Error(`Future jump revision failed: ${message}`)
  }
}

export async function createFutureJumpRun(rawInput: FutureJumpCreateRequest): Promise<FutureJumpMutationResponse> {
  const input = parseRequestInput(futureJumpCreateRequestSchema, rawInput)
  const db = createNovelDatabaseAccess(input.novelId)
  const outlineNode = findOutlineNodeById(input.targetOutlineNodeId, db)
  if (!outlineNode) {
    throw new ResourceNotFoundError(`Target outline node not found: ${input.targetOutlineNodeId}`)
  }
  if (outlineNode.novelId !== input.novelId) throw new ResourceNotFoundError('Target outline node does not belong to the requested novel')
  const parentNode = requireOptionalTimelineNodeInBranchContext({
    nodeId: input.parentTimelineNodeId,
    novelId: outlineNode.novelId,
    branchId: outlineNode.branchId,
    label: 'Parent timeline node',
    db,
  })

  const generated = await generateFutureJump({
    novelId: outlineNode.novelId,
    branchId: outlineNode.branchId,
    sourceContext: input.sourceContext,
    targetOutlineNodeId: input.targetOutlineNodeId,
    targetOutlineChapterId: input.targetOutlineChapterId,
    parentTimelineNodeId: parentNode?.id ?? null,
    userDirection: input.userDirection ?? undefined,
  })

  const existingNode = findStoryTimelineNodeByFutureJumpRunId(generated.run.id, db)
  let timelineNode = existingNode

  if (!timelineNode) {
    const targetAnchor = listOutlineNodeChapters(generated.run.targetOutlineNodeId, db).find(
      (chapter) => chapter.id === generated.run.targetOutlineChapterId
    )
    if (!targetAnchor) {
      throw new ResourceNotFoundError(`Target outline chapter anchor not found: ${generated.run.targetOutlineChapterId}`)
    }

    const labelIndex = getNextStoryTimelineLabelIndex(outlineNode.novelId, outlineNode.branchId, 'future_jump', db)
    const readableLabel = formatStoryBranchReadableLabel('future_jump', labelIndex)
    const readableLineageLabel = buildChildReadableLineageLabel(parentNode, readableLabel)
    timelineNode = createStoryTimelineNode({
      id: uid('timeline-node'),
      novelId: outlineNode.novelId,
      branchId: outlineNode.branchId,
      nodeType: 'future_jump',
      labelIndex,
      readableLabel,
      readableLineageLabel,
      anchorChapterNo: targetAnchor.chapterNo,
      title: buildFutureJumpNodeTitle({
        readableLineageLabel,
        titleHint: generated.titleHint,
        outlineNode,
        targetAnchor,
      }),
      subtitle: buildFutureJumpNodeSubtitle({
        subtitleHint: generated.subtitleHint,
        userDirection: generated.run.userDirection,
        targetAnchor,
      }),
      parentNodeId: generated.run.parentTimelineNodeId,
      sourceChapterNo: generated.run.sourceChapterNo,
      targetChapterNo: generated.run.targetChapterNo,
      chapterId: targetAnchor.chapterId,
      continueBlockId: null,
      whatIfSessionId: null,
      futureJumpRunId: generated.run.id,
      laneIndex: 0,
      colorToken: 'violet',
      status: generated.run.status,
    }, db)
  }

  return futureJumpMutationResponseSchema.parse({
    runId: generated.run.id,
    timelineNodeId: timelineNode?.id ?? null,
    bridgeSummary: generated.run.bridgeSummary,
    generatedTargetText: generated.run.generatedTargetText,
    presetCompat: generated.presetCompat,
  }) as FutureJumpMutationResponse
}

export async function reviseFutureJumpRun(rawInput: Pick<ReviseFutureJumpInput, 'runId'> & FutureJumpReviseRequest): Promise<FutureJumpMutationResponse> {
  const input = parseRequestInput(futureJumpReviseRequestSchema, rawInput)
  const db = createNovelDatabaseAccess(input.novelId)
  const run = findFutureJumpRunById(rawInput.runId, db)
  if (!run) {
    throw new ResourceNotFoundError(`Future jump run not found: ${rawInput.runId}`)
  }

  const outlineNode = findOutlineNodeById(run.targetOutlineNodeId, db)
  if (!outlineNode) {
    throw new ResourceNotFoundError(`Target outline node not found: ${run.targetOutlineNodeId}`)
  }

  const revised = await reviseFutureJump({
    runId: rawInput.runId,
    novelId: outlineNode.novelId,
    branchId: outlineNode.branchId,
    userFeedback: input.userFeedback,
  })
  const timelineNode = findStoryTimelineNodeByFutureJumpRunId(revised.run.id, db)

  return futureJumpMutationResponseSchema.parse({
    runId: revised.run.id,
    timelineNodeId: timelineNode?.id ?? null,
    bridgeSummary: revised.run.bridgeSummary,
    generatedTargetText: revised.run.generatedTargetText,
    presetCompat: revised.presetCompat,
  }) as FutureJumpMutationResponse
}

export type {
  FutureJumpMutationResult,
  GenerateFutureJumpInput,
  LoadedFutureJumpGenerationContext,
  ReviseFutureJumpInput,
}

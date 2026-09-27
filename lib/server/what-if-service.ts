import { parseRequestInput } from '@/lib/server/request-validation'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { createNovelDatabaseAccess } from '@/lib/server/database-access'
import { writeLlmDebugLog } from '@/lib/server/llm-debug-log'
import { NON_STREAM_PROVIDER_TIMEOUT_MS } from '@/lib/server/provider-request'
import { whatIfCreateRequestSchema, whatIfCreateResponseSchema, whatIfDeltaExtractionSchema } from '@/lib/server/story-branch-contracts'
import { createStoryTimelineNode, getNextStoryTimelineLabelIndex } from '@/lib/server/story-timeline-store'
import { formatStoryBranchReadableLabel, prefixStoryBranchTitle } from '@/lib/story-branch-labels'
import { addWhatIfDelta, createWhatIfSession, findWhatIfSessionById } from '@/lib/server/what-if-store'
import type { OllamaProviderSettings, OpenAICompatibleProviderSettings } from '@/lib/types'
import type { WhatIfCreateRequest, WhatIfCreateResponse } from '@/lib/story-branch-types'
import { uid } from '@/lib/utils'

type ExtractedWhatIfDelta = {
  deltaType: string
  subjectName: string | null
  targetName: string | null
  key: string
  oldValue: string | null
  newValue: string | null
  validFromChapter: number | null
  description: string
  confidence: number | null
}

type StructuredModelResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>
    }
  }>
}

type OllamaChatResponse = {
  message?: {
    content?: string
  }
}

type StructuredModelContent = NonNullable<
  NonNullable<NonNullable<StructuredModelResponse['choices']>[number]['message']>['content']
>

function normalizeModelContent(content: StructuredModelContent | undefined) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .join('')
      .trim()
  }
  return ''
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenced?.[1]?.trim() || trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown
      } catch {
      }
    }
  }

  return null
}

function clampConfidence(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  if (numeric < 0) return 0
  if (numeric > 1) return 1
  return numeric
}

function normalizeDelta(input: Record<string, unknown>, sourceChapterNo: number): ExtractedWhatIfDelta | null {
  const deltaType = String(input.delta_type ?? '').trim()
  const key = String(input.key ?? '').trim()
  const description = String(input.description ?? '').trim()
  if (!deltaType || !key || !description) return null

  const validFromChapterValue = input.valid_from_chapter
  const validFromChapter = typeof validFromChapterValue === 'number' && Number.isInteger(validFromChapterValue) && validFromChapterValue > 0
    ? validFromChapterValue
    : sourceChapterNo

  return {
    deltaType,
    subjectName: typeof input.subject_name === 'string' && input.subject_name.trim() ? input.subject_name.trim() : null,
    targetName: typeof input.target_name === 'string' && input.target_name.trim() ? input.target_name.trim() : null,
    key,
    oldValue: typeof input.old_value === 'string' && input.old_value.trim() ? input.old_value.trim() : null,
    newValue: typeof input.new_value === 'string' && input.new_value.trim() ? input.new_value.trim() : null,
    validFromChapter,
    description,
    confidence: clampConfidence(input.confidence),
  }
}

function buildFallbackDelta(input: WhatIfCreateRequest): ExtractedWhatIfDelta {
  return {
    deltaType: 'speculative_rewrite',
    subjectName: null,
    targetName: null,
    key: 'rewrite_outcome',
    oldValue: input.originalText.trim().slice(0, 160) || null,
    newValue: input.generatedText.trim().slice(0, 160) || null,
    validFromChapter: input.sourceChapterNo,
    description: input.userInstruction.trim() || '基于当前改写结果生成的 What-if 分支。',
    confidence: 0.35,
  }
}

function buildDeltaExtractionMessages(input: WhatIfCreateRequest) {
  return {
    system: [
      'You extract speculative story deltas for ReTale.',
      'This is private entertainment-only speculative state, not authoritative canon.',
      'Return JSON only in the exact shape {"deltas":[...]}.',
      'Every delta must use these fields exactly: delta_type | subject_name | target_name | key | old_value | new_value | valid_from_chapter | description | confidence.',
      'Only include changes that are implied by the rewrite compared with the original text and instruction.',
      'Write descriptions in concise Chinese.',
    ].join(' '),
    user: JSON.stringify({
      task: 'extract_what_if_deltas',
      sourceChapterNo: input.sourceChapterNo,
      userInstruction: input.userInstruction,
      selectedText: input.selectedText,
      originalText: input.originalText,
      generatedText: input.generatedText,
      outputSchema: {
        deltas: [{
          delta_type: 'relationship_change',
          subject_name: '人物A',
          target_name: '人物B',
          key: 'relationship',
          old_value: '旧状态',
          new_value: '新状态',
          valid_from_chapter: input.sourceChapterNo,
          description: '简短中文描述',
          confidence: 0.9,
        }],
      },
    }),
  }
}

async function requestOpenAICompatibleJson(config: OpenAICompatibleProviderSettings, input: WhatIfCreateRequest) {
  if (!config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim()) return null
  const messages = buildDeltaExtractionMessages(input)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NON_STREAM_PROVIDER_TIMEOUT_MS)
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
  const requestMessages = [
    { role: 'system', content: messages.system },
    { role: 'user', content: messages.user },
  ]
  const requestBody = {
    model: config.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: requestMessages,
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    if (!response.ok) {
      await writeLlmDebugLog({
        folder: 'what-if',
        provider: 'openai-compatible',
        model: config.model,
        streamed: false,
        stage: 'delta-extraction',
        request: { url, body: requestBody, messages: requestMessages },
        response: { status: response.status, error: `HTTP ${response.status}` },
      })
      return null
    }
    const data = await response.json() as StructuredModelResponse
    const raw = normalizeModelContent(data.choices?.[0]?.message?.content)
    const parsed = parseJsonObject(raw)
    await writeLlmDebugLog({
      folder: 'what-if',
      provider: 'openai-compatible',
      model: config.model,
      streamed: false,
      stage: 'delta-extraction',
      request: { url, body: requestBody, messages: requestMessages },
      response: { status: response.status, rawText: raw, parsed },
    })
    return parsed
  } catch (error) {
    await writeLlmDebugLog({
      folder: 'what-if',
      provider: 'openai-compatible',
      model: config.model,
      streamed: false,
      stage: 'delta-extraction',
      request: { url, body: requestBody, messages: requestMessages },
      response: { error: error instanceof Error ? error.message : 'What-if delta extraction failed' },
    })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function requestOllamaJson(config: OllamaProviderSettings, input: WhatIfCreateRequest) {
  if (!config.baseUrl.trim() || !config.model.trim()) return null
  const messages = buildDeltaExtractionMessages(input)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NON_STREAM_PROVIDER_TIMEOUT_MS)
  const url = `${config.baseUrl.replace(/\/$/, '')}/api/chat`
  const requestMessages = [
    { role: 'system', content: messages.system },
    { role: 'user', content: messages.user },
  ]
  const requestBody = {
    model: config.model,
    stream: false,
    format: {
      type: 'object',
      properties: {
        deltas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              delta_type: { type: 'string' },
              subject_name: { type: ['string', 'null'] },
              target_name: { type: ['string', 'null'] },
              key: { type: 'string' },
              old_value: { type: ['string', 'null'] },
              new_value: { type: ['string', 'null'] },
              valid_from_chapter: { type: ['integer', 'null'] },
              description: { type: 'string' },
              confidence: { type: ['number', 'null'] },
            },
            required: ['delta_type', 'key', 'description'],
          },
        },
      },
      required: ['deltas'],
    },
    messages: requestMessages,
    options: {
      temperature: 0,
    },
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      await writeLlmDebugLog({
        folder: 'what-if',
        provider: 'ollama',
        model: config.model,
        streamed: false,
        stage: 'delta-extraction',
        request: { url, body: requestBody, messages: requestMessages },
        response: { status: response.status, rawText: text, error: `HTTP ${response.status}` },
      })
      return null
    }
    const data = await response.json() as OllamaChatResponse
    const raw = data.message?.content?.trim() || ''
    const parsed = parseJsonObject(raw)
    await writeLlmDebugLog({
      folder: 'what-if',
      provider: 'ollama',
      model: config.model,
      streamed: false,
      stage: 'delta-extraction',
      request: { url, body: requestBody, messages: requestMessages },
      response: { status: response.status, rawText: raw, parsed },
    })
    return parsed
  } catch (error) {
    await writeLlmDebugLog({
      folder: 'what-if',
      provider: 'ollama',
      model: config.model,
      streamed: false,
      stage: 'delta-extraction',
      request: { url, body: requestBody, messages: requestMessages },
      response: { error: error instanceof Error ? error.message : 'What-if delta extraction failed' },
    })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function extractWhatIfDeltas(input: WhatIfCreateRequest) {
  const rewriteSettings = loadStoredAISettings().rewrite
  let parsed: unknown = null

  if (rewriteSettings.provider === 'openai-compatible') {
    parsed = await requestOpenAICompatibleJson(rewriteSettings.openAICompatible, input)
  } else {
    parsed = await requestOllamaJson(rewriteSettings.ollama, input)
  }

  const validated = whatIfDeltaExtractionSchema.safeParse(parsed)
  const normalized = validated.success
    ? validated.data.deltas
        .map((delta) => normalizeDelta(delta, input.sourceChapterNo))
        .filter((delta): delta is ExtractedWhatIfDelta => Boolean(delta))
    : []

  return normalized.length ? normalized : [buildFallbackDelta(input)]
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

function buildLineTitle(input: WhatIfCreateRequest, topDelta: ExtractedWhatIfDelta) {
  const explicit = sanitizeLineTitle(input.titleHint?.trim() || '')
  if (explicit) return explicit

  const deltaBased = sanitizeLineTitle(topDelta.description)
  if (deltaBased) return deltaBased

  const instructionBased = sanitizeLineTitle(input.userInstruction)
  if (instructionBased) return instructionBased

  return '分歧线'
}

function buildSubtitle(input: WhatIfCreateRequest, topDelta: ExtractedWhatIfDelta) {
  const explicit = input.subtitleHint?.trim()
  if (explicit) return explicit.slice(0, 48)

  const subject = topDelta.subjectName?.trim() || ''
  const target = topDelta.targetName?.trim() ? `→${topDelta.targetName.trim()}` : ''
  const summary = subject || target
    ? `${subject}${target}：${topDelta.description}`.trim()
    : topDelta.description.trim()

  return summary ? summary.slice(0, 48) : input.userInstruction.trim().slice(0, 48) || null
}

export async function createWhatIfSessionFromRewrite(rawInput: WhatIfCreateRequest): Promise<WhatIfCreateResponse> {
  const input = parseRequestInput(whatIfCreateRequestSchema, rawInput)
  const db = createNovelDatabaseAccess(input.novelId)
  const deltas = await extractWhatIfDeltas(input)
  const labelIndex = getNextStoryTimelineLabelIndex(input.novelId, input.branchId, 'what_if', db)
  const readableLabel = formatStoryBranchReadableLabel('what_if', labelIndex)
  const readableLineageLabel = readableLabel
  const topDelta = deltas[0] ?? buildFallbackDelta(input)
  const title = prefixStoryBranchTitle(readableLineageLabel, buildLineTitle(input, topDelta))
  const subtitle = buildSubtitle(input, topDelta)
  const sessionId = uid('what-if-session')
  const timelineNodeId = uid('timeline-node')

  await db.withTransaction(async () => {
    createWhatIfSession({
      id: sessionId,
      novelId: input.novelId,
      baseBranchId: input.branchId,
      sourceChapterNo: input.sourceChapterNo,
      title,
      premise: input.userInstruction,
      selectedText: input.selectedText,
      originalText: input.originalText,
      generatedText: input.generatedText,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      status: 'active',
    }, db)

    for (const delta of deltas) {
      addWhatIfDelta({
        id: uid('what-if-delta'),
        sessionId,
        deltaType: delta.deltaType,
        subjectName: delta.subjectName,
        targetName: delta.targetName,
        subjectEntityId: null,
        targetEntityId: null,
        key: delta.key,
        oldValue: delta.oldValue,
        newValue: delta.newValue,
        validFromChapter: delta.validFromChapter,
        description: delta.description,
        confidence: delta.confidence,
      }, db)
    }

    createStoryTimelineNode({
      id: timelineNodeId,
      novelId: input.novelId,
      branchId: input.branchId,
      nodeType: 'what_if',
      labelIndex,
      readableLabel,
      readableLineageLabel,
      anchorChapterNo: input.sourceChapterNo,
      title,
      subtitle,
      parentNodeId: null,
      sourceChapterNo: input.sourceChapterNo,
      targetChapterNo: null,
      chapterId: null,
      continueBlockId: null,
      whatIfSessionId: sessionId,
      futureJumpRunId: null,
      laneIndex: 0,
      colorToken: 'violet',
      status: 'active',
    }, db)
  })

  const persistedSession = findWhatIfSessionById(sessionId, db)
  const response = {
    sessionId,
    timelineNodeId,
    generatedText: input.generatedText,
    deltas: persistedSession?.deltas ?? [],
    title,
    subtitle,
  } satisfies WhatIfCreateResponse

  return whatIfCreateResponseSchema.parse(response)
}

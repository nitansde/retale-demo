import { normalizeCharacterRoleCardProfile, type CharacterRoleCardProfile } from '@/lib/story-knowledge'
import { loadStoredAISettings } from '@/lib/server/ai-settings'
import { writeLlmDebugLog } from '@/lib/server/llm-debug-log'
import { NON_STREAM_PROVIDER_TIMEOUT_MS } from '@/lib/server/provider-request'

type CandidatePromotionObservation = {
  chapterNo: number
  mentionCount: number
  observation: string | null
  evidenceQuote: string | null
}

export type CandidatePromotionSummary = {
  summary: string
  descriptionDelta: string
  status: string
  profile: CharacterRoleCardProfile
}

function buildFallbackPromotionSummary(params: {
  candidateName: string
  observations: CandidatePromotionObservation[]
}): CandidatePromotionSummary {
  const observationLines = params.observations
    .map((item) => item.observation?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(-3)

  const summary = observationLines[0] ?? `${params.candidateName}在多个章节中持续出现。`

  return {
    summary,
    descriptionDelta: summary,
    status: '活跃',
    profile: {},
  }
}

function buildCandidatePromotionPrompt(params: {
  candidateName: string
  firstSeenChapter: number
  lastSeenChapter: number
  chapterCount: number
  mentionCount: number
  observations: CandidatePromotionObservation[]
}) {
  const observationLines = params.observations
    .sort((left, right) => left.chapterNo - right.chapterNo)
    .map((item) => [
      `- 第 ${item.chapterNo} 章（本章提及 ${item.mentionCount} 次）`,
      item.observation?.trim() ? `观察：${item.observation.trim()}` : '',
      item.evidenceQuote?.trim() ? `证据：${item.evidenceQuote.trim()}` : '',
    ].filter(Boolean).join('｜'))
    .join('\n')

  return [
    '任务：把已累计到晋升阈值的未知人物候选整理成正式角色摘要。',
    '只返回 1 个 JSON 对象。不要输出 markdown、解释或额外字段。',
    '固定字段只能是：summary、description_delta、status、profile。',
    'summary 用 1 句话概括这个角色当前最稳定、可复用的识别信息。',
    'description_delta 保持精简，尽量保留原始措辞，适合作为角色描述补充。',
    'status 用一个简短角色状态，例如“活跃”“登场”“观察中”，不要编造重大剧情变化。',
    'profile 可包含：personality、gender、identity、capability、appearance、body、clothing、speakingStyle、likes。每项都是 { content, note?, evidence? }。无把握就省略。',
    '不要捏造姓名之外的设定；只根据下面的跨章节观察做保守归纳。',
    '最小示例：',
    '{"summary":"灰袍老人多次现身，拄杖而行，嗓音沙哑。","description_delta":"灰袍老人｜拄杖而行｜嗓音沙哑","status":"活跃","profile":{"appearance":{"content":"灰袍老人"},"speakingStyle":{"content":"嗓音沙哑"}}}',
    `候选名：${params.candidateName}`,
    `首次出现章节：第 ${params.firstSeenChapter} 章`,
    `最近出现章节：第 ${params.lastSeenChapter} 章`,
    `累计出现章节数：${params.chapterCount}`,
    `累计提及次数：${params.mentionCount}`,
    '跨章节观察：',
    observationLines || '- 无可用观察',
  ].join('\n\n')
}

function extractOpenAIResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices
  const content = choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

function extractFirstJsonObject(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fencedMatch?.[1]?.trim()) {
    return extractFirstJsonObject(fencedMatch[1].trim())
  }

  const firstBrace = trimmed.indexOf('{')
  if (firstBrace < 0) return trimmed

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = firstBrace; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) {
      return trimmed.slice(firstBrace, index + 1)
    }
  }

  return trimmed.slice(firstBrace)
}

function normalizePromotionSummary(raw: unknown, fallback: CandidatePromotionSummary) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fallback
  }

  const record = raw as Record<string, unknown>
  const summary = typeof record.summary === 'string' && record.summary.trim()
    ? record.summary.trim()
    : fallback.summary
  const descriptionDelta = typeof record.description_delta === 'string' && record.description_delta.trim()
    ? record.description_delta.trim()
    : summary
  const status = typeof record.status === 'string' && record.status.trim()
    ? record.status.trim()
    : fallback.status

  return {
    summary,
    descriptionDelta,
    status,
    profile: normalizeCharacterRoleCardProfile(record.profile),
  }
}

async function requestOpenAICompatiblePromotionSummary(params: {
  prompt: string
  baseUrl: string
  apiKey: string
  model: string
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NON_STREAM_PROVIDER_TIMEOUT_MS)
  const url = `${params.baseUrl.replace(/\/$/, '')}/chat/completions`
  const requestBody = {
    model: params.model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Return exactly one valid JSON object. Never output markdown or commentary.',
      },
      {
        role: 'user',
        content: params.prompt,
      },
    ],
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    const rawText = await response.text()
    await writeLlmDebugLog({
      folder: 'candidate-promotion',
      provider: 'openai-compatible',
      model: params.model,
      streamed: false,
      stage: 'promotion-summary',
      request: { url, body: requestBody, messages: requestBody.messages },
      response: response.ok ? { status: response.status, rawText } : { status: response.status, rawText, error: `HTTP ${response.status}` },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return extractOpenAIResponseText(JSON.parse(rawText))
  } finally {
    clearTimeout(timeout)
  }
}

async function requestOllamaPromotionSummary(params: {
  prompt: string
  baseUrl: string
  model: string
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NON_STREAM_PROVIDER_TIMEOUT_MS)
  const url = `${params.baseUrl.replace(/\/$/, '')}/api/chat`
  const requestBody = {
    model: params.model,
    stream: false,
    format: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        description_delta: { type: 'string' },
        status: { type: 'string' },
        profile: { type: 'object' },
      },
      required: ['summary', 'description_delta', 'status', 'profile'],
    },
    messages: [
      {
        role: 'system',
        content: 'Return exactly one valid JSON object. Never output markdown or commentary.',
      },
      {
        role: 'user',
        content: params.prompt,
      },
    ],
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

    const rawText = await response.text()
    await writeLlmDebugLog({
      folder: 'candidate-promotion',
      provider: 'ollama',
      model: params.model,
      streamed: false,
      stage: 'promotion-summary',
      request: { url, body: requestBody, messages: requestBody.messages },
      response: response.ok ? { status: response.status, rawText } : { status: response.status, rawText, error: `Ollama HTTP ${response.status}` },
    })

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`)
    }

    const parsed = JSON.parse(rawText) as { message?: { content?: string } }
    return parsed.message?.content?.trim() ?? ''
  } finally {
    clearTimeout(timeout)
  }
}

export async function generateCandidatePromotionSummary(params: {
  candidateName: string
  firstSeenChapter: number
  lastSeenChapter: number
  chapterCount: number
  mentionCount: number
  observations: CandidatePromotionObservation[]
}): Promise<CandidatePromotionSummary> {
  const fallback = buildFallbackPromotionSummary({
    candidateName: params.candidateName,
    observations: params.observations,
  })
  const prompt = buildCandidatePromotionPrompt(params)
  const settings = loadStoredAISettings().knowledgeExtraction

  try {
    let rawContent = ''
    if (settings.provider === 'openai-compatible' && settings.openAICompatible.configured && settings.openAICompatible.apiKey.trim()) {
      rawContent = await requestOpenAICompatiblePromotionSummary({
        prompt,
        baseUrl: settings.openAICompatible.baseUrl,
        apiKey: settings.openAICompatible.apiKey,
        model: settings.openAICompatible.model,
      })
    } else if (settings.provider === 'ollama' && settings.ollama.configured && settings.ollama.model.trim()) {
      rawContent = await requestOllamaPromotionSummary({
        prompt,
        baseUrl: settings.ollama.baseUrl,
        model: settings.ollama.model,
      })
    } else {
      return fallback
    }

    if (!rawContent) {
      return fallback
    }

    const parsed = JSON.parse(extractFirstJsonObject(rawContent)) as unknown
    return normalizePromotionSummary(parsed, fallback)
  } catch {
    return fallback
  }
}

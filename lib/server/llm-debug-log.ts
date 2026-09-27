import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type LlmDebugProvider = 'openai-compatible' | 'ollama'

export type LlmDebugOutputTransformCandidate = {
  preRegexText: string
  postRegexText: string
}

export type LlmDebugOutputTransform = {
  preRegexText?: string
  postRegexText?: string
  candidates?: LlmDebugOutputTransformCandidate[]
}

export type LlmDebugLogParams = {
  folder: string
  provider: LlmDebugProvider
  model: string
  streamed: boolean
  stage?: string
  attempt?: number
  presetCompat?: unknown
  request: {
    url: string
    body: unknown
    messages?: Array<{ role: string; content: string }>
  }
  response: {
    status?: number
    rawText?: string
    parsed?: unknown
    outputTransform?: LlmDebugOutputTransform
    error?: string
    partial?: boolean
  }
}

function isLlmDebugLogEnabled() {
  return process.env.LLM_DEBUG_LOG === '1'
}

function getLogRoot() {
  const configured = process.env.LLM_DEBUG_LOG_DIR?.trim()
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'logs', 'llm-debug')
}

function safePathSegment(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  return normalized || 'unknown'
}

function safeFolderPath(folder: string) {
  return folder
    .split('/')
    .map(safePathSegment)
    .join(path.sep)
}

function buildFileName(params: LlmDebugLogParams) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const parts = [
    timestamp,
    params.provider,
    params.stage,
    typeof params.attempt === 'number' ? `attempt-${params.attempt + 1}` : undefined,
    randomUUID(),
  ].filter((part): part is string => Boolean(part))

  return `${parts.map(safePathSegment).join('__')}.json`
}

function redactUrlCredentials(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.username) parsed.username = 'redacted'
    if (parsed.password) parsed.password = 'redacted'
    return parsed.toString()
  } catch {
    return url
  }
}

export async function writeLlmDebugLog(params: LlmDebugLogParams) {
  if (!isLlmDebugLogEnabled()) return

  try {
    const directory = path.join(getLogRoot(), safeFolderPath(params.folder))
    await fs.mkdir(directory, { recursive: true })
    const filePath = path.join(directory, buildFileName(params))
    const payload = {
      createdAt: new Date().toISOString(),
      provider: params.provider,
      model: params.model,
      streamed: params.streamed,
      stage: params.stage,
      attempt: params.attempt,
      ...(params.presetCompat === undefined ? {} : { presetCompat: params.presetCompat }),
      request: {
        ...params.request,
        url: redactUrlCredentials(params.request.url),
      },
      response: params.response,
    }
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
  }
}

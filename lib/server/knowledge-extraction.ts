import { setTimeout as sleep } from 'node:timers/promises'
import type { Chapter, KnowledgeExtractionScenarioSettings } from '@/lib/types'
import { type ChapterKnowledgeExtraction } from '@/lib/story-knowledge'
import { extractChapterKnowledgeWithOpenAICompatible } from '@/lib/server/openai-compatible'
import { extractChapterKnowledgeWithOllama } from '@/lib/server/ollama-local'

type KnowledgeProvider = 'openai-compatible' | 'ollama'

type KnowledgeExtractionRetryBucket = {
  consecutiveFailures: number
  cooldownUntil: number
  retryTail: Promise<void>
}

const INITIAL_RETRY_COOLDOWN_MS = 15_000
const MAX_RETRY_COOLDOWN_MS = 60 * 60 * 1000
const retryBuckets = new Map<string, KnowledgeExtractionRetryBucket>()

export type OfflineExtractionResult = {
  extraction: ChapterKnowledgeExtraction
  provider: KnowledgeProvider | 'fallback'
  model?: string
}

function buildFallbackExtraction(rawText: string, chapterNo: number): ChapterKnowledgeExtraction {
  const summaryEvent = buildConservativeSummaryEvent(rawText, chapterNo, rawText.replace(/\s+/g, ' ').trim().slice(0, 180))
  const summarySource = rawText.replace(/\s+/g, ' ').trim()
  const summary = summarySource ? summarySource.slice(0, 180) : `第 ${chapterNo} 章`
  return {
    chapterNo,
    summary,
    characters: [],
    knownCharacterUpdates: [],
    unknownCharacterObservations: [],
    aliasDiscoveries: [],
    relations: [],
    events: summaryEvent ? [summaryEvent] : [],
    worldbuilding: [],
    openThreads: [],
  }
}

function buildConservativeSummaryEvent(rawText: string, chapterNo: number, summary: string) {
  const normalizedSummary = summary.trim()
  if (!normalizedSummary) {
    return null
  }

  const firstNumberedLine = rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .find((item) => item.line)

  const eventNameSource = normalizedSummary.split(/[，。；：,.!?！？]/)[0]?.trim() ?? normalizedSummary
  const eventName = eventNameSource.length <= 24 ? eventNameSource : `${eventNameSource.slice(0, 24).trim()}…`

  return {
    name: eventName || `第 ${chapterNo} 章`,
    summary: normalizedSummary,
    eventType: 'story',
    participants: [],
    consequences: '',
    importance: 2,
    evidence: firstNumberedLine
      ? [{ quote: firstNumberedLine.line.slice(0, 140), lineStart: firstNumberedLine.lineNumber, lineEnd: firstNumberedLine.lineNumber }]
      : [],
  }
}

function ensureTimelineCoverage(extraction: ChapterKnowledgeExtraction, rawText: string) {
  if (extraction.events.length > 0) {
    return extraction
  }

  const summaryEvent = buildConservativeSummaryEvent(rawText, extraction.chapterNo, extraction.summary)
  if (!summaryEvent) {
    return extraction
  }

  return {
    ...extraction,
    events: [summaryEvent],
  }
}

function getRetryBucketKey(settings: KnowledgeExtractionScenarioSettings) {
  const providerSettings = settings.provider === 'openai-compatible'
    ? settings.openAICompatible
    : settings.ollama

  return [settings.provider, providerSettings.baseUrl.trim(), providerSettings.model.trim()].join('::')
}

function getRetryBucket(settings: KnowledgeExtractionScenarioSettings) {
  const key = getRetryBucketKey(settings)
  const existing = retryBuckets.get(key)
  if (existing) {
    return existing
  }

  const created: KnowledgeExtractionRetryBucket = {
    consecutiveFailures: 0,
    cooldownUntil: 0,
    retryTail: Promise.resolve(),
  }
  retryBuckets.set(key, created)
  return created
}

function markRetrySuccess(bucket: KnowledgeExtractionRetryBucket) {
  bucket.consecutiveFailures = 0
  bucket.cooldownUntil = 0
}

function markRetryFailure(bucket: KnowledgeExtractionRetryBucket) {
  bucket.consecutiveFailures += 1
  const cooldownMs = Math.min(
    MAX_RETRY_COOLDOWN_MS,
    INITIAL_RETRY_COOLDOWN_MS * 2 ** Math.max(0, bucket.consecutiveFailures - 1)
  )
  bucket.cooldownUntil = Date.now() + cooldownMs
}

async function waitForRetryCooldown(ms: number, assertCanContinue?: () => void | Promise<void>) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await assertCanContinue?.()
    const remaining = deadline - Date.now()
    await sleep(Math.min(1000, remaining))
  }
  await assertCanContinue?.()
}

async function runSerializedRetry<T>(bucket: KnowledgeExtractionRetryBucket, task: () => Promise<T>) {
  const previous = bucket.retryTail
  let release: () => void = () => {}
  bucket.retryTail = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous
  try {
    return await task()
  } finally {
    release()
  }
}

async function performProviderExtraction(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
  storyStateText?: string
  mode: 'full' | 'focused'
  settings: KnowledgeExtractionScenarioSettings
}) {
  if (params.settings.provider === 'openai-compatible') {
    return await extractChapterKnowledgeWithOpenAICompatible(params, params.settings.openAICompatible)
  }
  return await extractChapterKnowledgeWithOllama(params, params.settings.ollama)
}

async function runProviderExtraction(params: {
  chapterTitle: string
  chapterNo: number
  rawText: string
  storyStateText?: string
  mode: 'full' | 'focused'
  settings: KnowledgeExtractionScenarioSettings
  assertCanContinue?: () => void | Promise<void>
}) {
  const bucket = getRetryBucket(params.settings)
  const attempt = async () => performProviderExtraction(params)

  const firstResult = await attempt()
  if (!firstResult.enabled) {
    return firstResult
  }
  if (firstResult.extraction) {
    markRetrySuccess(bucket)
    return firstResult
  }

  markRetryFailure(bucket)

  return await runSerializedRetry(bucket, async () => {
    const cooldownMs = Math.max(0, bucket.cooldownUntil - Date.now())
    if (cooldownMs > 0) {
      await waitForRetryCooldown(cooldownMs, params.assertCanContinue)
    }

    await params.assertCanContinue?.()
    const retryResult = await attempt()
    if (!retryResult.enabled) {
      return retryResult
    }
    if (retryResult.extraction) {
      markRetrySuccess(bucket)
      return retryResult
    }

    markRetryFailure(bucket)
    return retryResult
  })
}

export async function extractChapterKnowledgeOffline(params: {
  chapter: Chapter
  chapterNo: number
  storyStateText?: string
  settings: KnowledgeExtractionScenarioSettings
  assertCanContinue?: () => void | Promise<void>
}): Promise<OfflineExtractionResult> {
  const rawText = params.chapter.content
    .replace(/<\/p>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

  const provider = params.settings.provider
  const primary = await runProviderExtraction({
    chapterTitle: params.chapter.title,
    chapterNo: params.chapterNo,
    rawText,
    storyStateText: params.storyStateText,
    mode: 'full',
    settings: params.settings,
    assertCanContinue: params.assertCanContinue,
  })

  if (primary.enabled && primary.extraction) {
    return {
      extraction: ensureTimelineCoverage(primary.extraction, rawText),
      provider,
      model: primary.model,
    }
  }

  if (primary.error) {
    console.error('Knowledge extraction falling back to conservative projection', {
      chapterTitle: params.chapter.title,
      chapterNo: params.chapterNo,
      error: primary.error,
      model: primary.model,
      provider,
    })
  }

  return {
    extraction: buildFallbackExtraction(rawText, params.chapterNo),
    provider: 'fallback',
    model: primary.model,
  }
}

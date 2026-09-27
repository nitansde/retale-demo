import { WRITING_SKILL_DEFAULTS } from '@/lib/writing-skill-defaults'
import {
  createSeededRandom,
  loadMaterialLibrary,
  readMaterialLibraryVersion,
  resolveInternalMaterialRange,
  type MaterialLibrary,
} from '@/lib/server/writing-skill-material'
import {
  listWritingSkillCards,
  listWritingSkillCardSources,
  markWritingSkillCardStale,
  markWritingSkillCardsStaleForLibraryVersion,
  readWritingSkillCardDetail,
  type WritingSkillStoreDb,
} from '@/lib/server/writing-skill-store'
import { loadWritingSkillMaterialCollection, readWritingSkillMaterialCollectionVersion } from '@/lib/server/writing-skill-sources'
import type {
  ResolvedSkillExample,
  WritingSkillCard,
  WritingSkillCardDetail,
  WritingSkillExample,
  WritingSkillRuntimeRecord,
} from '@/lib/writing-skill-types'
import {
  buildWritingSkillPromptBlockId,
  normalizeWritingSkillCardIds,
} from '@/lib/writing-skill-selection'

function shuffle<T>(items: T[], random: () => number) {
  const next = items.slice()
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[next[index], next[target]] = [next[target], next[index]]
  }
  return next
}

function exampleChapterId(example: WritingSkillExample) {
  return example.rangeRef.chapterId
}

function loadWritingSkillCardLibrary(card: WritingSkillCard, db?: WritingSkillStoreDb) {
  if (!card.libraryId.startsWith('writing-skill-collection:')) {
    return loadMaterialLibrary(card.libraryId)
  }
  const sourceRefs = listWritingSkillCardSources(card.id, db).map(({ sourceType, sourceId }) => ({
    sourceType,
    sourceId,
  }))
  return loadWritingSkillMaterialCollection(sourceRefs, { db }).library
}

export function chooseWritingSkillExamples(input: {
  examples: WritingSkillExample[]
  count: number
  seed: number
}) {
  const count = Math.max(0, Math.floor(input.count))
  if (!count) return []
  const random = createSeededRandom(input.seed)
  const tiers = [
    input.examples.filter((example) => example.score >= 0.85),
    input.examples.filter((example) => example.score >= 0.65 && example.score < 0.85),
    input.examples.filter((example) => example.score < 0.65),
  ].map((tier) => shuffle(tier, random))
  const ordered = tiers.flat()
  const seededOrder = new Map(ordered.map((example, index) => [example.id, index]))
  const scoreTier = (example: WritingSkillExample) => (
    example.score >= 0.85 ? 0 : example.score >= 0.65 ? 1 : 2
  )

  const selected: WritingSkillExample[] = []
  const remaining = ordered.slice()
  while (selected.length < count && remaining.length) {
    remaining.sort((left, right) => {
      const chapterPenalty = Number(selected.some((item) => exampleChapterId(item) === exampleChapterId(left)))
        - Number(selected.some((item) => exampleChapterId(item) === exampleChapterId(right)))
      if (chapterPenalty !== 0) return chapterPenalty
      const tierPenalty = scoreTier(left) - scoreTier(right)
      if (tierPenalty !== 0) return tierPenalty
      return (seededOrder.get(left.id) ?? 0) - (seededOrder.get(right.id) ?? 0)
    })
    selected.push(remaining.shift()!)
  }
  return selected
}

export function selectSkillExamples(input: {
  cardId: string
  count: number
  seed: number
  db?: WritingSkillStoreDb
  library?: MaterialLibrary
}) {
  const card = readWritingSkillCardDetail(input.cardId, input.db)
  if (!card) throw new Error('写作技巧卡不存在')
  if (card.status !== 'ACTIVE') throw new Error('这张写作技巧卡当前不可用')
  const library = input.library ?? loadWritingSkillCardLibrary(card, input.db)
  if (library.version !== card.libraryVersion) {
    markWritingSkillCardsStaleForLibraryVersion(card.libraryId, library.version, input.db)
    throw new Error('这张写作技巧卡引用的素材库版本已经过期，请重新提炼')
  }

  const valid = card.examples.filter((example) => (
    example.enabled && Boolean(resolveInternalMaterialRange(library, example.rangeRef))
  ))
  return chooseWritingSkillExamples({
    examples: valid,
    count: Math.min(input.count, WRITING_SKILL_DEFAULTS.maxRuntimeExampleCount),
    seed: input.seed,
  })
}

export function resolveWritingSkillExamples(input: {
  cardId: string
  count: number
  seed: number
  db?: WritingSkillStoreDb
  library?: MaterialLibrary
}) {
  const card = readWritingSkillCardDetail(input.cardId, input.db)
  if (!card) throw new Error('写作技巧卡不存在')
  const library = input.library ?? loadWritingSkillCardLibrary(card, input.db)
  const examples = selectSkillExamples({ ...input, library })
  const resolved = examples.flatMap((example) => {
    const resolvedExample = resolveWritingSkillExample(library, example)
    return resolvedExample ? [resolvedExample] : []
  })
  return { card, examples: resolved }
}

function resolveWritingSkillExample(
  library: MaterialLibrary,
  example: WritingSkillExample,
): ResolvedSkillExample | null {
  const range = resolveInternalMaterialRange(library, example.rangeRef)
  if (!range) return null
  const paragraphs = library.paragraphs.filter((paragraph) => (
    paragraph.chapterId === range.start.chapterId
    && paragraph.paragraphIndex >= range.start.paragraphIndex
    && paragraph.paragraphIndex <= range.end.paragraphIndex
  ))
  if (!paragraphs.length) return null
  return {
    ...example,
    anonymizedText: paragraphs.map((paragraph) => paragraph.anonymizedText).join('\n\n'),
  }
}

export function resolveWritingSkillCardDetail(input: {
  cardId: string
  db?: WritingSkillStoreDb
  library?: MaterialLibrary
}): WritingSkillCardDetail | null {
  const card = readWritingSkillCardDetail(input.cardId, input.db)
  if (!card) return null
  let library = input.library
  if (!library) {
    try {
      library = loadWritingSkillCardLibrary(card, input.db)
    } catch {
      return {
        ...card,
        examples: card.examples.map((example) => ({ ...example, anonymizedText: null })),
      }
    }
  }
  return {
    ...card,
    examples: card.examples.map((example) => ({
      ...example,
      anonymizedText: resolveWritingSkillExample(library, example)?.anonymizedText ?? null,
    })),
  }
}

const CHINESE_EXAMPLE_NUMERALS = ['一', '二', '三', '四', '五']

export function compileWritingSkillPrompt(card: WritingSkillCard, examples: ResolvedSkillExample[]) {
  return [
    `## 本次指定写作技巧：${card.title}`,
    '',
    '### 技巧概述',
    card.summary,
    '',
    '### 写作方法',
    ...card.rules.map((rule, index) => `${index + 1}. ${rule.text}`),
    '',
    '### 适用范围',
    card.applicationScope,
    '',
    '### 避免',
    ...card.avoid.map((item) => `- ${item}`),
    '',
    '### 参考范文',
    ...examples.flatMap((example, index) => [
      `范文${CHINESE_EXAMPLE_NUMERALS[index] ?? index + 1}：`,
      example.anonymizedText,
      '',
    ]),
    '只学习这些范文的描写方法、信息组织和细节选择。',
    '不得复制其中的具体措辞、人物、设定或情节。',
    '不得改变当前小说中已经确定的人物外貌、关系、世界观和事件结果。',
  ].join('\n').trim()
}

export function resolveWritingSkillRuntime(input: {
  cardId: string
  count?: number
  seed: number
  db?: WritingSkillStoreDb
  library?: MaterialLibrary
}) {
  const detail = readWritingSkillCardDetail(input.cardId, input.db)
  if (!detail) throw new Error('写作技巧卡不存在')
  const count = Math.min(
    Math.max(1, Math.floor(input.count ?? detail.defaultExampleCount)),
    WRITING_SKILL_DEFAULTS.maxRuntimeExampleCount,
  )
  const { card, examples } = resolveWritingSkillExamples({
    cardId: input.cardId,
    count,
    seed: input.seed,
    db: input.db,
    library: input.library,
  })
  const record: WritingSkillRuntimeRecord = {
    skillCardId: card.id,
    exampleCount: examples.length,
    seed: input.seed,
    selectedExampleRefs: examples.map((example) => example.displayRef),
  }
  return {
    card,
    examples,
    prompt: compileWritingSkillPrompt(card, examples),
    record,
  }
}

export function resolveWritingSkillRuntimes(input: {
  cardIds: string[]
  count?: number
  seed: number
  db?: WritingSkillStoreDb
  library?: MaterialLibrary
}) {
  const cardIds = normalizeWritingSkillCardIds({ writingSkillCardIds: input.cardIds })
  const libraries = new Map<string, MaterialLibrary>()
  const runtimes = cardIds.map((cardId) => {
    const card = readWritingSkillCardDetail(cardId, input.db)
    if (!card) throw new Error('写作技巧卡不存在')
    let library = input.library ?? libraries.get(card.libraryId)
    if (!library) {
      library = loadWritingSkillCardLibrary(card, input.db)
      libraries.set(card.libraryId, library)
    }
    return resolveWritingSkillRuntime({ cardId, count: input.count, seed: input.seed, db: input.db, library })
  })

  return {
    runtimes,
    records: runtimes.map((runtime) => runtime.record),
    prompt: runtimes.map((runtime) => runtime.prompt).join('\n\n'),
    blocks: runtimes.map((runtime) => ({
      id: buildWritingSkillPromptBlockId(runtime.card.id),
      label: `写作技巧：${runtime.card.title}`,
      enabled: true,
      priority: 'highest' as const,
      content: runtime.prompt,
    })),
  }
}

export function refreshWritingSkillCardStaleness(db?: WritingSkillStoreDb) {
  const cards = listWritingSkillCards({}, db)
  const versions = new Map<string, string | null>()
  const sourceVersions = new Map<string, string | null>()
  for (const card of cards) {
    if (!card.libraryId.startsWith('writing-skill-collection:')) {
      if (versions.has(card.libraryId)) continue
      const version = readMaterialLibraryVersion(card.libraryId)
      versions.set(card.libraryId, version)
      markWritingSkillCardsStaleForLibraryVersion(card.libraryId, version, db)
      continue
    }
    try {
      if (!versions.has(card.libraryId)) {
        const sourceRefs = listWritingSkillCardSources(card.id, db)
        versions.set(card.libraryId, readWritingSkillMaterialCollectionVersion(sourceRefs, { db, sourceVersions }))
      }
      const version = versions.get(card.libraryId)
      if (version !== card.libraryVersion) markWritingSkillCardStale(card.id, db)
    } catch {
      versions.set(card.libraryId, null)
      markWritingSkillCardStale(card.id, db)
    }
  }
  return versions
}
